# OwnPilot Gateway-Only Dockerfile
# API server without bundled UI (for headless/API-only deployments)
# For full deployment (API + UI), use the root Dockerfile instead.

# ============================================================================
# Stage 1: Base
# ============================================================================
FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

# ============================================================================
# Stage 2: Dependencies
# ============================================================================
FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 3: Builder
# ============================================================================
FROM dependencies AS builder

COPY . .

# Build backend only (no UI)
RUN pnpm run build --filter=@ownpilot/core --filter=@ownpilot/gateway --filter=@ownpilot/cli

# ============================================================================
# Stage 4: Production
# ============================================================================
FROM base AS production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/cli/package.json ./packages/cli/

RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/data ./packages/core/data
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/gateway/data ./packages/gateway/data
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist

# Create non-root user and data directory
RUN addgroup -g 1001 -S ownpilot && adduser -S ownpilot -u 1001 -G ownpilot
RUN mkdir -p /app/data && chown -R ownpilot:ownpilot /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

USER ownpilot

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

LABEL org.opencontainers.image.source="https://github.com/ownpilot/ownpilot"
LABEL org.opencontainers.image.description="OwnPilot Gateway — API server only (no UI)"
LABEL org.opencontainers.image.licenses="MIT"

CMD ["node", "packages/gateway/dist/server.js"]
