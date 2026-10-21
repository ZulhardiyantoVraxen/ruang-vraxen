import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { ModelTier, ModelVariant } from "@prisma/client";
import { OpenRouterClient, resolveModel, resolveVariantUsed, RouteDecision, RoleHint, ChatWithFallbackResult, TOPICS } from "@platform/shared";

export type { RouteDecision };

/**
 * All model calls in the platform go through this service - nothing calls
 * OpenRouter directly. That is what makes "pilih versi gratis atau
 * berbayar" a per-agent/per-division DATA toggle (Agent.modelVariant,
 * ModelClass.openRouterModel{Free,Paid}) instead of a code change.
 *
 * The raw HTTP call lives in @platform/shared's OpenRouterClient (also used
 * by apps/worker); this service only adds the DB-backed tier -> model
 * resolution, which needs Prisma and so can't live in the framework-free
 * shared package.
 */
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly client = new OpenRouterClient(process.env.OPENROUTER_API_KEY);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  /** Resolve which exact model id to call for a tier + requested variant. `roleHint` narrows a FREE pick to models suited to that specific role (see @platform/shared's model-capability.ts). */
  async resolveModel(tier: ModelTier, variant: ModelVariant, roleHint?: RoleHint): Promise<RouteDecision> {
    const modelClass = await this.prisma.modelClass.findUniqueOrThrow({ where: { tier } });
    const decision = resolveModel(modelClass, variant, roleHint);
    if (decision.requiresZeroRetention && variant === "FREE") {
      this.logger.warn(`Tier ${tier} requires zero-retention; ignoring FREE request and using paid model.`);
    }
    return decision;
  }

  /**
   * Thin wrapper so callers (orchestrator, task executors) get usage back
   * for UsageLog. No fallback - use chatWithFallback for anything driven by
   * a resolveModel() RouteDecision (which is almost everything; this plain
   * variant stays for the rare case where only a bare modelId is on hand).
   */
  async chat(modelId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    return this.client.chat(modelId, messages);
  }

  /**
   * Self-healing call: tries `route.modelId`, and on a rate-limit/timeout/
   * 5xx error automatically retries `route.fallbackModelIds` in order (see
   * OpenRouterClient.chatWithFallback). When a fallback actually fires, logs
   * it and - if `context` is given - publishes `usage.model_fallback.triggered`
   * so the event is visible platform-wide (CTO/Kael's self-healing
   * monitoring), not just as a "model sedang sibuk" message in one chat.
   * `context` is optional because not every caller has a natural
   * aggregateId yet (e.g. mid-onboarding, before a Division exists).
   */
  async chatWithFallback(
    route: RouteDecision,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    context?: { aggregateId: string; source: string },
  ): Promise<ChatWithFallbackResult & { variantUsed: ModelVariant }> {
    const result = await this.client.chatWithFallback(route.modelId, route.fallbackModelIds, messages);

    const variantUsed = resolveVariantUsed(route, result.modelId);

    if (result.usedFallback) {
      const trail = result.attempts.map((a) => (a.error ? `${a.modelId} (gagal: ${a.error})` : a.modelId)).join(" -> ");
      this.logger.warn(`Model fallback terjadi${context ? ` [${context.source}]` : ""}: ${trail}`);

      if (context) {
        await this.kafka
          .publish(TOPICS.USAGE_EVENTS, {
            eventType: "usage.model_fallback.triggered",
            aggregateId: context.aggregateId,
            payload: {
              source: context.source,
              primaryModelId: route.modelId,
              resolvedModelId: result.modelId,
              attempts: result.attempts,
            },
          })
          .catch((err) => this.logger.error(`Gagal publish usage.model_fallback.triggered: ${err instanceof Error ? err.message : err}`));
      }
    }

    return { ...result, variantUsed };
  }
}
