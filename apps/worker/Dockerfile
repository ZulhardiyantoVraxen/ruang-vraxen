FROM node:20-slim AS build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm --filter @platform/db prisma generate
RUN pnpm --filter @platform/worker build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/package.json
CMD ["node", "apps/worker/dist/index.js"]
