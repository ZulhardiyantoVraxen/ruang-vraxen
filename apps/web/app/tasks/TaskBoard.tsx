"use client";

import styles from "./taskBoard.module.css";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: number;
  resultSummary?: string | null;
  updatedAt: string;
  divisionName: string;
};

const COLUMNS: { key: string; label: string; color: string; statuses: string[] }[] = [
  { key: "triage", label: "Triase", color: "#94a3b8", statuses: ["TRIAGE"] },
  { key: "queue", label: "Antrean", color: "#94a3b8", statuses: ["TODO", "SCHEDULED", "READY"] },
  { key: "running", label: "Berjalan", color: "#5fc9b8", statuses: ["RUNNING"] },
  { key: "review", label: "Review", color: "#e0a63e", statuses: ["REVIEW"] },
  { key: "approval", label: "Menunggu Approval", color: "#9f8fe0", statuses: ["APPROVAL_PENDING"] },
  { key: "awaiting_director", label: "Menunggu Jawaban Anda", color: "#9f8fe0", statuses: ["AWAITING_DIRECTOR"] },
  { key: "blocked", label: "Terblokir", color: "#e06c5b", statuses: ["BLOCKED"] },
  { key: "done", label: "Selesai", color: "#5fc9b8", statuses: ["DONE"] },
  { key: "rejected", label: "Ditolak", color: "#e06c5b", statuses: ["REJECTED"] },
];

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
 * All work, all divisions, one screen: columns scroll sideways and each
 * column scrolls its own cards - the board itself never grows taller than
 * the viewport, no matter the backlog size.
 */
export default function TaskBoard({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Task Board</h1>
        <span className={styles.headerCount}>{total} task</span>
      </div>

      <div className={styles.board}>
        {COLUMNS.map((col) => {
          const colTasks = tasks
            .filter((t) => col.statuses.includes(t.status))
            .sort((a, b) => a.priority - b.priority || (a.updatedAt < b.updatedAt ? 1 : -1));
          return (
            <div key={col.key} className={styles.column}>
              <div className={styles.columnHead}>
                <span className={styles.columnDot} style={{ background: col.color }} />
                <span className={styles.columnTitle}>{col.label}</span>
                <span className={styles.columnCount}>{colTasks.length}</span>
              </div>
              <div className={styles.columnBody}>
                {colTasks.length === 0 && <p className={styles.columnEmpty}>Kosong</p>}
                {colTasks.map((t) => (
                  <div key={t.id} className={styles.card}>
                    <p className={styles.cardDivision}>{t.divisionName}</p>
                    <p className={styles.cardTitle}>{t.title}</p>
                    {t.resultSummary && <p className={styles.cardSummary}>{t.resultSummary}</p>}
                    <div className={styles.cardMeta}>
                      <span className={styles.cardPriority}>P{t.priority}</span>
                      <span className={styles.cardTime}>{formatTime(t.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
