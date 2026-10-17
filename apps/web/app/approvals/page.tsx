import { api } from "@/lib/api";

// The human-approval queue from the "Alur Kerja Startup Virtual" artifact -
// one shared inbox across every division, not per-PM.
export default async function ApprovalsPage() {
  const approvals = await api.pendingApprovals().catch(() => []);

  return (
    <div>
      <h1>Antrean Persetujuan</h1>
      <ul>
        {approvals.map((a: any) => (
          <li key={a.id} style={{ marginBottom: 12 }}>
            <strong>{a.task.title}</strong> — {a.task.division.name}
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Diajukan {new Date(a.requestedAt).toLocaleString("id-ID")}</div>
          </li>
        ))}
        {approvals.length === 0 && <li style={{ color: "#64748b" }}>Tidak ada yang menunggu persetujuan.</li>}
      </ul>
    </div>
  );
}
