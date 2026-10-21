"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import ExpandableText from "../components/ExpandableText";
import { AttachmentPicker, PendingAttachment } from "../components/AttachmentPicker";
import styles from "./chiefOfStaff.module.css";

type Agent = { id: string; displayName: string; status: string };
type AgentRole = { id: string; name: string; requiresApproval: boolean; agents: Agent[] };
type Assignment = {
  id: string;
  role: "EXECUTOR" | "REVIEWER";
  assignedAt: string;
  completedAt: string | null;
  agent: { displayName: string; agentRole: { name: string } };
};
type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: number;
  requiresApproval: boolean;
  resultSummary?: string | null;
  updatedAt: string;
  createdAt: string;
  assignments?: Assignment[];
};
type Division = { id: string; slug: string; name: string; agentRoles: AgentRole[]; tasks?: Task[] };

const STATUS_LABEL: Record<string, string> = {
  TRIAGE: "Triase",
  TODO: "Belum dikerjakan",
  SCHEDULED: "Terjadwal",
  READY: "Siap dikerjakan",
  RUNNING: "Berjalan",
  BLOCKED: "Terblokir",
  REVIEW: "Review",
  APPROVAL_PENDING: "Menunggu approval Anda",
  AWAITING_DIRECTOR: "Menunggu jawaban Anda",
  DONE: "Selesai",
  REJECTED: "Ditolak",
};

const STATUS_COLOR: Record<string, string> = {
  TRIAGE: "#94a3b8",
  TODO: "#94a3b8",
  SCHEDULED: "#94a3b8",
  READY: "#5b9bd6",
  RUNNING: "#5fc9b8",
  BLOCKED: "#e06c5b",
  REVIEW: "#e0a63e",
  APPROVAL_PENDING: "#9f8fe0",
  AWAITING_DIRECTOR: "#9f8fe0",
  DONE: "#5fc9b8",
  REJECTED: "#e06c5b",
};

function formatTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

type Project = { id: string; name: string };

export default function ChiefOfStaffPanel({ pusat }: { pusat: Division | null }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(3);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(pusat?.tasks ?? []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [dueAt, setDueAt] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  const chiefOfStaff = useMemo(() => {
    // Role was renamed "Chief of Staff" -> "Sekretaris Direksi" (that title
    // now belongs to the Hermes Telegram bot in the org design); same agent,
    // same in-office job, matched by its new name.
    const role = pusat?.agentRoles.find((r) => r.name.toLowerCase().includes("sekretaris direksi"));
    return role?.agents[0] ?? null;
  }, [pusat]);

  // "Setiap input ada lampiran" - a direct order to Chief of Staff can carry a doc/folder too.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function attachFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map((f) => api.uploadFile(f)));
      const uploaded = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof api.uploadFile>>> => r.status === "fulfilled")
        .map((r) => ({ id: r.value.id, filename: r.value.filename }));
      setAttachments((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!title.trim() || !pusat) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask({
        divisionSlug: pusat.slug,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        requiresApproval,
        projectId: projectId || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        attachmentIds: attachments.map((a) => a.id),
      });
      setTasks((prev) => [task, ...prev]);
      setTitle("");
      setDescription("");
      setPriority(3);
      setRequiresApproval(true);
      setDueAt("");
      setAttachments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim pekerjaan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h1>PIC Chief of Staff</h1>
          <p>
            Beri pekerjaan langsung ke Chief of Staff di sini - bukan ke divisi tertentu. Chief of Staff yang akan
            memilah, meneruskan ke PM divisi terkait, dan menggabungkan laporan yang butuh persetujuan Anda jadi satu
            antrean di halaman Approval.
          </p>
        </div>
        {chiefOfStaff && (
          <div className={styles.chiefCard}>
            <div className={styles.chiefAvatar}>{initials(chiefOfStaff.displayName)}</div>
            <div className={styles.chiefMeta}>
              <span className={styles.chiefLabel}>Chief of Staff saat ini</span>
              <span className={styles.chiefName}>{chiefOfStaff.displayName}</span>
            </div>
          </div>
        )}
      </div>

      {!pusat && <p className={styles.error}>Tidak bisa memuat divisi Sekretariat Direksi / Chief of Staff. Coba muat ulang halaman.</p>}

      {pusat && (
        <div className={styles.card}>
          <p className={styles.cardTitle}>Beri pekerjaan baru</p>
          <div className={styles.fieldStack}>
            <input
              className={styles.field}
              placeholder="Judul pekerjaan - contoh: Review rencana ekspansi Q1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className={styles.field}
              placeholder="Detail / konteks (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
            <AttachmentPicker
              items={attachments}
              uploading={uploading}
              onAddFiles={attachFiles}
              onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              idPrefix="chief-of-staff-task"
            />
          </div>
          <div className={styles.row}>
            <label className={styles.priorityLabel}>
              Prioritas
              <select className={styles.prioritySelect} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={1}>1 - Tertinggi</option>
                <option value={2}>2</option>
                <option value={3}>3 - Normal</option>
                <option value={4}>4</option>
                <option value={5}>5 - Terendah</option>
              </select>
            </label>
            <label className={styles.priorityLabel}>
              Project (opsional)
              <select className={styles.prioritySelect} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Tanpa project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.priorityLabel}>
              Deadline (opsional)
              <input
                type="datetime-local"
                className={styles.prioritySelect}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
            <label className={styles.toggle} onClick={() => setRequiresApproval((v) => !v)}>
              <span className={`${styles.toggleTrack} ${requiresApproval ? styles.toggleTrackOn : ""}`}>
                <span className={`${styles.toggleKnob} ${requiresApproval ? styles.toggleKnobOn : ""}`} />
              </span>
              Hasil akhir wajib persetujuan saya
            </label>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.submitRow}>
            <button className={styles.submitButton} disabled={busy || !title.trim()} onClick={submit}>
              {busy ? "Mengirim..." : "Kirim ke Chief of Staff"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.historyHead}>
        <h2>Riwayat pekerjaan yang diberikan</h2>
        <span className={styles.historyCount}>{tasks.length}</span>
      </div>

      {tasks.length === 0 && <p className={styles.empty}>Belum ada pekerjaan yang diberikan.</p>}

      <div className={styles.timeline}>
        {tasks.map((t) => {
          const color = STATUS_COLOR[t.status] ?? "#94a3b8";
          const executor = t.assignments?.filter((a) => a.role === "EXECUTOR").slice(-1)[0];
          const repliedBy = executor ? `${executor.agent.displayName} · ${executor.agent.agentRole.name}` : "Chief of Staff";
          return (
            <div key={t.id} className={styles.entry}>
              <div className={styles.entryRail}>
                <div className={styles.entryDot} style={{ background: color }} />
              </div>
              <div className={styles.entryBody}>
                <div className={styles.entryTop}>
                  <p className={styles.entryTitle}>{t.title}</p>
                  <span className={styles.pill} style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>
                </div>
                <p className={styles.entryTime}>
                  Dikirim {formatTime(t.createdAt)}
                  {t.updatedAt !== t.createdAt && ` · Diperbarui ${formatTime(t.updatedAt)}`}
                </p>
                {t.description && <ExpandableText text={t.description} className={styles.entryDesc} />}
                {t.resultSummary && (
                  <div className={styles.reply}>
                    <p className={styles.replyFrom}>Balasan dari {repliedBy}</p>
                    <ExpandableText
                      text={t.resultSummary}
                      className={styles.replyText}
                      onLoadFull={() => api.taskFullText(t.id)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
