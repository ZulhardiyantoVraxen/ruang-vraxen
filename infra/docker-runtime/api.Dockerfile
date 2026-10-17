# Runtime-only image for @platform/api.
#
# This Dockerfile does NOT build from source. The build context it expects
# is a "dist-only" staging directory produced on the build host by:
#   pnpm --filter @platform/api deploy --prod <stage-dir>
# which already contains dist/, package.json and a production-only
# node_modules (workspace deps like @platform/shared inlined). No repo
# source, devDependencies, or TypeScript ever enters the image.
FROM node:20-slim
# Prisma's query engine (generated on the build host) needs libssl at
# runtime; node:20-slim doesn't ship it, which made Prisma silently
# misdetect the OpenSSL ABI and fail with "could not locate the Query
# Engine for runtime debian-openssl-1.1.x" (generated for 3.0.x).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/main.js"]
