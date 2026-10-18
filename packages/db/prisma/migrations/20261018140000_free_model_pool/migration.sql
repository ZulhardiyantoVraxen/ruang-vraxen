-- Add a pool of free OpenRouter model slugs per Tingkat, so FREE-variant
-- calls can rotate across several free models instead of always hitting the
-- single legacy "openRouterModelFree" slug. Additive + defaulted, so no
-- backfill is required.
ALTER TABLE "ModelClass" ADD COLUMN "openRouterModelFreePool" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
