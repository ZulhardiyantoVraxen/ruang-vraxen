import { Injectable, Logger } from "@nestjs/common";

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'()]+/gi;
const MAX_LINKS_PER_MESSAGE = 3; // a message with a wall of links is almost always spam/noise, not something to actually fetch
const MAX_LINK_CHARS = 6000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * "Agent juga bisa membaca dari link yang saya berikan" - any URL the
 * director drops into a chat message, task instruction, or question answer
 * gets fetched and folded into the agent's context, the same way an
 * uploaded file does (see UploadsService.describeForPrompt). A plain fetch
 * + crude tag-stripping, not a real readability pass - good enough for
 * articles/docs/READMEs, not meant to handle JS-rendered pages.
 */
@Injectable()
export class LinkReaderService {
  private readonly logger = new Logger(LinkReaderService.name);

  /** First few distinct http(s) URLs found in free text, in the order they appear. */
  extractUrls(text: string): string[] {
    const found = text.match(URL_REGEX) ?? [];
    return Array.from(new Set(found)).slice(0, MAX_LINKS_PER_MESSAGE);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async fetchOne(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!res.ok) return `[Link: ${url}] - gagal diakses (${res.status})`;
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      const text = contentType.includes("html") ? this.stripHtml(raw) : raw.trim();
      const truncated = text.length > MAX_LINK_CHARS;
      return `[Link: ${url}]\n${text.slice(0, MAX_LINK_CHARS)}${truncated ? "\n...(terpotong)" : ""}`;
    } catch (err) {
      this.logger.warn(`Gagal membaca link ${url}: ${err instanceof Error ? err.message : err}`);
      return `[Link: ${url}] - gagal diakses (timeout atau tidak bisa dijangkau)`;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Fetches every URL found in `text` and returns them as prompt-ready blocks, or null if the text has no links. */
  async describeLinksInText(text: string): Promise<string | null> {
    const urls = this.extractUrls(text);
    if (urls.length === 0) return null;
    const blocks = await Promise.all(urls.map((u) => this.fetchOne(u)));
    return blocks.join("\n\n");
  }
}
