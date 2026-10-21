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
  /** Arsip - approval yang sudah diputuskan (disetujui/ditolak). */
  decidedApprovals: () => request<any[]>("/approvals/decided"),
  decideApproval: (id: string, status: "APPROVED" | "REJECTED", approverRef: string, notes?: string, attachmentIds?: string[]) =>
    request(`/approvals/${id}/decide`, { method: "PATCH", body: JSON.stringify({ status, approverRef, notes, attachmentIds }) }),
  createTask: (payload: {
    divisionSlug: string;
    title: string;
    description?: string;
    priority?: number;
    requiresApproval?: boolean;
    projectId?: string;
    dueAt?: string;
    attachmentIds?: string[];
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
  broadcastCommand: (payload: { agentIds: string[]; instruction: string; projectId?: string; dueAt?: string; attachmentIds?: string[] }) =>
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
   * Board. `attachmentIds` come from `uploadFile` below - "di semua menu
   * chat ada file upload, bisa dokumen atau folder".
   */
  agentChat: (agentId: string, message: string, attachmentIds?: string[]) =>
    request<
      | { type: "chat"; reply: string }
      | { type: "task"; taskId: string; title: string; queued: boolean; note: string }
    >(`/agents/${agentId}/chat`, { method: "POST", body: JSON.stringify({ message, attachmentIds }) }),
  /**
   * Uploads a file of any type to the shared attachment store and returns
   * its id - pass that id (or several, for a folder - one call per file) as
   * `attachmentIds` to agentChat/createTask/broadcastCommand/etc to fold it
   * into that message. Text-like files (txt, md, csv, json…) are read into
   * the agent's context; anything else is still stored and downloadable via
   * the returned `url`, just not parsed.
   */
  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/uploads`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`API /uploads failed: ${res.status}`);
    return res.json() as Promise<{ id: string; filename: string; mimeType: string; size: number; url: string }>;
  },
  createProject: (name: string, description?: string, attachmentIds?: string[]) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify({ name, description, attachmentIds }) }),
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
  /** Arsip - pertanyaan yang sudah dijawab (atau repo-request yang sudah dikonfirmasi). */
  archivedQuestions: () => request<any[]>("/questions/archived"),
  /** `attachmentIds` from `uploadFile` - "setiap pertanyaan juga ada attachment filenya, bisa dokumen atau folder". */
  answerQuestion: (id: string, answer: string, attachmentIds?: string[]) =>
    request<any>(`/questions/${id}/answer`, { method: "PATCH", body: JSON.stringify({ answer, attachmentIds }) }),
  /** Director confirms a repo-request question - records which GitHub repo the project now commits to, and resumes the paused task. */
  confirmRepo: (id: string, repoName: string) =>
    request<any>(`/questions/${id}/confirm-repo`, { method: "PATCH", body: JSON.stringify({ repoName }) }),
  /**
   * "Tambah personel" from the division menu - director supplies only a
   * role name (+ optional responsibilities); tier and the agent's display
   * name are inferred/generated server-side.
   */
  quickAddPersonnel: (divisionSlug: string, roleName: string, responsibilities?: string, attachmentIds?: string[]) =>
    request<{ role: any; agent: any }>(`/divisions/${divisionSlug}/personnel`, {
      method: "POST",
      body: JSON.stringify({ roleName, responsibilities, attachmentIds }),
    }),
  startOnboarding: (brief: string, attachmentIds?: string[]) =>
    request<any>("/onboarding/start", { method: "POST", body: JSON.stringify({ brief, attachmentIds }) }),
  answerOnboarding: (sessionId: string, answer: string, attachmentIds?: string[]) =>
    request<any>(`/onboarding/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ answer, attachmentIds }) }),
  confirmOnboarding: (sessionId: string, slug: string, name: string, description?: string) =>
    request<any>(`/onboarding/${sessionId}/confirm`, { method: "POST", body: JSON.stringify({ slug, name, description }) }),

  // --- Meeting rooms (Point 4: satu privat Direktur+CEO, satu terbuka untuk semua tim yang diundang) ---
  listMeetings: (status?: string) => request<any[]>(`/meetings${status ? `?status=${status}` : ""}`),
  getMeeting: (id: string) => request<any>(`/meetings/${id}`),
  /** Idempotent - always resolves to the same standing Direktur-CEO room. */
  openDirectorCeoRoom: () => request<any>("/meetings/director-ceo", { method: "POST" }),
  createMeeting: (title: string, inviteAgentIds: string[]) =>
    request<any>("/meetings", { method: "POST", body: JSON.stringify({ title, inviteAgentIds }) }),
  sendMeetingMessage: (id: string, content: string, attachmentIds?: string[]) =>
    request<{ messages: any[]; failures: { agentId: string; agentName: string; reason: string }[] }>(
      `/meetings/${id}/messages`,
      { method: "POST", body: JSON.stringify({ content, attachmentIds }) },
    ),
  inviteToMeeting: (id: string, agentId: string) =>
    request<any>(`/meetings/${id}/invite`, { method: "POST", body: JSON.stringify({ agentId }) }),
  closeMeeting: (id: string) => request<any>(`/meetings/${id}/close`, { method: "POST" }),
  /** "Dirangkum dulu dari hasil rapat" - draft title+description, nothing created yet. */
  summarizeMeeting: (id: string) =>
    request<{ title: string; description: string; driveUrl: string | null }>(`/meetings/${id}/summarize`, { method: "POST" }),
  /** "Lalu dijadikan task" - Director-approved summary becomes a real Task. */
  createTaskFromMeeting: (id: string, agentId: string, title: string, description: string) =>
    request<{ taskId: string; queued: boolean }>(`/meetings/${id}/create-task`, {
      method: "POST",
      body: JSON.stringify({ agentId, title, description }),
    }),

  // --- Release ke Caddy ("semua yang menghasilkan file script bisa langsung
  // di-release") - stage (zip upload or an existing .html attachment from
  // chat/rapat) -> preview -> pilih subdomain -> go-live setelah DNS siap.
  listReleases: () => request<Release[]>("/releases"),
  getRelease: (id: string) => request<Release>(`/releases/${id}`),
  /** `file` for a zip upload, or `attachmentId` to reuse an existing chat/meeting .html attachment - pass exactly one. */
  createRelease: async (title: string, source: { file?: File; attachmentId?: string }) => {
    const form = new FormData();
    form.append("title", title);
    if (source.file) form.append("file", source.file);
    if (source.attachmentId) form.append("attachmentId", source.attachmentId);
    const res = await fetch(`${BASE}/releases`, { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `API /releases failed: ${res.status}`);
    return res.json() as Promise<Release>;
  },
  /** Browser-only preview link - opens the staged site in a new tab before anything is public. */
  releasePreviewUrl: (id: string) => `${BASE}/releases/${id}/preview`,
  setReleaseSubdomain: (id: string, subdomain: string) =>
    request<{ release: Release; dnsInstructions: { type: string; host: string; value: string } }>(
      `/releases/${id}/subdomain`,
      { method: "POST", body: JSON.stringify({ subdomain }) },
    ),
  checkReleaseDns: (id: string) =>
    request<{ host: string; expected: string; records: string[]; matches: boolean }>(`/releases/${id}/check-dns`),
  goLiveRelease: (id: string) => request<Release>(`/releases/${id}/go-live`, { method: "POST" }),
  takeDownRelease: (id: string) => request<Release>(`/releases/${id}/take-down`, { method: "POST" }),
};

export type Release = {
  id: string;
  title: string;
  slug: string;
  status: "STAGED" | "PENDING_DNS" | "LIVE";
  sourceKind: "zip" | "attachment";
  subdomain: string | null;
  liveUrl: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
