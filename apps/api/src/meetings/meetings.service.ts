import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { UsageService } from "../usage/usage.service";
import { TasksService } from "../tasks/tasks.service";
import { UploadsService } from "../uploads/uploads.service";
import { LinkReaderService } from "../common/link-reader.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { GoogleSheetsClient } from "@platform/shared";
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
 * Point 4: "dua meeting-room construct - satu privat Direktur+Staff
 * Direksi, satu terbuka untuk semua tim yang diundang."
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
    private readonly uploads: UploadsService,
    private readonly linkReader: LinkReaderService,
    private readonly storage: ObjectStorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * "Simpan ringkasan rapat ke Google Drive, buat folder baru topik dan
   * tanggal rapat" - Drive/Docs/folder structure:
   *   <projectsRootFolderId> / "Rapat" / "<judul rapat> - <tanggal>" / "Ringkasan - <jam>"
   * Best-effort and fail-open, same philosophy as the Finance budget sheet
   * integration this reuses GoogleSheetsClient from: with no GOOGLE_* env
   * vars configured, this silently returns null and summarize() still works
   * (title/description are always saved to the DB either way) - never let a
   * missing Drive integration block the Director from getting a summary.
   */
  private async saveSummaryToDrive(room: { id: string; title: string }, title: string, description: string): Promise<string | null> {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const rootFolderId = process.env.GOOGLE_DRIVE_PROJECTS_ROOT_FOLDER_ID;
    if (!serviceAccountEmail || !privateKey || !rootFolderId) return null;

    try {
      const drive = new GoogleSheetsClient({ clientEmail: serviceAccountEmail, privateKey });

      // "Rapat" root folder, cached so repeat summaries never re-search/re-create it.
      const rapatRootKey = "meetings/drive-rapat-root-folder.json";
      let rapatRootId = (await this.storage.getJson<{ folderId: string }>(rapatRootKey))?.folderId;
      if (!rapatRootId) {
        rapatRootId = (await drive.findFolderByName("Rapat", rootFolderId)) ?? (await drive.createFolder("Rapat", rootFolderId));
        await this.storage.putJson(rapatRootKey, { folderId: rapatRootId });
      }

      // One subfolder per room per calendar day ("topik dan tanggal rapat") - cached per room+day.
      const dateLabel = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
      const dayFolderName = `${room.title} - ${dateLabel}`;
      const dayFolderKey = `meetings/${room.id}/drive-day-folder-${dateLabel.replace(/\s+/g, "-")}.json`;
      let dayFolderId = (await this.storage.getJson<{ folderId: string }>(dayFolderKey))?.folderId;
      if (!dayFolderId) {
        dayFolderId = (await drive.findFolderByName(dayFolderName, rapatRootId)) ?? (await drive.createFolder(dayFolderName, rapatRootId));
        await this.storage.putJson(dayFolderKey, { folderId: dayFolderId });
      }

      const timeLabel = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      const doc = await drive.createDocument(`Ringkasan - ${timeLabel}`, `${title}\n\n${description}`, dayFolderId);
      return doc.url;
    } catch (err) {
      this.logger.error(`Gagal menyimpan ringkasan rapat ${room.id} ke Google Drive:`, err);
      return null;
    }
  }

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
   * Resolves the standing private room between the Director and the WHOLE
   * Staff Direksi roster (CEO/CFO/CTO/COO - the division slugged
   * "staff-direksi"), not just the CEO - "satu privat Direktur+Staff
   * Direksi". The Prisma enum value is still named DIRECTOR_CEO (that was
   * this room's first, too-narrow design before this fix; renaming the DB
   * enum isn't worth a migration for an internal label nobody sees), but
   * the actual membership is the full division roster.
   *
   * Idempotent AND self-healing: a second call never creates a duplicate
   * room, and every call tops up the existing room with any staff-direksi
   * agent who isn't a participant yet (covers both this fix's one-time
   * backfill and, going forward, a newly hired Staff Direksi member
   * automatically joining the standing room on its next open).
   */
  async ensureDirectorCeoRoom() {
    const staffDireksiAgents = await this.prisma.agent.findMany({
      where: { agentRole: { division: { slug: "staff-direksi" } } },
    });
    if (staffDireksiAgents.length === 0) {
      throw new BadRequestException("Belum ada agent Staff Direksi - jalankan seed lebih dulu");
    }

    const existing = await this.prisma.meetingRoom.findFirst({ where: { type: "DIRECTOR_CEO", status: "ACTIVE" } });

    let roomId: string;
    if (existing) {
      roomId = existing.id;
      // Self-heal the title too - a room created before this fix still carries
      // the old "Direktur & CEO" label even though its participants are now
      // being topped up to the whole roster below.
      if (existing.title !== "Rapat Direktur & Staff Direksi") {
        await this.prisma.meetingRoom.update({ where: { id: roomId }, data: { title: "Rapat Direktur & Staff Direksi" } });
      }
    } else {
      roomId = (
        await this.prisma.meetingRoom.create({
          data: { type: "DIRECTOR_CEO" as MeetingRoomType, title: "Rapat Direktur & Staff Direksi" },
        })
      ).id;
    }

    for (const agent of staffDireksiAgents) {
      await this.prisma.meetingParticipant.upsert({
        where: { meetingRoomId_agentId: { meetingRoomId: roomId, agentId: agent.id } },
        create: { meetingRoomId: roomId, agentId: agent.id },
        update: {},
      });
    }

    return this.get(roomId);
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
    if (room.type !== "OPEN") throw new BadRequestException("Rapat privat Direktur-Staff Direksi tidak bisa menerima undangan baru");
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
    if (room.type !== "OPEN") throw new BadRequestException("Rapat privat Direktur-Staff Direksi selalu terbuka, tidak bisa ditutup");
    await this.prisma.meetingRoom.update({ where: { id: roomId }, data: { status: "CLOSED" as MeetingRoomStatus } });
    return this.get(roomId);
  }

  /**
   * Director posts one message; every participant replies in turn,
   * sequentially, each seeing the replies already posted earlier in this
   * same round - returns every message created during this call (the
   * Director's own plus each reply that succeeded).
   */
  /** "Setiap input ada lampiran" - a message posted into a meeting can carry files too (one or many, same as a folder upload elsewhere). */
  async sendMessage(roomId: string, content: string, attachmentIds: string[] = []) {
    const room = await this.prisma.meetingRoom.findUnique({
      where: { id: roomId },
      include: { participants: { include: { agent: { include: AGENT_WITH_ROLE } } } },
    });
    if (!room) throw new NotFoundException(`Meeting room ${roomId} tidak ditemukan`);
    if (room.status !== "ACTIVE") throw new BadRequestException("Rapat ini sudah ditutup");

    const storedContent = `${content}${this.uploads.noteForIds(attachmentIds)}`;
    const directorMessage = await this.prisma.meetingMessage.create({
      data: { meetingRoomId: roomId, senderType: "DIRECTOR", content: storedContent },
    });
    const created = [directorMessage];
    // "Pakai socket biar realtime" - pushed the instant it's persisted, to
    // every connected client (including other tabs/viewers), not just the
    // one that sent it - see RealtimeGateway's own header comment.
    this.realtime.emit(`meeting:${roomId}`, "message", { ...directorMessage, senderAgent: null });
    const failures: { agentId: string; agentName: string; reason: string }[] = [];

    // Full attachment content (+ any URL typed into the message) is only
    // injected into THIS round's model calls, not re-stored on every future
    // transcript fetch - same split as chat's attachmentForModel/storedMessage.
    const extrasForModel = (
      await Promise.all([this.uploads.describeManyForPrompt(attachmentIds), this.linkReader.describeLinksInText(content)])
    )
      .filter((x): x is string => Boolean(x))
      .join("\n\n");

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
${extrasForModel ? `\nLampiran/konten tambahan dari pesan terakhir Direktur:\n${extrasForModel}\n` : ""}
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
        this.realtime.emit(`meeting:${roomId}`, "message", reply);

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
        const failure = { agentId: agent.id, agentName: agent.displayName, reason };
        failures.push(failure);
        this.realtime.emit(`meeting:${roomId}`, "failure", failure);
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
    let draft: { title: string; description: string };
    try {
      const parsed = JSON.parse(unfenced);
      draft =
        typeof parsed?.title === "string"
          ? { title: parsed.title, description: typeof parsed.description === "string" ? parsed.description : result.content }
          : { title: room.title, description: result.content };
    } catch {
      // Model didn't return clean JSON - harmless raw-text fallback; the
      // Director edits this in the UI before creating anything anyway.
      draft = { title: room.title, description: result.content };
    }

    // "Setiap card rapat ada ringkasan" - persisted so the /meetings list can
    // show it without the Director having to open the room; Drive save is
    // best-effort on top (null when GOOGLE_* env vars aren't configured).
    const driveUrl = await this.saveSummaryToDrive(room, draft.title, draft.description);
    await this.prisma.meetingRoom.update({
      where: { id: roomId },
      data: {
        lastSummaryTitle: draft.title,
        lastSummaryText: draft.description,
        lastSummaryAt: new Date(),
        lastSummaryDriveUrl: driveUrl,
      },
    });

    return { ...draft, driveUrl };
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
