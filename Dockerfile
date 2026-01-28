# OwnPilot Dockerfile
# Multi-stage build for optimal image size

# ============================================
# Stage 1: Build
# ============================================
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/channels/package.json ./packages/channels/
COPY packages/cli/package.json ./packages/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core/ ./packages/core/
COPY packages/gateway/ ./packages/gateway/
COPY packages/channels/ ./packages/channels/
COPY packages/cli/ ./packages/cli/

# Build all packages
RUN pnpm build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/channels/package.json ./packages/channels/
COPY packages/cli/package.json ./packages/cli/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist
COPY --from=builder /app/packages/channels/dist ./packages/channels/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "packages/cli/dist/index.js", "start"]
