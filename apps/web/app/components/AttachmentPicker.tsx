"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import styles from "./attachment-picker.module.css";

export type PendingAttachment = { id: string; filename: string };

/**
 * "Setiap input ada lampiran, bisa berupa dokumen atau folder yang akan
 * di-upload" - one shared attach-then-send pattern for every text input in
 * the app. A "folder" pick is just several files selected at once (the
 * browser's own webkitdirectory picker hands over a flat FileList), so this
 * uploads each one individually via the existing single-file POST /uploads
 * and collects their ids - callers pass that array as `attachmentIds` on
 * whatever create/send call follows.
 */
export function useAttachments(initial: PendingAttachment[] = []) {
  const [items, setItems] = useState<PendingAttachment[]>(initial);
  const [uploading, setUploading] = useState(false);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map((f) => api.uploadFile(f)));
      const uploaded = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof api.uploadFile>>> => r.status === "fulfilled")
        .map((r) => ({ id: r.value.id, filename: r.value.filename }));
      setItems((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id));
  }

  function reset() {
    setItems([]);
  }

  return { items, uploading, addFiles, remove, reset, ids: items.map((a) => a.id) };
}

/**
 * Two pick buttons - one file (or several at once), or a whole folder - plus
 * a chip row of what's queued so far, each removable before send. Purely
 * presentational; pair it with `useAttachments()` above.
 */
export function AttachmentPicker({
  items,
  uploading,
  onAddFiles,
  onRemove,
  idPrefix,
}: {
  items: PendingAttachment[];
  uploading: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  idPrefix: string;
}) {
  return (
    <div className={styles.row}>
      <label className={styles.pickButton} htmlFor={`${idPrefix}-file`}>
        {uploading ? "Mengunggah…" : "📎 File"}
      </label>
      <input
        id={`${idPrefix}-file`}
        type="file"
        multiple
        className={styles.hiddenInput}
        disabled={uploading}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAddFiles(files);
          e.target.value = "";
        }}
      />
      <label className={styles.pickButton} htmlFor={`${idPrefix}-folder`}>
        📁 Folder
      </label>
      <input
        id={`${idPrefix}-folder`}
        type="file"
        multiple
        // Non-standard but universally supported (Chrome/Edge/Firefox/Safari) directory-pick attributes.
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        className={styles.hiddenInput}
        disabled={uploading}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAddFiles(files);
          e.target.value = "";
        }}
      />
      {items.map((a) => (
        <span key={a.id} className={styles.chip}>
          {a.filename}
          <button type="button" className={styles.chipRemove} onClick={() => onRemove(a.id)}>
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
