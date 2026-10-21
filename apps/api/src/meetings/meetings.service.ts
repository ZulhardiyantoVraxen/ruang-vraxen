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
 * this existed, so a meeting has to be able to produce a real Task. A first
 * attempt classified each reply automatically (same prompt-based
 * classify-or-reply pattern as ChatService), but testing showed it's not
 * reliable - even an explicit "TUGAS BARU untuk X:" prefix got a
 * conversational reply instead of the required JSON, silently producing no
 * Task at all. Replaced with a manual, Director-driven flow instead:
 * `summarize()` asks the model for a plain summary (title + description) of
 * the transcript so far - a well-defined single-purpose extraction, which
 * models handle far more reliably than the earlier classify-or-reply
 * decision, and even an imperfect result is harmless here because the
 * Director reviews/edits it before anything is created - then
 * `createTaskFromSummary()` turns the (Director-approved) title/description
 * into a real Task via TasksService.createDirectCommand once the Director
 * explicitly asks for it.
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

Berikan tanggapanmu sebagai ${agent.displayName} terhadap perkembangan terbaru di atas - singkat, relevan dengan peranmu, dan dalam Bahasa Indonesia. Kalau tidak ada yang perlu kamu tambahkan dari sisi perananmu, cukup bilang itu secara singkat (jangan mengulang pendapat yang sudah disampaikan orang lain). Balas sebagai teks natural biasa - jangan pernah balas dalam format JSON.`;

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

        const reply = await this.prisma.meetingMessage.create({
          data: { meetingRoomId: roomId, senderType: "AGENT", senderAgentId: agent.id, content: result.content },
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

  /**
   * "Dirangkum dulu dari hasil rapat, lalu dijadikan task" - one plain
   * summarization call over the whole transcript, always the same shape
   * (never a classify-or-reply branch), so it's far more reliable than the
   * earlier auto-classification attempt. Returns a draft only; nothing is
   * created yet - the Director reviews/edits this before calling
   * createTaskFromSummary.
   */
  async summarize(roomId: string) {
    const room = await this.prisma.meetingRoom.findUnique({
      where: { id: roomId },
      include: { messages: { orderBy: { createdAt: "asc" }, include: { senderAgent: true } } },
    });
    if (!room) throw new NotFoundException(`Meeting room ${roomId} tidak ditemukan`);
    if (room.messages.length === 0) throw new BadRequestException("Belum ada percakapan di rapat ini untuk dirangkum");

    const transcriptText = room.messages
      .map((m) => `${m.senderType === "DIRECTOR" ? "Direktur" : m.senderAgent?.displayName ?? "Agent"}: ${m.content}`)
      .join("\n");

    const summarizerPrompt = `Berikut transkrip rapat berjudul "${room.title}":

${transcriptText}

Ringkas hasil rapat ini menjadi draft satu pekerjaan (task) yang bisa ditugaskan. Balas HANYA dengan JSON murni tanpa markdown fence, persis format ini: {"title":"judul singkat (maks 10 kata)","description":"ringkasan hasil diskusi, keputusan, dan apa yang perlu dikerjakan - dalam Bahasa Indonesia"}`;

    // Plain tier call (no specific agent persona needed for a summary) -
    // ATAS tier, same as other director-facing judgment calls, PAID so a
    // free-pool model's quirks never degrade something the Director is
    // about to act on.
    const route = await this.modelRouting.resolveModel("ATAS", "PAID");
    const result = await this.modelRouting.chatWithFallback(
      route,
      [
        { role: "system", content: "Kamu merangkum rapat kerja menjadi draft task yang jelas dan actionable." },
        { role: "user", content: summarizerPrompt },
      ],
      { aggregateId: roomId, source: "meeting-summary" },
    );

    const unfenced = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      const parsed = JSON.parse(unfenced);
      if (typeof parsed?.title === "string") {
        return { title: parsed.title, description: typeof parsed.description === "string" ? parsed.description : result.content };
      }
    } catch {
      // Model didn't return clean JSON - fall through to the raw-text fallback below.
    }
    // Harmless fallback: the Director edits this in the UI before creating
    // anything anyway, so an imperfect parse never blocks the flow.
    return { title: room.title, description: result.content };
  }

  /** Director-approved: turns a (possibly edited) summary into a real Task, assigned to the chosen participant. */
  async createTaskFromSummary(roomId: string, agentId: string, title: string, description: string) {
    const participant = await this.prisma.meetingParticipant.findUnique({
      where: { meetingRoomId_agentId: { meetingRoomId: roomId, agentId } },
    });
    if (!participant) throw new BadRequestException("Agent tersebut bukan peserta rapat ini");

    const result = await this.tasks.createDirectCommand(agentId, title, description);
    await this.prisma.meetingMessage.create({
      data: {
        meetingRoomId: roomId,
        senderType: "DIRECTOR",
        content: `📋 Dijadikan tugas: "${title}" (Task #${result.taskId.slice(-6)})`,
      },
    });
    return result;
  }
}
