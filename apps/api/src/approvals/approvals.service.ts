import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  /** The approval queue a human (or a PM role, per the artifact's chain) works through. */
  pending() {
    return this.prisma.approval.findMany({
      where: { status: "PENDING" },
      include: { task: { include: { division: true } } },
      orderBy: { requestedAt: "asc" },
    });
  }

  async decide(approvalId: string, status: "APPROVED" | "REJECTED", approverRef: string, notes?: string) {
    const approval = await this.prisma.approval.update({
      where: { id: approvalId },
      data: { status, approverRef, notes, decidedAt: new Date() },
    });
    await this.prisma.task.update({
      where: { id: approval.taskId },
      data: { status: status === "APPROVED" ? "DONE" : "REJECTED" },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: status === "APPROVED" ? "task.approved" : "task.rejected",
      aggregateId: approval.taskId,
      payload: { approverRef, notes },
    });
    return approval;
  }
}
