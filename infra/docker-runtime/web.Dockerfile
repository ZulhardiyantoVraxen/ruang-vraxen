# Runtime-only image for @platform/web.
#
# Build context: the Next.js "standalone" output directory. For a monorepo
# app, that output nests the real entry point at apps/web/server.js
# (mirroring the workspace path) rather than at the standalone root, and
# .next/static + public are copied in separately alongside it - see
# infra/build-and-deploy.sh for how the staging dir is assembled.
FROM node:20-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
