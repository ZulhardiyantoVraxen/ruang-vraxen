import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { TasksService } from "../tasks/tasks.service";
import { UsageService } from "../usage/usage.service";
import { UploadsService } from "../uploads/uploads.service";
import { LinkReaderService } from "../common/link-reader.service";

type ChatResult =
  | { type: "chat"; reply: string }
  | { type: "task"; taskId: string; title: string; queued: boolean; note: string };

/**
 * "Saya ingin langsung bisa chatting dengan agent, bukan memberikan tugas,
 * kecuali isi pesannya berupa pemberian tugas" - a free-form thread per
 * agent that never touches the Task Board by itself. Every director message
 * goes through one model call that both classifies AND replies in one shot:
 * if the message reads as conversation, the reply comes straight back here;
 * if it reads as an actual work order, the model's JSON gets turned into a
 * real Task (via TasksService.createDirectCommand, the same busy-aware
 * create+assign path "Perintah sekaligus" uses) instead of a chat reply, and
 * a short system note is appended to the thread so it stays coherent.
 *
 * Deliberately synchronous (no Kafka/worker round trip, unlike task
 * execution) - a chat is supposed to feel like a chat, not a polling loop.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelRouting: OpenRouterService,
    private readonly tasks: TasksService,
    private readonly usage: UsageService,
    private readonly uploads: UploadsService,
    private readonly linkReader: LinkReaderService,
  ) {}

  history(agentId: string) {
    return this.prisma.chatMessage.findMany({ where: { agentId }, orderBy: { createdAt: "asc" } });
  }

  /**
   * `attachmentId` is the id POST /uploads returned - "di semua menu chat
   * ada file upload". The thread itself only ever shows a short reference
   * line (so old conversations don't balloon in size), but the model call
   * for THIS turn gets the attachment's full content injected (text-like
   * files read verbatim, anything else just described) - the same way an
   * attachment shows up inline in a Claude conversation.
   */
  async send(agentId: string, message: string, attachmentId?: string): Promise<ChatResult> {
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      include: { agentRole: { include: { modelClass: true, division: true } } },
    });

    const attachmentNote = attachmentId ? `\n\n📎 Lampiran: ${this.uploads.filenameFromId(attachmentId)} (/uploads/${attachmentId})` : "";
    const storedMessage = `${message}${attachmentNote}`;
    await this.prisma.chatMessage.create({ data: { agentId, role: "DIRECTOR", content: storedMessage } });

    const recent = await this.prisma.chatMessage.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const history = recent.reverse(); // oldest first, includes the message we just stored

    const attachmentForModel = attachmentId ? await this.uploads.describeForPrompt(attachmentId) : null;
    // "Agent juga bisa membaca dari link yang saya berikan" - any URL typed
    // straight into the message gets fetched too, same as an attachment.
    const linksForModel = await this.linkReader.describeLinksInText(message);
    const extrasForModel = [attachmentForModel, linksForModel].filter(Boolean).join("\n\n") || null;

    const systemPrompt = `Kamu adalah ${agent.displayName}, ${agent.agentRole.name} di divisi ${agent.agentRole.division.name}.${
      agent.agentRole.responsibilities ? ` Tanggung jawabmu: ${agent.agentRole.responsibilities}.` : ""
    }
Kamu sedang chat santai dengan Direktur (atasanmu langsung) lewat kotak chat pribadi.

ATURAN PALING PENTING: lihat pesan TERAKHIR dari Direktur saja untuk memutuskan ini.
- Kalau pesan itu OBROLAN BIASA (sapaan, pertanyaan status, basa-basi, diskusi) -> balas sebagai teks natural, singkat, seperti karyawan membalas chat bosnya. JANGAN pernah balas JSON untuk kasus ini.
- Kalau pesan itu benar-benar PERINTAH KERJA/TUGAS BARU yang jelas -> balas HANYA dengan JSON murni tanpa markdown fence, persis format ini: {"type":"task","title":"judul singkat tugas","description":"detail lengkap tugasnya"}

Jangan pernah mencampur teks biasa dengan JSON dalam satu balasan.`;

    const route = await this.modelRouting.resolveModel(agent.agentRole.tier, agent.modelVariant, {
      roleName: agent.agentRole.name,
      responsibilities: agent.agentRole.responsibilities,
    });

    let content: string, tokensIn: number, tokensOut: number;
    try {
      const messagesForModel = history.map((m: { role: string; content: string }, i: number) => ({
        role: (m.role === "DIRECTOR" ? "user" : "assistant") as "user" | "assistant",
        // The last entry is the message we just stored above - swap in the
        // attachment's full content for the model call only (the thread
        // itself keeps the short reference line, see storedMessage above).
        content: extrasForModel && i === history.length - 1 ? `${message}\n\n${extrasForModel}` : m.content,
      }));
      const result = await this.modelRouting.chat(route.modelId, [
        { role: "system", content: systemPrompt },
        ...messagesForModel,
      ]);
      content = result.content;
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
    } catch (err) {
      // A provider hiccup (rate limit, timeout, model down) must read as the
      // agent being briefly unreachable, not as a broken chat feature - the
      // director's own message is already saved above, so this only affects
      // the reply. Previously this threw straight through to a raw HTTP 500
      // in the UI ("API .../chat failed: 500").
      this.logger.error(`OpenRouter call gagal untuk agent ${agentId} (model ${route.modelId}): ${err instanceof Error ? err.message : err}`);
      const friendly =
        "Maaf, model AI saya sedang sibuk atau kena limit sesaat (kemungkinan karena trafik tinggi barusan). Coba kirim lagi dalam beberapa menit.";
      await this.prisma.chatMessage.create({ data: { agentId, role: "AGENT", content: friendly } });
      return { type: "chat", reply: friendly };
    }

    await this.usage
      .record({
        agentId: agent.id,
        modelUsed: route.modelId,
        modelVariant: route.variant,
        source: "chat",
        tokensIn,
        tokensOut,
      })
      .catch(() => {}); // usage tracking is best-effort, never block a chat reply on it

    const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    let task: { type: "task"; title: string; description: string } | null = null;
    try {
      const parsed = JSON.parse(unfenced);
      if (parsed?.type === "task" && typeof parsed.title === "string") {
        task = { type: "task", title: parsed.title, description: typeof parsed.description === "string" ? parsed.description : parsed.title };
      }
    } catch {
      // Not JSON - treat as a normal chat reply below.
    }

    if (task) {
      try {
        const result = await this.tasks.createDirectCommand(agent.id, task.title, task.description);
        const note = result.queued
          ? `📋 Dicatat sebagai tugas: "${task.title}" — saya sedang mengerjakan hal lain, akan saya kerjakan begitu selesai.`
          : `📋 Dicatat sebagai tugas: "${task.title}" — langsung saya kerjakan, bisa dipantau di Task Board.`;
        await this.prisma.chatMessage.create({ data: { agentId, role: "AGENT", content: note } });
        return { type: "task", taskId: result.taskId, title: task.title, queued: result.queued, note };
      } catch (err) {
        this.logger.error(`Gagal membuat task dari chat untuk agent ${agentId}: ${err instanceof Error ? err.message : err}`);
        const friendly = `Maaf, saya mengerti ini sebagai tugas ("${task.title}") tapi gagal mencatatnya barusan. Coba kirim lagi sebentar.`;
        await this.prisma.chatMessage.create({ data: { agentId, role: "AGENT", content: friendly } });
        return { type: "chat", reply: friendly };
      }
    }

    await this.prisma.chatMessage.create({ data: { agentId, role: "AGENT", content } });
    return { type: "chat", reply: content };
  }
}
