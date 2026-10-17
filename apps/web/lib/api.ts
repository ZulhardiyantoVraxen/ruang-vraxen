/**
 * Every page fetches through this one client -> the UI never hardcodes which
 * divisions/roles/tasks exist. New divisions created through onboarding show
 * up automatically on next fetch, same as task boards per divisi.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

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
  startOnboarding: (brief: string) => request<any>("/onboarding/start", { method: "POST", body: JSON.stringify({ brief }) }),
  answerOnboarding: (sessionId: string, answer: string) =>
    request<any>(`/onboarding/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ answer }) }),
  confirmOnboarding: (sessionId: string, slug: string, name: string, description?: string) =>
    request<any>(`/onboarding/${sessionId}/confirm`, { method: "POST", body: JSON.stringify({ slug, name, description }) }),
};
