import { api } from "@/lib/api";

// Shows one division's roster AND every task currently running in it in
// parallel - this is the "1 divisi bisa kerjakan beberapa pekerjaan
// sekaligus" view.
export default async function DivisionDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const division = await api.getDivision(slug);
  const running = await api.runningTasks(division.id).catch(() => []);

  return (
    <div>
      <h1>{division.name}</h1>
      <p style={{ color: "#94a3b8" }}>{division.description}</p>

      <h2 style={{ marginTop: 32 }}>Roster</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th align="left">Role</th><th align="left">Tier</th><th align="left">Agent</th><th align="left">Max paralel</th></tr>
        </thead>
        <tbody>
          {division.agentRoles.map((role: any) => (
            <tr key={role.id} style={{ borderTop: "1px solid #334155" }}>
              <td>{role.name}</td>
              <td>{role.tier}</td>
              <td>{role.agents.map((a: any) => `${a.displayName} (${a.status})`).join(", ") || "—"}</td>
              <td>{role.maxConcurrentTasks}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 32 }}>Pekerjaan berjalan ({running.length})</h2>
      <ul>
        {running.map((task: any) => (
          <li key={task.id}>
            <strong>{task.title}</strong> — {task.status}
            {task.assignments?.length > 0 && (
              <span style={{ color: "#94a3b8" }}> · {task.assignments.map((a: any) => a.agent.displayName).join(", ")}</span>
            )}
          </li>
        ))}
        {running.length === 0 && <li style={{ color: "#64748b" }}>Tidak ada pekerjaan berjalan.</li>}
      </ul>
    </div>
  );
}
