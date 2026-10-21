import { inferRoleCapability, tagFreeModel } from "./model-capability";

/**
 * Pure, framework-free tier -> model resolution. Shared by apps/api's
 * OpenRouterService (which fetches the ModelClass row via Prisma, then
 * calls this) and apps/worker (same). Keeping the actual decision logic
 * here means the free/paid/zero-retention rule is defined exactly once.
 */
export type ModelVariant = "FREE" | "PAID";

/** Optional - lets resolveModel narrow a Tingkat's free pool to the models best suited to this specific role (see model-capability.ts). */
export interface RoleHint {
  roleName: string;
  responsibilities?: string | null;
}

export interface ModelClassLike {
  tier: string;
  openRouterModelFree: string | null;
  /** Several free OpenRouter slugs for this Tingkat - one is picked at random per call so idle free models actually get used. */
  openRouterModelFreePool?: string[] | null;
  openRouterModelPaid: string;
  requiresZeroRetention: boolean;
}

export interface RouteDecision {
  modelId: string;
  variant: ModelVariant;
  requiresZeroRetention: boolean;
  /**
   * Self-healing chain: models to try, in order, if `modelId` fails with a
   * retryable error (rate-limit/timeout/5xx) - see
   * OpenRouterClient.chatWithFallback(). Always ends in the tier's paid
   * model unless `modelId` already IS that paid model (then it holds one
   * same-model retry instead, for a transient hiccup with no cheaper
   * alternative to swap to). Capped so one chat/task call can never trigger
   * an unbounded number of OpenRouter attempts.
   */
  fallbackModelIds: string[];
}

const MAX_FREE_FALLBACKS = 3;

export function resolveModel(
  modelClass: ModelClassLike,
  requestedVariant: ModelVariant,
  roleHint?: RoleHint,
): RouteDecision {
  const paid = modelClass.openRouterModelPaid;

  // Zero-data-retention divisions (e.g. Kesehatan, per UU PDP) are never
  // silently downgraded to free - free-tier OpenRouter slots do not
  // guarantee a zero-retention provider. Only a same-model retry on
  // transient errors - never a swap to a non-zero-retention model.
  if (modelClass.requiresZeroRetention && requestedVariant === "FREE") {
    return { modelId: paid, variant: "PAID", requiresZeroRetention: true, fallbackModelIds: [paid] };
  }
  if (requestedVariant === "FREE") {
    const pool = (modelClass.openRouterModelFreePool ?? []).filter(Boolean);
    if (pool.length > 0) {
      // Narrow to the models whose inferred capability matches this role
      // (e.g. Developer -> CODE-tagged slugs only); if nothing in this
      // Tingkat's pool matches, fall back to the full pool rather than
      // stranding the role with zero free options.
      const scopedPool = roleHint
        ? (() => {
            const needed = inferRoleCapability(roleHint.roleName, roleHint.responsibilities);
            const matching = pool.filter((slug) => tagFreeModel(slug).includes(needed));
            return matching.length > 0 ? matching : pool;
          })()
        : pool;
      const pick = scopedPool[Math.floor(Math.random() * scopedPool.length)];
      // Fall back across the FULL pool (not just the role-scoped slice) -
      // any other free model beats failing outright - then the paid model
      // as the last resort, capped so a flaky pool can't balloon one call
      // into a dozen OpenRouter attempts.
      const otherFreeModels = pool.filter((m) => m !== pick).slice(0, MAX_FREE_FALLBACKS);
      return { modelId: pick, variant: "FREE", requiresZeroRetention: false, fallbackModelIds: [...otherFreeModels, paid] };
    }
    if (modelClass.openRouterModelFree) {
      return { modelId: modelClass.openRouterModelFree, variant: "FREE", requiresZeroRetention: false, fallbackModelIds: [paid] };
    }
  }
  return {
    modelId: paid,
    variant: "PAID",
    requiresZeroRetention: modelClass.requiresZeroRetention,
    fallbackModelIds: [paid], // same-model retry only - already the top tier, nothing cheaper/different to swap to
  };
}

/**
 * Which variant actually answered a chatWithFallback() call, for accurate
 * UsageLog accounting - "resolvedModelId" may be a fallback, not
 * `route.modelId`. Shared by apps/api (OpenRouterService) and apps/worker
 * (which calls OpenRouterClient directly) so this - like resolveModel
 * itself - is defined exactly once. By construction (see resolveModel
 * above) the LAST entry of `fallbackModelIds` is always the tier's paid
 * model; anything earlier in the chain is another free-pool alternate.
 */
export function resolveVariantUsed(route: RouteDecision, resolvedModelId: string): ModelVariant {
  if (resolvedModelId === route.modelId) return route.variant;
  return resolvedModelId === route.fallbackModelIds.at(-1) ? "PAID" : "FREE";
}
