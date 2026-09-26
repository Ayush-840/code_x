FROM node:20-alpine AS base
RUN apk add --no-cache git
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/web/package.json ./apps/web/
RUN corepack enable && pnpm install --frozen-lockfile --prod=false

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must
# be present during `next build` — runtime env has no effect on them. Without
# these the production build fails its guard (resolveApiUrl/resolveWsUrl).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN corepack enable && pnpm --filter @vibe-coder/database exec prisma generate
RUN pnpm --filter @vibe-coder/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/database/generated ./packages/database/generated

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
