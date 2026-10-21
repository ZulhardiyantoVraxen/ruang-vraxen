import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { UsageService } from "../usage/usage.service";
import { TasksService } from "../tasks/tasks.service";
import { MeetingRoomType, MeetingRoomStatus, Prisma } from "@prisma/client";

const AGENT_WITH_ROLE = {
  agentRole: { include: { modelClass: true, division: true } },
} satisfies Prisma.AgentInclude;

const ROOM_WITH_DETAIL = {
  participants: { include: { agent: { include: AGENT_WITH_ROLE } } },
  messages: { orderBy: { createdAt: "asc" as const }, include: { senderAgent: true } },
} satisfies Prisma.MeetingRoomInclude;

const TRANSCRIPT_WINDOW = 40; // enough roundtable turns for context without ballooning every model call

/**
 * Point 4: "dua meeting-room construct - satu privat Direktur+CEO, satu
 * terbuka untuk semua tim yang diundang."
 *
 * Unlike ChatService (one agent, one thread, synchronous classify-or-reply),
 * a meeting room has several agents sharing one transcript. Every message
 * the Director posts triggers EVERY participant to generate its own reply,
 * in turn order, so each later agent in the same round already sees the
 * earlier ones' replies - a real roundtable, not N independent 1:1 chats
 * glued together. Replies go through the same self-healing OpenRouter chain
 * (chatWithFallback) as everything else in the platform; a participant whose
 * entire fallback chain fails is skipped for that round rather than blocking
 * the others or polluting the thread with an error message.
 *
 * "Task akan masuk dari hasil meeting dengan Staff Direksi" - the PIC Chief
 * of Staff page (a standalone "give work directly" form) was retired once
 * this existed, so a meeting has to be able to actually produce a real Task
 * on its own, not just a chat transcript. Each participant's reply is
 * classified the same way ChatService classifies a 1:1 chat reply: a work
 * order clearly directed at that participant becomes a real Task (via
 * TasksService.createDirectCommand, landing in THAT agent's own division)
 * instead of a plain message, with a short system note taking its place in
 * the transcript so the meeting stays coherent.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelRouting: OpenRouterService,
    private readonly usage: UsageService,
    private readonly tasks: TasksService,
  ) {}

  list(status?: string) {
    return this.prisma.meetingRoom.findMany({
      where: status ? { status: status as MeetingRoomStatus } : undefined,
      orderBy: { updatedAt: "desc" },
      include: { participants: { include: { agent: true } } },
    });
  }

  async get(roomId: string) {
    const room = await this.prisma.meetingRoom.findUnique({ where: { id: roomId }, include: ROOM_WITH_DETAIL });
    if (!room) throw new NotFoundException(`Meeting room ${roomId} tidak ditemukan`);
    return room;
  }

  /**
   * Resolves (and lazily creates, exactly once) the standing private room
   * between the Director and Edward (CEO, Staff Direksi) - "satu privat
   * Direktur+CEO". Idempotent: a second call never creates a duplicate, it
   * just returns the existing ACTIVE room.
   */
  async ensureDirectorCeoRoom() {
    const existing = await this.prisma.meetingRoom.findFirst({
      where: { type: "DIRECTOR_CEO", status: "ACTIVE" },
      include: ROOM_WITH_DETAIL,
    });
    if (existing) return existing;

    const ceoRole = await this.prisma.agentRole.findFirst({
      where: { name: { equals: "CEO", mode: "insensitive" }, division: { slug: "staff-direksi" } },
      include: { agents: true },
    });
    const ceo = ceoRole?.agents[0];
    if (!ceo) throw new BadRequestException("Agent CEO (Staff Direksi) tidak ditemukan - jalankan seed lebih dulu");

    const created = await this.prisma.meetingRoom.create({
      data: {
        type: "DIRECTOR_CEO" as MeetingRoomType,
        title: "Rapat Direktur & CEO",
        participants: { create: [{ agentId: ceo.id }] },
      },
      include: ROOM_WITH_DETAIL,
    });
    return created;
  }

  /** "Terbuka untuk semua tim yang diundang" - ad hoc per topik, roster dipilih Direktur saat dibuat. */
  async createOpenRoom(title: string, inviteAgentIds: string[]) {
    const agents = await this.prisma.agent.findMany({ where: { id: { in: inviteAgentIds } } });
    if (agents.length !== new Set(inviteAgentIds).size) {
      throw new BadRequestException("Satu atau lebih agentId yang diundang tidak ditemukan");
    }

    return this.prisma.meetingRoom.create({
      data: {
        type: "OPEN" as MeetingRoomType,
        title,
        participants: { create: inviteAgentIds.map((agentId) => ({ agentId })) },
      },
      include: ROOM_WITH_DETAIL,
    });
  }

  async invite(roomId: string, agentId: string) {
    const room = await this.prisma.meetingRoom.findUniqueOrThrow({ where: { id: roomId } });
    if (room.type !== "OPEN") throw new BadRequestException("Rapat privat Direktur-CEO tidak bisa menerima undangan baru");
    if (room.status !== "ACTIVE") throw new BadRequestException("Rapat ini sudah ditutup");

    await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    await this.prisma.meetingParticipant.upsert({
      where: { meetingRoomId_agentId: { meetingRoomId: roomId, agentId } },
      create: { meetingRoomId: roomId, agentId },
      update: {},
    });
    return this.get(roomId);
  }

  async close(roomId: string) {
    const room = await this.prisma.meetingRoom.findUniqueOrThrow({ where: { id: roomId } });
    if (room.type !== "OPEN") throw new BadRequestException("Rapat privat Direktur-CEO selalu terbuka, tidak bisa ditutup");
    await this.prisma.meetingRoom.update({ where: { id: roomId }, data: { status: "CLOSED" as MeetingRoomStatus } });
    return this.get(roomId);
  }

  /**
   * Director posts one message; every participant replies in turn,
   * sequentially, each seeing the replies already posted earlier in this
   * same round - returns every message created during this call (the
   * Director's own plus each reply that succeeded).
   */
  async sendMessage(roomId: string, content: string) {
    const room = await this.prisma.meetingRoom.findUnique({
      where: { id: roomId },
      include: { participants: { include: { agent: { include: AGENT_WITH_ROLE } } } },
    });
    if (!room) throw new NotFoundException(`Meeting room ${roomId} tidak ditemukan`);
    if (room.status !== "ACTIVE") throw new BadRequestException("Rapat ini sudah ditutup");

    const created = [
      await this.prisma.meetingMessage.create({
        data: { meetingRoomId: roomId, senderType: "DIRECTOR", content },
      }),
    ];
    const failures: { agentId: string; agentName: string; reason: string }[] = [];

    for (const participant of room.participants) {
      const agent = participant.agent;
      const transcript = await this.prisma.meetingMessage.findMany({
        where: { meetingRoomId: roomId },
        orderBy: { createdAt: "desc" },
        take: TRANSCRIPT_WINDOW,
        include: { senderAgent: true },
      });
      const transcriptText = transcript
        .reverse()
        .map((m) => `${m.senderType === "DIRECTOR" ? "Direktur" : m.senderAgent?.displayName ?? "Agent"}: ${m.content}`)
        .join("\n");

      const otherParticipants = room.participants
        .filter((p) => p.agentId !== agent.id)
        .map((p) => `${p.agent.displayName} (${p.agent.agentRole.name})`)
        .join(", ");

      const systemPrompt = `Kamu adalah ${agent.displayName}, ${agent.agentRole.name} di divisi ${agent.agentRole.division.name}.${
        agent.agentRole.responsibilities ? ` Tanggung jawabmu: ${agent.agentRole.responsibilities}.` : ""
      }
Kamu sedang rapat berjudul "${room.title}" bersama Direktur${otherParticipants ? ` dan: ${otherParticipants}` : ""}.
Berikut transkrip rapat sejauh ini (urut dari lama ke baru):

${transcriptText}

Berikan tanggapanmu sebagai ${agent.displayName} terhadap perkembangan terbaru di atas - singkat, relevan dengan peranmu, dan dalam Bahasa Indonesia. Kalau tidak ada yang perlu kamu tambahkan dari sisi perananmu, cukup bilang itu secara singkat (jangan mengulang pendapat yang sudah disampaikan orang lain).

ATURAN PALING PENTING: lihat pesan TERAKHIR dari Direktur saja untuk memutuskan ini.
- Kalau pesan itu OBROLAN/DISKUSI/KOORDINASI BIASA (update status, pertanyaan, pendapat) -> balas sebagai teks natural seperti di atas. JANGAN pernah balas JSON untuk kasus ini.
- Kalau pesan itu benar-benar PERINTAH KERJA/TUGAS BARU yang jelas ditujukan untukmu secara spesifik (disebut namamu, atau jelas satu-satunya yang relevan dari perananmu) -> balas HANYA dengan JSON murni tanpa markdown fence, persis format ini: {"type":"task","title":"judul singkat tugas","description":"detail lengkap tugasnya"}

Jangan pernah mencampur teks biasa dengan JSON dalam satu balasan.`;

      try {
        const route = await this.modelRouting.resolveModel(agent.agentRole.tier, agent.modelVariant, {
          roleName: agent.agentRole.name,
          responsibilities: agent.agentRole.responsibilities,
        });
        const result = await this.modelRouting.chatWithFallback(
          route,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: "Silakan tanggapi sebagai dirimu sendiri." },
          ],
          { aggregateId: roomId, source: "meeting" },
        );

        const unfenced = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        let taskDraft: { title: string; description: string } | null = null;
        try {
          const parsed = JSON.parse(unfenced);
          if (parsed?.type === "task" && typeof parsed.title === "string") {
            taskDraft = { title: parsed.title, description: typeof parsed.description === "string" ? parsed.description : parsed.title };
          }
        } catch {
          // Not JSON - treat as a normal meeting reply below.
        }

        let replyContent = result.content;
        if (taskDraft) {
          try {
            const taskResult = await this.tasks.createDirectCommand(agent.id, taskDraft.title, taskDraft.description);
            replyContent = taskResult.queued
              ? `📋 Dicatat sebagai tugas: "${taskDraft.title}" — saya sedang mengerjakan hal lain, akan saya kerjakan begitu selesai.`
              : `📋 Dicatat sebagai tugas: "${taskDraft.title}" — langsung saya kerjakan, bisa dipantau di Task Board.`;
          } catch (taskErr) {
            this.logger.error(`Meeting ${roomId}: gagal membuat task dari balasan ${agent.displayName}: ${taskErr instanceof Error ? taskErr.message : taskErr}`);
            replyContent = `Maaf, saya mengerti ini sebagai tugas ("${taskDraft.title}") tapi gagal mencatatnya barusan.`;
          }
        }

        const reply = await this.prisma.meetingMessage.create({
          data: { meetingRoomId: roomId, senderType: "AGENT", senderAgentId: agent.id, content: replyContent },
          include: { senderAgent: true },
        });
        created.push(reply);

        await this.usage
          .record({
            agentId: agent.id,
            modelUsed: result.modelId,
            modelVariant: result.variantUsed,
            source: "meeting",
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          })
          .catch(() => {});
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Gagal menghubungi model";
        this.logger.error(`Meeting ${roomId}: agent ${agent.displayName} gagal merespons (seluruh fallback chain): ${reason}`);
        failures.push({ agentId: agent.id, agentName: agent.displayName, reason });
      }
    }

    await this.prisma.meetingRoom.update({ where: { id: roomId }, data: { updatedAt: new Date() } });
    return { messages: created, failures };
  }
}
