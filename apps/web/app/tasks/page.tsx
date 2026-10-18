import { api } from "@/lib/api";
import TaskBoard from "./TaskBoard";

// Kanban view of every top-level task across every division, fed from the
// same /divisions payload the office dashboard already uses (each division
// carries its own top-level tasks) - no separate aggregation endpoint
// needed, just flattened with the division name attached per task.
export default async function TasksPage() {
  const divisions = await api.listDivisions().catch(() => []);
  const tasks = divisions.flatMap((d: any) =>
    (d.tasks ?? []).map((t: any) => ({ ...t, divisionName: d.name })),
  );

  return <TaskBoard tasks={tasks} />;
}
