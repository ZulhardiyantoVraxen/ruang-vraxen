# Runtime-only image for @platform/worker.
# Build context: output of `pnpm --filter @platform/worker deploy --prod <stage-dir>`.
# See api.Dockerfile for why there is no build stage here.
FROM node:20-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
