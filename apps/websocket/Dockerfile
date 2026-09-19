FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/websocket/package.json ./apps/websocket/
COPY packages/shared/package.json ./packages/shared/
RUN corepack enable && pnpm install --frozen-lockfile --prod=false

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/websocket/node_modules ./apps/websocket/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN corepack enable && pnpm --filter @vibe-coder/websocket build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 wsuser

COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder --chown=wsuser:nodejs /app/apps/websocket/dist ./apps/websocket/dist
COPY --from=builder --chown=wsuser:nodejs /app/apps/websocket/package.json ./apps/websocket/

USER wsuser
EXPOSE 4001
CMD ["node", "apps/websocket/dist/index.js"]
