import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { PrismaService } from "../prisma/prisma.service";
import { ModelTier, ModelVariant } from "@prisma/client";

export interface RouteDecision {
  modelId: string;      // exact OpenRouter model id used for this call
  variant: ModelVariant;
  requiresZeroRetention: boolean;
}

/**
 * All model calls in the platform go through this service - nothing calls
 * OpenRouter directly. That is what makes "pilih versi gratis atau
 * berbayar" a per-agent/per-division DATA toggle (Agent.modelVariant,
 * ModelClass.openRouterModel{Free,Paid}) instead of a code change.
 */
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve which exact model id to call for a tier + requested variant. */
  async resolveModel(tier: ModelTier, variant: ModelVariant): Promise<RouteDecision> {
    const modelClass = await this.prisma.modelClass.findUniqueOrThrow({ where: { tier } });

    // Zero-data-retention divisions (e.g. Kesehatan, per UU PDP) are never
    // silently downgraded to free - free-tier OpenRouter slots do not
    // guarantee a zero-retention provider.
    if (modelClass.requiresZeroRetention && variant === "FREE") {
      this.logger.warn(
        `Tier ${tier} requires zero-retention; ignoring FREE request and using paid model.`,
      );
      return { modelId: modelClass.openRouterModelPaid, variant: "PAID", requiresZeroRetention: true };
    }

    if (variant === "FREE" && modelClass.openRouterModelFree) {
      return { modelId: modelClass.openRouterModelFree, variant: "FREE", requiresZeroRetention: false };
    }

    return {
      modelId: modelClass.openRouterModelPaid,
      variant: "PAID",
      requiresZeroRetention: modelClass.requiresZeroRetention,
    };
  }

  /** Thin wrapper so callers (orchestrator, task executors) get usage back for UsageLog. */
  async chat(modelId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    const completion = await this.client.chat.completions.create({
      model: modelId,
      messages,
    });
    return {
      content: completion.choices[0]?.message?.content ?? "",
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
    };
  }
}
