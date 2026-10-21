import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ObjectStorageService } from "../storage/object-storage.service";

export interface UploadedFileMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// Text-like MIME types whose content is worth reading into a chat/task
// prompt as context, the same way an attached .txt/.md/.csv shows up
// directly in a Claude conversation. Anything else (images, PDFs, office
// docs, archives, audio/video) is still stored and downloadable, but its
// content isn't parsed - the model is only told a file of that type exists.
const TEXT_LIKE_MIME_PREFIXES = ["text/"];
const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
]);
const MAX_INLINE_TEXT_CHARS = 8000;

@Injectable()
export class UploadsService {
  constructor(private readonly storage: ObjectStorageService) {}

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120) || "file";
  }

  async save(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }): Promise<UploadedFileMeta> {
    const id = `${randomUUID()}-${this.sanitizeFilename(file.originalname)}`;
    await this.storage.putUpload(`uploads/${id}`, file.buffer, file.mimetype || "application/octet-stream");
    return { id, filename: file.originalname, mimeType: file.mimetype || "application/octet-stream", size: file.size };
  }

  async getFile(id: string) {
    return this.storage.getObjectWithMeta(`uploads/${id}`);
  }

  isTextLike(mimeType: string): boolean {
    return TEXT_LIKE_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) || TEXT_LIKE_MIME_TYPES.has(mimeType);
  }

  // randomUUID() is always exactly 36 chars (8-4-4-4-12 hex + 4 hyphens), so
  // the filename save() appended starts right after it + the separator
  // hyphen. A UUID contains hyphens itself, so splitting on the first "-"
  // (as an earlier version of this did) only strips part of it.
  private static readonly UUID_PREFIX_LEN = 36 + 1;

  /** Original filename is everything after the UUID prefix in the id (see save() above). */
  filenameFromId(id: string): string {
    return id.length > UploadsService.UUID_PREFIX_LEN ? id.slice(UploadsService.UUID_PREFIX_LEN) : id;
  }

  /**
   * Reads an uploaded file back as a prompt-ready block, the way an
   * attachment shows up inline in a Claude conversation - full text for
   * text-like files (truncated if huge), or just a note of its existence
   * for anything this quick implementation can't parse (images, PDFs,
   * office docs, etc. are stored and downloadable, just not read). Only the
   * attachment id is needed - filename and type are both recovered from
   * storage, so callers (chat, broadcast command, direct task) never have
   * to carry upload metadata around themselves.
   */
  /**
   * "Setiap input ada lampiran, bisa dokumen atau folder" - a folder upload
   * is just several files uploaded one by one (the browser hands over a
   * flat FileList either way), so every surface that used to carry one
   * `attachmentId` now carries `attachmentIds: string[]` instead - these two
   * helpers are the array-aware version of the note/describe pair every
   * caller used to build by hand for a single id.
   */
  noteForIds(ids: string[]): string {
    if (ids.length === 0) return "";
    if (ids.length === 1) return `\n\n📎 Lampiran: ${this.filenameFromId(ids[0])} (/uploads/${ids[0]})`;
    const lines = ids.map((id) => `- ${this.filenameFromId(id)} (/uploads/${id})`).join("\n");
    return `\n\n📎 Lampiran (${ids.length} file):\n${lines}`;
  }

  async describeManyForPrompt(ids: string[]): Promise<string | null> {
    if (ids.length === 0) return null;
    const blocks = await Promise.all(ids.map((id) => this.describeForPrompt(id)));
    return blocks.join("\n\n");
  }

  async describeForPrompt(id: string): Promise<string> {
    const filename = this.filenameFromId(id);
    try {
      const { buffer, contentType } = await this.storage.getObjectWithMeta(`uploads/${id}`);
      const mimeType = contentType ?? "application/octet-stream";
      if (!this.isTextLike(mimeType)) {
        return `[Lampiran: ${filename} (${mimeType}) - file tersimpan dan bisa diunduh direktur, tipe ini belum bisa dibaca otomatis oleh sistem. Unduh: /uploads/${id}]`;
      }
      let text = buffer.toString("utf-8");
      let truncated = false;
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        text = text.slice(0, MAX_INLINE_TEXT_CHARS);
        truncated = true;
      }
      return `[Lampiran: ${filename}]\n${text}${truncated ? "\n...(terpotong)" : ""}`;
    } catch {
      return `[Lampiran: ${filename} - gagal membaca file ini, mungkin sudah terhapus]`;
    }
  }
}
