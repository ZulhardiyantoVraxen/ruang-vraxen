import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { PrismaService } from "../prisma/prisma.service";
import { ModelTier, ModelVariant } from "@prisma/client";
import { OpenRouterClient, resolveModel, RouteDecision, RoleHint } from "@platform/shared";

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

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve which exact model id to call for a tier + requested variant. `roleHint` narrows a FREE pick to models suited to that specific role (see @platform/shared's model-capability.ts). */
  async resolveModel(tier: ModelTier, variant: ModelVariant, roleHint?: RoleHint): Promise<RouteDecision> {
    const modelClass = await this.prisma.modelClass.findUniqueOrThrow({ where: { tier } });
    const decision = resolveModel(modelClass, variant, roleHint);
    if (decision.requiresZeroRetention && variant === "FREE") {
      this.logger.warn(`Tier ${tier} requires zero-retention; ignoring FREE request and using paid model.`);
    }
    return decision;
  }

  /** Thin wrapper so callers (orchestrator, task executors) get usage back for UsageLog. */
  async chat(modelId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    return this.client.chat(modelId, messages);
  }
}
