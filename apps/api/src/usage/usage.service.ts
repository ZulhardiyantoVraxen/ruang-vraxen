import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";
import { ModelVariant } from "@prisma/client";

/** Rough OpenRouter pricing lookup would live here in production; kept simple for the scaffold. */
function estimateCostUsd(modelId: string, tokensIn: number, tokensOut: number): number {
  const isFree = modelId.endsWith(":free");
  if (isFree) return 0;
  // Placeholder blended rate - replace with a real per-model price table.
  return (tokensIn * 0.000003) + (tokensOut * 0.000015);
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  async record(params: {
    agentId: string;
    taskId?: string;
    modelUsed: string;
    modelVariant: ModelVariant;
    source: string;
    tokensIn: number;
    tokensOut: number;
  }) {
    const costUsd = estimateCostUsd(params.modelUsed, params.tokensIn, params.tokensOut);
    const log = await this.prisma.usageLog.create({ data: { ...params, costUsd } });

    await this.kafka.publish(TOPICS.USAGE_EVENTS, {
      eventType: "usage.recorded",
      aggregateId: params.agentId,
      payload: { taskId: params.taskId, costUsd, modelUsed: params.modelUsed },
    });

    await this.checkCostCap(params.agentId, costUsd);
    return log;
  }

  /** "Pasang batas biaya per agen" from Catatan Penting - checked on every write. */
  private async checkCostCap(agentId: string, latestCostUsd: number) {
    const cap = await this.prisma.costCap.findFirst({ where: { agentId, scope: "AGENT" } });
    if (!cap) return;

    const since = new Date(Date.now() - cap.periodDays * 24 * 60 * 60 * 1000);
    const periodUsage = await this.prisma.usageLog.aggregate({
      where: { agentId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    });
    const totalUsd = Number(periodUsage._sum.costUsd ?? 0);

    if (totalUsd >= Number(cap.maxCostUsd)) {
      await this.kafka.publish(TOPICS.USAGE_EVENTS, {
        eventType: "usage.cost_cap.exceeded",
        aggregateId: agentId,
        payload: { totalUsd, maxCostUsd: Number(cap.maxCostUsd) },
      });
      await this.prisma.agent.update({ where: { id: agentId }, data: { status: "PAUSED" } });
      this.logger.warn(`Agent ${agentId} paused - cost cap exceeded ($${totalUsd.toFixed(2)})`);
    } else if (totalUsd >= Number(cap.maxCostUsd) * 0.8) {
      await this.kafka.publish(TOPICS.USAGE_EVENTS, {
        eventType: "usage.cost_cap.warning",
        aggregateId: agentId,
        payload: { totalUsd, maxCostUsd: Number(cap.maxCostUsd) },
      });
    }
  }
}
