FROM node:20-alpine AS base
RUN apk add --no-cache git
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN corepack enable && pnpm install --frozen-lockfile --prod=false

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN corepack enable && pnpm --filter @vibe-coder/database exec prisma generate
RUN pnpm --filter @vibe-coder/api build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 apiuser

# Copy package files for production install
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Install production dependencies with hoisting to create symlinks
RUN corepack enable && pnpm install --frozen-lockfile --prod --shamefully-hoist

# Fix prisma engine permissions (engines need to be writable for downloads)
RUN chmod -R u+w /app/node_modules/.pnpm/@prisma+engines@* 2>/dev/null || true

# Copy built files and other assets
COPY --from=builder /app/packages/database/generated ./packages/database/generated
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/package.json ./apps/api/

USER apiuser
EXPOSE 4000
ENTRYPOINT []
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma && node apps/api/dist/apps/api/src/index.js"]