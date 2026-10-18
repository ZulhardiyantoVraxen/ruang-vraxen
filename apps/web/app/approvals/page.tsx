import { api } from "@/lib/api";
import ApprovalsPanel from "./ApprovalsPanel";

// The human-approval queue from the "Alur Kerja Startup Virtual" artifact -
// one shared inbox across every division, not per-PM. This is the manual
// trigger that moves a task from REVIEW/APPROVAL_PENDING to DONE/REJECTED
// on the Kanban (see "Jelaskan trigger Task Board" in the chat) - every
// other column change happens automatically.
export default async function ApprovalsPage() {
  const approvals = await api.pendingApprovals().catch(() => []);
  return <ApprovalsPanel initial={approvals} />;
}
