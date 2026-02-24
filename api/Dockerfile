***REMOVED*** Build stage
FROM node:20-alpine AS builder

WORKDIR /app

***REMOVED*** Copy package files
COPY package*.json ./

***REMOVED*** Install dependencies
RUN npm ci

***REMOVED*** Copy source
COPY tsconfig.json ./
COPY src ./src

***REMOVED*** Build TypeScript
RUN npm run build

***REMOVED*** Production stage
FROM node:20-alpine

WORKDIR /app

***REMOVED*** Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

***REMOVED*** Copy built files
COPY --from=builder /app/dist ./dist

***REMOVED*** Download AWS RDS CA bundle for SSL certificate validation
RUN wget -q -O /app/rds-combined-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

***REMOVED*** Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

USER nodejs

***REMOVED*** Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
