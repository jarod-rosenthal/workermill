***REMOVED*** WorkerMill AI Worker Container
***REMOVED*** Runs Claude Code CLI to execute AI agent tasks

FROM node:20.19-bookworm

***REMOVED*** System essentials only — all dev tools (Go, Terraform, AWS CLI, Kaniko, Rust,
***REMOVED*** Deno, etc.) are installed on-demand at runtime by /app/install-tools.sh.
***REMOVED*** python3 kept for target repos that need Python.
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    sudo \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh unzip \
    && rm -rf /var/lib/apt/lists/*

***REMOVED*** Kaniko executor for Docker image builds (daemon-less, works in Fargate).
***REMOVED*** Only tool that MUST be baked in — no standalone binary download exists.
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/executor /kaniko/executor
COPY --from=gcr.io/kaniko-project/executor:latest /kaniko/docker-credential-ecr-login /kaniko/docker-credential-ecr-login

***REMOVED*** Install Claude Code CLI (pinned to prevent breaking changes)
RUN npm install -g @anthropic-ai/claude-code@1

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

***REMOVED*** Circular dependency: epic imports types from multi-expert, multi-expert imports
***REMOVED*** values from epic/dist/. Build order: epic first (with type stub) → multi-expert second.
***REMOVED*** Create a minimal .d.ts stub so epic's `import type` resolves without full source.
RUN mkdir -p /app/multi-expert && \
    echo '{"type":"module"}' > /app/multi-expert/package.json && \
    echo 'export declare class MultiExpertCoordinator { start(): Promise<void>; stop(): void; }' > /app/multi-expert/index.d.ts

***REMOVED*** Copy and build Epic executor (multi-agent collaboration with Agent SDK)
COPY epic /app/epic
WORKDIR /app/epic
RUN rm -rf dist && npm install && npm run build
RUN echo "Epic executor compiled successfully!" && ls -la /app/epic/dist/

***REMOVED*** Now copy real multi-expert source (overwrites stub) and build
COPY multi-expert /app/multi-expert
WORKDIR /app/multi-expert
RUN npm install && npm run build
RUN echo "Multi-Expert coordinator compiled successfully!" && ls -la /app/multi-expert/dist/

***REMOVED*** Virtual Manager (Agent SDK-based PR review and log analysis)
COPY manager /app/manager
WORKDIR /app/manager
RUN npm install && npm run build
RUN echo "Virtual Manager compiled successfully!" && ls -la /app/manager/dist/

***REMOVED*** Standard SDK Executor (single-task execution with Agent SDK)
COPY standard /app/standard
WORKDIR /app/standard
RUN npm install && npm run build
RUN echo "Standard SDK executor compiled successfully!" && ls -la /app/standard/dist/

WORKDIR /app

***REMOVED*** ── IP Protection: bundle + minify + mangle (aligned with agent/build.mjs) ──
***REMOVED*** Full esbuild bundling with tree-shaking, property mangling, and single-file output.
***REMOVED*** Cross-component imports are resolved via plugin (eliminates cp -r hacks above).
COPY bundle.mjs /app/bundle.mjs
RUN npm install --no-save esbuild && node /app/bundle.mjs && rm /app/bundle.mjs

***REMOVED*** Verify bundled output and runtime assets
RUN test -f /app/epic/dist/index.js && \
    test -f /app/multi-expert/dist/index.js && \
    test -f /app/manager/dist/index.js && \
    test -f /app/standard/dist/index.js && \
    test -f /app/execution-compiled/git/create_pr.js && \
    test -f /app/agents/ai-sdk-executor.js && \
    test -f /app/AGENTS.md && \
    test -d /app/directives && \
    test -f /app/lib/checkpoint.sh && \
    echo "Bundle verification passed"

***REMOVED*** Copy entrypoint scripts + runtime tool installer
COPY entrypoint.sh /app/entrypoint.sh
COPY manager-entrypoint.sh /app/manager-entrypoint.sh
COPY epic-entrypoint.sh /app/epic-entrypoint.sh
COPY multi-expert-entrypoint.sh /app/multi-expert-entrypoint.sh
COPY standard-entrypoint.sh /app/standard-entrypoint.sh
COPY warm-wait.sh /app/warm-wait.sh
COPY start.sh /app/start.sh
COPY install-tools.sh /app/install-tools.sh
RUN chmod +x /app/entrypoint.sh /app/manager-entrypoint.sh /app/epic-entrypoint.sh /app/multi-expert-entrypoint.sh /app/standard-entrypoint.sh /app/warm-wait.sh /app/start.sh /app/install-tools.sh

***REMOVED*** Create workspace for cloned repos
RUN mkdir -p /workspace

***REMOVED*** Create worker user with sudo for runtime tool installs
***REMOVED*** Claude Code CLI refuses to run as root
RUN useradd -m -s /bin/bash worker

***REMOVED*** Only chown directories the worker actually WRITES to at runtime.
***REMOVED*** /app is read-only (root-owned 644/755 is readable by worker) — no chown needed.
***REMOVED*** This avoids a ~370MB Docker layer from duplicating /app content.
RUN mkdir -p /kaniko/.docker /usr/local/go /home/worker/go/pkg/mod /home/worker/go/bin \
    && chown -R worker:worker /workspace /kaniko /usr/local/go /home/worker/go

***REMOVED*** Create Kaniko wrapper that accepts VAR=value env args and execs /kaniko/executor.
***REMOVED*** Replaces "sudo env PATH=... /kaniko/executor" — scoped to Kaniko only, no generic env.
RUN printf '***REMOVED***!/bin/bash\nfor arg in "$@"; do\n  if [[ "$arg" =~ ^[A-Z_]+=.* ]]; then\n    export "$arg"\n    shift\n  else\n    break\n  fi\ndone\nexec /kaniko/executor "$@"\n' > /usr/local/bin/kaniko-run \
    && chmod 755 /usr/local/bin/kaniko-run

***REMOVED*** Allow worker user to install tools at runtime and run Kaniko/AWS/certs.
***REMOVED*** Scoped commands only — /usr/bin/env is NOT in this list.
RUN echo 'worker ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/tar, /usr/bin/unzip, /usr/bin/install, /usr/bin/mv, /usr/bin/cp, /usr/bin/chmod, /usr/bin/chown, /usr/bin/tee, /usr/bin/dd, /usr/local/bin/kaniko-run, /kaniko/executor, /usr/sbin/update-ca-certificates, /tmp/aws/install' > /etc/sudoers.d/worker \
    && chmod 440 /etc/sudoers.d/worker

***REMOVED*** Set PATH for tools that may be installed at runtime
ENV PATH="/usr/local/go/bin:/kaniko:${PATH}"
ENV GOPATH="/home/worker/go"
ENV GOMODCACHE="/home/worker/go/pkg/mod"

***REMOVED*** Switch to worker user for Claude Code CLI compatibility
USER worker

***REMOVED*** Set default working directory for repos
WORKDIR /workspace

***REMOVED*** Use CMD instead of ENTRYPOINT so ECS command overrides work
***REMOVED*** The start.sh wrapper checks EPIC_MODE and routes to the appropriate entrypoint
***REMOVED*** (Manager tasks override this to run manager-entrypoint.sh)
CMD ["/app/start.sh"]
