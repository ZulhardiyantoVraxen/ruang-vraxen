import { api } from "@/lib/api";

export default async function TasksPage() {
  const divisions = await api.listDivisions().catch(() => []);
  const byDivision = await Promise.all(
    divisions.map(async (d: any) => ({ division: d, tasks: await api.runningTasks(d.id).catch(() => []) })),
  );

  return (
    <div>
      <h1>Task Board</h1>
      {byDivision.map(({ division, tasks }) => (
        <div key={division.id} style={{ marginTop: 24 }}>
          <h3>{division.name}</h3>
          <ul>
            {tasks.map((t: any) => (
              <li key={t.id}>{t.title} — {t.status}</li>
            ))}
            {tasks.length === 0 && <li style={{ color: "#64748b" }}>Tidak ada task berjalan.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
