# Local Epic Mode Implementation Plan

Comprehensive plan for running WorkerMill Epic Mode locally with full production parity, including Planning Agent, Tech Lead review with revisions, and parallel expert execution using Claude Max subscription.

## Goals

1. **Full Epic Mode parity** - Planning Agent → Critic Review → Expert Execution → Tech Lead Review
2. **Agent SDK with Max OAuth** - Use `CLAUDE_CODE_OAUTH_TOKEN` instead of API keys
3. **Parallel expert execution** - 8+ experts working simultaneously via worktrees
4. **Same coordination** - File locks, coordination feed, memory system
5. **Single-command startup** - `./bin/local-workermill start --epic`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOCAL WORKERMILL EPIC MODE                           │
├─────────────────────────────┬───────────────────────────────────────────────┤
│  Frontend (localhost:5173)  │  API (localhost:3001)                          │
│  - Task creation UI         │  - PostgreSQL (Docker)                         │
│  - Log streaming (SSE)      │  - Planning Agent (AI SDK + OAuth)             │
│  - Coordination feed view   │  - Critic Agent (AI SDK + OAuth)               │
│  - Worker status dashboard  │  - Orchestrator (local mode)                   │
└─────────────────────────────┴───────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ORCHESTRATOR                                    │
│  1. Poll for queued tasks                                                   │
│  2. Run Planning Agent (decompose into stories)                             │
│  3. Run Critic Agent (validate plan, request revisions)                     │
│  4. Spawn Epic Coordinator (local process)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EPIC COORDINATOR                                   │
│  (Runs in main worktree - orchestrates experts)                             │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Claim Story │→ │ Route to    │→ │ Execute in  │→ │ Post Result │        │
│  │ from API    │  │ Expert      │  │ Worktree    │  │ to API      │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
│  Parallel execution across worktrees:                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Worktree 1  │ │ Worktree 2  │ │ Worktree 3  │ │ Worktree N  │           │
│  │ backend_dev │ │ frontend_dev│ │ devops_eng  │ │ qa_engineer │           │
│  │ (claude)    │ │ (claude)    │ │ (claude)    │ │ (claude)    │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TECH LEAD REVIEW                                   │
│  - InlineReviewer analyzes changes                                          │
│  - Can request revisions (max 3 iterations)                                 │
│  - Approves or escalates to human                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONSOLIDATION                                      │
│  - Merge expert branches                                                    │
│  - Create unified PR                                                        │
│  - Post results to Jira/Linear                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack (Local)

| Component | Technology | Notes |
|-----------|------------|-------|
| **Database** | PostgreSQL 15 (Docker) | Same as prod, synced from RDS |
| **API Server** | Express + TypeORM | Same code, `EXECUTION_MODE=local` |
| **Frontend** | React + Vite | Same code, points to localhost |
| **Planning Agent** | AI SDK + OAuth | Uses `CLAUDE_CODE_OAUTH_TOKEN` |
| **Critic Agent** | AI SDK + OAuth | Uses `CLAUDE_CODE_OAUTH_TOKEN` |
| **Expert Execution** | Claude CLI + OAuth | Spawns `claude` processes |
| **Worktree Isolation** | Git worktrees | One per expert, parallel execution |
| **Coordination** | Same API endpoints | File locks, feed, memory |
| **Log Streaming** | Same SSE | PostgreSQL + SSE polling |

---

## Authentication: Max Subscription OAuth

### How It Works

Production uses `ANTHROPIC_API_KEY` (pay-per-token). Local uses `CLAUDE_CODE_OAUTH_TOKEN` (Max subscription).

```bash
# Get your OAuth token
claude setup-token

# Set for local WorkerMill
export CLAUDE_CODE_OAUTH_TOKEN=<your-token>
```

### Code Changes Required

**File: `worker/epic/agent-sdk.ts`**

```typescript
// Current (production):
const agentEnv: Record<string, string> = {
  ANTHROPIC_API_KEY: config.anthropicApiKey,
  // ...
};

// Modified (local mode):
const agentEnv: Record<string, string> = {
  // Use OAuth token if available (local Max subscription)
  ...(process.env.CLAUDE_CODE_OAUTH_TOKEN
    ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
    : { ANTHROPIC_API_KEY: config.anthropicApiKey }),
  // ...
};
```

**File: `api/src/services/planning-agent.ts`** and **`critic-agent.ts`**

For AI SDK calls, we need to check if we're in local mode and use OAuth:

```typescript
// The AI SDK doesn't directly support OAuth tokens
// For local mode, we spawn claude CLI instead of using AI SDK

if (process.env.EXECUTION_MODE === 'local') {
  // Use claude CLI with OAuth token
  return runClaudeCliForPlanning(prompt);
} else {
  // Use AI SDK with API key (production)
  return generateText({ model, prompt });
}
```

---

## Phase 1: Local Infrastructure

### 1.1 Docker Compose

**File: `docker-compose.local.yml`**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: workermill-local-db
    environment:
      POSTGRES_USER: workermill
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: workermill
    ports:
      - "5432:5432"
    volumes:
      - workermill-local-data:/var/lib/postgresql/data
      - ./data/dumps:/dumps
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workermill"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  workermill-local-data:
```

### 1.2 Environment Configuration

**File: `.env.local`**

```bash
# =============================================================================
# LOCAL WORKERMILL CONFIGURATION
# =============================================================================

# Database
DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill

# Execution Mode
EXECUTION_MODE=local

# -----------------------------------------------------------------------------
# CLAUDE MAX AUTHENTICATION (Required)
# -----------------------------------------------------------------------------
# Get this by running: claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=<your-oauth-token>

# -----------------------------------------------------------------------------
# LOCAL WORKER SETTINGS
# -----------------------------------------------------------------------------
MAX_LOCAL_WORKERS=8
MAX_PARALLEL_EXPERTS=4
WORKTREE_BASE_PATH=../workermill-workers
WORKTREE_POOL_SIZE=8

# Target repository for workers to operate on
TARGET_REPO_PATH=../oncallshift-api

# -----------------------------------------------------------------------------
# API SETTINGS
# -----------------------------------------------------------------------------
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

# -----------------------------------------------------------------------------
# EPIC MODE SETTINGS
# -----------------------------------------------------------------------------
# Enable planning agent critic review
ENABLE_CRITIC_REVIEW=true
MAX_CRITIC_ITERATIONS=3
AUTO_APPROVAL_THRESHOLD=85

# Tech lead review settings
ENABLE_TECH_LEAD_REVIEW=true
MAX_REVIEW_REVISIONS=3

# Memory system (optional, for enhanced context)
ENABLE_MEMORY_SYSTEM=true
CODEBASE_INDEXING_ENABLED=false

# -----------------------------------------------------------------------------
# SCM TOKENS (for PR creation - sync from prod or configure)
# -----------------------------------------------------------------------------
# GITHUB_TOKEN=<token>
# BITBUCKET_TOKEN=<token>
# GITLAB_TOKEN=<token>
```

---

## Phase 2: Planning Agent (Local Mode)

### 2.1 Planning Agent Local Adapter

The planning agent currently uses AI SDK which requires API keys. For local mode, we need to use Claude CLI.

**New file: `api/src/services/planning-agent-local.ts`**

```typescript
/**
 * Local Planning Agent Adapter
 *
 * Uses Claude CLI with OAuth token instead of AI SDK.
 * Provides same interface as planning-agent.ts but for local execution.
 */

import { spawn } from 'child_process';
import type { ExecutionPlan, PlanningInput } from './planning-agent.js';

export async function runLocalPlanningAgent(
  input: PlanningInput
): Promise<ExecutionPlan> {
  const prompt = buildPlanningPrompt(input);

  return new Promise((resolve, reject) => {
    const claude = spawn('claude', [
      '--print',
      '--output-format', 'text',
      '--model', 'sonnet',
    ], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      },
    });

    let output = '';

    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    // Write prompt to stdin
    claude.stdin.write(prompt);
    claude.stdin.end();

    claude.on('close', (code) => {
      if (code === 0) {
        try {
          const plan = parseExecutionPlan(output);
          resolve(plan);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Planning agent exited with code ${code}`));
      }
    });
  });
}

function buildPlanningPrompt(input: PlanningInput): string {
  // Same prompt as planning-agent.ts PLAN_GENERATION_PROMPT
  return `You are a technical planning agent...`;
}
```

### 2.2 Unified Planning Interface

**Modified: `api/src/services/planning-agent.ts`**

Add local mode dispatch:

```typescript
import { runLocalPlanningAgent } from './planning-agent-local.js';

export async function runPlanningAgent(
  input: PlanningInput,
  config: PlanningAgentConfig
): Promise<ExecutionPlan> {
  // Local mode: use Claude CLI with OAuth
  if (process.env.EXECUTION_MODE === 'local') {
    return runLocalPlanningAgent(input);
  }

  // Production: use AI SDK with API key
  return runAiSdkPlanningAgent(input, config);
}
```

---

## Phase 3: Critic Agent (Tech Lead Review)

### 3.1 Critic Agent Local Adapter

**New file: `api/src/services/critic-agent-local.ts`**

```typescript
/**
 * Local Critic Agent Adapter
 *
 * Reviews execution plans using Claude CLI with OAuth token.
 * Same interface as critic-agent.ts.
 */

import { spawn } from 'child_process';
import type { CriticResult, ExecutionPlanV2 } from './pipeline-v2-types.js';

export async function runLocalCriticAgent(
  plan: ExecutionPlanV2,
  prd: string
): Promise<CriticResult> {
  const prompt = buildCriticPrompt(plan, prd);

  return new Promise((resolve, reject) => {
    const claude = spawn('claude', [
      '--print',
      '--output-format', 'text',
      '--model', 'sonnet',
    ], {
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      },
    });

    let output = '';

    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    claude.stdin.write(prompt);
    claude.stdin.end();

    claude.on('close', (code) => {
      if (code === 0) {
        try {
          const result = parseCriticResult(output);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Critic agent exited with code ${code}`));
      }
    });
  });
}

function buildCriticPrompt(plan: ExecutionPlanV2, prd: string): string {
  return `You are a senior technical reviewer (Tech Lead).

Review this execution plan and score it from 0-100.

## PRD
${prd}

## Execution Plan
${JSON.stringify(plan, null, 2)}

## Scoring Criteria
- Completeness: Does the plan cover all requirements?
- Feasibility: Are the steps realistic and achievable?
- Dependencies: Are dependencies correctly ordered?
- Risk: Are there any security or architectural risks?

## Response Format (JSON)
{
  "score": <0-100>,
  "approved": <true if score >= 85>,
  "risks": ["list of identified risks"],
  "suggestions": ["list of improvement suggestions"],
  "reasoning": "explanation of the score"
}`;
}

function parseCriticResult(output: string): CriticResult {
  // Extract JSON from response
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in critic response');
  return JSON.parse(match[0]);
}
```

### 3.2 Revision Loop

The existing critic agent supports revision loops (max 3 iterations). This works the same locally:

```
┌─────────────────┐
│ Planning Agent  │
│ creates plan    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Critic Agent    │────▶│ Score < 85?     │
│ reviews plan    │     │ AND iterations  │
└────────┬────────┘     │ < 3?            │
         │              └────────┬────────┘
         │                       │ Yes
         │              ┌────────▼────────┐
         │              │ Planning Agent  │
         │◀─────────────│ revises plan    │
         │              └─────────────────┘
         │
         │ No (approved or max iterations)
         ▼
┌─────────────────┐
│ Epic Coordinator│
│ spawns experts  │
└─────────────────┘
```

---

## Phase 4: Local Worker Spawner

### 4.1 Epic Coordinator Spawner

Instead of ECS, spawn the Epic Coordinator as a local process.

**New file: `api/src/services/local-epic-spawner.ts`**

```typescript
/**
 * Local Epic Spawner
 *
 * Spawns Epic Coordinator as a local Node.js process.
 * Replaces ECS task spawning for local development.
 */

import { spawn, ChildProcess } from 'child_process';
import { WorkerTask } from '../models/WorkerTask.js';
import { worktreeManager } from './worktree-manager.js';
import { logger } from '../utils/logger.js';

interface LocalEpicProcess {
  taskId: string;
  process: ChildProcess;
  worktreePath: string;
  startedAt: Date;
}

class LocalEpicSpawner {
  private activeProcesses: Map<string, LocalEpicProcess> = new Map();
  private maxConcurrent: number;

  constructor() {
    this.maxConcurrent = parseInt(process.env.MAX_LOCAL_WORKERS || '4');
  }

  async spawnEpicCoordinator(task: WorkerTask): Promise<void> {
    if (this.activeProcesses.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent tasks (${this.maxConcurrent}) reached`);
    }

    // Acquire main worktree for coordinator
    const worktreePath = await worktreeManager.acquireWorktree(task.id);

    // Build environment for Epic Coordinator
    const epicEnv: Record<string, string> = {
      ...process.env as Record<string, string>,

      // Task context
      TASK_ID: task.id,
      JIRA_ISSUE_KEY: task.jiraIssueKey || '',
      TASK_SUMMARY: task.title || '',

      // API configuration
      API_BASE_URL: 'http://localhost:3001',
      ORG_API_KEY: task.organization?.apiKey || '',

      // OAuth token for Claude CLI
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN!,

      // Target repository
      TARGET_REPO: task.organization?.defaultBitbucketRepo ||
                   task.organization?.defaultGithubRepo || '',

      // Worktree configuration
      WORKTREE_BASE_PATH: process.env.WORKTREE_BASE_PATH || '../workermill-workers',
      MAX_PARALLEL_EXPERTS: process.env.MAX_PARALLEL_EXPERTS || '4',

      // Review settings
      MAX_REVIEW_REVISIONS: process.env.MAX_REVIEW_REVISIONS || '3',
    };

    // Spawn Epic Coordinator
    const proc = spawn('npx', ['tsx', 'worker/epic/index.ts'], {
      cwd: worktreePath,
      env: epicEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Stream output to API logs
    this.streamLogsToApi(proc, task.id);

    // Track process
    this.activeProcesses.set(task.id, {
      taskId: task.id,
      process: proc,
      worktreePath,
      startedAt: new Date(),
    });

    // Handle exit
    proc.on('exit', (code) => this.handleExit(task.id, code));

    logger.info('Spawned local Epic Coordinator', {
      taskId: task.id,
      worktreePath,
      pid: proc.pid,
    });
  }

  private streamLogsToApi(proc: ChildProcess, taskId: string): void {
    const postLog = async (content: string) => {
      try {
        await fetch(`http://localhost:3001/api/tasks/${taskId}/logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.LOCAL_API_KEY || 'local-dev',
          },
          body: JSON.stringify({ content }),
        });
      } catch (e) {
        // Ignore log posting errors
      }
    };

    proc.stdout?.on('data', (data) => {
      const content = data.toString();
      console.log(`[Epic ${taskId}]`, content);
      postLog(content);
    });

    proc.stderr?.on('data', (data) => {
      const content = data.toString();
      console.error(`[Epic ${taskId}]`, content);
      postLog(`[ERROR] ${content}`);
    });
  }

  private async handleExit(taskId: string, code: number | null): Promise<void> {
    const epicProcess = this.activeProcesses.get(taskId);
    if (!epicProcess) return;

    logger.info('Epic Coordinator exited', { taskId, code });

    // Release worktree
    await worktreeManager.releaseWorktree(epicProcess.worktreePath);

    // Remove from active
    this.activeProcesses.delete(taskId);
  }

  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  async stopAll(): Promise<void> {
    for (const [taskId, epicProcess] of this.activeProcesses) {
      epicProcess.process.kill('SIGTERM');
      await worktreeManager.releaseWorktree(epicProcess.worktreePath);
    }
    this.activeProcesses.clear();
  }
}

export const localEpicSpawner = new LocalEpicSpawner();
```

---

## Phase 5: Worktree Manager (Parallel Experts)

### 5.1 Enhanced Worktree Manager

**New file: `api/src/services/worktree-manager.ts`**

```typescript
/**
 * Git Worktree Manager
 *
 * Manages a pool of git worktrees for parallel expert execution.
 * Each expert gets its own isolated worktree.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

interface Worktree {
  path: string;
  branch: string;
  inUse: boolean;
  taskId?: string;
  expertPersona?: string;
  createdAt: Date;
}

class WorktreeManager {
  private worktrees: Map<string, Worktree> = new Map();
  private basePath: string;
  private targetRepoPath: string;
  private poolSize: number;
  private initialized: boolean = false;

  constructor() {
    this.basePath = process.env.WORKTREE_BASE_PATH || '../workermill-workers';
    this.targetRepoPath = process.env.TARGET_REPO_PATH || '.';
    this.poolSize = parseInt(process.env.WORKTREE_POOL_SIZE || '8');
  }

  /**
   * Initialize worktree pool on startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing worktree pool', {
      basePath: this.basePath,
      targetRepo: this.targetRepoPath,
      poolSize: this.poolSize,
    });

    // Ensure base directory exists
    const absoluteBasePath = path.resolve(this.basePath);
    if (!fs.existsSync(absoluteBasePath)) {
      fs.mkdirSync(absoluteBasePath, { recursive: true });
    }

    // Clean up any stale worktrees from previous runs
    await this.pruneStaleWorktrees();

    // Pre-create pool
    for (let i = 0; i < this.poolSize; i++) {
      try {
        await this.createWorktree(`worker-${i}`);
      } catch (e) {
        logger.warn(`Failed to create worktree worker-${i}`, { error: e });
      }
    }

    this.initialized = true;
    logger.info('Worktree pool initialized', {
      count: this.worktrees.size,
    });
  }

  /**
   * Acquire a worktree for a task/expert.
   */
  async acquireWorktree(
    taskId: string,
    expertPersona?: string
  ): Promise<string> {
    await this.initialize();

    // Find available worktree
    for (const [wtPath, wt] of this.worktrees) {
      if (!wt.inUse) {
        // Reset to clean state
        await this.resetWorktree(wtPath);

        // Create task-specific branch
        const branch = `local-${taskId.slice(0, 8)}-${Date.now()}`;
        execSync(`git checkout -b "${branch}"`, {
          cwd: wtPath,
          stdio: 'ignore',
        });

        // Mark as in use
        wt.inUse = true;
        wt.taskId = taskId;
        wt.expertPersona = expertPersona;
        wt.branch = branch;

        logger.info('Acquired worktree', {
          path: wtPath,
          taskId,
          expertPersona,
          branch,
        });

        return wtPath;
      }
    }

    // No available worktree, create a new one
    const name = `worker-${this.worktrees.size}`;
    const wt = await this.createWorktree(name);

    const branch = `local-${taskId.slice(0, 8)}-${Date.now()}`;
    execSync(`git checkout -b "${branch}"`, {
      cwd: wt.path,
      stdio: 'ignore',
    });

    wt.inUse = true;
    wt.taskId = taskId;
    wt.expertPersona = expertPersona;
    wt.branch = branch;

    return wt.path;
  }

  /**
   * Release a worktree back to the pool.
   */
  async releaseWorktree(worktreePath: string): Promise<void> {
    const wt = this.worktrees.get(worktreePath);
    if (!wt) return;

    logger.info('Releasing worktree', {
      path: worktreePath,
      taskId: wt.taskId,
      expertPersona: wt.expertPersona,
    });

    // Reset to clean state
    await this.resetWorktree(worktreePath);

    // Mark as available
    wt.inUse = false;
    wt.taskId = undefined;
    wt.expertPersona = undefined;
  }

  /**
   * Reset worktree to clean state.
   */
  private async resetWorktree(worktreePath: string): Promise<void> {
    try {
      // Discard all changes
      execSync('git checkout -- .', { cwd: worktreePath, stdio: 'ignore' });
      execSync('git clean -fd', { cwd: worktreePath, stdio: 'ignore' });

      // Switch back to main branch
      execSync('git checkout main', { cwd: worktreePath, stdio: 'ignore' });

      // Pull latest
      execSync('git pull --rebase', { cwd: worktreePath, stdio: 'ignore' });
    } catch (e) {
      logger.warn('Failed to reset worktree', { path: worktreePath, error: e });
    }
  }

  /**
   * Create a new worktree.
   */
  private async createWorktree(name: string): Promise<Worktree> {
    const wtPath = path.resolve(this.basePath, name);
    const branch = `local-worker-${name}-init`;

    // Remove if exists (from previous run)
    if (fs.existsSync(wtPath)) {
      try {
        execSync(`git worktree remove "${wtPath}" --force`, {
          cwd: this.targetRepoPath,
          stdio: 'ignore',
        });
      } catch {
        // May fail if not a valid worktree, just remove directory
        fs.rmSync(wtPath, { recursive: true, force: true });
      }
    }

    // Create new worktree
    execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
      cwd: this.targetRepoPath,
    });

    const worktree: Worktree = {
      path: wtPath,
      branch,
      inUse: false,
      createdAt: new Date(),
    };

    this.worktrees.set(wtPath, worktree);
    logger.info('Created worktree', { path: wtPath, branch });

    return worktree;
  }

  /**
   * Prune stale worktrees from previous runs.
   */
  private async pruneStaleWorktrees(): Promise<void> {
    try {
      execSync('git worktree prune', {
        cwd: this.targetRepoPath,
        stdio: 'ignore',
      });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get all worktree paths for a task.
   */
  getWorktreesForTask(taskId: string): string[] {
    return Array.from(this.worktrees.entries())
      .filter(([_, wt]) => wt.taskId === taskId)
      .map(([path]) => path);
  }

  /**
   * Cleanup all worktrees on shutdown.
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up worktrees');

    for (const [wtPath] of this.worktrees) {
      try {
        execSync(`git worktree remove "${wtPath}" --force`, {
          cwd: this.targetRepoPath,
          stdio: 'ignore',
        });
      } catch {
        // Best effort cleanup
      }
    }

    this.worktrees.clear();
  }

  /**
   * Get status of all worktrees.
   */
  getStatus(): { total: number; inUse: number; available: number } {
    const inUse = Array.from(this.worktrees.values()).filter(wt => wt.inUse).length;
    return {
      total: this.worktrees.size,
      inUse,
      available: this.worktrees.size - inUse,
    };
  }
}

export const worktreeManager = new WorktreeManager();
```

---

## Phase 6: Orchestrator Integration

### 6.1 Orchestrator Local Mode

**Modified: `api/src/services/orchestrator.ts`**

```typescript
import { localEpicSpawner } from './local-epic-spawner.js';
import { runLocalPlanningAgent } from './planning-agent-local.js';
import { runLocalCriticAgent } from './critic-agent-local.js';

const EXECUTION_MODE = process.env.EXECUTION_MODE || 'ecs';

/**
 * Main orchestration loop - modified for local mode.
 */
async function processTask(task: WorkerTask): Promise<void> {
  // Step 1: Run Planning Agent
  const plan = EXECUTION_MODE === 'local'
    ? await runLocalPlanningAgent(buildPlanningInput(task))
    : await runAiSdkPlanningAgent(buildPlanningInput(task));

  // Step 2: Run Critic Agent (if enabled)
  if (process.env.ENABLE_CRITIC_REVIEW === 'true') {
    let iterations = 0;
    let currentPlan = plan;

    while (iterations < 3) {
      const review = EXECUTION_MODE === 'local'
        ? await runLocalCriticAgent(currentPlan, task.description)
        : await runAiSdkCriticAgent(currentPlan, task.description);

      if (review.approved || review.score >= 85) {
        break;
      }

      // Request revision
      currentPlan = await revisePlan(currentPlan, review.suggestions);
      iterations++;
    }
  }

  // Step 3: Spawn Epic Coordinator
  if (EXECUTION_MODE === 'local') {
    await localEpicSpawner.spawnEpicCoordinator(task);
  } else {
    await ecsTaskRunner.runTask(task);
  }
}
```

---

## Phase 7: Launcher Script

### 7.1 Enhanced Local WorkerMill Script

**Modified: `bin/local-workermill`**

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[local-workermill]${NC} $1"; }
warn() { echo -e "${YELLOW}[local-workermill]${NC} $1"; }
error() { echo -e "${RED}[local-workermill]${NC} $1"; }
info() { echo -e "${BLUE}[local-workermill]${NC} $1"; }

usage() {
  cat <<EOF
Usage: ./bin/local-workermill <command> [options]

Commands:
  start         Start local WorkerMill
  stop          Stop all services
  status        Show status of services
  sync-data     Sync data from production database
  create-task   Create a test task
  logs          Tail logs from all services
  reset         Reset local database

Options:
  --workers N      Max concurrent Epic Coordinators (default: 4)
  --experts N      Max parallel experts per task (default: 4)
  --skip-db        Don't start PostgreSQL
  --skip-fe        Don't start frontend
  --epic           Enable Epic Mode (planning + critic + multi-expert)
  --no-critic      Disable critic agent review
  --no-tech-lead   Disable tech lead review

Examples:
  ./bin/local-workermill start --epic --workers 2
  ./bin/local-workermill create-task "Fix bug in login"
  ./bin/local-workermill status
EOF
}

check_oauth_token() {
  if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    if [ -f "$PROJECT_ROOT/.env.local" ]; then
      source "$PROJECT_ROOT/.env.local"
    fi
  fi

  if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    error "CLAUDE_CODE_OAUTH_TOKEN not set!"
    echo ""
    echo "Run 'claude setup-token' to get your OAuth token,"
    echo "then add it to .env.local:"
    echo ""
    echo "  CLAUDE_CODE_OAUTH_TOKEN=<your-token>"
    echo ""
    exit 1
  fi

  log "OAuth token configured ✓"
}

start_postgres() {
  log "Starting PostgreSQL..."
  docker compose -f "$PROJECT_ROOT/docker-compose.local.yml" up -d postgres

  log "Waiting for PostgreSQL..."
  until docker exec workermill-local-db pg_isready -U workermill 2>/dev/null; do
    sleep 1
  done
  log "PostgreSQL ready ✓"
}

run_migrations() {
  log "Running migrations..."
  cd "$PROJECT_ROOT/api"
  DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill \
    npm run migrate 2>/dev/null || true
  log "Migrations complete ✓"
}

initialize_worktrees() {
  log "Initializing worktree pool..."

  WORKTREE_BASE="${WORKTREE_BASE_PATH:-../workermill-workers}"
  TARGET_REPO="${TARGET_REPO_PATH:-../oncallshift-api}"

  if [ ! -d "$TARGET_REPO" ]; then
    warn "Target repo not found: $TARGET_REPO"
    warn "Workers will operate on current directory"
    TARGET_REPO="."
  fi

  mkdir -p "$WORKTREE_BASE"

  # Prune stale worktrees
  git -C "$TARGET_REPO" worktree prune 2>/dev/null || true

  # Create pool
  for i in {0..7}; do
    WT_PATH="$WORKTREE_BASE/worker-$i"
    if [ ! -d "$WT_PATH" ]; then
      log "Creating worktree: worker-$i"
      git -C "$TARGET_REPO" worktree add "$WT_PATH" -b "local-worker-$i-init" 2>/dev/null || true
    fi
  done

  log "Worktree pool ready ✓"
}

start_api() {
  log "Starting API server..."
  cd "$PROJECT_ROOT/api"

  # Load env
  set -a
  [ -f "$PROJECT_ROOT/.env.local" ] && source "$PROJECT_ROOT/.env.local"
  set +a

  npm run dev > "$PROJECT_ROOT/.local-workermill/api.log" 2>&1 &
  echo $! > "$PROJECT_ROOT/.local-workermill/api.pid"
  log "API started (PID: $(cat "$PROJECT_ROOT/.local-workermill/api.pid")) ✓"
}

start_frontend() {
  log "Starting frontend..."
  cd "$PROJECT_ROOT/frontend"

  VITE_API_URL=http://localhost:3001 npm run dev > "$PROJECT_ROOT/.local-workermill/frontend.log" 2>&1 &
  echo $! > "$PROJECT_ROOT/.local-workermill/frontend.pid"
  log "Frontend started (PID: $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid")) ✓"
}

cmd_start() {
  mkdir -p "$PROJECT_ROOT/.local-workermill"

  # Defaults
  SKIP_DB=false
  SKIP_FE=false
  MAX_WORKERS=4
  MAX_EXPERTS=4
  ENABLE_EPIC=false
  ENABLE_CRITIC=true
  ENABLE_TECH_LEAD=true

  # Parse options
  while [[ $# -gt 0 ]]; do
    case $1 in
      --skip-db) SKIP_DB=true; shift ;;
      --skip-fe) SKIP_FE=true; shift ;;
      --workers) MAX_WORKERS=$2; shift 2 ;;
      --experts) MAX_EXPERTS=$2; shift 2 ;;
      --epic) ENABLE_EPIC=true; shift ;;
      --no-critic) ENABLE_CRITIC=false; shift ;;
      --no-tech-lead) ENABLE_TECH_LEAD=false; shift ;;
      *) shift ;;
    esac
  done

  # Export settings
  export EXECUTION_MODE=local
  export MAX_LOCAL_WORKERS=$MAX_WORKERS
  export MAX_PARALLEL_EXPERTS=$MAX_EXPERTS
  export ENABLE_CRITIC_REVIEW=$ENABLE_CRITIC
  export ENABLE_TECH_LEAD_REVIEW=$ENABLE_TECH_LEAD

  echo ""
  info "╔══════════════════════════════════════════════════════════════╗"
  info "║              LOCAL WORKERMILL - EPIC MODE                    ║"
  info "╚══════════════════════════════════════════════════════════════╝"
  echo ""

  # Check OAuth token
  check_oauth_token

  # Start services
  [ "$SKIP_DB" = false ] && start_postgres && run_migrations
  initialize_worktrees
  start_api
  sleep 2  # Wait for API to be ready
  [ "$SKIP_FE" = false ] && start_frontend

  echo ""
  log "═══════════════════════════════════════════════════════════════"
  log "  Local WorkerMill is running!"
  log ""
  log "  API:        http://localhost:3001"
  log "  Frontend:   http://localhost:5173"
  log "  Mode:       ${ENABLE_EPIC:+Epic Mode}${ENABLE_EPIC:-Standard}"
  log "  Workers:    $MAX_WORKERS max concurrent"
  log "  Experts:    $MAX_EXPERTS per task"
  log "  Critic:     ${ENABLE_CRITIC}"
  log "  Tech Lead:  ${ENABLE_TECH_LEAD}"
  log ""
  log "  Commands:"
  log "    ./bin/local-workermill create-task 'Your task'"
  log "    ./bin/local-workermill status"
  log "    ./bin/local-workermill logs"
  log "    ./bin/local-workermill stop"
  log "═══════════════════════════════════════════════════════════════"
}

cmd_create_task() {
  TITLE="${1:-Test Task}"
  DESCRIPTION="${2:-This is a test task for local WorkerMill}"

  log "Creating task: $TITLE"

  # Get org API key from database
  API_KEY=$(docker exec workermill-local-db psql -U workermill -d workermill -t -c \
    "SELECT \"apiKey\" FROM organizations LIMIT 1" 2>/dev/null | tr -d ' \n')

  if [ -z "$API_KEY" ]; then
    API_KEY="local-dev-key"
  fi

  curl -s -X POST http://localhost:3001/api/tasks \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "{
      \"title\": \"$TITLE\",
      \"description\": \"$DESCRIPTION\",
      \"persona\": \"backend_developer\",
      \"labels\": [\"workermill\"]
    }" | jq .

  log "Task created! Check http://localhost:5173 to monitor"
}

cmd_status() {
  echo ""
  info "═══════════════════════════════════════════════════════════════"
  info "                 LOCAL WORKERMILL STATUS"
  info "═══════════════════════════════════════════════════════════════"
  echo ""

  # PostgreSQL
  if docker ps 2>/dev/null | grep -q workermill-local-db; then
    echo -e "PostgreSQL:  ${GREEN}● running${NC}"
  else
    echo -e "PostgreSQL:  ${RED}○ stopped${NC}"
  fi

  # API
  if [ -f "$PROJECT_ROOT/.local-workermill/api.pid" ] && \
     kill -0 $(cat "$PROJECT_ROOT/.local-workermill/api.pid") 2>/dev/null; then
    echo -e "API:         ${GREEN}● running${NC} (PID: $(cat "$PROJECT_ROOT/.local-workermill/api.pid"))"
  else
    echo -e "API:         ${RED}○ stopped${NC}"
  fi

  # Frontend
  if [ -f "$PROJECT_ROOT/.local-workermill/frontend.pid" ] && \
     kill -0 $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid") 2>/dev/null; then
    echo -e "Frontend:    ${GREEN}● running${NC} (PID: $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid"))"
  else
    echo -e "Frontend:    ${RED}○ stopped${NC}"
  fi

  # Worktrees
  echo ""
  echo "Worktrees:"
  TARGET_REPO="${TARGET_REPO_PATH:-../oncallshift-api}"
  if [ -d "$TARGET_REPO" ]; then
    git -C "$TARGET_REPO" worktree list 2>/dev/null | head -10
  else
    echo "  (target repo not configured)"
  fi

  echo ""
}

cmd_stop() {
  log "Stopping local WorkerMill..."

  # Stop API
  if [ -f "$PROJECT_ROOT/.local-workermill/api.pid" ]; then
    kill $(cat "$PROJECT_ROOT/.local-workermill/api.pid") 2>/dev/null || true
    rm "$PROJECT_ROOT/.local-workermill/api.pid"
    log "API stopped"
  fi

  # Stop frontend
  if [ -f "$PROJECT_ROOT/.local-workermill/frontend.pid" ]; then
    kill $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid") 2>/dev/null || true
    rm "$PROJECT_ROOT/.local-workermill/frontend.pid"
    log "Frontend stopped"
  fi

  # Stop PostgreSQL
  docker compose -f "$PROJECT_ROOT/docker-compose.local.yml" down 2>/dev/null || true
  log "PostgreSQL stopped"

  log "All services stopped ✓"
}

cmd_logs() {
  tail -f "$PROJECT_ROOT/.local-workermill/api.log" \
          "$PROJECT_ROOT/.local-workermill/frontend.log" 2>/dev/null
}

cmd_sync_data() {
  log "Syncing data from production..."

  # Start bastion
  "$PROJECT_ROOT/bin/bastion" start 2>/dev/null || true
  sleep 5

  mkdir -p "$PROJECT_ROOT/data/dumps"
  DUMP_FILE="$PROJECT_ROOT/data/dumps/prod-$(date +%Y%m%d-%H%M%S).sql"

  warn "Ensure bastion SSH tunnel is active!"
  warn "Run: ./bin/bastion ssh"
  read -p "Press Enter when ready..."

  # Get password from secrets manager
  DB_PASS=$(aws secretsmanager get-secret-value \
    --secret-id workermill/dev/database-url \
    --query 'SecretString' --output text 2>/dev/null | \
    sed 's/.*:\([^@]*\)@.*/\1/')

  log "Dumping production database..."
  PGPASSWORD="$DB_PASS" pg_dump -h localhost -p 5432 -U workermill -d workermill \
    --no-owner --no-acl -f "$DUMP_FILE"

  log "Restoring to local database..."
  docker exec -i workermill-local-db psql -U workermill -d workermill < "$DUMP_FILE"

  log "Data sync complete! ✓"
}

# Main
case "${1:-}" in
  start)       shift; cmd_start "$@" ;;
  stop)        cmd_stop ;;
  status)      cmd_status ;;
  create-task) shift; cmd_create_task "$@" ;;
  logs)        cmd_logs ;;
  sync-data)   cmd_sync_data ;;
  reset)       docker compose -f "$PROJECT_ROOT/docker-compose.local.yml" down -v ;;
  *)           usage ;;
esac
```

---

## File Summary

### New Files

| File | Purpose |
|------|---------|
| `docker-compose.local.yml` | PostgreSQL container |
| `.env.local` | Local environment config |
| `bin/local-workermill` | Main launcher script |
| `api/src/services/local-epic-spawner.ts` | Spawns Epic Coordinator locally |
| `api/src/services/worktree-manager.ts` | Git worktree pool management |
| `api/src/services/planning-agent-local.ts` | Planning Agent with OAuth |
| `api/src/services/critic-agent-local.ts` | Critic Agent with OAuth |

### Modified Files

| File | Changes |
|------|---------|
| `api/src/services/orchestrator.ts` | Add `EXECUTION_MODE` switch |
| `api/src/services/planning-agent.ts` | Dispatch to local adapter |
| `api/src/services/critic-agent.ts` | Dispatch to local adapter |
| `worker/epic/agent-sdk.ts` | Support `CLAUDE_CODE_OAUTH_TOKEN` |
| `.gitignore` | Add `.local-workermill/`, `data/` |

---

## Epic Mode Flow (Local)

```
1. User runs: ./bin/local-workermill create-task "Implement feature X"
   │
   ▼
2. Task created in local PostgreSQL
   │
   ▼
3. Orchestrator claims task
   │
   ▼
4. Planning Agent (Claude CLI + OAuth) analyzes and creates plan
   │
   ▼
5. Critic Agent reviews plan
   │
   ├── Score < 85? → Revision loop (max 3 iterations)
   │
   ▼
6. Epic Coordinator spawned (local Node.js process)
   │
   ▼
7. Stories claimed and assigned to experts
   │
   ├── Expert 1 (worktree-1) → Claude CLI + OAuth
   ├── Expert 2 (worktree-2) → Claude CLI + OAuth
   ├── Expert 3 (worktree-3) → Claude CLI + OAuth
   └── Expert N (worktree-N) → Claude CLI + OAuth
   │
   ▼
8. Experts coordinate via API (file locks, feed messages)
   │
   ▼
9. Tech Lead Review (Claude CLI + OAuth)
   │
   ├── Changes needed? → Revision loop (max 3 iterations)
   │
   ▼
10. Branches merged, PR created
    │
    ▼
11. Task marked complete, results in dashboard
```

---

## Usage

### Quick Start

```bash
# 1. Setup OAuth token
claude setup-token
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" >> .env.local

# 2. Start local WorkerMill with Epic Mode
./bin/local-workermill start --epic

# 3. Create a task
./bin/local-workermill create-task "Add user authentication"

# 4. Monitor in dashboard
open http://localhost:5173
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `--workers N` | 4 | Max concurrent Epic Coordinators |
| `--experts N` | 4 | Max parallel experts per task |
| `--no-critic` | false | Disable critic agent review |
| `--no-tech-lead` | false | Disable tech lead review |

---

## Implementation Order

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Docker Compose + PostgreSQL + data sync | 2 hours |
| 2 | Planning Agent local adapter | 3 hours |
| 3 | Critic Agent local adapter | 2 hours |
| 4 | Local Epic Spawner | 4 hours |
| 5 | Worktree Manager | 3 hours |
| 6 | Orchestrator integration | 2 hours |
| 7 | Launcher script | 2 hours |
| 8 | Integration testing | 4 hours |

**Total estimated effort: 3-4 days**

---

## Comparison: Production vs Local

| Aspect | Production | Local |
|--------|------------|-------|
| Database | RDS PostgreSQL | Docker PostgreSQL |
| Planning Agent | AI SDK + API key | Claude CLI + OAuth |
| Critic Agent | AI SDK + API key | Claude CLI + OAuth |
| Expert Execution | ECS Fargate | Local processes + worktrees |
| Authentication | ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN |
| Log Streaming | SSE | SSE (same) |
| Coordination | API endpoints | API endpoints (same) |
| Cost | Pay-per-token | Max subscription |
