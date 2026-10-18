import { config } from "./config";
import { ModelVariant } from "@platform/db";

async function post(path: string, body: unknown, method: "POST" | "PATCH" = "POST") {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * The worker's only write path back into platform state. Every call here
 * hits apps/api, which owns the business rules (revision limits, approval
 * creation, cost-cap enforcement) - the worker never writes Task/Approval
 * rows directly, only reads them.
 */
export const apiClient = {
  recordResult: (taskId: string, resultSummary: string, resultObjectKey?: string) =>
    post(`/tasks/${taskId}/result`, { resultSummary, resultObjectKey }, "PATCH"),
  qaPassed: (taskId: string) => post(`/tasks/${taskId}/qa-passed`, {}),
  qaFailed: (taskId: string) => post(`/tasks/${taskId}/qa-failed`, {}),
  recordUsage: (params: {
    agentId: string;
    taskId?: string;
    modelUsed: string;
    modelVariant: ModelVariant;
    source: string;
    tokensIn: number;
    tokensOut: number;
  }) => post("/usage", params),
  setAgentStatus: (agentId: string, status: string) => post(`/agents/${agentId}/status`, { status }, "PATCH"),
  triageTask: (taskId: string, params: { divisionSlug: string; agentId: string; reasoning?: string; forceFinal?: boolean }) =>
    post(`/tasks/${taskId}/triage`, params),
};
