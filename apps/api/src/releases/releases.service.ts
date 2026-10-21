import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as dns from "node:dns/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import AdmZip from "adm-zip";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { CaddyReleaseClient } from "./caddy-release-client";

const RELEASES_DIR = process.env.RELEASES_DIR || "/data/releases";
const BASE_DOMAIN = process.env.RELEASE_BASE_DOMAIN || "vraxen-group.com";
// Same public IP the DNS for coworking/mcp/medistrax already points at on
// this VPS (see /etc/caddy/Caddyfile's own notes) - shown to the Direktur as
// the exact A record value to add at their DNS provider.
const HOST_IP = process.env.RELEASE_HOST_IP || "";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "release"
  );
}

@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly caddy: CaddyReleaseClient,
  ) {}

  private stagingDir(slug: string) {
    return path.join(RELEASES_DIR, slug, "staging");
  }
  private currentDir(slug: string) {
    return path.join(RELEASES_DIR, slug, "current");
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let n = 1;
    // Collisions are rare (one Direktur, occasional releases) - a short
    // linear probe is simpler than a retry-on-unique-constraint loop.
    while (await this.prisma.release.findUnique({ where: { slug: candidate } })) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  async list() {
    return this.prisma.release.findMany({ orderBy: { createdAt: "desc" } });
  }

  async get(id: string) {
    const release = await this.prisma.release.findUnique({ where: { id } });
    if (!release) throw new NotFoundException("Release tidak ditemukan.");
    return release;
  }

  private async writeIndexFromBuffer(slug: string, buffer: Buffer) {
    const dir = this.stagingDir(slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), buffer);
  }

  private async writeZip(slug: string, buffer: Buffer) {
    const dir = this.stagingDir(slug);
    await fs.mkdir(dir, { recursive: true });
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    if (entries.length === 0) throw new BadRequestException("Zip kosong, tidak ada file di dalamnya.");

    // Many build tools zip the project's own top-level folder (e.g.
    // "dist/index.html" instead of "index.html") - if every entry shares one
    // common first path segment, strip it so the site still lands at the
    // staging root instead of one level too deep.
    const firstSegments = new Set(entries.map((e) => e.entryName.split("/")[0]));
    const stripPrefix = firstSegments.size === 1 && !entries.some((e) => e.entryName.split("/").length === 1);
    const prefix = stripPrefix ? `${[...firstSegments][0]}/` : "";

    let hasIndex = false;
    for (const entry of entries) {
      const relative = entry.entryName.startsWith(prefix) ? entry.entryName.slice(prefix.length) : entry.entryName;
      if (!relative || relative.includes("..")) continue;
      const dest = path.join(dir, relative);
      if (!dest.startsWith(dir)) continue; // zip-slip guard
      if (relative.toLowerCase() === "index.html") hasIndex = true;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, entry.getData());
    }
    if (!hasIndex) {
      throw new BadRequestException("Zip harus punya index.html di root folder situs.");
    }
  }

  /** Direct upload from the Releases page: a .zip (dist/build output), or a single .html file. */
  async createFromUpload(title: string, buffer: Buffer, filename: string, mimeType: string) {
    const isZip = filename.toLowerCase().endsWith(".zip") || mimeType === "application/zip";
    const isHtml = filename.toLowerCase().endsWith(".html") || filename.toLowerCase().endsWith(".htm") || mimeType.startsWith("text/html");
    if (!isZip && !isHtml) {
      throw new BadRequestException("Hanya file .zip (hasil build/dist) atau .html tunggal yang bisa di-release.");
    }
    const slug = await this.uniqueSlug(title);
    if (isZip) await this.writeZip(slug, buffer);
    else await this.writeIndexFromBuffer(slug, buffer);
    return this.prisma.release.create({
      data: { title, slug, sourceKind: "zip" },
    });
  }

  async createFromAttachment(title: string, attachmentId: string) {
    const filename = this.uploads.filenameFromId(attachmentId);
    const { buffer, contentType } = await this.uploads.getFile(attachmentId).catch(() => {
      throw new BadRequestException("Lampiran tidak ditemukan - mungkin sudah terhapus.");
    });
    const isZip = filename.toLowerCase().endsWith(".zip") || contentType === "application/zip";
    const isHtml = filename.toLowerCase().endsWith(".html") || filename.toLowerCase().endsWith(".htm") || contentType?.startsWith("text/html");

    const slug = await this.uniqueSlug(title);
    if (isZip) {
      await this.writeZip(slug, buffer);
    } else if (isHtml) {
      await this.writeIndexFromBuffer(slug, buffer);
    } else {
      throw new BadRequestException(
        "Lampiran ini bukan file .html atau .zip situs statis - hanya jenis ini yang bisa langsung di-release.",
      );
    }
    return this.prisma.release.create({
      data: { title, slug, sourceKind: "attachment" },
    });
  }

  /** Resolves a requested preview subpath safely within the release's staging dir. */
  async previewFile(id: string, subpath: string) {
    const release = await this.get(id);
    const dir = this.stagingDir(release.slug);
    let rel = subpath.replace(/^\/+/, "");
    if (rel === "") rel = "index.html";
    const resolved = path.join(dir, rel);
    if (!resolved.startsWith(dir)) throw new BadRequestException("Path tidak valid.");
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolved);
    } catch {
      throw new NotFoundException("File tidak ditemukan di staging release ini.");
    }
    const ext = path.extname(resolved).toLowerCase();
    return { buffer, contentType: MIME_BY_EXT[ext] ?? "application/octet-stream" };
  }

  async setSubdomain(id: string, subdomain: string) {
    const release = await this.get(id);
    const existing = await this.prisma.release.findUnique({ where: { subdomain } });
    if (existing && existing.id !== release.id) {
      throw new ConflictException("Subdomain ini sudah dipakai release lain.");
    }
    const updated = await this.prisma.release.update({
      where: { id },
      data: { subdomain, status: "PENDING_DNS" },
    });
    return {
      release: updated,
      dnsInstructions: {
        type: "A",
        host: `${subdomain}.${BASE_DOMAIN}`,
        value: HOST_IP || "(IP VPS belum diset di server - hubungi admin)",
      },
    };
  }

  async checkDns(id: string) {
    const release = await this.get(id);
    if (!release.subdomain) throw new BadRequestException("Belum ada subdomain yang dipilih untuk release ini.");
    const host = `${release.subdomain}.${BASE_DOMAIN}`;
    let records: string[] = [];
    try {
      records = await dns.resolve4(host);
    } catch {
      records = [];
    }
    const matches = HOST_IP !== "" && records.includes(HOST_IP);
    return { host, expected: HOST_IP, records, matches };
  }

  async goLive(id: string) {
    const release = await this.get(id);
    if (!release.subdomain) throw new BadRequestException("Pilih subdomain dulu sebelum go-live.");
    const dnsCheck = await this.checkDns(id);
    if (!dnsCheck.matches) {
      throw new ConflictException(
        `DNS untuk ${dnsCheck.host} belum mengarah ke ${dnsCheck.expected || "IP VPS"} (saat ini: ${
          dnsCheck.records.join(", ") || "tidak ditemukan"
        }). Pastikan A record sudah ditambahkan di DNS provider, lalu coba lagi (propagasi DNS bisa butuh beberapa menit).`,
      );
    }

    const staging = this.stagingDir(release.slug);
    const current = this.currentDir(release.slug);
    await fs.rm(current, { recursive: true, force: true });
    await fs.mkdir(path.dirname(current), { recursive: true });
    await fs.cp(staging, current, { recursive: true });

    await this.caddy.addSite(release.subdomain, BASE_DOMAIN, current);

    return this.prisma.release.update({
      where: { id },
      data: {
        status: "LIVE",
        liveUrl: `https://${release.subdomain}.${BASE_DOMAIN}`,
        publishedAt: new Date(),
      },
    });
  }

  async takeDown(id: string) {
    const release = await this.get(id);
    if (release.subdomain && release.status === "LIVE") {
      await this.caddy.removeSite(release.subdomain);
    }
    const current = this.currentDir(release.slug);
    await fs.rm(current, { recursive: true, force: true });
    return this.prisma.release.update({
      where: { id },
      data: { status: "STAGED", liveUrl: null, publishedAt: null },
    });
  }
}
