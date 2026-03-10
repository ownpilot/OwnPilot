# OwnPilot Gateway Dockerfile
# Multi-stage build for production optimization

# ============================================================================
# Stage 1: Base
# ============================================================================
FROM node:22-alpine AS base

# Install pnpm
RUN npm install -g pnpm@10.29.3

# Set working directory
WORKDIR /app

# ============================================================================
# Stage 2: Dependencies
# ============================================================================
FROM base AS dependencies

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/cli/package.json ./packages/cli/
COPY packages/channels/package.json ./packages/channels/

# Install dependencies
RUN pnpm install --frozen-lockfile

# ============================================================================
# Stage 3: Builder
# ============================================================================
FROM dependencies AS builder

# Copy source code
COPY . .

# Build only necessary packages (exclude UI)
RUN pnpm run build --filter=@ownpilot/core --filter=@ownpilot/gateway --filter=@ownpilot/channels --filter=@ownpilot/cli

# ============================================================================
# Stage 4: Production
# ============================================================================
FROM base AS production

# Install production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/cli/package.json ./packages/cli/
COPY packages/channels/package.json ./packages/channels/

RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/channels/dist ./packages/channels/dist

# Copy necessary non-code files
COPY packages/gateway/src/db/migrations ./packages/gateway/src/db/migrations

# Environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the gateway
CMD ["node", "packages/gateway/dist/server.js"]
