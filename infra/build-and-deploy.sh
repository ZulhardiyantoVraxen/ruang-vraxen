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

mkdir -p "$STAGE_DIR/web"
cp -r apps/web/.next/standalone/. "$STAGE_DIR/web/"
cp -r apps/web/.next/static "$STAGE_DIR/web/.next/static"
if [ -d apps/web/public ]; then
  cp -r apps/web/public "$STAGE_DIR/web/public"
fi

echo "==> Building Docker images from staged artifacts only (build context has no source)"
cp infra/docker-runtime/api.Dockerfile "$STAGE_DIR/api/Dockerfile"
cp infra/docker-runtime/worker.Dockerfile "$STAGE_DIR/worker/Dockerfile"
cp infra/docker-runtime/web.Dockerfile "$STAGE_DIR/web/Dockerfile"

docker build -t ruang-api:latest "$STAGE_DIR/api"
docker build -t ruang-worker:latest "$STAGE_DIR/worker"
docker build -t ruang-web:latest "$STAGE_DIR/web"

echo "==> Done. Images ready: ruang-api:latest, ruang-worker:latest, ruang-web:latest"
