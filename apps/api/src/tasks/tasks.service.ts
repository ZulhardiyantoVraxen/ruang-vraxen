import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";
import { CreateTaskDto, TriageTaskDto } from "./dto";

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

  
  /** Worker calls this once an executor agent finishes - stores the output, keeps state transitions in TasksService. */
  async recordResult(taskId: string, resultSummary: string, resultObjectKey?: string) {
    return this.prisma.task.update({
      where: { id: taskId },
      data: { resultSummary, resultObjectKey, status: "REVIEW" },
    });
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
      include: { agentRole: true, assignments: { where: { completedAt: null } } },
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

  /** QA failed -> bounce back to the executor, bounded by Task.maxRevisions (Catatan Penting). */
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
