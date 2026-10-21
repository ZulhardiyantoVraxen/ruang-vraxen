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
    attachmentId?: string;
  }) => request<any>("/tasks", { method: "POST", body: JSON.stringify(payload) }),
  /**
   * "Kanban saya pengen bisa geser sendiri, Direktur punya hak penuh untuk
   * mempercepat progress" - drag-and-drop on the Task Board calls this to
   * force a card straight into whatever column it was dropped on, skipping
   * whatever stage the normal executor/QA/approval pipeline would require.
   */
  overrideTaskStatus: (taskId: string, status: string) =>
    request<any>(`/tasks/${taskId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  /**
   * "Perintah sekaligus" - one instruction, fanned out to any number of
   * agents at once. `queued: true` in the result means the agent was busy
   * and the director's order is reserved to start the instant they free up
   * - never silently dropped.
   */
  broadcastCommand: (payload: { agentIds: string[]; instruction: string; projectId?: string; dueAt?: string; attachmentId?: string }) =>
    request<{
      dispatched: { agentId: string; agentName: string; taskId: string; queued: boolean }[];
      failed: { agentId: string; agentName: string; reason: string }[];
    }>("/tasks/broadcast", { method: "POST", body: JSON.stringify(payload) }),
  listProjects: () => request<any[]>("/projects"),
  agentChatHistory: (agentId: string) => request<any[]>(`/agents/${agentId}/chat`),
  /**
   * Plain conversation with one agent - the API classifies the message and
   * only creates a real Task (see `result.type === "task"`) when it reads
   * as an actual work order, so ordinary chat never shows up on the Task
   * Board. `attachmentId` comes from `uploadFile` below - "di semua menu
   * chat ada file upload, bisa berupa apapun".
   */
  agentChat: (agentId: string, message: string, attachmentId?: string) =>
    request<
      | { type: "chat"; reply: string }
      | { type: "task"; taskId: string; title: string; queued: boolean; note: string }
    >(`/agents/${agentId}/chat`, { method: "POST", body: JSON.stringify({ message, attachmentId }) }),
  /**
   * Uploads a file of any type to the shared attachment store and returns
   * its id - pass that id as `attachmentId` to agentChat/createTask/
   * broadcastCommand to fold it into that message. Text-like files (txt,
   * md, csv, json…) are read into the agent's context; anything else is
   * still stored and downloadable via the returned `url`, just not parsed.
   */
  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/uploads`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`API /uploads failed: ${res.status}`);
    return res.json() as Promise<{ id: string; filename: string; mimeType: string; size: number; url: string }>;
  },
  createProject: (name: string, description?: string) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  /**
   * Same-origin link to the task's result as a PDF, streamed by the API
   * itself (MinIO has no public port) - 404s until the worker has produced
   * one. Browser-only; build it with the same base the rest of this client
   * uses so it works both behind Caddy and in dev.
   */
  taskPdfHref: (taskId: string) =>
    `${typeof window === "undefined" ? "" : process.env.NEXT_PUBLIC_API_URL ?? "/api"}/tasks/${taskId}/pdf`,
  /** "Baca semua" on a truncated Task.resultSummary - the full .md the worker stored, read lazily on expand. */
  taskFullText: async (taskId: string) => {
    const res = await fetch(`${BASE}/tasks/${taskId}/full-text`, { cache: "no-store" });
    if (!res.ok) throw new Error(`API /tasks/${taskId}/full-text failed: ${res.status}`);
    return res.text();
  },
  /** "Arsip" - every finished task plus where its output actually lives (GitHub repo / Drive / PDF). */
  archive: () =>
    request<
      {
        id: string;
        title: string;
        status: string;
        division: { name: string; slug: string } | null;
        project: { name: string } | null;
        updatedAt: string;
        resultSummary: string | null;
        githubUrl: string | null;
        driveUrl: string | null;
        pdfAvailable: boolean;
      }[]
    >("/tasks/archive"),
  /** The director's queue of questions raised by PM/decision-point agents mid-task. */
  openQuestions: () => request<any[]>("/questions/open"),
  /** `attachmentId` from `uploadFile` - "setiap pertanyaan juga ada attachment filenya". */
  answerQuestion: (id: string, answer: string, attachmentId?: string) =>
    request<any>(`/questions/${id}/answer`, { method: "PATCH", body: JSON.stringify({ answer, attachmentId }) }),
  /** Director confirms a repo-request question - records which GitHub repo the project now commits to, and resumes the paused task. */
  confirmRepo: (id: string, repoName: string) =>
    request<any>(`/questions/${id}/confirm-repo`, { method: "PATCH", body: JSON.stringify({ repoName }) }),
  /**
   * "Tambah personel" from the division menu - director supplies only a
   * role name (+ optional responsibilities); tier and the agent's display
   * name are inferred/generated server-side.
   */
  quickAddPersonnel: (divisionSlug: string, roleName: string, responsibilities?: string) =>
    request<{ role: any; agent: any }>(`/divisions/${divisionSlug}/personnel`, {
      method: "POST",
      body: JSON.stringify({ roleName, responsibilities }),
    }),
  startOnboarding: (brief: string) => request<any>("/onboarding/start", { method: "POST", body: JSON.stringify({ brief }) }),
  answerOnboarding: (sessionId: string, answer: string) =>
    request<any>(`/onboarding/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ answer }) }),
  confirmOnboarding: (sessionId: string, slug: string, name: string, description?: string) =>
    request<any>(`/onboarding/${sessionId}/confirm`, { method: "POST", body: JSON.stringify({ slug, name, description }) }),

  // --- Meeting rooms (Point 4: satu privat Direktur+CEO, satu terbuka untuk semua tim yang diundang) ---
  listMeetings: (status?: string) => request<any[]>(`/meetings${status ? `?status=${status}` : ""}`),
  getMeeting: (id: string) => request<any>(`/meetings/${id}`),
  /** Idempotent - always resolves to the same standing Direktur-CEO room. */
  openDirectorCeoRoom: () => request<any>("/meetings/director-ceo", { method: "POST" }),
  createMeeting: (title: string, inviteAgentIds: string[]) =>
    request<any>("/meetings", { method: "POST", body: JSON.stringify({ title, inviteAgentIds }) }),
  sendMeetingMessage: (id: string, content: string) =>
    request<{ messages: any[]; failures: { agentId: string; agentName: string; reason: string }[] }>(
      `/meetings/${id}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    ),
  inviteToMeeting: (id: string, agentId: string) =>
    request<any>(`/meetings/${id}/invite`, { method: "POST", body: JSON.stringify({ agentId }) }),
  closeMeeting: (id: string) => request<any>(`/meetings/${id}/close`, { method: "POST" }),
};
