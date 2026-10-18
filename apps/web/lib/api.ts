/**
 * Every page fetches through this one client -> the UI never hardcodes which
 * divisions/roles/tasks exist. New divisions created through onboarding show
 * up automatically on next fetch, same as task boards per divisi.
 *
 * Server components (and the worker/API-adjacent code paths) run inside the
 * `web` container, where a relative path like "/api" has no origin to
 * resolve against - `fetch("/api/...")` throws there, which this file used
 * to swallow in every caller's `.catch(() => [])`, rendering a dashboard
 * that always looked empty. On the server, talk to the API directly over
 * the Docker network via API_URL (set at runtime, see docker-compose.prod
 * .yml); in the browser, keep using the same-origin "/api" path that Next's
 * rewrite forwards to the API container.
 */
const BASE =
  typeof window === "undefined"
    ? process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://api:4000"
    : process.env.NEXT_PUBLIC_API_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  listDivisions: () => request<any[]>("/divisions"),
  getDivision: (slug: string) => request<any>(`/divisions/${slug}`),
  runningTasks: (divisionId: string) => request<any[]>(`/tasks/division/${divisionId}/running`),
  pendingApprovals: () => request<any[]>("/approvals/pending"),
  decideApproval: (id: string, status: "APPROVED" | "REJECTED", approverRef: string, notes?: string) =>
    request(`/approvals/${id}/decide`, { method: "PATCH", body: JSON.stringify({ status, approverRef, notes }) }),
  createTask: (payload: {
    divisionSlug: string;
    title: string;
    description?: string;
    priority?: number;
    requiresApproval?: boolean;
    projectId?: string;
    dueAt?: string;
  }) => request<any>("/tasks", { method: "POST", body: JSON.stringify(payload) }),
  /**
   * "Perintah sekaligus" - one instruction, fanned out to any number of
   * agents at once. `queued: true` in the result means the agent was busy
   * and the director's order is reserved to start the instant they free up
   * - never silently dropped.
   */
  broadcastCommand: (payload: { agentIds: string[]; instruction: string; projectId?: string; dueAt?: string }) =>
    request<{
      dispatched: { agentId: string; agentName: string; taskId: string; queued: boolean }[];
      failed: { agentId: string; agentName: string; reason: string }[];
    }>("/tasks/broadcast", { method: "POST", body: JSON.stringify(payload) }),
  listProjects: () => request<any[]>("/projects"),
  createProject: (name: string, description?: string) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  /** The director's queue of questions raised by PM/decision-point agents mid-task. */
  openQuestions: () => request<any[]>("/questions/open"),
  answerQuestion: (id: string, answer: string) =>
    request<any>(`/questions/${id}/answer`, { method: "PATCH", body: JSON.stringify({ answer }) }),
  startOnboarding: (brief: string) => request<any>("/onboarding/start", { method: "POST", body: JSON.stringify({ brief }) }),
  answerOnboarding: (sessionId: string, answer: string) =>
    request<any>(`/onboarding/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ answer }) }),
  confirmOnboarding: (sessionId: string, slug: string, name: string, description?: string) =>
    request<any>(`/onboarding/${sessionId}/confirm`, { method: "POST", body: JSON.stringify({ slug, name, description }) }),
};
