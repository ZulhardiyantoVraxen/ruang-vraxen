/**
 * Pure, framework-free tier -> model resolution. Shared by apps/api's
 * OpenRouterService (which fetches the ModelClass row via Prisma, then
 * calls this) and apps/worker (same). Keeping the actual decision logic
 * here means the free/paid/zero-retention rule is defined exactly once.
 */
export type ModelVariant = "FREE" | "PAID";

export interface ModelClassLike {
  tier: string;
  openRouterModelFree: string | null;
  openRouterModelPaid: string;
  requiresZeroRetention: boolean;
}

export interface RouteDecision {
  modelId: string;
  variant: ModelVariant;
  requiresZeroRetention: boolean;
}

export function resolveModel(modelClass: ModelClassLike, requestedVariant: ModelVariant): RouteDecision {
  // Zero-data-retention divisions (e.g. Kesehatan, per UU PDP) are never
  // silently downgraded to free - free-tier OpenRouter slots do not
  // guarantee a zero-retention provider.
  if (modelClass.requiresZeroRetention && requestedVariant === "FREE") {
    return { modelId: modelClass.openRouterModelPaid, variant: "PAID", requiresZeroRetention: true };
  }
  if (requestedVariant === "FREE" && modelClass.openRouterModelFree) {
    return { modelId: modelClass.openRouterModelFree, variant: "FREE", requiresZeroRetention: false };
  }
  return {
    modelId: modelClass.openRouterModelPaid,
    variant: "PAID",
    requiresZeroRetention: modelClass.requiresZeroRetention,
  };
}
