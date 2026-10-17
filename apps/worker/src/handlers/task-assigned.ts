import { prisma } from "../prisma";
import { apiClient } from "../api-client";
import { config } from "../config";
import { OpenRouterClient, ObjectStorageClient, resolveModel } from "@platform/shared";
import { executorPrompt, reviewerPrompt } from "../prompts";

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
    taskId,
    modelUsed: route.modelId,
    modelVariant: route.variant,
    source: "kanban",
    tokensIn,
    tokensOut,
  });

  // Long output goes to object storage; the task row only keeps a short summary + the key.
  const objectKey = await objectStorage.putTaskOutput(taskId, "executor-output.md", content, "text/markdown");
  const summary = content.length > 500 ? `${content.slice(0, 500)}…` : content;
  await apiClient.recordResult(taskId, summary, objectKey);
  await apiClient.setAgentStatus(agent.id, "IDLE");

  await runQaIfReviewerAssigned(taskId, content);
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
