import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";
import { ModelVariant } from "@prisma/client";

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  /** Scale a role horizontally: spin up another agent instance of the same role. */
  async provision(agentRoleId: string, displayName: string) {
    const agent = await this.prisma.agent.create({
      data: { agentRoleId, displayName },
    });
    await this.kafka.publish(TOPICS.AGENT_EVENTS, {
      eventType: "agent.provisioned",
      aggregateId: agent.id,
      payload: { agentRoleId, displayName },
    });
    return agent;
  }

  async setStatus(agentId: string, status: "IDLE" | "WORKING" | "REVIEWING" | "COLLABORATING" | "PAUSED") {
    const agent = await this.prisma.agent.update({ where: { id: agentId }, data: { status } });
    await this.kafka.publish(TOPICS.AGENT_EVENTS, {
      eventType: "agent.status.changed",
      aggregateId: agent.id,
      payload: { status },
    });
    return agent;
  }

  /** Flip an agent between the free and paid OpenRouter model for its tier. */
  async switchVariant(agentId: string, variant: ModelVariant) {
    const agent = await this.prisma.agent.update({ where: { id: agentId }, data: { modelVariant: variant } });
    await this.kafka.publish(TOPICS.AGENT_EVENTS, {
      eventType: "agent.model_variant.switched",
      aggregateId: agent.id,
      payload: { variant },
    });
    return agent;
  }

  /**
   * How many tasks an agent is currently carrying, vs. its role's
   * concurrency ceiling. Excludes a queued-but-not-started director command
   * (Task.status TODO - see TasksService.broadcast) - that's reserved work
   * waiting its turn, not load actually occupying the agent right now.
   */
  async currentLoad(agentId: string) {
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
      include: { agentRole: true, assignments: { where: { completedAt: null, task: { status: { not: "TODO" } } } } },
    });
    return { active: agent.assignments.length, max: agent.agentRole.maxConcurrentTasks };
  }
}
