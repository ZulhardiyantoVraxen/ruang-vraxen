import { prisma } from "../prisma";
import { apiClient } from "../api-client";
import { config } from "../config";
import { OpenRouterClient, resolveModel } from "@platform/shared";
import { chiefOfStaffTriagePrompt } from "../prompts";

const openRouter = new OpenRouterClient(config.openRouterApiKey);

interface TaskCreatedPayload {
  divisionId: string;
  parentTaskId?: string | null;
}

/**
 * Shape of a division fetched with its roster below, typed by hand rather
 * than inferred from the Prisma call: this keeps the .map()/.find()
 * callbacks below from falling back to implicit `any` in an environment
 * where `prisma generate` hasn't run against the current schema yet.
 */
interface DivisionWithRoster {
  slug: string;
  name: string;
  description: string | null;
  agentRoles: {
    name: string;
    responsibilities: string | null;
    requiresApproval: boolean;
    agents: { id: string }[];
  }[];
}

/**
 * Reacts to "task.created". Every task today starts life filed against
 * Pusat with no agent attached yet - the only entry point is the
 * "PIC Chief of Staff" inbox in apps/web (POST /tasks with
 * divisionSlug="pusat"). This is Chief of Staff actually doing that job:
 * call the ATAS-tier model to decide which division (and whose desk) the
 * request really belongs to, then hand it off through the normal
 * assignment pipeline (TasksService.triage -> assign) so the usual
 * executor flow in task-assigned.ts picks it up from there - including
 * when the decision is "stays with Chief of Staff".
 */
export async function handleTaskCreated(taskId: string, payload: TaskCreatedPayload) {
  if (payload.parentTaskId) return; // subtasks are fanned out explicitly, not triaged here

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { division: true } });
  if (!task || task.division.slug !== "pusat") return; // only the CoS inbox gets auto-triaged

  const existingAssignment = await prisma.taskAssignment.findFirst({ where: { taskId } });
  if (existingAssignment) return; // already handled - e.g. a redelivered event

  const chiefRole = await prisma.agentRole.findFirst({
    where: { divisionId: task.divisionId, requiresApproval: true },
    include: { agents: true, modelClass: true },
  });
  const chief = chiefRole?.agents[0];
  if (!chief) return; // no Chief of Staff seeded yet - nothing can triage this

  const divisions: DivisionWithRoster[] = await prisma.division.findMany({
    where: { status: "ACTIVE" },
    include: { agentRoles: { include: { agents: true } } },
  });

  await apiClient.setAgentStatus(chief.id, "REVIEWING");

  let decision: { divisionSlug: string; reasoning: string };
  // Set only on the catch-path below: every task that reaches this handler
  // came from the director's own "PIC Chief of Staff" inbox, so a failed
  // classification is never a reason to park it behind a second approval
  // loop - the director's order is absolute even when the AI can't tell
  // which division it belongs to.
  let forceFinal = false;
  try {
    const route = resolveModel(chiefRole.modelClass, chief.modelVariant);
    const prompt = chiefOfStaffTriagePrompt({
      taskTitle: task.title,
      taskDescription: task.description,
      divisions: divisions.map((d: DivisionWithRoster) => ({
        slug: d.slug,
        name: d.name,
        description: d.description,
        roles: d.agentRoles.map((r) => ({
          name: r.name,
          responsibilities: r.responsibilities,
          isPM: r.requiresApproval,
          hasAgent: r.agents.length > 0,
        })),
      })),
    });

    const { content, tokensIn, tokensOut } = await openRouter.chat(route.modelId, [
      { role: "system", content: "Kamu adalah Chief of Staff yang mentriase permintaan kerja masuk ke perusahaan virtual." },
      { role: "user", content: prompt },
    ]);

    await apiClient.recordUsage({
      agentId: chief.id,
      taskId,
      modelUsed: route.modelId,
      modelVariant: route.variant,
      source: "kanban",
      tokensIn,
      tokensOut,
    });

    decision = JSON.parse(content);
    if (!decision?.divisionSlug) throw new Error("missing divisionSlug in triage response");
  } catch (err) {
    // A triage call that fails or returns garbage should not strand the
    // task forever - fail safe to Chief of Staff's own desk rather than
    // crashing the consumer loop, same philosophy as the QA verdict parse
    // in task-assigned.ts.
    console.error(`[worker] triage failed for task ${taskId}, keeping with Chief of Staff:`, err);
    decision = {
      divisionSlug: "pusat",
      reasoning: "Triase otomatis gagal - dieksekusi langsung oleh Chief of Staff atas perintah direktur (final, tanpa approval tambahan).",
    };
    forceFinal = true;
  }

  const targetDivision = divisions.find((d) => d.slug === decision.divisionSlug) ?? divisions.find((d) => d.slug === "pusat");
  const targetPmRole = targetDivision?.agentRoles.find((r) => r.requiresApproval && r.agents.length > 0);
  const targetAgent = targetPmRole?.agents[0] ?? chief; // no PM seeded in the target division -> stays with Chief of Staff

  await apiClient.triageTask(taskId, {
    divisionSlug: targetDivision?.slug ?? "pusat",
    agentId: targetAgent.id,
    reasoning: decision.reasoning,
    forceFinal,
  });

  await apiClient.setAgentStatus(chief.id, "IDLE");
}

export type { TaskCreatedPayload };
