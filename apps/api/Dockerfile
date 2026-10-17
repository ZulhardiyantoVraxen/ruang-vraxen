FROM node:20-slim AS build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN corepack enable && pnpm install --frozen-lockfile=false
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @platform/db prisma generate
RUN pnpm --filter @platform/api build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
