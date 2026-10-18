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
}

export function resolveModel(
  modelClass: ModelClassLike,
  requestedVariant: ModelVariant,
  roleHint?: RoleHint,
): RouteDecision {
  // Zero-data-retention divisions (e.g. Kesehatan, per UU PDP) are never
  // silently downgraded to free - free-tier OpenRouter slots do not
  // guarantee a zero-retention provider.
  if (modelClass.requiresZeroRetention && requestedVariant === "FREE") {
    return { modelId: modelClass.openRouterModelPaid, variant: "PAID", requiresZeroRetention: true };
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
      return { modelId: pick, variant: "FREE", requiresZeroRetention: false };
    }
    if (modelClass.openRouterModelFree) {
      return { modelId: modelClass.openRouterModelFree, variant: "FREE", requiresZeroRetention: false };
    }
  }
  return {
    modelId: modelClass.openRouterModelPaid,
    variant: "PAID",
    requiresZeroRetention: modelClass.requiresZeroRetention,
  };
}
