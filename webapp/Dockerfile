# Multi-stage Next.js build for Backyard arm64
FROM --platform=linux/arm64 node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional --loglevel=warn

FROM --platform=linux/arm64 node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM --platform=linux/arm64 node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Copy standalone output + static assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# non-root (node:20-alpine ships with 'node' user uid=1000)
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider -q http://localhost:3000/cs || exit 1

CMD ["node", "server.js"]
