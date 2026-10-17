"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";

type Agent = { id: string; displayName: string; status: string };
type AgentRole = { id: string; name: string; requiresApproval: boolean; agents: Agent[] };
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
  DONE: "#5fc9b8",
  REJECTED: "#e06c5b",
};

export default function ChiefOfStaffPanel({ pusat }: { pusat: Division | null }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(3);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(pusat?.tasks ?? []);

  const chiefOfStaff = useMemo(() => {
    const role = pusat?.agentRoles.find((r) => r.name.toLowerCase().includes("chief of staff"));
    return role?.agents[0] ?? null;
  }, [pusat]);

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
      });
      setTasks((prev) => [task, ...prev]);
      setTitle("");
      setDescription("");
      setPriority(3);
      setRequiresApproval(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim pekerjaan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <h1>PIC Chief of Staff</h1>
      <p style={{ color: "#94a3b8" }}>
        Beri pekerjaan langsung ke Chief of Staff di sini - bukan ke divisi tertentu. Chief of Staff yang akan
        memilah, meneruskan ke PM divisi terkait, dan menggabungkan laporan yang butuh persetujuan Anda jadi satu
        antrean di halaman Approval.
      </p>
      {chiefOfStaff && (
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Chief of Staff saat ini: <strong style={{ color: "#e2e8f0" }}>{chiefOfStaff.displayName}</strong>
        </p>
      )}
      {!pusat && (
        <p style={{ color: "#e06c5b" }}>
          Tidak bisa memuat divisi Pusat / Chief of Staff. Coba muat ulang halaman.
        </p>
      )}

      {pusat && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            placeholder="Judul pekerjaan - contoh: Review rencana ekspansi Q1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ padding: 8 }}
          />
          <textarea
            placeholder="Detail / konteks (opsional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ padding: 8, width: "100%" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              Prioritas
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={1}>1 - Tertinggi</option>
                <option value={2}>2</option>
                <option value={3}>3 - Normal</option>
                <option value={4}>4</option>
                <option value={5}>5 - Terendah</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              Hasil akhir wajib persetujuan saya
            </label>
          </div>
          {error && <p style={{ color: "#e06c5b", fontSize: 13 }}>{error}</p>}
          <div>
            <button disabled={busy || !title.trim()} onClick={submit}>
              {busy ? "Mengirim..." : "Kirim ke Chief of Staff"}
            </button>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 32 }}>Riwayat pekerjaan yang diberikan</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {tasks.map((t) => (
          <li key={t.id} style={{ borderTop: "1px solid #1c2b3a", padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <strong>{t.title}</strong>
              <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[t.status] ?? "#94a3b8", whiteSpace: "nowrap" }}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            {t.description && <p style={{ fontSize: 13, color: "#94a3b8", margin: "4px 0 0" }}>{t.description}</p>}
            {t.resultSummary && (
              <p style={{ fontSize: 13, color: "#c3cdd7", margin: "4px 0 0" }}>
                <em>Hasil:</em> {t.resultSummary}
              </p>
            )}
          </li>
        ))}
        {tasks.length === 0 && <li style={{ color: "#64748b", padding: "10px 0" }}>Belum ada pekerjaan yang diberikan.</li>}
      </ul>
    </div>
  );
}
