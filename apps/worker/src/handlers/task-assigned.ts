import { prisma } from "../prisma";
import { apiClient } from "../api-client";
import { config } from "../config";
import { OpenRouterClient, ObjectStorageClient, resolveModel } from "@platform/shared";
import { executorPrompt, pmExecutorPrompt, reviewerPrompt } from "../prompts";

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
  } else {
    await runStandardExecutor(agent, task);
  }
}

async function runStandardExecutor(
  agent: Awaited<ReturnType<typeof prisma.agent.findUniqueOrThrow>> & {
    agentRole: { name: string; responsibilities: string | null; modelClass: any; division: any };
  },
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & { division: { name: string } },
) {
  const route = resolveModel(agent.agentRole.modelClass, agent.modelVariant);
  const prompt = executorPrompt({
    divisionName: task.division.name,
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
    taskTitle: task.title,
    taskDescription: task.description,
  });

  const { content, tokensIn, tokensOut } = await openRouter.chat(route.modelId, [
    { role: "system", content: agent.systemPrompt ?? "Kerjakan task yang diberikan sebaik mungkin." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: agent.id,
    taskId: task.id,
    modelUsed: route.modelId,
    modelVariant: route.variant,
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  // Long output goes to object storage; the task row only keeps a short summary + the key.
  const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", content, "text/markdown");
  const summary = content.length > 500 ? `${content.slice(0, 500)}…` : content;
  await apiClient.recordResult(task.id, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(task.id, content);
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
  task: Awaited<ReturnType<typeof prisma.task.findUniqueOrThrow>> & { division: { name: string } },
) {
  const route = resolveModel(agent.agentRole.modelClass, agent.modelVariant);
  const prompt = pmExecutorPrompt({
    divisionName: task.division.name,
    roleName: agent.agentRole.name,
    responsibilities: agent.agentRole.responsibilities,
    taskTitle: task.title,
    taskDescription: task.description,
  });

  const { content, tokensIn, tokensOut } = await openRouter.chat(route.modelId, [
    { role: "system", content: agent.systemPrompt ?? "Kerjakan task yang diberikan sebaik mungkin, sebagai PM divisi." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: agent.id,
    taskId: task.id,
    modelUsed: route.modelId,
    modelVariant: route.variant,
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  let parsed: { type: "result"; summary: string } | { type: "question"; question: string };
  try {
    parsed = JSON.parse(content);
    if (parsed.type !== "result" && parsed.type !== "question") throw new Error("unexpected type");
  } catch {
    parsed = { type: "result", summary: content };
  }

  if (parsed.type === "question") {
    await apiClient.askDirector({
      agentId: agent.id,
      divisionId: agent.agentRole.divisionId,
      taskId: task.id,
      question: parsed.question,
    });
    await apiClient.setAgentStatus(agent.id, "IDLE");
    return; // task is now AWAITING_DIRECTOR - resumes via QuestionsService.answer once the director replies
  }

  const objectKey = await objectStorage.putTaskOutput(task.id, "executor-output.md", parsed.summary, "text/markdown");
  const summary = parsed.summary.length > 500 ? `${parsed.summary.slice(0, 500)}…` : parsed.summary;
  await apiClient.recordResult(task.id, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(task.id, parsed.summary);
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

  const route = resolveModel(reviewer.agentRole.modelClass, reviewer.modelVariant);
  const prompt = reviewerPrompt({
    divisionName: task.division.name,
    reviewerRoleName: reviewer.agentRole.name,
    taskTitle: task.title,
    taskDescription: task.description,
    executorOutput,
  });

  const { content, tokensIn, tokensOut } = await openRouter.chat(route.modelId, [
    { role: "system", content: "Kamu adalah QA yang teliti dan ringkas." },
    { role: "user", content: prompt },
  ]);

  await apiClient.recordUsage({
    agentId: reviewer.id,
    taskId,
    modelUsed: route.modelId,
    modelVariant: route.variant,
    source: "kanban",
    tokensIn,
    tokensOut,
  });
  await apiClient.setAgentStatus(reviewer.id, "IDLE");

  let verdict: { verdict: "PASS" | "FAIL"; notes: string };
  try {
    verdict = JSON.parse(content);
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

export type { TaskAssignedPayload };
