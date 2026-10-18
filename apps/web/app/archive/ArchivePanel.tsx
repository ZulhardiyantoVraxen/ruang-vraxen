"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import ExpandableText from "../components/ExpandableText";
import styles from "./archive.module.css";

type ArchiveEntry = {
  id: string;
  title: string;
  status: string;
  division: { name: string; slug: string } | null;
  project: { name: string } | null;
  updatedAt: string;
  resultSummary: string | null;
  githubUrl: string | null;
  driveUrl: string | null;
  pdfAvailable: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  REVIEW: "Review",
  APPROVAL_PENDING: "Menunggu approval",
  DONE: "Selesai",
};

function formatTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/**
 * "Arsip" - one place for every finished task's output, so the team never
 * has to ask (like Chief of Staff did in the idle check-in) where a result
 * lives. GitHub repo output and PDF output link straight to where the file
 * actually is; Google Drive is wired up the same way here for the day that
 * integration exists, but there's nothing in it yet (always empty today).
 */
export default function ArchivePanel({ initial }: { initial: ArchiveEntry[] }) {
  const [filter, setFilter] = useState<"all" | "github" | "drive" | "pdf">("all");

  const entries = initial.filter((e) => {
    if (filter === "github") return !!e.githubUrl;
    if (filter === "drive") return !!e.driveUrl;
    if (filter === "pdf") return !e.githubUrl && !e.driveUrl && e.pdfAvailable;
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Arsip</h1>
          <p className={styles.lead}>
            Semua output task yang sudah selesai, langsung mengarah ke tempat hasil itu sebenarnya tersimpan - repo
            GitHub kalau outputnya kode, Google Drive kalau sudah terhubung ke sana, atau PDF untuk laporan biasa.
            Tim tidak perlu bertanya lagi mau simpan di mana - semuanya otomatis dan tercatat di sini.
          </p>
        </div>
        <span className={styles.headerCount}>{entries.length}</span>
      </div>

      <div className={styles.filterRow}>
        {([
          ["all", "Semua"],
          ["github", "GitHub"],
          ["drive", "Google Drive"],
          ["pdf", "PDF"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.filterButton} ${filter === key ? styles.filterButtonActive : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {entries.length === 0 && <p className={styles.empty}>Belum ada output yang tersimpan di kategori ini.</p>}

      <div className={styles.list}>
        {entries.map((e) => (
          <div key={e.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <p className={styles.cardTitle}>{e.title}</p>
                <p className={styles.cardMeta}>
                  {e.division?.name ?? "—"}
                  {e.project?.name && ` · Project: ${e.project.name}`}
                  {" · "}Diperbarui {formatTime(e.updatedAt)}
                </p>
              </div>
              <span className={styles.statusPill}>{STATUS_LABEL[e.status] ?? e.status}</span>
            </div>

            {e.resultSummary && (
              <ExpandableText
                text={e.resultSummary}
                className={styles.cardSummary}
                onLoadFull={() => api.taskFullText(e.id)}
              />
            )}

            <div className={styles.storageRow}>
              {e.githubUrl && (
                <a href={e.githubUrl} target="_blank" rel="noreferrer" className={`${styles.storageBadge} ${styles.storageGithub}`}>
                  🗂 Lihat di repository GitHub
                </a>
              )}
              {e.driveUrl && (
                <a href={e.driveUrl} target="_blank" rel="noreferrer" className={`${styles.storageBadge} ${styles.storageDrive}`}>
                  📁 Lihat di Google Drive
                </a>
              )}
              {e.pdfAvailable && (
                <a href={api.taskPdfHref(e.id)} target="_blank" rel="noreferrer" className={`${styles.storageBadge} ${styles.storagePdf}`}>
                  📄 Lihat PDF
                </a>
              )}
              {!e.githubUrl && !e.driveUrl && !e.pdfAvailable && (
                <span className={styles.storageNone}>Belum ada file tersimpan untuk task ini.</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
