#!/usr/bin/env bash
# Builds ruang-api / ruang-worker / ruang-web as Docker images from a
# throwaway clone of the repo, then deletes that clone (and the intermediate
# staging dir). Nothing but the resulting Docker images survives on the host
# after this script finishes - no repo checkout, no node_modules, no
# TypeScript source.
#
# Usage (on the VPS):
#   bash infra/build-and-deploy.sh
#
# After it finishes, bring the stack up with:
#   cd infra && docker compose -f docker-compose.prod.yml up -d
set -euo pipefail

REPO_URL="https://github.com/ZulhardiyantoVraxen/ruang-vraxen.git"
BUILD_DIR="$(mktemp -d /root/ruang-build.XXXXXX)"
STAGE_DIR="$(mktemp -d /root/ruang-stage.XXXXXX)"

cleanup() {
  echo "==> Cleaning up throwaway clone and staging dir"
  rm -rf "$BUILD_DIR" "$STAGE_DIR"
}
trap cleanup EXIT

echo "==> Cloning into throwaway dir $BUILD_DIR"
git clone --depth 1 "$REPO_URL" "$BUILD_DIR"
cd "$BUILD_DIR"

echo "==> Installing dependencies"
pnpm install

echo "==> Generating Prisma client"
pnpm --filter @platform/db exec prisma generate

echo "==> Building packages/db and packages/shared (compiled dist, no source needed at runtime)"
pnpm build:packages

echo "==> Building apps/api"
pnpm --filter @platform/api build

echo "==> Building apps/worker"
pnpm --filter @platform/worker build

echo "==> Building apps/web (next build, output: standalone)"
pnpm --filter @platform/web build

echo "==> Staging dist-only artifacts (pnpm deploy --prod inlines workspace deps, prod deps only)"
# --legacy: pnpm v10 defaults to requiring inject-workspace-packages=true for
# `pnpm deploy`; --legacy keeps the older (still correct for our case) behavior
# of resolving workspace deps from the pnpm store without that opt-in.
pnpm --filter @platform/api deploy --prod --legacy "$STAGE_DIR/api"
pnpm --filter @platform/worker deploy --prod --legacy "$STAGE_DIR/worker"

# `pnpm deploy` reinstalls @prisma/client fresh from the content-addressable
# store - it does NOT carry over the query-engine binary + generated client
# code that `prisma generate` produces (that's written as a side effect into
# a specific node_modules location, not something pnpm's pack/deploy logic
# knows to preserve). So regenerate it in place, inside each staged
# node_modules, using a temporary copy of the schema - removed right after,
# nothing but the generated client output remains.
echo "==> Regenerating Prisma Client inside each staged node_modules"
for TARGET in "$STAGE_DIR/api" "$STAGE_DIR/worker"; do
  mkdir -p "$TARGET/prisma"
  cp packages/db/prisma/schema.prisma "$TARGET/prisma/schema.prisma"
  (cd "$TARGET" && npx -y prisma@5.22.0 generate --schema=prisma/schema.prisma)
  rm -rf "$TARGET/prisma"
done

# Next.js standalone output for a monorepo app nests the entry point at
# apps/<app>/server.js (mirroring the workspace path), not at the standalone
# root - and .next/static + public are deliberately excluded from standalone,
# so they're copied in at that same nested path.
mkdir -p "$STAGE_DIR/web/apps/web/.next"
cp -r apps/web/.next/standalone/. "$STAGE_DIR/web/"
cp -r apps/web/.next/static "$STAGE_DIR/web/apps/web/.next/static"
if [ -d apps/web/public ]; then
  cp -r apps/web/public "$STAGE_DIR/web/apps/web/public"
fi

echo "==> Building Docker images from staged artifacts only (build context has no source)"
cp infra/docker-runtime/api.Dockerfile "$STAGE_DIR/api/Dockerfile"
cp infra/docker-runtime/worker.Dockerfile "$STAGE_DIR/worker/Dockerfile"
cp infra/docker-runtime/web.Dockerfile "$STAGE_DIR/web/Dockerfile"

docker build -t ruang-api:latest "$STAGE_DIR/api"
docker build -t ruang-worker:latest "$STAGE_DIR/worker"
docker build -t ruang-web:latest "$STAGE_DIR/web"

echo "==> Done. Images ready: ruang-api:latest, ruang-worker:latest, ruang-web:latest"
