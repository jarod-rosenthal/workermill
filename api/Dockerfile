FROM node:22-bookworm-slim

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source code
COPY tsconfig.json ./
COPY src/ src/

# Build TypeScript
RUN npx tsc

# Prune dev dependencies
RUN npm prune --production

EXPOSE 3001

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
    CMD node -e "const h=require('http');h.get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
