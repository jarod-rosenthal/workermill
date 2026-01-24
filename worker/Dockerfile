***REMOVED*** WorkerMill AI Worker Container
***REMOVED*** Runs Claude Code CLI to execute AI agent tasks

FROM node:20-bookworm

***REMOVED*** Install system dependencies (including sudo for Kaniko privilege escalation)
***REMOVED*** ca-certificates is critical for SSL/TLS operations after Kaniko runs
***REMOVED*** python3 and pip are needed for Aider (Ollama agent)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    sudo \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh unzip \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Install AWS CLI v2 for ECS deployments
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && aws --version

***REMOVED*** Install Kaniko executor for Docker image builds (daemon-less, works in Fargate)
***REMOVED*** Using multi-stage copy from official Kaniko image
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/executor /kaniko/executor
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/docker-credential-gcr /kaniko/docker-credential-gcr
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/docker-credential-ecr-login /kaniko/docker-credential-ecr-login
ENV PATH="/kaniko:${PATH}"

***REMOVED*** Create Kaniko config directory
RUN mkdir -p /kaniko/.docker

***REMOVED*** Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

***REMOVED*** Install Aider for agentic coding with Ollama/OpenAI/other providers
***REMOVED*** Aider provides tool execution capabilities that raw LLM APIs lack
RUN pip3 install --break-system-packages aider-chat


***REMOVED*** Install LangGraph and multi-provider LangChain packages for unified ReAct agent
***REMOVED*** Supports: ollama, openai, gemini, groq, mistral, azure
***REMOVED*** Use --upgrade --no-cache-dir to always get latest versions
RUN pip3 install --break-system-packages --upgrade --no-cache-dir \
    langgraph \
    langchain-core \
    langchain \
    langchain-ollama \
    langchain-openai \
    langchain-google-genai \
    langchain-groq \
    langchain-mistralai
***REMOVED*** Create app directory
WORKDIR /app

***REMOVED*** Copy directives, execution scripts, agents, and log-parser
COPY directives /app/directives
COPY execution /app/execution
COPY scripts /app/scripts
COPY agents /app/agents
COPY lib /app/lib
COPY AGENTS.md /app/AGENTS.md

***REMOVED*** Copy package.json for any dependencies
COPY package.json /app/package.json
WORKDIR /app
RUN npm install

***REMOVED*** Make log-parser executable
RUN chmod +x /app/scripts/log-parser.cjs

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

***REMOVED*** Copy and build Epic executor (multi-agent collaboration with Agent SDK)
COPY epic /app/epic
WORKDIR /app/epic
RUN npm install && npm run build
RUN echo "Epic executor compiled successfully!" && ls -la /app/epic/dist/

WORKDIR /app

***REMOVED*** Copy entrypoint scripts
COPY entrypoint.sh /app/entrypoint.sh
COPY manager-entrypoint.sh /app/manager-entrypoint.sh
COPY epic-entrypoint.sh /app/epic-entrypoint.sh
COPY start.sh /app/start.sh
RUN chmod +x /app/entrypoint.sh /app/manager-entrypoint.sh /app/epic-entrypoint.sh /app/start.sh

***REMOVED*** Create workspace for cloned repos
RUN mkdir -p /workspace

***REMOVED*** Create worker user with sudo access for Kaniko
***REMOVED*** Claude Code CLI refuses to run as root, but Kaniko needs root for chown
***REMOVED*** Solution: Run as worker user, allow passwordless sudo for Kaniko
RUN useradd -m -s /bin/bash worker
RUN chown -R worker:worker /app /workspace /kaniko /app/epic

***REMOVED*** Allow worker user to run Kaniko and AWS CLI as root without password
***REMOVED*** This is safe because the container is ephemeral and network-isolated
***REMOVED*** Note: We include /usr/bin/env because build_container.ts uses "sudo env PATH=... /kaniko/executor"
***REMOVED*** to ensure the ECR credential helper is in PATH when running as root
***REMOVED*** Note: update-ca-certificates is needed to restore SSL certs after Kaniko potentially corrupts them
RUN echo 'worker ALL=(ALL) NOPASSWD: /kaniko/executor, /usr/local/bin/aws, /usr/bin/env, /usr/sbin/update-ca-certificates' > /etc/sudoers.d/worker \
    && chmod 440 /etc/sudoers.d/worker

***REMOVED*** Switch to worker user for Claude Code CLI compatibility
USER worker

***REMOVED*** Set default working directory for repos
WORKDIR /workspace

***REMOVED*** Use CMD instead of ENTRYPOINT so ECS command overrides work
***REMOVED*** The start.sh wrapper checks EPIC_MODE and routes to the appropriate entrypoint
***REMOVED*** (Manager tasks override this to run manager-entrypoint.sh)
CMD ["/app/start.sh"]
