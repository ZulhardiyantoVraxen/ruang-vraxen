# Runtime-only image for @platform/worker.
# Build context: output of `pnpm --filter @platform/worker deploy --prod <stage-dir>`.
# See api.Dockerfile for why there is no build stage here.
FROM node:20-slim
# See api.Dockerfile - Prisma's generated query engine needs libssl, which
# node:20-slim doesn't ship by default.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
