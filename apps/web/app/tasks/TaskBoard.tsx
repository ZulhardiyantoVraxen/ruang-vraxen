"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./taskBoard.module.css";
import { api } from "../../lib/api";
import ExpandableText from "../components/ExpandableText";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: number;
  resultSummary?: string | null;
  updatedAt: string;
  dueAt?: string | null;
  divisionName: string;
  divisionId: string;
  picName?: string | null;
  projectName?: string | null;
};

type DivisionOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };

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

function isOverdue(dueAt: string, status: string) {
  return new Date(dueAt).getTime() < Date.now() && status !== "DONE" && status !== "REJECTED";
}

/**
 * All active execution work, one screen: columns scroll sideways and each
 * column scrolls its own cards - the board itself never grows taller than
 * the viewport, no matter the backlog size. Filterable by Project and
 * Division so a project "in flight" is actually visible as one thread
 * instead of tasks just sitting in their own division's column.
 */
// Flattens /divisions into the Task Board's shape - mirrors tasks/page.tsx's
// server-side transform exactly, so client-side polling refreshes stay
// consistent with the initial server render.
function flattenTasks(divisions: any[]): Task[] {
  return divisions
    .filter((d) => d.slug !== "pusat")
    .flatMap((d) =>
      (d.tasks ?? []).map((t: any) => {
        const executor = (t.assignments ?? []).filter((a: any) => a.role === "EXECUTOR").slice(-1)[0];
        return {
          ...t,
          divisionName: d.name,
          divisionId: d.id,
          picName: executor?.agent?.displayName ?? null,
          projectName: t.project?.name ?? null,
        };
      }),
    );
}

export default function TaskBoard({
  tasks: initialTasks,
  divisions,
  projects,
}: {
  tasks: Task[];
  divisions: DivisionOption[];
  projects: ProjectOption[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [divisionFilter, setDivisionFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Keep the board live without the director needing to refresh - same
  // polling pattern OfficeDashboard already uses for /divisions.
  useEffect(() => {
    const id = setInterval(() => {
      api
        .listDivisions()
        .then((divs) => setTasks(flattenTasks(divs)))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  /**
   * "Kanban saya pengen bisa geser sendiri, Direktur punya hak penuh untuk
   * mempercepat progress" - dropping a card on a column force-sets that
   * task's status via the admin override endpoint. Optimistic: the card
   * jumps immediately, and reverts if the API call fails.
   */
  async function moveTask(taskId: string, targetStatus: string) {
    const previous = tasks;
    const current = tasks.find((t) => t.id === taskId);
    if (!current || current.status === targetStatus) return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)));
    setMoveError(null);
    try {
      await api.overrideTaskStatus(taskId, targetStatus);
    } catch {
      setTasks(previous);
      setMoveError("Gagal memindahkan task. Coba lagi.");
      setTimeout(() => setMoveError(null), 4000);
    }
  }

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (divisionFilter && t.divisionId !== divisionFilter) return false;
      if (projectFilter && t.projectName !== projectFilter) return false;
      return true;
    });
  }, [tasks, divisionFilter, projectFilter]);

  const total = filtered.length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Task Board</h1>
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">Semua project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <select className={styles.filterSelect} value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)}>
            <option value="">Semua divisi</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <span className={styles.headerCount}>{moveError ?? `${total} task`}</span>
      </div>

      <div className={styles.board}>
        {COLUMNS.map((col) => {
          const colTasks = filtered
            .filter((t) => col.statuses.includes(t.status))
            .sort((a, b) => a.priority - b.priority || (a.updatedAt < b.updatedAt ? 1 : -1));
          return (
            <div key={col.key} className={styles.column}>
              <div className={styles.columnHead}>
                <span className={styles.columnDot} style={{ background: col.color }} />
                <span className={styles.columnTitle}>{col.label}</span>
                <span className={styles.columnCount}>{colTasks.length}</span>
              </div>
              <div
                className={`${styles.columnBody} ${dragOverCol === col.key ? styles.columnBodyDragOver : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol((prev) => (prev === col.key ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const taskId = e.dataTransfer.getData("text/plain") || draggingId;
                  if (taskId) moveTask(taskId, col.statuses[0]);
                  setDraggingId(null);
                }}
              >
                {colTasks.length === 0 && <p className={styles.columnEmpty}>Kosong</p>}
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`${styles.card} ${draggingId === t.id ? styles.cardDragging : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(t.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverCol(null);
                    }}
                  >
                    {t.projectName && <p className={styles.cardProject}>{t.projectName}</p>}
                    <p className={styles.cardDivision}>{t.divisionName}</p>
                    <p className={styles.cardTitle}>{t.title}</p>
                    {t.resultSummary && (
                      <ExpandableText
                        text={t.resultSummary}
                        lines={2}
                        className={styles.cardSummary}
                        onLoadFull={() => api.taskFullText(t.id)}
                      />
                    )}
                    <div className={styles.cardMeta}>
                      <span className={styles.cardPriority}>P{t.priority}</span>
                      {t.picName && <span className={styles.cardPic}>PIC: {t.picName}</span>}
                      <span className={styles.cardTime}>{formatTime(t.updatedAt)}</span>
                    </div>
                    {t.dueAt && (
                      <div className={`${styles.cardDue} ${isOverdue(t.dueAt, t.status) ? styles.cardDueLate : ""}`}>
                        Deadline: {formatTime(t.dueAt)}
                      </div>
                    )}
                    {t.resultSummary && (t.status === "DONE" || t.status === "REVIEW") && (
                      <a
                        href={api.taskPdfHref(t.id)}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.cardPdfButton}
                      >
                        📄 Unduh PDF
                      </a>
                    )}
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
