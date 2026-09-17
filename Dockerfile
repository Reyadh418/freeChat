# Production Dockerfile for freeChat
# Lightweight, secure, multi-stage Node.js Alpine container

FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Production runtime image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create writable directory for local fallback database with proper node user permissions
RUN mkdir -p /app/database && chown -R node:node /app

# Copy dependencies and application sources
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
COPY --chown=node:node database/schema.sql ./database/schema.sql

# Non-root execution for security hardening
USER node

EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server/server.js"]

