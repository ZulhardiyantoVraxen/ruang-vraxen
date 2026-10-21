import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TasksService } from "../tasks/tasks.service";
import { TOPICS } from "@platform/shared";
import { ROLE_NAMES } from "../common/role-names";

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly tasks: TasksService,
  ) {}

  /** The approval queue a human (or a PM role, per the artifact's chain) works through. */
  pending() {
    return this.prisma.approval.findMany({
      where: { status: "PENDING" },
      include: { task: { include: { division: true, project: true } } },
      orderBy: { requestedAt: "asc" },
    });
  }

  /** Already decided (approved or rejected) - the archive folder for the Approvals page, grouped client-side by division same as `pending()`. */
  decided() {
    return this.prisma.approval.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      include: { task: { include: { division: true, project: true } } },
      orderBy: { decidedAt: "desc" },
      take: 200,
    });
  }

  async decide(approvalId: string, status: "APPROVED" | "REJECTED", approverRef: string, notes?: string) {
    const approval = await this.prisma.approval.update({
      where: { id: approvalId },
      data: { status, approverRef, notes, decidedAt: new Date() },
    });
    const task = await this.prisma.task.update({
      where: { id: approval.taskId },
      data: { status: status === "APPROVED" ? "DONE" : "REJECTED" },
      include: {
        division: true,
        assignments: {
          where: { role: "EXECUTOR" },
          include: { agent: { include: { agentRole: true } } },
          orderBy: { assignedAt: "desc" },
          take: 1,
        },
      },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: status === "APPROVED" ? "task.approved" : "task.rejected",
      aggregateId: approval.taskId,
      payload: { approverRef, notes },
    });

    // The director's sign-off on a UI/UX design is exactly the gate the
    // brief asked for ("approval dari saya, setelah ada approval lanjutkan
    // ke developer") - once it clears, hand the work straight to Developer
    // rather than leaving a human to notice and re-dispatch it by hand.
    if (status === "APPROVED" && task.assignments[0]?.agent.agentRole.name === ROLE_NAMES.UIUX_DESIGNER) {
      await this.handoffDesignToDeveloper(task);
    }

    return approval;
  }

  private async handoffDesignToDeveloper(task: {
    id: string;
    divisionId: string;
    title: string;
    priority: number;
    resultSummary: string | null;
    division: { slug: string };
  }) {
    const developer = await this.prisma.agent.findFirst({
      where: { agentRole: { divisionId: task.divisionId, name: ROLE_NAMES.DEVELOPER } },
    });
    if (!developer) {
      console.error(`[approvals] design task ${task.id} approved but no Developer seeded in this division - no hand-off happened.`);
      return;
    }

    const followUp = await this.tasks.create({
      divisionSlug: task.division.slug,
      title: `Implementasikan desain: ${task.title}`,
      description: task.resultSummary
        ? `[Hand-off dari UI/UX, disetujui direktur]\n\n${task.resultSummary}`
        : "[Hand-off dari UI/UX, disetujui direktur] (ringkasan desain tidak tersedia - cek riwayat task sebelumnya)",
      parentTaskId: task.id,
      priority: task.priority,
    });

    // PM Software signs off on the implementation (the "koordinasi dengan
    // PM" half of the brief, completed at the build stage) - assigned
    // BEFORE the executor so the worker's QA step finds it already in place.
    const pm = await this.prisma.agent.findFirst({
      where: { agentRole: { divisionId: task.divisionId, name: ROLE_NAMES.PM_SOFTWARE } },
    });
    if (pm) {
      await this.tasks.assign(followUp.id, pm.id, "REVIEWER").catch((err) => {
        console.error(`[approvals] could not assign PM Software reviewer for follow-up task ${followUp.id}:`, err);
      });
    }

    await this.tasks.assign(followUp.id, developer.id, "EXECUTOR").catch((err) => {
      console.error(`[approvals] could not assign Developer to follow-up task ${followUp.id}:`, err);
    });
  }
}
