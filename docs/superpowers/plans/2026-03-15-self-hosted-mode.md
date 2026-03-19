# Self-Hosted Mode: Replace Standalone SQLite with Full API Stack

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone SQLite backend with a Docker Compose stack (PostgreSQL + Redis + API + Frontend) so there is one code path for all execution modes, while keeping the agent binary as the single-command launcher.

**Architecture:** The agent binary manages Docker Compose lifecycle for self-hosted users. In self-hosted mode, `workermill-agent start` runs `docker compose up -d` (PostgreSQL, Redis, API, Frontend), waits for the API to be healthy, then enters cloud-agent mode pointed at `localhost:3001`. Workers are spawned as Docker containers by the agent via `docker-spawner.ts` (already works). Cloud mode is unchanged — agent connects to `workermill.com`. The VS Code extension connects to the agent's local-api (which proxies events) in both modes.

**Tech Stack:** Docker Compose, Express API (TypeORM + PostgreSQL), React + Vite frontend, Vercel AI SDK (multi-provider), Claude Agent SDK

**Key constraints:**
- Must support all AI providers: Anthropic (Claude Agent SDK), OpenAI, Google, Ollama (Vercel AI SDK)
- Cloud mode (connecting to workermill.com) must remain fully functional
- Docker is required for self-hosted mode (already required for sandbox workers)
- VS Code extension connects via agent's local-api (`~/.workermill/agent.port`) — this does NOT change
- Workers already use Docker-in-Docker for sandbox — no change needed

---

## File Structure

### New Files
- `docker-compose.yml` (repo root) — production-ready Compose file for self-hosted mode (API + Frontend + PostgreSQL + Redis)
- `api/Dockerfile` — containerize the API server
- `frontend/Dockerfile` — build and serve the frontend statically (nginx)
- `agent/src/compose-manager.ts` — Docker Compose lifecycle management (up/down/health)

### Modified Files
- `agent/src/index.ts` — self-hosted mode: start Compose, wait for health, then enter cloud-agent flow
- `agent/src/commands/start.ts` — replace standalone config bridging with self-hosted Compose launch
- `agent/src/backends/local/config.ts` — add `mode: "self-hosted"`, keep `isCloudMode()` working
- `agent/src/backends/selector.ts` — self-hosted uses CloudBackend pointed at localhost
- `agent/src/local-api.ts` — remove SQLite dependencies, keep `agentEvents` and SSE for VS Code
- `agent/src/commands/init-standalone.ts` → rename to `init-selfhosted.ts` — configure self-hosted mode (Docker check, API key storage via API)
- `packages/vscode-workermill/package.json` — update welcome view text
- `packages/vscode-workermill/src/extension.ts` — update `setupStandalone` command

### Files to Remove (after migration)
- `agent/src/backends/local/db.ts` — SQLite layer
- `agent/src/backends/local/index.ts` — LocalBackend class
- `agent/src/backends/local/event-bus.ts` — in-process event multiplexer
- `agent/src/backends/local/orchestrator.ts` — standalone task orchestrator
- `agent/src/commands/run-standalone.ts` — one-shot standalone task runner
- `agent/src/commands/prd-standalone.ts` — standalone PRD decomposition

### Files that Stay Unchanged
- `agent/src/docker-spawner.ts` — already handles Docker worker spawning
- `agent/src/spawner.ts` — native spawner for cloud mode
- `agent/src/poller.ts` — cloud polling (self-hosted reuses this pointed at localhost)
- `agent/src/api.ts` — API client (self-hosted points at localhost:3001)
- `worker/` — entire worker directory unchanged
- `api/src/` — entire API unchanged (it already supports `EXECUTION_MODE=local`)
- `agent/src/backends/cloud/` — CloudBackend (self-hosted reuses this)

---

## Chunk 1: Docker Compose Infrastructure

### Task 1: Create API Dockerfile

**Files:**
- Create: `api/Dockerfile`

- [ ] **Step 1: Create the API Dockerfile**

```dockerfile
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
```

- [ ] **Step 2: Verify it builds**

Run: `cd api && docker build -t workermill-api:local .`
Expected: Successful build

- [ ] **Step 3: Commit**

```bash
git add api/Dockerfile
git commit -m "feat: add API Dockerfile for self-hosted mode"
```

---

### Task 2: Create Frontend Dockerfile

**Files:**
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Create the Frontend Dockerfile**

The frontend uses Vite with a proxy for `/api/*` requests. In production, nginx handles the proxying.

```dockerfile
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config: serve SPA + proxy /api to the API container
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Create nginx config**

Create: `frontend/nginx.conf`

```nginx
server {
    listen 5173;
    root /usr/share/nginx/html;
    index index.html;

    # SPA: serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to the API container
    location /api/ {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }

    # Proxy SSE streams
    location /api/stream/ {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # Proxy auth routes
    location /auth/ {
        proxy_pass http://api:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd frontend && docker build -t workermill-frontend:local .`
Expected: Successful build

- [ ] **Step 4: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf
git commit -m "feat: add Frontend Dockerfile for self-hosted mode"
```

---

### Task 3: Create Production Docker Compose

**Files:**
- Create: `docker-compose.yml` (repo root)

- [ ] **Step 1: Create docker-compose.yml**

This extends `docker-compose.local.yml` patterns but adds the API and Frontend services. The API runs with `EXECUTION_MODE=local` (skips Cognito, auto-login) and mounts the Docker socket so workers can be spawned.

```yaml
# WorkerMill Self-Hosted Stack
# Usage: docker compose up -d
# The agent binary manages this file — don't run manually.

services:
  postgres:
    image: pgvector/pgvector:pg15
    container_name: workermill-db
    environment:
      POSTGRES_USER: workermill
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: workermill
    ports:
      - "5432:5432"
    volumes:
      - workermill-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workermill"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: workermill-redis
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: workermill-api
    ports:
      - "3001:3001"
    environment:
      NODE_ENV: production
      PORT: "3001"
      EXECUTION_MODE: local
      DATABASE_URL: postgresql://workermill:localdev@postgres:5432/workermill
      REDIS_URL: redis://redis:6379
      NODE_TLS_REJECT_UNAUTHORIZED: "0"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "const h=require('http');h.get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: workermill-frontend
    ports:
      - "5173:5173"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  workermill-data:
    name: workermill-data
```

- [ ] **Step 2: Verify it starts**

Run: `docker compose up -d && docker compose ps`
Expected: All 4 services healthy

Run: `curl -s http://localhost:3001/health | head -1`
Expected: 200 OK

- [ ] **Step 3: Verify it stops**

Run: `docker compose down`
Expected: All containers stopped

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add self-hosted Docker Compose stack"
```

---

## Chunk 2: Agent Compose Manager

### Task 4: Create Compose Manager Module

**Files:**
- Create: `agent/src/compose-manager.ts`

This module manages the Docker Compose lifecycle from the agent binary. It starts/stops the self-hosted stack and waits for the API to be healthy.

- [ ] **Step 1: Create compose-manager.ts**

```typescript
/**
 * Compose Manager — start/stop the self-hosted Docker Compose stack.
 *
 * The agent binary calls this to bring up PostgreSQL, Redis, API, and Frontend
 * before entering cloud-agent mode pointed at localhost:3001.
 */

import chalk from "chalk";
import { execFileSync, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { findDockerBin } from "./config.js";

const SELF_HOSTED_API_URL = "http://localhost:3001";
const HEALTH_ENDPOINT = `${SELF_HOSTED_API_URL}/health`;

/**
 * Find the docker-compose.yml bundled with the agent or in the repo.
 * The agent binary bundles it at build time; fallback to repo root for dev.
 */
function findComposeFile(): string {
  // Bundled with agent binary (adjacent to the binary)
  const bundled = path.join(path.dirname(process.execPath), "docker-compose.yml");
  if (fs.existsSync(bundled)) return bundled;

  // Dev mode: repo root
  const repoRoot = path.resolve(__dirname, "../../..");
  const repoCompose = path.join(repoRoot, "docker-compose.yml");
  if (fs.existsSync(repoCompose)) return repoCompose;

  throw new Error(
    "docker-compose.yml not found. Reinstall the agent or run from the repo root."
  );
}

/**
 * Check if the self-hosted stack is already running and healthy.
 */
export function isStackHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_ENDPOINT, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Start the self-hosted Docker Compose stack.
 * Idempotent — safe to call if already running.
 */
export async function startCompose(
  log?: (msg: string) => void,
): Promise<void> {
  // Check if already running
  if (await isStackHealthy()) {
    log?.("Self-hosted stack already running");
    return;
  }

  const docker = findDockerBin();
  const composeFile = findComposeFile();
  const composeDir = path.dirname(composeFile);

  log?.(`Starting self-hosted stack from ${composeFile}`);

  // Build and start services
  try {
    execFileSync(docker, ["compose", "-f", composeFile, "up", "-d", "--build"], {
      cwd: composeDir,
      stdio: "pipe",
      timeout: 300_000, // 5 minutes for first build
      windowsHide: true,
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString?.() || "";
    throw new Error(`Failed to start self-hosted stack: ${stderr || (err instanceof Error ? err.message : String(err))}`);
  }

  // Wait for API to be healthy
  log?.("Waiting for API to be ready...");
  const maxWaitMs = 120_000;
  const pollMs = 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    if (await isStackHealthy()) {
      log?.("API is healthy");
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error("API did not become healthy within 2 minutes. Check: docker compose logs api");
}

/**
 * Stop the self-hosted Docker Compose stack.
 */
export async function stopCompose(
  log?: (msg: string) => void,
): Promise<void> {
  const docker = findDockerBin();

  let composeFile: string;
  try {
    composeFile = findComposeFile();
  } catch {
    log?.("No compose file found — nothing to stop");
    return;
  }

  log?.("Stopping self-hosted stack...");
  try {
    execFileSync(docker, ["compose", "-f", composeFile, "down"], {
      cwd: path.dirname(composeFile),
      stdio: "pipe",
      timeout: 30_000,
      windowsHide: true,
    });
    log?.("Self-hosted stack stopped");
  } catch (err) {
    log?.(`Warning: compose down failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export { SELF_HOSTED_API_URL };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/compose-manager.ts
git commit -m "feat: add Docker Compose lifecycle manager for self-hosted mode"
```

---

## Chunk 3: Agent Mode Rewiring

### Task 5: Add Self-Hosted Mode to Config

**Files:**
- Modify: `agent/src/backends/local/config.ts`

- [ ] **Step 1: Add self-hosted mode detection**

The `mode` field in `~/.workermill/config.json` gains a third value: `"self-hosted"`. The `isCloudMode()` function must return `true` for self-hosted (since self-hosted uses the CloudBackend pointed at localhost). Add a new `isSelfHostedMode()` function.

In `agent/src/backends/local/config.ts`, add after the existing `isCloudMode()` function:

```typescript
/** True when running in self-hosted mode (Docker Compose local stack). */
export function isSelfHostedMode(): boolean {
  try {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return config.mode === "self-hosted";
  } catch {
    return false;
  }
}
```

Modify `isCloudMode()` to also return `true` for self-hosted:

```typescript
export function isCloudMode(): boolean {
  try {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return config.mode === "cloud" || config.mode === "self-hosted";
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/backends/local/config.ts
git commit -m "feat: add self-hosted mode detection to agent config"
```

---

### Task 6: Rewire Agent Startup for Self-Hosted Mode

**Files:**
- Modify: `agent/src/index.ts`
- Modify: `agent/src/commands/start.ts`

This is the core change. When `mode: "self-hosted"`, the agent:
1. Starts Docker Compose (PostgreSQL + Redis + API + Frontend)
2. Builds an `AgentConfig` pointing at `localhost:3001`
3. Falls into the existing cloud-agent flow (register, poll, spawn workers)

- [ ] **Step 1: Add self-hosted startup path to index.ts**

In `agent/src/index.ts`, add import:

```typescript
import { isSelfHostedMode } from "./backends/local/config.js";
import { startCompose, stopCompose, SELF_HOSTED_API_URL } from "./compose-manager.js";
```

Then, in `startAgent()`, before the existing `if (standaloneMode)` block, add a self-hosted check. The self-hosted path starts Compose, then falls through to the cloud-agent flow:

```typescript
const selfHosted = isSelfHostedMode();

if (selfHosted) {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Agent (Self-Hosted)"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();
  console.log(`  ${chalk.dim("Version:")}    ${AGENT_VERSION}`);
  console.log(`  ${chalk.dim("Mode:")}       ${chalk.green("Self-Hosted")} (Docker Compose)`);
  console.log();

  // Start the Docker Compose stack
  await startCompose((msg) => console.log(`  ${chalk.dim(msg)}`));

  // Override config to point at local API
  config.apiUrl = SELF_HOSTED_API_URL;
  config.apiKey = "self-hosted";

  console.log(`  ${chalk.green("●")} Stack running at ${chalk.cyan(SELF_HOSTED_API_URL)}`);
  console.log(`  ${chalk.dim("Dashboard:")} http://localhost:5173`);
  console.log();
}
```

The existing cloud-agent flow (initApi, register, poll, heartbeat) then runs with `config.apiUrl = "http://localhost:3001"`.

In the cleanup function, add Compose teardown for self-hosted:

```typescript
if (selfHosted) {
  await stopCompose((msg) => console.log(`  ${chalk.dim(msg)}`));
}
```

- [ ] **Step 2: Update start.ts to handle self-hosted config**

In `agent/src/commands/start.ts`, the standalone config bridge (lines 116-134) currently creates an `AgentConfig` for standalone mode. Add a self-hosted case that creates a config pointing at localhost:

After the existing `if (standaloneCheck.mode === "standalone" ...)` block, add:

```typescript
} else if (standaloneCheck.mode === "self-hosted") {
  const sc = standaloneCheck;
  config = {
    apiUrl: "http://localhost:3001",
    apiKey: "self-hosted",
    agentId: `agent-${os.hostname()}`,
    maxWorkers: sc.settings?.maxParallelExperts ?? 4,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    githubToken: sc.scm?.token || "",
    bitbucketToken: "",
    gitlabToken: "",
    githubReviewerToken: "",
    sandbox: (sc.sandbox === "docker" ? "docker" : "none") as "docker" | "none",
    dockerImage: "ghcr.io/jarod-rosenthal/worker",
    dockerMemoryGb: 4,
    localRag: false,
    ollamaPort: 11434,
  };
```

Add `os` import if not present: `import { hostname } from "os";`

- [ ] **Step 3: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add agent/src/index.ts agent/src/commands/start.ts
git commit -m "feat: self-hosted mode starts Docker Compose then enters cloud-agent flow"
```

---

### Task 7: Create Self-Hosted Init Command

**Files:**
- Create: `agent/src/commands/init-selfhosted.ts`
- Modify: `agent/src/cli.ts`

- [ ] **Step 1: Create init-selfhosted.ts**

This replaces `init-standalone.ts` for self-hosted mode. It checks Docker, detects credentials, and writes a `mode: "self-hosted"` config.

```typescript
/**
 * workermill-agent init --self-hosted
 *
 * Setup for self-hosted mode (Docker Compose stack).
 * Checks Docker is running, detects credentials, writes config.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { execFileSync } from "child_process";
import {
  loadStandaloneConfig,
  saveStandaloneConfig,
  detectExistingKey,
  type StandaloneConfig,
} from "../backends/local/config.js";
import { findDockerBin, checkDockerAvailable } from "../config.js";

function detectGitHubToken(): string | null {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (token) return token;
  } catch { /* gh not installed or not authed */ }
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return null;
}

function detectRepoFromCwd(): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (url) return url;
  } catch { /* not a git repo */ }
  return null;
}

export async function initSelfHostedCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Self-Hosted Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // Check Docker
  if (!checkDockerAvailable()) {
    console.log(`  ${chalk.red("✗")} Docker is not running`);
    console.log(`  Install Docker Desktop: ${chalk.cyan("https://www.docker.com/products/docker-desktop/")}`);
    process.exit(1);
  }
  console.log(`  ${chalk.green("✓")} Docker is running`);

  const existing = loadStandaloneConfig();
  let needsPrompt = false;

  // Auto-detect AI provider key
  const aiKey = detectExistingKey("anthropic");
  if (aiKey) {
    const masked = aiKey.slice(0, 12) + "..." + aiKey.slice(-4);
    console.log(`  ${chalk.green("✓")} AI provider: Anthropic (${masked})`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No Claude OAuth or ANTHROPIC_API_KEY found`);
    needsPrompt = true;
  }

  // Auto-detect GitHub token
  const ghToken = existing.scm?.token || detectGitHubToken();
  if (ghToken) {
    const masked = ghToken.slice(0, 8) + "..." + ghToken.slice(-4);
    console.log(`  ${chalk.green("✓")} GitHub token: ${masked}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No GitHub token found`);
    needsPrompt = true;
  }

  // Auto-detect repo
  const defaultRepo = existing.defaultRepo || detectRepoFromCwd() || "";
  if (defaultRepo) {
    console.log(`  ${chalk.green("✓")} Target repo: ${defaultRepo}`);
  }

  console.log();

  // Prompt for missing credentials
  let finalAiKey = aiKey || "";
  let finalGhToken = ghToken || "";

  if (!aiKey) {
    const { key } = await inquirer.prompt([{
      type: "password",
      name: "key",
      message: "Anthropic API key (or run 'claude' to set up OAuth first):",
      mask: "*",
      validate: (v: string) => v.length > 0 || "API key is required for AI workers",
    }]);
    finalAiKey = key;
  }

  if (!ghToken) {
    console.log(chalk.dim("  Tip: Run 'gh auth login' first for automatic detection."));
    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: "GitHub token (for pushing branches/PRs):",
      mask: "*",
      validate: (v: string) => v.length > 0 || "Token is required to push code",
    }]);
    finalGhToken = token;
  }

  // Save config
  const config: StandaloneConfig = {
    mode: "self-hosted",
    roles: {
      planner: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
      worker: { provider: "anthropic", model: "claude-sonnet-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
      techLead: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
    },
    scm: {
      provider: "github",
      token: finalGhToken,
    },
    defaultRepo: defaultRepo || undefined,
    sandbox: "docker",
    settings: existing.settings || { maxStories: 8 },
  };

  saveStandaloneConfig(config);

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log();
  if (!needsPrompt) {
    console.log(chalk.green("  All credentials auto-detected — zero prompts needed!"));
    console.log();
  }
  console.log(`  Run ${chalk.cyan("workermill-agent start")} to launch.`);
  console.log(`  Dashboard will be at ${chalk.cyan("http://localhost:5173")}`);
  console.log();
  process.exit(0);
}
```

- [ ] **Step 2: Wire up CLI**

In `agent/src/cli.ts`, add the `init --self-hosted` route alongside the existing `init --standalone`. The `--standalone` flag should map to self-hosted (backward compat):

Find the `init` command handler and add:

```typescript
import { initSelfHostedCommand } from "./commands/init-selfhosted.js";
```

Map `--standalone` to call `initSelfHostedCommand()` instead of `initStandaloneCommand()`.

- [ ] **Step 3: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add agent/src/commands/init-selfhosted.ts agent/src/cli.ts
git commit -m "feat: add init --self-hosted command with Docker check"
```

---

## Chunk 4: Local API Cleanup

### Task 8: Decouple local-api.ts from SQLite

**Files:**
- Modify: `agent/src/local-api.ts`

The local-api serves two purposes:
1. **Event relay** — `agentEvents` EventEmitter + SSE endpoints for VS Code (KEEP)
2. **SQLite CRUD** — task/board/log management via LocalBackend (REMOVE)

In self-hosted mode, task CRUD goes through the real API at `localhost:3001`. The local-api only needs to relay `agentEvents` to SSE clients (VS Code extension).

- [ ] **Step 1: Identify SQLite-dependent routes in local-api.ts**

Read the full file and identify which routes call `getBackend()`, `getLocalDb()`, or `processQueuedTask()`. These routes are only needed for standalone mode.

- [ ] **Step 2: Guard SQLite routes behind mode check**

Rather than removing routes (which would break standalone until fully migrated), wrap SQLite-dependent routes in a mode check:

```typescript
import { isSelfHostedMode } from "./backends/local/config.js";

// Only register LocalBackend routes if NOT in self-hosted mode
if (!isSelfHostedMode()) {
  // ... existing SQLite CRUD routes ...
}
```

The `agentEvents` export, SSE stream routes (`/api/stream/tasks`, `/api/stream/logs/:taskId`), and `/api/status` stay unconditionally — they work in all modes.

- [ ] **Step 3: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify cloud mode still works**

The cloud mode path in `index.ts` must still start `local-api` and export `agentEvents`. Verify by reading the cloud startup path.

- [ ] **Step 5: Commit**

```bash
git add agent/src/local-api.ts
git commit -m "feat: guard SQLite routes behind mode check in local-api"
```

---

## Chunk 5: VS Code Extension Updates

### Task 9: Update Extension Onboarding

**Files:**
- Modify: `packages/vscode-workermill/package.json`
- Modify: `packages/vscode-workermill/src/extension.ts`

- [ ] **Step 1: Update welcome view text**

In `package.json`, the welcome view currently says "Standalone Mode (BYOK)". Update to:

```json
"contents": "AI coding agents that plan, code, and open pull requests — right from your editor.\n\n[Get Started](command:workermill.setupStandalone)\nRuns locally with Docker. Bring your own API keys.\n\n---\n\nHave a WorkerMill Cloud account?\n[Sign in with GitHub](command:workermill.signUpWithGitHub)"
```

Note: The command stays `workermill.setupStandalone` (same VS Code command ID, just runs the new self-hosted flow internally).

- [ ] **Step 2: Update setupStandalone command**

The `setupStandalone` command in `extension.ts` (already updated in an earlier edit) runs `workermill-agent init --standalone`. Since `--standalone` now maps to self-hosted, this works without changes. The agent binary handles the Docker check and init flow.

Verify the existing flow works:
1. Extension installs binary (if needed)
2. Checks Git and Claude CLI
3. Opens terminal with `workermill-agent init --standalone`
4. Polls for config file
5. Starts agent, connects

- [ ] **Step 3: Verify extension typechecks**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/vscode-workermill/package.json packages/vscode-workermill/src/extension.ts
git commit -m "feat: update VS Code extension onboarding for self-hosted mode"
```

---

## Chunk 6: API Self-Hosted Credential Bootstrapping

### Task 10: Ensure API Handles Self-Hosted Auth

**Files:**
- Investigate: `api/src/middleware/auth.ts`
- Investigate: `api/src/index.ts`

In `EXECUTION_MODE=local`, the API already skips Cognito auth and auto-creates a local user. Verify this flow works for self-hosted:

- [ ] **Step 1: Verify local mode auth bypass**

Read `api/src/middleware/auth.ts` and confirm that `EXECUTION_MODE=local` skips JWT validation and auto-authenticates requests.

- [ ] **Step 2: Verify local mode auto-creates org and user**

Read the API startup in `api/src/index.ts` to confirm it seeds a default organization and user in local mode.

- [ ] **Step 3: Verify org credentials storage**

The API stores AI provider keys (Anthropic, OpenAI, Google) and SCM tokens (GitHub, GitLab, Bitbucket) in the `org_credentials` table. In self-hosted mode, users configure these via the Settings page in the web dashboard (http://localhost:5173/settings) or via the VS Code settings panel.

Confirm that `api/src/routes/settings/` has endpoints for reading/writing org credentials.

- [ ] **Step 4: Document the credential flow**

In self-hosted mode, credentials flow:
1. User enters API keys in Settings (web dashboard or VS Code settings panel)
2. API stores them in `org_credentials` table
3. When spawning workers, API reads credentials from DB and passes as env vars
4. Worker uses credentials to call AI providers (via Claude Agent SDK or Vercel AI SDK)

No action needed if this already works — just verify.

- [ ] **Step 5: Commit (if any changes needed)**

```bash
git commit -m "fix: ensure API local mode handles self-hosted credential flow"
```

---

## Chunk 7: Integration Testing

### Task 11: End-to-End Self-Hosted Smoke Test

- [ ] **Step 1: Clean slate**

```bash
# Remove any existing config
rm -f ~/.workermill/config.json
# Stop any running agent
workermill-agent stop 2>/dev/null || true
# Stop any running containers
docker compose down 2>/dev/null || true
```

- [ ] **Step 2: Run init**

```bash
cd /path/to/workermill
workermill-agent init --standalone
```

Verify:
- Docker check passes
- Credential auto-detection works
- Config saved with `mode: "self-hosted"`

- [ ] **Step 3: Start agent**

```bash
workermill-agent start
```

Verify:
- Docker Compose starts (4 containers: postgres, redis, api, frontend)
- API becomes healthy at `http://localhost:3001/health`
- Frontend loads at `http://localhost:5173`
- Agent enters polling mode against localhost:3001
- VS Code extension connects via `~/.workermill/agent.port`

- [ ] **Step 4: Create a task via VS Code**

- Open VS Code with the WorkerMill extension
- Verify extension connects
- Create a simple task
- Verify task appears in the API (`curl http://localhost:3001/api/tasks`)
- Verify worker Docker container is spawned
- Verify logs stream to VS Code

- [ ] **Step 5: Verify cloud mode still works**

Change config to `mode: "cloud"` with a real `apiUrl` and `apiKey`. Run `workermill-agent start`. Verify it connects to the cloud API without starting Docker Compose.

- [ ] **Step 6: Stop and verify cleanup**

```bash
workermill-agent stop
```

Verify:
- Agent process stops
- Docker Compose containers stop
- PID and port files cleaned up

---

## Chunk 8: Remove Dead Standalone Code (Post-Migration)

### Task 12: Remove SQLite Backend

**DO NOT execute this chunk until Chunks 1-7 are verified working.** This is the cleanup step.

**Files to delete:**
- `agent/src/backends/local/db.ts`
- `agent/src/backends/local/index.ts`
- `agent/src/backends/local/event-bus.ts`
- `agent/src/backends/local/orchestrator.ts`
- `agent/src/commands/init-standalone.ts`
- `agent/src/commands/run-standalone.ts`
- `agent/src/commands/prd-standalone.ts`

**Files to update:**
- `agent/src/index.ts` — remove standalone branch, remove orchestrator import
- `agent/src/local-api.ts` — remove guarded SQLite routes entirely
- `agent/src/cli.ts` — remove `run` and `prd` standalone commands
- `agent/src/backends/selector.ts` — remove LocalBackend import

- [ ] **Step 1: Delete standalone-only files**

```bash
rm agent/src/backends/local/db.ts
rm agent/src/backends/local/index.ts
rm agent/src/backends/local/event-bus.ts
rm agent/src/backends/local/orchestrator.ts
rm agent/src/commands/init-standalone.ts
rm agent/src/commands/run-standalone.ts
rm agent/src/commands/prd-standalone.ts
```

- [ ] **Step 2: Remove standalone imports and code paths**

Update `agent/src/index.ts`:
- Remove `import { initOrchestrator, shutdownOrchestrator }`
- Remove the `if (standaloneMode)` block entirely

Update `agent/src/backends/selector.ts`:
- Remove `LocalBackend` dynamic import
- Always return `CloudBackend`

Update `agent/src/local-api.ts`:
- Remove all guarded SQLite routes
- Remove imports from `db.ts`, `event-bus.ts`, `orchestrator.ts`
- Keep `agentEvents` export and SSE stream routes

Update `agent/src/cli.ts`:
- Remove `run` and `prd` command handlers

- [ ] **Step 3: Verify it compiles**

Run: `cd agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify self-hosted mode still works**

Repeat Task 11 smoke test.

- [ ] **Step 5: Verify cloud mode still works**

Change config to cloud mode, verify agent connects to cloud API.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove standalone SQLite backend (replaced by self-hosted Docker Compose)"
```
