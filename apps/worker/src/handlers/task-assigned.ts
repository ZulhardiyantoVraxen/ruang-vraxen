import { prisma } from "../prisma";
import { apiClient } from "../api-client";
import { config } from "../config";
import {
  OpenRouterClient,
  ObjectStorageClient,
  resolveModel,
  resolveVariantUsed,
  markdownToPdfBuffer,
  GitHubClient,
  GoogleSheetsClient,
  extractCodeBlocks,
} from "@platform/shared";
import { executorPrompt, pmExecutorPrompt, financeBudgetPrompt, chiefOfStaffRelayPrompt, reviewerPrompt } from "../prompts";

const openRouter = new OpenRouterClient(config.openRouterApiKey);
const objectStorage = new ObjectStorageClient(config.objectStorage);

interface TaskAssignedPayload {
  agentId: string;
  role: "EXECUTOR" | "REVIEWER";
}

/**
 * Reacts to task-events / "task.assigned". Only EXECUTOR assignments start
 * work here - a REVIEWER assignment is picked up as part of the SAME run,
 * right after the executor produces output (see runQaIfReviewerAssigned
 * below), rather than waiting for its own event. That keeps QA deterministic:
 * it can never fire before there is anything to review.
 */
export async function handleTaskAssigned(taskId: string, payload: TaskAssignedPayload) {
  if (payload.role !== "EXECUTOR") return; // REVIEWER handled inline after executor finishes, see below

  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: payload.agentId },
    include: { agentRole: { include: { modelClass: true, division: true } } },
  });
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { division: true },
  });

  await apiClient.setAgentStatus(agent.id, "WORKING");

  // AgentRole.requiresApproval is this codebase's existing "is a PM/
  // decision-point role" flag (same one task-created.ts uses to find Chief
  // of Staff) - any such role gets the structured prompt that can raise a
  // question to the director instead of forcing a guess.
  if (agent.agentRole.requiresApproval) {
    await runPmExecutor(agent, task);
  } else if (isFinance(agent.agentRole.name, task.division.slug)) {
    await runFinanceExecutor(agent, task);
  } else {
    await runStandardExecutor(agent, task);
  }
}

function isFinance(roleName: string, divisionSlug: string): boolean {
  return divisionSlug === "pusat" && roleName.toLowerCase() === "finance";
}

async function runStandardExecutor(
  agent: Awaited<ReturnType<typeof prisma.agent.findUniqueOrThrow>> & {
    agentRole: { name: string; responsibilities: string | null; modelClass: any; division: any };
  },
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & { division: { name: string; slug: string } },
) {
  const route = resolveModel(agent.agentRole.modelClass, agent.modelVariant, {
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
  });
  const prompt = executorPrompt({
    divisionName: task.division.name,
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
    taskTitle: task.title,
    taskDescription: task.description,
  });

  const { content, tokensIn, tokensOut, modelId: usedModelId } = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
    { role: "system", content: agent.systemPrompt ?? "Kerjakan task yang diberikan sebaik mungkin." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: agent.id,
    taskId: task.id,
    modelUsed: usedModelId,
    modelVariant: resolveVariantUsed(route, usedModelId),
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  // Long output goes to object storage; the task row only keeps a short summary + the key.
  const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", content, "text/markdown");
  await storeAsPdf(task.id, task.title, content);
  await commitCodeIfPresent(task.id, task.title, task.division.slug, task.projectId, content);
  const summary = content.length > 500 ? `${content.slice(0, 500)}…` : content;
  await apiClient.recordResult(task.id, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(task.id, content);
}

/**
 * "Finance hanya perlu skill untuk menghitung nilai budget project ... dalam
 * beberapa fase, nanti dia membuat dokumen per project itu sendiri di Google
 * Sheets" - Finance's entire job now, replacing the old generic
 * executorPrompt free-text path. The model replies with phase-broken-down
 * numbers; this turns that straight into a Google Sheet via
 * GoogleSheetsClient (best-effort - if GOOGLE_* env vars aren't configured
 * yet, the budget is still computed and recorded as the task result, just
 * without an actual spreadsheet).
 */
async function runFinanceExecutor(
  agent: Awaited<ReturnType<typeof prisma.agent.findUniqueOrThrow>> & {
    agentRole: { name: string; responsibilities: string | null; modelClass: any; division: any };
  },
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & {
    division: { name: string; slug: string };
    projectId: string | null;
  },
) {
  const route = resolveModel(agent.agentRole.modelClass, agent.modelVariant, {
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
  });
  const project = task.projectId ? await prisma.project.findUnique({ where: { id: task.projectId } }) : null;
  const prompt = financeBudgetPrompt({
    taskTitle: task.title,
    taskDescription: task.description,
    projectName: project?.name ?? null,
  });

  const { content, tokensIn, tokensOut, modelId: usedModelId } = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
    { role: "system", content: agent.systemPrompt ?? "Kamu adalah Finance, hitung estimasi budget project dengan teliti." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: agent.id,
    taskId: task.id,
    modelUsed: usedModelId,
    modelVariant: resolveVariantUsed(route, usedModelId),
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  type BudgetReply = { phases: { name: string; amount: number }[]; notes?: string };
  let parsed: BudgetReply | null = null;
  try {
    const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const candidate = JSON.parse(unfenced);
    if (!Array.isArray(candidate?.phases)) throw new Error("missing phases[]");
    parsed = candidate;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    // Model didn't return clean budget JSON - record the raw reply as a
    // plain result rather than crashing the consumer loop, same fail-safe
    // philosophy as the PM/QA JSON parses below.
    const summary = content.length > 500 ? `${content.slice(0, 500)}…` : content;
    const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", content, "text/markdown");
    await apiClient.recordResult(task.id, summary, objectKey);
    await apiClient.setAgentStatus(agent.id, "IDLE");
    await runQaIfReviewerAssigned(task.id, content);
    return;
  }

  const total = parsed.phases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const fmt = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const summaryLines = [
    project?.name ? `Estimasi budget project "${project.name}":` : "Estimasi budget:",
    ...parsed.phases.map((p) => `- ${p.name}: ${fmt(Number(p.amount) || 0)}`),
    `Total: ${fmt(total)}`,
    parsed.notes ? `Catatan: ${parsed.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", summaryLines, "text/markdown");
  await storeAsPdf(task.id, task.title, summaryLines);
  await createBudgetSheetIfConfigured(task.id, task.projectId, project?.name ?? null, parsed, total);

  const summary = summaryLines.length > 500 ? `${summaryLines.slice(0, 500)}…` : summaryLines;
  await apiClient.recordResult(task.id, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(task.id, summaryLines);
}

/**
 * Finds (or creates, first time only) the Drive subfolder for a Project
 * under the director's single "Semua Project" root folder - "di folder 2
 * wajib buat folder baru untuk setiap projectnya". The resulting folder id
 * is cached via the same marker-file pattern as the GitHub repo marker
 * (`project/${projectId}/drive-folder.json`) so repeat budget tasks for the
 * same project reuse one folder instead of creating a new one every time.
 */
async function getOrCreateProjectDriveFolder(
  sheets: GoogleSheetsClient,
  projectId: string,
  projectName: string,
  rootFolderId: string,
): Promise<string> {
  const key = `project/${projectId}/drive-folder.json`;
  if (await objectStorage.exists(key)) {
    const buffer = await objectStorage.getObjectBuffer(key);
    const data = JSON.parse(buffer.toString("utf-8")) as { folderId: string };
    if (data.folderId) return data.folderId;
  }

  let folderId = await sheets.findFolderByName(projectName, rootFolderId);
  if (!folderId) folderId = await sheets.createFolder(projectName, rootFolderId);

  await objectStorage.putObject(
    key,
    JSON.stringify({ folderId, createdAt: new Date().toISOString() }),
    "application/json",
  );
  return folderId;
}

/**
 * Creates the actual Google Sheet for a Finance budget task, inside that
 * project's own Drive subfolder, and drops the same marker-file pattern as
 * commitCodeIfPresent's github-output.json - the Archive page already reads
 * `${taskId}/drive-output.json`, so no apps/api or apps/web change is needed
 * for the link to show up there. Best-effort: with no GOOGLE_* env vars set
 * yet, or no project attached to the task, this silently skips (budget
 * numbers are still recorded as the task result either way).
 */
async function createBudgetSheetIfConfigured(
  taskId: string,
  projectId: string | null,
  projectName: string | null,
  budget: { phases: { name: string; amount: number }[]; notes?: string },
  total: number,
) {
  const { serviceAccountEmail, privateKey, projectsRootFolderId } = config.google;
  if (!serviceAccountEmail || !privateKey || !projectsRootFolderId) return;
  if (!projectId || !projectName) return; // no project to file the sheet under - nothing to create

  try {
    const sheets = new GoogleSheetsClient({ clientEmail: serviceAccountEmail, privateKey });
    const folderId = await getOrCreateProjectDriveFolder(sheets, projectId, projectName, projectsRootFolderId);

    const rows: (string | number)[][] = [
      ["Fase", "Nominal (Rp)"],
      ...budget.phases.map((p) => [p.name, Number(p.amount) || 0]),
      ["Total", total],
    ];
    if (budget.notes) rows.push([], ["Catatan", budget.notes]);

    const sheet = await sheets.createSpreadsheet(`Budget - ${projectName}`, rows, folderId);
    await objectStorage.putTaskOutput(
      taskId,
      "drive-output.json",
      JSON.stringify({ url: sheet.url, spreadsheetId: sheet.spreadsheetId, folderId, createdAt: new Date().toISOString() }),
      "application/json",
    );
  } catch (err) {
    console.error(`[task-assigned] gagal membuat Google Sheet budget untuk task ${taskId}:`, err);
  }
}

/**
 * PM/decision-point variant: the model replies with structured JSON that
 * can either finish the task normally or raise a question to the director
 * (per "PM harus lebih interaktif bertanya kepada direktur" - this applies
 * any time a PM is executing a task, not only during Auditor's daily
 * check-in). A reply that isn't clean JSON is treated as a plain result
 * rather than crashing the consumer loop - same fail-safe philosophy as the
 * QA verdict parse below.
 */
async function runPmExecutor(
  agent: Awaited<ReturnType<typeof prisma.agent.findUniqueOrThrow>> & {
    agentRole: { name: string; responsibilities: string | null; modelClass: any; division: any; divisionId: string };
  },
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & { division: { name: string; slug: string } },
) {
  const route = resolveModel(agent.agentRole.modelClass, agent.modelVariant, {
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
  });
  const projectContext = await getProjectContext(task.projectId);
  const prompt = pmExecutorPrompt({
    divisionName: task.division.name,
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
    taskTitle: task.title,
    taskDescription: task.description,
    project: projectContext,
  });

  const { content, tokensIn, tokensOut, modelId: usedModelId } = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
    { role: "system", content: agent.systemPrompt ?? "Kerjakan task yang diberikan sebaik mungkin, sebagai PM divisi." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: agent.id,
    taskId: task.id,
    modelUsed: usedModelId,
    modelVariant: resolveVariantUsed(route, usedModelId),
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  type PmReply =
    | { type: "result"; summary: string }
    | { type: "question"; question: string }
    | { type: "repo_request"; repoName: string; reason?: string };

  let parsed: PmReply;
  try {
    // Models love wrapping JSON in a ```json ... ``` fence even when told
    // not to - strip it before parsing instead of falling back to treating
    // the whole fenced block (literal backticks included) as plain text.
    const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(unfenced);
    if (parsed.type !== "result" && parsed.type !== "question" && parsed.type !== "repo_request") {
      throw new Error("unexpected type");
    }
  } catch {
    parsed = { type: "result", summary: content };
  }

  if (parsed.type === "repo_request") {
    // "Nanti PM minta saya tulis nama repositorynya, sebelum melakukan
    // development ... akun ini khusus untuk output project" - always goes
    // straight to the (human) director, never through Chief of Staff -
    // creating a repo is a manual action only the director can do.
    await apiClient.requestGithubRepo({
      agentId: agent.id,
      divisionId: agent.agentRole.divisionId,
      taskId: task.id,
      repoName: parsed.repoName,
      reason: parsed.reason,
    });
    await apiClient.setAgentStatus(agent.id, "IDLE");
    return; // task is now AWAITING_DIRECTOR - resumes once the director confirms the repo exists (see QuestionsService.confirmRepo)
  }

  if (parsed.type === "question") {
    // "Direktur hanya koordinasi dengan Chief of Staff" - Chief of Staff's
    // OWN questions still go straight to the (human) director, same as
    // before. Every other PM's question is routed through Chief of Staff
    // first (an AI-to-AI call, resolved synchronously, right here).
    if (isChiefOfStaff(agent.agentRole.name, task.division.slug)) {
      await apiClient.askDirector({
        agentId: agent.id,
        divisionId: agent.agentRole.divisionId,
        taskId: task.id,
        question: parsed.question,
      });
      await apiClient.setAgentStatus(agent.id, "IDLE");
      return; // task is now AWAITING_DIRECTOR - resumes via QuestionsService.answer once the director replies
    }

    const relay = await relayQuestionThroughChiefOfStaff(agent, task, parsed.question);
    if (!relay.resolved) {
      return; // escalated to the director under Chief of Staff's name (or no Chief of Staff configured yet) - task is now AWAITING_DIRECTOR
    }

    // Chief of Staff answered directly - fold the Q&A into context and let
    // this PM finish the SAME task right now. No pause/resume needed: this
    // whole relay happened inside one worker invocation.
    const followUpDescription = [
      task.description,
      `[Pertanyaan ke Chief of Staff] ${parsed.question}`,
      `[Jawaban Chief of Staff] ${relay.answer}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const followUpPrompt = pmExecutorPrompt({
      divisionName: task.division.name,
      roleName: agent.agentRole.name,
      responsibilities: agent.agentRole.responsibilities,
      taskTitle: task.title,
      taskDescription: followUpDescription,
      project: projectContext,
    });

    const followUp = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
      { role: "system", content: agent.systemPrompt ?? "Kerjakan task yang diberikan sebaik mungkin, sebagai PM divisi." },
      { role: "user", content: followUpPrompt },
    ]);
    const usedModelId = followUp.modelId;
    await apiClient.recordUsage({
      agentId: agent.id,
      taskId: task.id,
      modelUsed: usedModelId,
      modelVariant: resolveVariantUsed(route, usedModelId),
      source: "kanban",
      tokensIn: followUp.tokensIn,
      tokensOut: followUp.tokensOut,
    });

    try {
      const unfenced = followUp.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      parsed = JSON.parse(unfenced);
      if (parsed.type !== "result" && parsed.type !== "question" && parsed.type !== "repo_request") {
        throw new Error("unexpected type");
      }
    } catch {
      parsed = { type: "result", summary: followUp.content };
    }

    if (parsed.type === "repo_request") {
      await apiClient.requestGithubRepo({
        agentId: agent.id,
        divisionId: agent.agentRole.divisionId,
        taskId: task.id,
        repoName: parsed.repoName,
        reason: parsed.reason,
      });
      await apiClient.setAgentStatus(agent.id, "IDLE");
      return;
    }

    if (parsed.type === "question") {
      // Still stuck even with Chief of Staff's answer folded in - don't loop
      // forever relaying back and forth. Chief of Staff has already weighed
      // in once, so this one goes to the director directly, still under
      // Chief of Staff's name (the director never sees the division PM here).
      await apiClient.askDirector({
        agentId: relay.chiefId,
        divisionId: relay.pusatId,
        taskId: task.id,
        question: parsed.question,
      });
      await apiClient.setAgentStatus(agent.id, "IDLE");
      return;
    }
  }

  const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", parsed.summary, "text/markdown");
  await storeAsPdf(task.id, task.title, parsed.summary);
  await commitCodeIfPresent(task.id, task.title, task.division.slug, task.projectId, parsed.summary);
  const summary = parsed.summary.length > 500 ? `${parsed.summary.slice(0, 500)}…` : parsed.summary;
  await apiClient.recordResult(task.id, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(task.id, parsed.summary);
  await appendPmReportRowIfConfigured(agent, task, parsed.summary);
}

/**
 * "Satu Google Sheets berisi banyak project, ada timeline, judul task, PIC,
 * keterangan dan status" - every division PM (not Chief of Staff - its own
 * triage/consolidation tasks aren't tied to a client Project, so there's
 * nothing meaningful to log here) gets one new row in a single shared
 * tracking sheet each time it finishes a Project task, rather than Finance's
 * one-new-file-per-task pattern. Best-effort, same fail-open philosophy as
 * createBudgetSheetIfConfigured: with no GOOGLE_* env vars configured, or no
 * Project attached to this task, this silently skips.
 */
async function appendPmReportRowIfConfigured(
  agent: { id: string; displayName: string; agentRole: { name: string; division: { name: string } } },
  task: { id: string; title: string; projectId: string | null },
  summary: string,
) {
  const { serviceAccountEmail, privateKey, projectsRootFolderId } = config.google;
  if (!serviceAccountEmail || !privateKey || !projectsRootFolderId) return;
  if (!task.projectId) return; // not tied to a client Project - nothing to log

  try {
    const sheets = new GoogleSheetsClient({ clientEmail: serviceAccountEmail, privateKey });
    const spreadsheetId = await getOrCreateMasterTrackingSheet(sheets, projectsRootFolderId);

    // Read the task back after runQaIfReviewerAssigned so "Status" reflects
    // where it actually landed (DONE if auto-passed with no reviewer, REVIEW/
    // BLOCKED/APPROVAL_PENDING otherwise) rather than guessing.
    const finalTask = await prisma.task.findUnique({ where: { id: task.id } });
    const statusLabel = taskStatusLabel(finalTask?.status ?? "DONE");
    const timeline = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
    const keterangan = summary.length > 300 ? `${summary.slice(0, 300)}…` : summary;

    await sheets.appendRow(spreadsheetId, [
      timeline,
      task.title,
      `${agent.displayName} (${agent.agentRole.name} - ${agent.agentRole.division.name})`,
      keterangan,
      statusLabel,
    ]);
  } catch (err) {
    console.error(`[task-assigned] gagal menambah baris tracking PM untuk task ${task.id}:`, err);
  }
}

/** Finds (or creates, first time only) the single shared PM tracking sheet, directly inside the Drive bersama root - cached the same marker-file way as the per-project folder/budget sheet. */
async function getOrCreateMasterTrackingSheet(sheets: GoogleSheetsClient, rootFolderId: string): Promise<string> {
  const key = "pm-tracking-sheet.json";
  if (await objectStorage.exists(key)) {
    const buffer = await objectStorage.getObjectBuffer(key);
    const data = JSON.parse(buffer.toString("utf-8")) as { spreadsheetId: string };
    if (data.spreadsheetId) return data.spreadsheetId;
  }

  const { spreadsheetId, url } = await sheets.createSpreadsheet(
    "Tracking Task - Semua Project",
    [["Timeline", "Judul Task", "PIC", "Keterangan", "Status"]],
    rootFolderId,
  );
  await objectStorage.putObject(key, JSON.stringify({ spreadsheetId, url, createdAt: new Date().toISOString() }), "application/json");
  return spreadsheetId;
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "DONE":
      return "Selesai";
    case "REVIEW":
      return "Menunggu QA";
    case "APPROVAL_PENDING":
      return "Menunggu Persetujuan Direktur";
    case "AWAITING_DIRECTOR":
      return "Menunggu Jawaban Direktur";
    case "BLOCKED":
      return "Terhambat";
    case "REJECTED":
      return "Ditolak";
    case "FAILED":
      return "Gagal";
    default:
      return status;
  }
}

/**
 * Tells a PM whether the Project its current task belongs to already has a
 * GitHub repo the director confirmed (see QuestionsService.confirmRepo) -
 * drives the repo_request instruction in pmExecutorPrompt. Tasks with no
 * Project at all (ad hoc work, idle check-ins) get no project context and
 * never trigger a repo_request.
 */
async function getProjectContext(projectId: string | null): Promise<{ name: string; repoConfigured: boolean } | null> {
  if (!projectId) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const repoConfigured =
    !!config.github.token && !!config.github.owner && (await objectStorage.exists(`project/${projectId}/github-repo.json`));
  return { name: project.name, repoConfigured };
}

/** Reads the repo a Project's GitHub output actually commits to, once the director has confirmed one (see confirmRepo). */
async function getConfiguredRepo(projectId: string): Promise<{ owner: string; repo: string } | null> {
  const key = `project/${projectId}/github-repo.json`;
  if (!(await objectStorage.exists(key))) return null;
  try {
    const buffer = await objectStorage.getObjectBuffer(key);
    const data = JSON.parse(buffer.toString("utf-8")) as { repo: string; owner?: string };
    return { owner: data.owner || config.github.owner, repo: data.repo };
  } catch {
    return null;
  }
}

function isChiefOfStaff(roleName: string, divisionSlug: string): boolean {
  // Role was renamed "Chief of Staff" -> "Sekretaris Direksi" (Hermes/
  // Telegram now holds the "Chief of Staff" title); same in-office routing
  // job, matched by its new name.
  return divisionSlug === "pusat" && roleName.toLowerCase().includes("sekretaris direksi");
}

type RelayResult =
  | { resolved: true; answer: string; chiefId: string; pusatId: string }
  | { resolved: false };

/**
 * "Koordinasi PM hanya sebatas sampai Chief of Staff, direktur hanya
 * koordinasi dengan 1 orang" - when any division PM (never Chief of Staff
 * itself, handled separately above) raises a question mid-task, it lands on
 * Chief of Staff first, not the director. Chief of Staff is itself an AI
 * agent, so this is resolved synchronously as a single extra model call
 * right here in the worker - no task pause, no extra round trip - unless
 * Chief of Staff genuinely decides the director needs to be looped in, in
 * which case IT (not the original PM) becomes the one asking.
 */
async function relayQuestionThroughChiefOfStaff(
  agent: Awaited<ReturnType<typeof prisma.agent.findUniqueOrThrow>> & {
    agentRole: { name: string; division: any; divisionId: string };
  },
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & { division: { name: string; slug: string } },
  question: string,
): Promise<RelayResult> {
  const pusat = await prisma.division.findUnique({
    where: { slug: "pusat" },
    include: { agentRoles: { include: { agents: true, modelClass: true } } },
  });
  const chiefRole = pusat?.agentRoles.find((r: { name: string }) => isChiefOfStaff(r.name, "pusat"));
  const chief = chiefRole?.agents[0];

  if (!pusat || !chiefRole || !chief) {
    // No Chief of Staff agent configured yet - fail safe to the old
    // direct-to-director path rather than leaving the PM stuck forever.
    console.error(`[task-assigned] Chief of Staff tidak ditemukan - pertanyaan task ${task.id} langsung ke direktur.`);
    await apiClient.askDirector({
      agentId: agent.id,
      divisionId: agent.agentRole.divisionId,
      taskId: task.id,
      question,
    });
    await apiClient.setAgentStatus(agent.id, "IDLE");
    return { resolved: false };
  }

  const route = resolveModel(chiefRole.modelClass, chief.modelVariant, {
    roleName: chiefRole.name,
    responsibilities: chiefRole.responsibilities,
  });
  const prompt = chiefOfStaffRelayPrompt({
    askingRoleName: agent.agentRole.name,
    askingDivisionName: task.division.name,
    taskTitle: task.title,
    taskDescription: task.description,
    question,
  });

  const { content, tokensIn, tokensOut, modelId: usedModelId } = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
    {
      role: "system",
      content: chief.systemPrompt ?? "Kamu adalah Chief of Staff yang menyaring pertanyaan PM sebelum sampai ke direktur.",
    },
    { role: "user", content: prompt },
  ]);
  await apiClient.recordUsage({
    agentId: chief.id,
    taskId: task.id,
    modelUsed: usedModelId,
    modelVariant: resolveVariantUsed(route, usedModelId),
    source: "pm-relay",
    tokensIn,
    tokensOut,
  });

  let relay: { type: "answer"; answer: string } | { type: "escalate"; question: string };
  try {
    const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    relay = JSON.parse(unfenced);
    if (relay.type !== "answer" && relay.type !== "escalate") throw new Error("unexpected type");
  } catch {
    // Chief of Staff's model didn't return clean JSON - fail safe to
    // escalating with the PM's original question rather than guessing an answer.
    relay = { type: "escalate", question };
  }

  if (relay.type === "escalate") {
    await apiClient.askDirector({
      agentId: chief.id,
      divisionId: pusat.id,
      taskId: task.id,
      question: relay.question,
    });
    await apiClient.setAgentStatus(agent.id, "IDLE");
    return { resolved: false };
  }

  return { resolved: true, answer: relay.answer, chiefId: chief.id, pusatId: pusat.id };
}

/** If a REVIEWER was already assigned to this task, run the review now that output exists. */
async function runQaIfReviewerAssigned(taskId: string, executorOutput: string) {
  const reviewerAssignment = await prisma.taskAssignment.findFirst({
    where: { taskId, role: "REVIEWER", completedAt: null },
    include: { agent: { include: { agentRole: { include: { modelClass: true, division: true } } } } },
  });

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { division: true } });

  if (!reviewerAssignment) {
    // No QA role assigned to this task - treat executor output as final.
    await apiClient.qaPassed(taskId);
    return;
  }

  const reviewer = reviewerAssignment.agent;
  await apiClient.setAgentStatus(reviewer.id, "REVIEWING");

  const route = resolveModel(reviewer.agentRole.modelClass, reviewer.modelVariant, {
    roleName: reviewer.agentRole.name,
    responsibilities: reviewer.agentRole.responsibilities,
  });
  const prompt = reviewerPrompt({
    divisionName: task.division.name,
    reviewerRoleName: reviewer.agentRole.name,
    taskTitle: task.title,
    taskDescription: task.description,
    executorOutput,
  });

  const { content, tokensIn, tokensOut, modelId: usedModelId } = await openRouter.chatWithFallback(route.modelId, route.fallbackModelIds, [
    { role: "system", content: "Kamu adalah QA yang teliti dan ringkas." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: reviewer.id,
    taskId,
    modelUsed: usedModelId,
    modelVariant: resolveVariantUsed(route, usedModelId),
    source: "kanban",
    tokensIn,
    tokensOut,
  });
  await apiClient.setAgentStatus(reviewer.id, "IDLE");

  let verdict: { verdict: "PASS" | "FAIL"; notes: string };
  try {
    const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    verdict = JSON.parse(unfenced);
  } catch {
    // A reviewer model that doesn't return clean JSON is a prompt/model
    // problem, not a task problem - fail safe to a human rather than silently passing.
    verdict = { verdict: "FAIL", notes: "QA tidak mengembalikan JSON yang valid - perlu dicek manual." };
  }

  if (verdict.verdict === "PASS") {
    await apiClient.qaPassed(taskId);
  } else {
    await apiClient.qaFailed(taskId); // bumps revisionCount; TasksService stops the loop at maxRevisions
  }
}

/**
 * Renders the executor's markdown result as a PDF and stores it alongside
 * the .md original, at a predictable key (`<taskId>/executor-output.pdf`)
 * so the API can serve it without needing a DB column for it. Best-effort:
 * a rendering problem (unexpected content, PDFKit edge case) must never
 * block the task from completing - the .md output already has the real
 * result recorded.
 */
async function storeAsPdf(taskId: string, title: string, content: string) {
  try {
    const pdf = await markdownToPdfBuffer(title, content);
    await objectStorage.putTaskOutput(taskId, "executor-output.pdf", pdf, "application/pdf");
  } catch (err) {
    console.error(`[task-assigned] gagal membuat PDF untuk task ${taskId}:`, err);
  }
}

/**
 * "Output yang menghasilkan source code otomatis tersimpan di Github" -
 * scans the executor's markdown result for fenced code blocks with a
 * recognized language and, if any exist, commits each as its own file,
 * grouped under `<divisionSlug>/<taskId>-<slug of title>/`. A report with no
 * code fences (the common case) is a no-op - this never runs for plain text
 * output. Best-effort like storeAsPdf: a GitHub API hiccup must never block
 * the task from completing.
 *
 * "Akun ini khusus untuk output project ... nama repo sesuai permintaan PM"
 * - there is no single shared output repo any more. Each Project gets its
 * own repo, named by the PM and created manually by the director (see
 * pmExecutorPrompt's repo_request instruction + QuestionsService.confirmRepo).
 * A task with no Project, or whose Project has no confirmed repo yet, simply
 * isn't committed anywhere - its code still lives in the .md/.pdf output.
 */
async function commitCodeIfPresent(taskId: string, title: string, divisionSlug: string, projectId: string | null, content: string) {
  if (!config.github.token || !config.github.owner) return; // GITHUB_PAT not configured - skip silently rather than crash
  const blocks = extractCodeBlocks(content);
  if (blocks.length === 0) return;
  if (!projectId) return; // ad hoc task, not tied to any project repo

  const repoInfo = await getConfiguredRepo(projectId);
  if (!repoInfo) {
    console.error(
      `[task-assigned] task ${taskId} menghasilkan kode tapi project ${projectId} belum punya repo GitHub terkonfirmasi - commit dilewati.`,
    );
    return;
  }

  const github = new GitHubClient({ owner: repoInfo.owner, repo: repoInfo.repo, token: config.github.token });
  const folder = `${divisionSlug}/${taskId}-${slugify(title)}`;
  let committed = 0;
  for (const block of blocks) {
    try {
      await github.putFile(`${folder}/${block.filename}`, block.code, `${title} - ${block.filename}`);
      committed += 1;
    } catch (err) {
      console.error(`[task-assigned] gagal commit ${block.filename} untuk task ${taskId} ke GitHub:`, err);
    }
  }

  // "Arsip ... jika dari repository langsung mengarah ke repositorynya" -
  // there's no DB column tracking this (would need a migration), so drop a
  // small marker object next to the .md/.pdf output instead - same pattern,
  // zero schema risk. The Archive page checks for this file to decide
  // whether a task's output lives in the GitHub repo.
  if (committed > 0) {
    try {
      const url = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/tree/main/${folder}`;
      await objectStorage.putTaskOutput(
        taskId,
        "github-output.json",
        JSON.stringify({ url, folder, repo: repoInfo.repo, committedAt: new Date().toISOString() }),
        "application/json",
      );
    } catch (err) {
      console.error(`[task-assigned] gagal menyimpan marker arsip GitHub untuk task ${taskId}:`, err);
    }
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "task"
  );
}

export type { TaskAssignedPayload };
