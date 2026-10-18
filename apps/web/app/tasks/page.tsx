import { api } from "@/lib/api";
import TaskBoard from "./TaskBoard";

// Kanban view of every top-level task actually being worked, fed from the
// same /divisions payload the office dashboard already uses (each division
// carries its own top-level tasks) - no separate aggregation endpoint
// needed, just flattened with the division name, PIC (latest executor) and
// deadline attached per task.
//
// "Pusat" is excluded on purpose: those rows are the director's own raw
// command intake (handled by the "PIC Chief of Staff" / Riwayat page, not
// the Task Board) - the brief was explicit that only actual execution work
// should land here, not the director's orders themselves.
export default async function TasksPage() {
  const [divisions, projects] = await Promise.all([
    api.listDivisions().catch(() => []),
    api.listProjects().catch(() => []),
  ]);

  const tasks = divisions
    .filter((d: any) => d.slug !== "pusat")
    .flatMap((d: any) =>
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

  return <TaskBoard tasks={tasks} divisions={divisions.filter((d: any) => d.slug !== "pusat").map((d: any) => ({ id: d.id, name: d.name }))} projects={projects} />;
}
