"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import styles from "./approvals.module.css";

type Approval = {
  id: string;
  requestedAt: string;
  task: {
    id: string;
    title: string;
    description?: string | null;
    resultSummary?: string | null;
    priority: number;
    division?: { name?: string } | null;
    project?: { name?: string } | null;
    dueAt?: string | null;
  };
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
 * The manual half of the Kanban's otherwise-automatic trigger chain: this is
 * where REVIEW/APPROVAL_PENDING actually becomes DONE or REJECTED - every
 * other column change on the Task Board happens by itself. Redesigned per
 * the director's "tampilan approval jelek" revision: real Approve/Reject
 * actions (the old page had none at all), an optional note, and enough
 * context per card (division, project, deadline, what was actually produced)
 * to decide without switching tabs.
 */
export default function ApprovalsPanel({ initial }: { initial: Approval[] }) {
  const [approvals, setApprovals] = useState<Approval[]>(initial);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setError(null);
    try {
      await api.decideApproval(id, status, "Direktur", notes[id]?.trim() || undefined);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memproses keputusan.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Antrean Persetujuan</h1>
          <p className={styles.subtitle}>
            Setiap task yang wajib persetujuan Anda berhenti di sini. Setujui untuk melanjutkan ke Selesai (atau hand-off
            berikutnya), atau tolak untuk mengembalikannya sebagai Ditolak di Task Board.
          </p>
        </div>
        <span className={styles.headerCount}>{approvals.length} menunggu</span>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {approvals.length === 0 && <p className={styles.empty}>Tidak ada yang menunggu persetujuan saat ini.</p>}

      <div className={styles.list}>
        {approvals.map((a) => (
          <div key={a.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <p className={styles.cardTitle}>{a.task.title}</p>
                <p className={styles.cardMeta}>
                  {a.task.division?.name ?? "—"}
                  {a.task.project?.name && ` · Project: ${a.task.project.name}`}
                  {" · "}Diajukan {formatTime(a.requestedAt)}
                  {a.task.dueAt && ` · Deadline ${formatTime(a.task.dueAt)}`}
                </p>
              </div>
              <span className={styles.priorityPill}>P{a.task.priority}</span>
            </div>

            {a.task.description && <p className={styles.cardDescription}>{a.task.description}</p>}
            {a.task.resultSummary && (
              <div className={styles.resultBox}>
                <p className={styles.resultLabel}>Hasil yang diajukan</p>
                <p className={styles.resultText}>{a.task.resultSummary}</p>
              </div>
            )}

            <textarea
              className={styles.notesInput}
              placeholder="Catatan (opsional)…"
              value={notes[a.id] ?? ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
              rows={2}
            />

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.rejectButton}
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "REJECTED")}
              >
                Tolak
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={busyId === a.id}
                onClick={() => decide(a.id, "APPROVED")}
              >
                {busyId === a.id ? "Memproses…" : "Setujui"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
