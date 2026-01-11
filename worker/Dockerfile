***REMOVED*** WorkerMill AI Worker Container
***REMOVED*** Runs Claude Code CLI to execute AI agent tasks

FROM node:20-bookworm

***REMOVED*** Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

***REMOVED*** Create app directory
WORKDIR /app

***REMOVED*** Copy directives and execution scripts
COPY directives /app/directives
COPY execution /app/execution
COPY AGENTS.md /app/AGENTS.md

***REMOVED*** Copy and build the Anthropic API proxy for token tracking
COPY package.json /app/package.json
COPY src/proxy /app/src/proxy
WORKDIR /app
RUN npm install
RUN npx tsc -p /app/src/proxy/tsconfig.json
RUN echo "Proxy compiled:" && ls -la /app/proxy-compiled/

***REMOVED*** Install TypeScript globally for execution scripts
RUN npm install -g typescript ts-node

***REMOVED*** Set up execution scripts with proper dependencies
WORKDIR /app/execution

***REMOVED*** Create package.json for execution scripts (uses only Node.js built-ins)
RUN echo '{"name": "workermill-execution", "version": "1.0.0", "private": true, "devDependencies": {"@types/node": "^20.0.0", "typescript": "^5.0.0"}}' > package.json

***REMOVED*** Create tsconfig.json for compilation
RUN echo '{"compilerOptions": {"target": "ES2022", "module": "commonjs", "outDir": "../execution-compiled", "rootDir": ".", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "resolveJsonModule": true, "declaration": false, "moduleResolution": "node"}, "include": ["**/*.ts"], "exclude": ["node_modules"]}' > tsconfig.json

***REMOVED*** Install dependencies
RUN npm install

***REMOVED*** Compile TypeScript execution scripts (no error suppression - we want to see failures)
RUN npx tsc

***REMOVED*** Verify compiled files exist
RUN echo "Verifying compiled files..." && \
    ls -la /app/execution-compiled/ && \
    test -d /app/execution-compiled/git && \
    test -d /app/execution-compiled/ticket && \
    test -d /app/execution-compiled/test && \
    test -d /app/execution-compiled/metrics && \
    test -f /app/execution-compiled/git/create_pr.js && \
    test -f /app/execution-compiled/ticket/add_comment.js && \
    test -f /app/execution-compiled/ticket/transition_issue.js && \
    test -f /app/execution-compiled/test/run_tests.js && \
    test -f /app/execution-compiled/test/run_typecheck.js && \
    test -f /app/execution-compiled/metrics/record_task_metrics.js && \
    echo "All execution scripts compiled successfully!"

WORKDIR /app

***REMOVED*** Copy entrypoint scripts
COPY entrypoint.sh /app/entrypoint.sh
COPY manager-entrypoint.sh /app/manager-entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/manager-entrypoint.sh

***REMOVED*** Create workspace for cloned repos
RUN mkdir -p /workspace

***REMOVED*** Run as non-root user
RUN useradd -m -s /bin/bash worker
RUN chown -R worker:worker /app /workspace
USER worker

***REMOVED*** Set default working directory for repos
WORKDIR /workspace

ENTRYPOINT ["/app/entrypoint.sh"]
