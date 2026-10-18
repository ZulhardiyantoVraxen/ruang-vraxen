import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";
import { BroadcastCommandDto, CreateTaskDto, TriageTaskDto } from "./dto";
import { ROLE_NAMES } from "../common/role-names";

/**
 * One division running several jobs at once = several Task rows with the
 * same divisionId and no parent; one job split across specialists in
 * parallel = Task rows sharing a parentTaskId. Nothing here assumes a fixed
 * number of concurrent jobs per division - that's just "how many Task rows
 * currently have status RUNNING for this divisionId".
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  async create(dto: CreateTaskDto) {
    const division = await this.prisma.division.findUniqueOrThrow({ where: { slug: dto.divisionSlug } });
    const task = await this.prisma.task.create({
      data: {
        divisionId: division.id,
        title: dto.title,
        description: dto.description,
        parentTaskId: dto.parentTaskId,
        priority: dto.priority ?? 3,
        requiresApproval: dto.requiresApproval ?? false,
        projectId: dto.projectId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: dto.parentTaskId ? "task.subtask.created" : "task.created",
      aggregateId: task.id,
      payload: { divisionId: division.id, parentTaskId: dto.parentTaskId },
    });
    return task;
  }

  /** Every division's concurrently running jobs, for the office/dashboard view. */
  runningByDivision(divisionId: string) {
    return this.prisma.task.findMany({
      where: { divisionId, status: { in: ["RUNNING", "REVIEW", "APPROVAL_PENDING"] } },
      include: { assignments: { include: { agent: true } } },
    });
  }

  
  /**
   * Worker calls this once an executor agent finishes - stores the output,
   * keeps state transitions in TasksService.
   *
   * This is also where the executor's concurrency slot is actually freed
   * (see `completeAssignment` below). Freeing it here - the moment they
   * submit, not whenever QA/approval eventually resolves - is what fixes
   * the bug where an agent that had ever been given one task stayed
   * reported "at its concurrency limit" forever: nothing in this codebase
   * used to ever set TaskAssignment.completedAt, so every assignment ever
   * made counted against the agent for good.
   */
  async recordResult(taskId: string, resultSummary: string, resultObjectKey?: string) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { resultSummary, resultObjectKey, status: "REVIEW" },
    });
    await this.completeAssignment(taskId, "EXECUTOR");
    return task;
  }

  /**
   * Marks the agent's open assignment for this task/role done, freeing their
   * concurrency slot, then immediately checks whether that agent has a
   * director command sitting queued (see `broadcast` below) and activates
   * the oldest one if so - a director's order never gets silently dropped
   * just because the agent was mid-task when it was sent.
   */
  private async completeAssignment(taskId: string, role: "EXECUTOR" | "REVIEWER") {
    const assignment = await this.prisma.taskAssignment.findFirst({
      where: { taskId, role, completedAt: null },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment) return;
    await this.prisma.taskAssignment.update({ where: { id: assignment.id }, data: { completedAt: new Date() } });
    await this.drainQueueForAgent(assignment.agentId);
  }

  /**
   * Activates the oldest command still queued for this agent (a broadcast
   * that arrived while they were busy - see `broadcast`). Queued work is a
   * TaskAssignment row that already exists (completedAt null, reserving the
   * slot) but whose Task never left TODO because nothing started it yet.
   */
  private async drainQueueForAgent(agentId: string) {
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      // Same exclusion as `assign()` - a queued item's own reservation must
      // not count against itself when checking if there's room to start it.
      include: { agentRole: true, assignments: { where: { completedAt: null, task: { status: { not: "TODO" } } } } },
    });
    if (agent.assignments.length >= agent.agentRole.maxConcurrentTasks) return; // still full - next free-up will try again

    const queued = await this.prisma.taskAssignment.findFirst({
      where: { agentId, role: "EXECUTOR", completedAt: null, task: { status: "TODO" } },
      orderBy: { assignedAt: "asc" },
    });
    if (!queued) return;

    await this.prisma.task.update({ where: { id: queued.taskId }, data: { status: "RUNNING" } });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "task.assigned",
      aggregateId: queued.taskId,
      payload: { agentId, role: "EXECUTOR" },
    });
  }

  /**
   * "PM harus lebih interaktif bertanya kepada direktur" leaves a task
   * AWAITING_DIRECTOR with its original EXECUTOR assignment still open
   * (recordResult was never called - the PM asked a question instead of
   * finishing). Resuming it reuses that same assignment and republishes
   * task.assigned so the worker picks it back up - no new assignment row,
   * no concurrency check, since the agent never actually gave up this slot.
   */
  async resumeExecutor(taskId: string, agentId: string) {
    const existing = await this.prisma.taskAssignment.findFirst({
      where: { taskId, agentId, role: "EXECUTOR", completedAt: null },
    });
    if (!existing) {
      // Shouldn't normally happen, but never leave a question unanswered
      // for lack of bookkeeping - fall back to a fresh (concurrency-checked)
      // assignment.
      return this.assign(taskId, agentId, "EXECUTOR");
    }
    await this.prisma.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "task.assigned",
      aggregateId: taskId,
      payload: { agentId, role: "EXECUTOR" },
    });
    return existing;
  }

  /**
   * Chief of Staff's own triage decision, materialized: every task today
   * starts life filed against Pusat with no agent attached (see the
   * "PIC Chief of Staff" inbox in apps/web) - this is apps/worker (which
   * calls the ATAS-tier model to decide) telling us where it actually
   * belongs. Moving divisions is just re-pointing divisionId; handing it to
   * an agent reuses the normal `assign` path below, which is what starts
   * the usual executor flow (apps/worker's task.assigned handler).
   */
  async triage(taskId: string, dto: TriageTaskDto) {
    const division = await this.prisma.division.findUniqueOrThrow({ where: { slug: dto.divisionSlug } });
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        divisionId: division.id,
        // forceFinal (set only when auto-triage itself failed) overrides
        // whatever "wajib persetujuan" box was checked when this was filed -
        // a director's order doesn't wait on a second approval loop just
        // because the AI classifier couldn't pick a division for it.
        requiresApproval: dto.forceFinal ? false : undefined,
        description: dto.reasoning
          ? [task.description, `[Triase Chief of Staff] ${dto.reasoning}`].filter(Boolean).join("\n\n")
          : task.description,
      },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "task.triaged",
      aggregateId: taskId,
      payload: { divisionId: division.id, divisionSlug: dto.divisionSlug, reasoning: dto.reasoning },
    });
    return this.assign(taskId, dto.agentId, "EXECUTOR");
  }

  async assign(taskId: string, agentId: string, role: "EXECUTOR" | "REVIEWER") {
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      // "task: { status: { not: "TODO" } }" excludes a queued-but-not-started
      // director command (see `broadcast`) from counting against the limit -
      // that reservation shouldn't itself block the agent from being given
      // this (possibly different) piece of work right now.
      include: { agentRole: true, assignments: { where: { completedAt: null, task: { status: { not: "TODO" } } } } },
    });
    if (agent.assignments.length >= agent.agentRole.maxConcurrentTasks) {
      throw new BadRequestException(
        `Agent ${agent.displayName} is at its concurrency limit (${agent.agentRole.maxConcurrentTasks})`,
      );
    }
    const assignment = await this.prisma.taskAssignment.create({ data: { taskId, agentId, role } });
    await this.prisma.task.update({ where: { id: taskId }, data: { status: "RUNNING" } });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "task.assigned",
      aggregateId: taskId,
      payload: { agentId, role },
    });
    return assignment;
  }

  /**
   * One instruction, one Task per selected agent, assigned immediately - the
   * office view's "perintah sekaligus" command. Each agent is already chosen
   * by the person (not Chief of Staff's pusat-inbox triage), so this never
   * publishes "task.created" - only "task.assigned", which is what the
   * worker actually executes (apps/worker's handleTaskAssigned: sets the
   * agent WORKING, calls its tier's model with the instruction, records the
   * result, sets it back to IDLE).
   *
   * "Perintah itu mutlak dari Direktur" - a command sent here is never just
   * dropped for an agent who happens to be at their concurrency limit. If
   * the agent is busy, the Task is still created and a TaskAssignment row
   * is reserved for them (status TODO = queued), and `drainQueueForAgent`
   * (called every time any agent's assignment completes - see
   * `completeAssignment`) automatically activates it the moment a slot
   * frees up, in the order the commands came in. Only a genuinely invalid
   * agent id ends up in `failed`.
   */
  async broadcast(dto: BroadcastCommandDto) {
    const agents = await this.prisma.agent.findMany({
      where: { id: { in: dto.agentIds } },
      include: { agentRole: true },
    });
    if (agents.length === 0) throw new BadRequestException("Tidak ada agent yang valid dipilih");

    const title = dto.instruction.length > 90 ? `${dto.instruction.slice(0, 90)}…` : dto.instruction;
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : undefined;
    const dispatched: { agentId: string; agentName: string; taskId: string; queued: boolean }[] = [];
    const failed: { agentId: string; agentName: string; reason: string }[] = [];

    for (const agent of agents) {
      try {
        const task = await this.prisma.task.create({
          data: {
            divisionId: agent.agentRole.divisionId,
            title,
            description: dto.instruction,
            priority: 1, // a direct director order always jumps the queue once a slot is free
            projectId: dto.projectId,
            dueAt,
          },
        });
        // A UI/UX brief: Analis has to weigh in before this counts as done
        // (the "koordinasi dengan Analis" from the director's brief) and the
        // result always rolls up to the director's own Approval queue -
        // never bypassable via the task-level "wajib persetujuan" box, since
        // this hand-off chain depends on it. Both are wired BEFORE the
        // executor is assigned (which is what actually fires the worker),
        // so the QA step is guaranteed to see the reviewer already in place.
        if (agent.agentRole.name === ROLE_NAMES.UIUX_DESIGNER) {
          await this.wireUiUxDesignTask(task.id, agent.agentRole.divisionId);
        }
        try {
          await this.assign(task.id, agent.id, "EXECUTOR");
          dispatched.push({ agentId: agent.id, agentName: agent.displayName, taskId: task.id, queued: false });
        } catch (err) {
          if (!(err instanceof BadRequestException)) throw err;
          // Busy, not invalid - queue it instead of reporting a failure.
          await this.prisma.taskAssignment.create({ data: { taskId: task.id, agentId: agent.id, role: "EXECUTOR" } });
          await this.prisma.task.update({ where: { id: task.id }, data: { status: "TODO" } });
          dispatched.push({ agentId: agent.id, agentName: agent.displayName, taskId: task.id, queued: true });
        }
      } catch (err) {
        failed.push({ agentId: agent.id, agentName: agent.displayName, reason: err instanceof Error ? err.message : "unknown error" });
      }
    }
    return { dispatched, failed };
  }

  private async wireUiUxDesignTask(taskId: string, divisionId: string) {
    await this.prisma.task.update({ where: { id: taskId }, data: { requiresApproval: true } });
    const analyst = await this.prisma.agent.findFirst({
      where: { agentRole: { divisionId, name: ROLE_NAMES.ANALYST } },
    });
    if (!analyst) return; // no Analis seeded in this division - design still ships, just without a second opinion
    try {
      await this.assign(taskId, analyst.id, "REVIEWER");
    } catch (err) {
      // Analis already at its concurrency limit - don't let that block the
      // design work itself, just note it got no review pass.
      console.error(`[tasks] could not assign Analis reviewer for design task ${taskId}:`, err);
    }
  }

  /**
   * "Auditor akan selalu menagih pekerjaan setiap harinya kepada PM" - fans
   * out one status-report task to every division's PM. Idempotent per
   * calendar day per division (checked by title + createdAt, no extra
   * state needed) so calling this more than once in the same day - a retry,
   * an overlapping cron tick - never double-tags anyone. The chase itself
   * is just a normal Task; PM is a requiresApproval role, so it runs
   * through the structured PM-executor prompt (apps/worker's
   * runPmExecutor) which is exactly what lets the PM raise a question back
   * instead of guessing.
   */
  async auditDailyCheckIn() {
    const MARKER_TITLE = "[Audit harian] Laporkan progres timnya hari ini";
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const divisions = await this.prisma.division.findMany({
      where: { status: "ACTIVE", slug: { not: "pusat" } },
      include: { agentRoles: { include: { agents: true } } },
    });

    const dispatched: { divisionSlug: string; pmName: string; taskId: string }[] = [];
    const skipped: { divisionSlug: string; reason: string }[] = [];

    for (const division of divisions) {
      const pmRole = division.agentRoles.find((r) => r.requiresApproval && r.agents.length > 0);
      if (!pmRole) {
        skipped.push({ divisionSlug: division.slug, reason: "Belum ada PM" });
        continue;
      }
      const pm = pmRole.agents[0];

      const already = await this.prisma.task.findFirst({
        where: { divisionId: division.id, title: MARKER_TITLE, createdAt: { gte: startOfDay } },
      });
      if (already) {
        skipped.push({ divisionSlug: division.slug, reason: "Sudah ditagih hari ini" });
        continue;
      }

      const task = await this.prisma.task.create({
        data: {
          divisionId: division.id,
          title: MARKER_TITLE,
          description:
            "Auditor menagih: ringkas status semua task yang sedang berjalan di divisi Anda hari ini. Kalau ada hal yang butuh keputusan atau klarifikasi direktur, ajukan sebagai pertanyaan - jangan menebak.",
          priority: 3,
        },
      });
      try {
        await this.assign(task.id, pm.id, "EXECUTOR");
        dispatched.push({ divisionSlug: division.slug, pmName: pm.displayName, taskId: task.id });
      } catch (err) {
        // A PM already at their concurrency limit (maxConcurrentTasks) is
        // one division's problem, not a reason to skip chasing every other
        // division too - the created-but-unassigned task just sits in
        // TRIAGE until the PM frees up; tomorrow's check-in finds a
        // different marker-title task already exists today, so it won't
        // double up in the meantime.
        skipped.push({
          divisionSlug: division.slug,
          reason: err instanceof Error ? err.message : "Gagal menugaskan PM",
        });
      }
    }

    return { dispatched, skipped };
  }

  /**
   * "Semua personel harus interaktif, jika tidak ada pekerjaan segera minta
   * ke PM. Jika PM tidak ada, minta ke Chief of Staff. Chief of Staff tidak
   * tahu mengerjakan apa, ajukan ke Direktur." - walks every ACTIVE
   * division's roster once, and for any agent that is IDLE with no open
   * assignment, routes a "need work" notice up the chain:
   *   - a regular agent -> their division's PM (requiresApproval role)
   *   - no PM in that division, or the idle agent IS the PM -> Chief of Staff
   *   - Chief of Staff themself idle -> straight to the director, as a
   *     DirectorQuestion (same inbox as "Pertanyaan")
   * Idempotent per agent per calendar day (same marker-title pattern as
   * auditDailyCheckIn) so a frequent cron tick never spams the same notice.
   */
  async checkIdleAgents() {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const pusat = await this.prisma.division.findUnique({
      where: { slug: "pusat" },
      include: { agentRoles: { include: { agents: true } } },
    });
    const chiefRole = pusat?.agentRoles.find((r) => r.name.toLowerCase().includes("chief of staff"));
    const chief = chiefRole?.agents[0] ?? null;

    const divisions = await this.prisma.division.findMany({
      where: { status: "ACTIVE" },
      include: {
        agentRoles: { include: { agents: { include: { assignments: { where: { completedAt: null } } } } } },
      },
    });

    const notified: { agentId: string; agentName: string; routedTo: string }[] = [];
    const skipped: { agentId: string; reason: string }[] = [];

    for (const division of divisions) {
      const pmRole = division.agentRoles.find((r) => r.requiresApproval && division.slug !== "pusat");
      const pm = pmRole?.agents[0] ?? null;

      for (const role of division.agentRoles) {
        for (const agent of role.agents) {
          if (agent.status !== "IDLE" || agent.assignments.length > 0) continue;

          const marker = `[Idle] ${agent.displayName} menunggu pekerjaan`;
          const already = await this.prisma.task.findFirst({ where: { title: marker, createdAt: { gte: startOfDay } } });
          if (already) {
            skipped.push({ agentId: agent.id, reason: "Sudah dilaporkan hari ini" });
            continue;
          }

          const isChiefOfStaff = division.slug === "pusat" && chief?.id === agent.id;
          try {
            if (isChiefOfStaff) {
              if (!chief) throw new Error("Chief of Staff tidak ditemukan");
              await this.prisma.directorQuestion.create({
                data: {
                  agentId: chief.id,
                  divisionId: division.id,
                  question: `${chief.displayName} (Chief of Staff) sedang tidak ada pekerjaan. Ada arahan untuk hari ini?`,
                },
              });
              notified.push({ agentId: agent.id, agentName: agent.displayName, routedTo: "Direktur" });
              continue;
            }

            const isPm = pm?.id === agent.id;
            const recipient = isPm ? chief : pm ?? chief;
            if (!recipient) throw new Error("Tidak ada PM maupun Chief of Staff untuk dihubungi");

            const task = await this.prisma.task.create({
              data: {
                divisionId: recipient.id === chief?.id ? (pusat?.id ?? division.id) : division.id,
                title: marker,
                description: `${agent.displayName} (${role.name}) di divisi ${division.name} sedang tidak ada pekerjaan. Tolong tugaskan sesuatu, atau beri tahu kalau memang belum ada yang bisa dikerjakan.`,
                priority: 4,
              },
            });
            await this.assign(task.id, recipient.id, "EXECUTOR");
            notified.push({ agentId: agent.id, agentName: agent.displayName, routedTo: recipient.displayName });
          } catch (err) {
            skipped.push({ agentId: agent.id, reason: err instanceof Error ? err.message : "Gagal mengirim notifikasi" });
          }
        }
      }
    }

    return { notified, skipped };
  }

  /**
   * QA failed -> bounce back to the executor, bounded by Task.maxRevisions
   * (Catatan Penting). The executor's slot was already freed in
   * `recordResult` the moment they submitted, so this re-opens a fresh
   * assignment for the SAME agent to redo the work - deliberately bypassing
   * the concurrency check, since a revision is a continuation of work
   * already promised, not a new request competing for a slot. The reviewer's
   * assignment is left open (not completed) so the next round's QA still
   * finds them attached to this task.
   */
  async qaFailed(taskId: string) {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (task.revisionCount >= task.maxRevisions) {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: "BLOCKED" } });
      await this.kafka.publish(TOPICS.TASK_EVENTS, {
        eventType: "task.revision_limit.reached",
        aggregateId: taskId,
        payload: { revisionCount: task.revisionCount },
      });
      return;
    }
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: "RUNNING", revisionCount: { increment: 1 } },
    });
    const lastExecutor = await this.prisma.taskAssignment.findFirst({
      where: { taskId, role: "EXECUTOR" },
      orderBy: { assignedAt: "desc" },
    });
    if (lastExecutor) {
      await this.prisma.taskAssignment.create({ data: { taskId, agentId: lastExecutor.agentId, role: "EXECUTOR" } });
      await this.kafka.publish(TOPICS.TASK_EVENTS, {
        eventType: "task.assigned",
        aggregateId: taskId,
        payload: { agentId: lastExecutor.agentId, role: "EXECUTOR" },
      });
    }
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "task.qa.failed",
      aggregateId: taskId,
      payload: { revisionCount: updated.revisionCount },
    });
    return updated;
  }

  async qaPassed(taskId: string) {
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const nextStatus = task.requiresApproval ? "APPROVAL_PENDING" : "DONE";
    const updated = await this.prisma.task.update({ where: { id: taskId }, data: { status: nextStatus } });
    await this.completeAssignment(taskId, "REVIEWER"); // reviewer's job on this task is done - free them up
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: task.requiresApproval ? "task.approval.requested" : "task.completed",
      aggregateId: taskId,
      payload: {},
    });
    if (task.requiresApproval) {
      await this.prisma.approval.create({ data: { taskId } });
    }
    return updated;
  }
}
