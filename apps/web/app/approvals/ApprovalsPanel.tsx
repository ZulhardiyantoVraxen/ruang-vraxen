"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import ExpandableText from "../components/ExpandableText";
import styles from "./approvals.module.css";

type Approval = {
  id: string;
  requestedAt: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  decidedAt?: string | null;
  notes?: string | null;
  task: {
    id: string;
    title: string;
    description?: string | null;
    resultSummary?: string | null;
    priority: number;
    division?: { name?: string; slug?: string } | null;
    project?: { name?: string } | null;
    dueAt?: string | null;
  };
};

const UNGROUPED = "__tanpa_divisi__";

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

  // "Dikelompokkan berdasarkan topik" (= divisi), sama seperti Pertanyaan -
  // "all" | "archive" | division slug (atau UNGROUPED untuk task tanpa divisi).
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [decided, setDecided] = useState<Approval[] | null>(null);
  const [decidedLoading, setDecidedLoading] = useState(false);

  const topics = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; count: number }>();
    for (const a of approvals) {
      const slug = a.task.division?.slug ?? UNGROUPED;
      const name = a.task.division?.name ?? "Tanpa Divisi";
      const existing = map.get(slug);
      if (existing) existing.count += 1;
      else map.set(slug, { slug, name, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [approvals]);

  // "Sampai habis, toggle nomor akan hilang" - bounce back to "Semua" the
  // moment the topic being viewed no longer has any pending approval.
  if (activeTopic !== "all" && activeTopic !== "archive" && !topics.some((t) => t.slug === activeTopic)) {
    setActiveTopic("all");
  }

  async function openDecided() {
    setActiveTopic("archive");
    if (decided !== null) return;
    setDecidedLoading(true);
    try {
      setDecided(await api.decidedApprovals());
    } catch {
      setDecided([]);
    } finally {
      setDecidedLoading(false);
    }
  }

  const visible =
    activeTopic === "archive"
      ? decided ?? []
      : activeTopic === "all"
        ? approvals
        : approvals.filter((a) => (a.task.division?.slug ?? UNGROUPED) === activeTopic);

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

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTopic === "all" ? styles.tabActive : ""}`}
          onClick={() => setActiveTopic("all")}
        >
          Semua <span className={styles.tabCount}>{approvals.length}</span>
        </button>
        {topics.map((t) => (
          <button
            key={t.slug}
            type="button"
            className={`${styles.tab} ${activeTopic === t.slug ? styles.tabActive : ""}`}
            onClick={() => setActiveTopic(t.slug)}
          >
            {t.name} <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
        <button
          type="button"
          className={`${styles.tab} ${styles.tabArchive} ${activeTopic === "archive" ? styles.tabActive : ""}`}
          onClick={openDecided}
        >
          🗂 Arsip
        </button>
      </div>

      {activeTopic === "archive" && decidedLoading && <p className={styles.empty}>Memuat arsip…</p>}
      {activeTopic === "archive" && !decidedLoading && visible.length === 0 && (
        <p className={styles.empty}>Belum ada approval di arsip.</p>
      )}
      {activeTopic !== "archive" && visible.length === 0 && (
        <p className={styles.empty}>
          {approvals.length === 0 ? "Tidak ada yang menunggu persetujuan saat ini." : "Tidak ada yang menunggu untuk topik ini."}
        </p>
      )}

      <div className={styles.list}>
        {visible.map((a) =>
          activeTopic === "archive" ? (
            <div key={a.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div>
                  <p className={styles.cardTitle}>{a.task.title}</p>
                  <p className={styles.cardMeta}>
                    {a.task.division?.name ?? "Tanpa Divisi"}
                    {a.task.project?.name && ` · Project: ${a.task.project.name}`}
                    {" · "}Diputuskan {formatTime(a.decidedAt ?? a.requestedAt)}
                  </p>
                </div>
                <span className={`${styles.statusPill} ${a.status === "APPROVED" ? styles.statusApproved : styles.statusRejected}`}>
                  {a.status === "APPROVED" ? "Disetujui" : "Ditolak"}
                </span>
              </div>
              {a.notes && <p className={styles.cardDescription}>Catatan: {a.notes}</p>}
            </div>
          ) : (
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

              {a.task.description && <ExpandableText text={a.task.description} className={styles.cardDescription} />}
              {a.task.resultSummary && (
                <div className={styles.resultBox}>
                  <p className={styles.resultLabel}>Hasil yang diajukan</p>
                  <ExpandableText
                    text={a.task.resultSummary}
                    className={styles.resultText}
                    onLoadFull={() => api.taskFullText(a.task.id)}
                  />
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
          ),
        )}
      </div>
    </div>
  );
}
