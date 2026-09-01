# ===== Stage 1: deps =====
# Install production dependencies only
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && \
    npx prisma generate

# ===== Stage 2: builder =====
# Build the Next.js application
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && \
    mkdir -p public

# ===== Stage 3: runner =====
# Production image - minimal footprint
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build artifacts
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy the full production node_modules (prod deps only, incl. prisma CLI +
# its transitive deps like `effect`, `@prisma/config`, `@prisma/engines`).
# `prisma` is a runtime dependency in package.json, so `npm ci --omit=dev`
# in the deps stage installs the complete `prisma migrate deploy` dependency tree.
COPY --from=deps /app/node_modules ./node_modules

# Copy prisma schema (needed for migrations)
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/todos || exit 1

CMD ["node", "server.js"]
