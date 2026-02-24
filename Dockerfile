# OwnPilot Dockerfile
# Multi-stage build for optimal image size

# ============================================
# Stage 1: Build
# ============================================
FROM node:22-alpine AS builder

# Install pnpm (pinned to match packageManager field)
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

# Copy package files (layer cached when only source changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/channels/package.json ./packages/channels/
COPY packages/cli/package.json ./packages/cli/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and build config
COPY tsconfig.base.json turbo.json ./
COPY packages/core/ ./packages/core/
COPY packages/gateway/ ./packages/gateway/
COPY packages/channels/ ./packages/channels/
COPY packages/cli/ ./packages/cli/
COPY packages/ui/ ./packages/ui/

# Build all packages (Turbo builds dependencies in order, including UI)
RUN pnpm build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine AS production

# Install pnpm (pinned to match packageManager field)
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/channels/package.json ./packages/channels/
COPY packages/cli/package.json ./packages/cli/
COPY packages/ui/package.json ./packages/ui/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/data ./packages/core/data
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/gateway/data ./packages/gateway/data
COPY --from=builder /app/packages/channels/dist ./packages/channels/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist

# Copy UI static assets (no node_modules needed — pre-built by Vite)
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist

# Create non-root user
RUN addgroup -g 1001 -S ownpilot && adduser -S ownpilot -u 1001 -G ownpilot

# Create data directory with proper ownership
RUN mkdir -p /app/data && chown -R ownpilot:ownpilot /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Switch to non-root user
USER ownpilot

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# OCI labels for GHCR
LABEL org.opencontainers.image.source="https://github.com/ownpilot/ownpilot"
LABEL org.opencontainers.image.description="OwnPilot — Privacy-first personal AI assistant"
LABEL org.opencontainers.image.licenses="MIT"

# Start the application
CMD ["node", "packages/gateway/dist/server.js"]
