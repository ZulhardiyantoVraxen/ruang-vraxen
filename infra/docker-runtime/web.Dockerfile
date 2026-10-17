# Runtime-only image for @platform/web.
#
# Build context: the Next.js "standalone" output directory, assembled on the
# build host as:
#   .next/standalone/*          (includes its own minimal node_modules)
#   .next/standalone/.next/static  <- copied in from .next/static
#   .next/standalone/public        <- copied in from apps/web/public (if any)
# Next.js's standalone output already traces and includes only the
# dependencies actually used at runtime, so no extra pnpm deploy step is
# needed for this app.
FROM node:20-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
