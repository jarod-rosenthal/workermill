# WorkerMill AI Worker Container
# Runs Claude Code CLI to execute AI agent tasks

FROM node:20-bookworm

# Install system dependencies (including sudo for Kaniko privilege escalation)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh unzip \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2 for ECS deployments
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && aws --version

# Install Kaniko executor for Docker image builds (daemon-less, works in Fargate)
# Using multi-stage copy from official Kaniko image
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/executor /kaniko/executor
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/docker-credential-gcr /kaniko/docker-credential-gcr
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/docker-credential-ecr-login /kaniko/docker-credential-ecr-login
ENV PATH="/kaniko:${PATH}"

# Create Kaniko config directory
RUN mkdir -p /kaniko/.docker

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy directives, execution scripts, and log-parser
COPY directives /app/directives
COPY execution /app/execution
COPY scripts /app/scripts
COPY AGENTS.md /app/AGENTS.md

# Copy package.json for any dependencies
COPY package.json /app/package.json
WORKDIR /app
RUN npm install

# Make log-parser executable
RUN chmod +x /app/scripts/log-parser.cjs

# Install TypeScript globally for execution scripts
RUN npm install -g typescript ts-node

# Set up execution scripts with proper dependencies
WORKDIR /app/execution

# Create package.json for execution scripts (uses only Node.js built-ins)
RUN echo '{"name": "workermill-execution", "version": "1.0.0", "private": true, "devDependencies": {"@types/node": "^20.0.0", "typescript": "^5.0.0"}}' > package.json

# Create tsconfig.json for compilation
RUN echo '{"compilerOptions": {"target": "ES2022", "module": "commonjs", "outDir": "../execution-compiled", "rootDir": ".", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true, "resolveJsonModule": true, "declaration": false, "moduleResolution": "node"}, "include": ["**/*.ts"], "exclude": ["node_modules"]}' > tsconfig.json

# Install dependencies
RUN npm install

# Compile TypeScript execution scripts (no error suppression - we want to see failures)
RUN npx tsc

# Verify compiled files exist
RUN echo "Verifying compiled files..." && \
    ls -la /app/execution-compiled/ && \
    test -d /app/execution-compiled/git && \
    test -d /app/execution-compiled/ticket && \
    test -d /app/execution-compiled/test && \
    test -d /app/execution-compiled/metrics && \
    test -d /app/execution-compiled/deploy && \
    test -f /app/execution-compiled/git/create_pr.js && \
    test -f /app/execution-compiled/ticket/add_comment.js && \
    test -f /app/execution-compiled/ticket/transition_issue.js && \
    test -f /app/execution-compiled/test/run_tests.js && \
    test -f /app/execution-compiled/test/run_typecheck.js && \
    test -f /app/execution-compiled/metrics/record_task_metrics.js && \
    test -f /app/execution-compiled/deploy/build_and_push.js && \
    test -f /app/execution-compiled/deploy/deploy_ecs.js && \
    test -f /app/execution-compiled/deploy/check_health.js && \
    test -f /app/execution-compiled/deploy/rollback.js && \
    echo "All execution scripts compiled successfully!"

WORKDIR /app

# Copy entrypoint scripts
COPY entrypoint.sh /app/entrypoint.sh
COPY manager-entrypoint.sh /app/manager-entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/manager-entrypoint.sh

# Create workspace for cloned repos
RUN mkdir -p /workspace

# Create worker user with sudo access for Kaniko
# Claude Code CLI refuses to run as root, but Kaniko needs root for chown
# Solution: Run as worker user, allow passwordless sudo for Kaniko
RUN useradd -m -s /bin/bash worker
RUN chown -R worker:worker /app /workspace /kaniko

# Allow worker user to run Kaniko and AWS CLI as root without password
# This is safe because the container is ephemeral and network-isolated
RUN echo 'worker ALL=(ALL) NOPASSWD: /kaniko/executor, /usr/local/bin/aws' > /etc/sudoers.d/worker \
    && chmod 440 /etc/sudoers.d/worker

# Switch to worker user for Claude Code CLI compatibility
USER worker

# Set default working directory for repos
WORKDIR /workspace

# Use CMD instead of ENTRYPOINT so ECS command overrides work
# (Manager tasks override this to run manager-entrypoint.sh)
CMD ["/app/entrypoint.sh"]
