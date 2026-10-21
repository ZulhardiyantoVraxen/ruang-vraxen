"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const RELEASABLE_EXT = /\.(html?|zip)$/i;
// Matches the "📎 Lampiran: name (/uploads/id)" / "- name (/uploads/id)" lines
// UploadsService.noteForIds appends to every stored chat/meeting message -
// filenames are sanitized server-side to be space-free, so this is reliable.
const ATTACHMENT_REF_RE = /([^\s()]+)\s*\(\/uploads\/([^)\s]+)\)/g;

export function extractAttachmentRefs(content: string): { filename: string; id: string }[] {
  const refs: { filename: string; id: string }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(ATTACHMENT_REF_RE);
  while ((m = re.exec(content))) {
    refs.push({ filename: m[1], id: m[2] });
  }
  return refs;
}

/**
 * "Dari lampiran hasil chat & rapat" - inline "🚀 Release" action next to any
 * attachment in a transcript that looks like a releasable static site (a
 * single .html file, or a .zip of a build/dist). Hidden for anything else -
 * the attachment is still there and downloadable, just not release-able
 * with one click.
 */
export function ReleaseAttachmentAction({ filename, attachmentId }: { filename: string; attachmentId: string }) {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!RELEASABLE_EXT.test(filename)) return null;

  async function release() {
    setStatus("busy");
    setMessage("");
    try {
      const title = filename.replace(/\.(html?|zip)$/i, "");
      const result = await api.createRelease(title, { attachmentId });
      window.open(api.releasePreviewUrl(result.id), "_blank");
      setStatus("done");
      setMessage("Dibuat - lanjutkan pilih subdomain di halaman Release.");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Gagal membuat release.");
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={release}
        disabled={status === "busy"}
        style={{
          background: "none",
          border: "1px solid #243545",
          borderRadius: 6,
          padding: "1px 8px",
          fontSize: 11,
          color: "#7fe0bb",
          cursor: "pointer",
        }}
      >
        {status === "busy" ? "Menyiapkan…" : "🚀 Release"}
      </button>
      {message && (
        <span style={{ fontSize: 11, color: status === "error" ? "#e0806b" : "#7f91a3" }}>
          {status === "done" ? (
            <>
              {message} <a href="/releases" style={{ color: "#5b9bd6" }}>Buka halaman Release</a>
            </>
          ) : (
            message
          )}
        </span>
      )}
    </span>
  );
}

/** Drop-in row of Release actions for every releasable attachment found in a message's stored content. */
export function ReleaseAttachmentActions({ content }: { content: string }) {
  const refs = extractAttachmentRefs(content).filter((r) => RELEASABLE_EXT.test(r.filename));
  if (refs.length === 0) return null;
  return (
    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
      {refs.map((r) => (
        <ReleaseAttachmentAction key={r.id} filename={r.filename} attachmentId={r.id} />
      ))}
    </div>
  );
}
