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

***REMOVED*** Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

***REMOVED*** Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

***REMOVED*** Remove build dependencies to reduce image size
RUN apk del python3 make g++

***REMOVED*** Copy built files
COPY --from=builder /app/dist ./dist

***REMOVED*** Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

USER nodejs

***REMOVED*** Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/index.js"]
