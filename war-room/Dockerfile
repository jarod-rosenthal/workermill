***REMOVED*** War Room Container
***REMOVED*** Multi-agent collaboration service using Claude Agent SDK

FROM node:22-slim

***REMOVED*** Install git and gh CLI for repository operations
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

***REMOVED*** Copy package files
COPY package*.json ./

***REMOVED*** Install dependencies
RUN npm ci --only=production

***REMOVED*** Copy compiled source
COPY dist/ ./dist/

***REMOVED*** Create workspace directory for repository cloning
RUN mkdir -p /app/workspace

***REMOVED*** Set environment
ENV NODE_ENV=production

***REMOVED*** Run the War Room
CMD ["node", "dist/index.js"]
