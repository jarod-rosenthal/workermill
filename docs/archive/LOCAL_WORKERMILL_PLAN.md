# Local WorkerMill Implementation Plan

This document outlines the implementation plan for running WorkerMill locally with full production parity, enabling 8+ Claude Code agents to work on the same codebase simultaneously.

## Goals

1. **Full parity with production** - Same API, same coordination, same log streaming
2. **Local PostgreSQL** - Mirror of prod data for realistic testing
3. **Local worker execution** - Claude Code processes instead of ECS Fargate
4. **Minimal code changes** - Reuse existing WorkerMill code wherever possible
5. **Single-command startup** - `./bin/local-workermill start`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Local WorkerMill                             │
├─────────────────────────────┬───────────────────────────────────────┤
│  Frontend (localhost:5173)  │  API (localhost:3001)                  │
│  - Same React dashboard     │  - Same Express routes                 │
│  - Same SSE log streaming   │  - Local PostgreSQL (Docker)           │
│  - Same task management     │  - EXECUTION_MODE=local                │
└─────────────────────────────┴───────────────────────────────────────┘
                                           │
                                           ▼
                               ┌───────────────────────┐
                               │  Orchestrator Service  │
                               │  (same code, local    │
                               │   spawner injected)   │
                               └───────────────────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
             ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
             │ Worktree 1  │       │ Worktree 2  │       │ Worktree 3  │
             │ task-uuid-1 │       │ task-uuid-2 │       │ task-uuid-3 │
             ├─────────────┤       ├─────────────┤       ├─────────────┤
             │ Claude Code │       │ Claude Code │       │ Claude Code │
             │ (subprocess)│       │ (subprocess)│       │ (subprocess)│
             └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
                    │                     │                     │
                    └─────────────────────┴─────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │ POST /api/tasks/:id/   │
                              │ logs (same as ECS)     │
                              └────────────────────────┘
```

---

## Phase 1: Local PostgreSQL Setup

### 1.1 Docker Compose Configuration

**New file: `docker-compose.local.yml`**

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
      - ./data/dumps:/dumps  # For importing prod data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workermill"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  workermill-local-data:
```

### 1.2 Local Environment File

**New file: `.env.local`**

```bash
# Database
DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill

# Execution mode
EXECUTION_MODE=local

# Local worker settings
MAX_LOCAL_WORKERS=4
WORKTREE_BASE_PATH=../workermill-workers
TARGET_REPO_PATH=../oncallshift-api  # Or configurable

# API settings
PORT=3001
NODE_ENV=development

# Reuse prod secrets for integrations (optional)
# These can be copied from prod or use test values
ANTHROPIC_API_KEY=<your-key>
```

### 1.3 Data Migration from Production

**New script: `bin/sync-prod-data`**

```bash
#!/bin/bash
set -e

# This script:
# 1. Connects to prod RDS via bastion
# 2. Dumps the database
# 3. Restores to local PostgreSQL

DUMP_FILE="data/dumps/prod-$(date +%Y%m%d-%H%M%S).sql"

echo "Starting bastion if not running..."
./bin/bastion start 2>/dev/null || true
sleep 5

echo "Dumping production database..."
# SSH tunnel must be active
pg_dump -h localhost -p 5432 -U workermill -d workermill \
  --no-owner --no-acl \
  -f "$DUMP_FILE"

echo "Restoring to local database..."
docker exec -i workermill-local-db psql -U workermill -d workermill < "$DUMP_FILE"

echo "Data sync complete: $DUMP_FILE"
```

**Optional: Data sanitization script for sensitive fields**

```bash
# bin/sanitize-local-data
docker exec workermill-local-db psql -U workermill -d workermill <<EOF
-- Sanitize API keys (keep format, change values)
UPDATE organizations SET "apiKey" = 'local-' || id::text || '-test';

-- Optionally clear sensitive tokens
UPDATE organizations SET
  "githubToken" = NULL,
  "gitlabToken" = NULL,
  "bitbucketToken" = NULL
WHERE id != <your-test-org-id>;
EOF
```

---

## Phase 2: Local Worker Spawner

### 2.1 New Service: LocalWorkerSpawner

**New file: `api/src/services/local-worker-spawner.ts`**

This service replaces ECS task spawning with local Claude Code process spawning.

```typescript
// Pseudocode structure - actual implementation will follow

import { spawn, ChildProcess } from 'child_process';
import { WorkerTask } from '../models/WorkerTask';
import { worktreeManager } from './worktree-manager';

interface LocalWorker {
  taskId: string;
  process: ChildProcess;
  worktreePath: string;
  startedAt: Date;
}

class LocalWorkerSpawner {
  private activeWorkers: Map<string, LocalWorker> = new Map();
  private maxWorkers: number;

  constructor() {
    this.maxWorkers = parseInt(process.env.MAX_LOCAL_WORKERS || '4');
  }

  async spawnWorker(task: WorkerTask): Promise<void> {
    if (this.activeWorkers.size >= this.maxWorkers) {
      throw new Error(`Max workers (${this.maxWorkers}) reached`);
    }

    // 1. Create or claim worktree
    const worktreePath = await worktreeManager.acquireWorktree(task.id);

    // 2. Write task context to worktree
    await this.writeTaskContext(worktreePath, task);

    // 3. Spawn Claude Code process
    const proc = spawn('claude', [
      '-p',
      `Execute the task defined in .workermill/task.json. Post logs to the API.`
    ], {
      cwd: worktreePath,
      env: {
        ...process.env,
        TASK_ID: task.id,
        WORKERMILL_API: 'http://localhost:3001',
        WORKERMILL_API_KEY: task.organization.apiKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 4. Stream output to API (same as ECS workers)
    this.streamOutputToApi(proc, task.id);

    // 5. Track active worker
    this.activeWorkers.set(task.id, {
      taskId: task.id,
      process: proc,
      worktreePath,
      startedAt: new Date(),
    });

    // 6. Handle completion
    proc.on('exit', (code) => this.handleWorkerExit(task.id, code));
  }

  private async writeTaskContext(worktreePath: string, task: WorkerTask): Promise<void> {
    // Write .workermill/task.json with task details
    // Similar to what ECS containers receive via environment
  }

  private streamOutputToApi(proc: ChildProcess, taskId: string): void {
    // Pipe stdout/stderr to POST /api/tasks/:taskId/logs
    // Same protocol as worker/entrypoint.sh post_log()
  }

  private async handleWorkerExit(taskId: string, code: number): Promise<void> {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return;

    // 1. Release worktree back to pool
    await worktreeManager.releaseWorktree(worker.worktreePath);

    // 2. Update task status based on exit code
    // 3. Remove from active workers
    this.activeWorkers.delete(taskId);
  }

  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  async stopWorker(taskId: string): Promise<void> {
    const worker = this.activeWorkers.get(taskId);
    if (worker) {
      worker.process.kill('SIGTERM');
    }
  }
}

export const localWorkerSpawner = new LocalWorkerSpawner();
```

### 2.2 Worktree Manager

**New file: `api/src/services/worktree-manager.ts`**

Manages a pool of git worktrees for fast worker startup.

```typescript
// Pseudocode structure

import { execSync, exec } from 'child_process';
import path from 'path';

interface Worktree {
  path: string;
  branch: string;
  inUse: boolean;
  taskId?: string;
}

class WorktreeManager {
  private worktrees: Map<string, Worktree> = new Map();
  private basePath: string;
  private targetRepoPath: string;
  private poolSize: number;

  constructor() {
    this.basePath = process.env.WORKTREE_BASE_PATH || '../workermill-workers';
    this.targetRepoPath = process.env.TARGET_REPO_PATH || '.';
    this.poolSize = parseInt(process.env.WORKTREE_POOL_SIZE || '8');
  }

  async initialize(): Promise<void> {
    // Pre-create pool of worktrees on startup
    for (let i = 0; i < this.poolSize; i++) {
      await this.createWorktree(`worker-${i}`);
    }
  }

  async acquireWorktree(taskId: string): Promise<string> {
    // Find an available worktree or create new one
    // Mark as in-use
    // Create fresh branch for this task
    // Return path
  }

  async releaseWorktree(worktreePath: string): Promise<void> {
    // Reset worktree to clean state
    // Mark as available
    // Delete task-specific branch
  }

  private async createWorktree(name: string): Promise<Worktree> {
    const wtPath = path.join(this.basePath, name);
    const branch = `local-worker-${name}-${Date.now()}`;

    // git worktree add <path> -b <branch>
    execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
      cwd: this.targetRepoPath,
    });

    const worktree: Worktree = {
      path: wtPath,
      branch,
      inUse: false,
    };

    this.worktrees.set(wtPath, worktree);
    return worktree;
  }

  async cleanup(): Promise<void> {
    // Remove all worktrees on shutdown
    for (const [wtPath] of this.worktrees) {
      execSync(`git worktree remove "${wtPath}" --force`, {
        cwd: this.targetRepoPath,
      });
    }
  }
}

export const worktreeManager = new WorktreeManager();
```

---

## Phase 3: Orchestrator Local Mode

### 3.1 Modify Orchestrator Service

**File: `api/src/services/orchestrator.ts`**

Minimal changes to support local execution mode.

```typescript
// Add at top of file
import { localWorkerSpawner } from './local-worker-spawner';
import { ecsTaskRunner } from './ecs-task-runner';

const EXECUTION_MODE = process.env.EXECUTION_MODE || 'ecs';

// Modify the task spawning logic
async function spawnWorkerForTask(task: WorkerTask): Promise<void> {
  if (EXECUTION_MODE === 'local') {
    await localWorkerSpawner.spawnWorker(task);
  } else {
    await ecsTaskRunner.runTask(task);
  }
}

// Modify concurrency check
function canSpawnMoreWorkers(): boolean {
  if (EXECUTION_MODE === 'local') {
    const maxLocal = parseInt(process.env.MAX_LOCAL_WORKERS || '4');
    return localWorkerSpawner.getActiveWorkerCount() < maxLocal;
  } else {
    // Existing ECS logic
    return getRunningTaskCount() < MAX_CONCURRENT_TASKS;
  }
}
```

### 3.2 Graceful Shutdown

Ensure local workers are properly terminated on API shutdown.

```typescript
// api/src/index.ts - add shutdown handler

import { worktreeManager } from './services/worktree-manager';
import { localWorkerSpawner } from './services/local-worker-spawner';

process.on('SIGTERM', async () => {
  console.log('Shutting down local WorkerMill...');

  if (process.env.EXECUTION_MODE === 'local') {
    // Stop all active workers
    for (const taskId of localWorkerSpawner.getActiveTaskIds()) {
      await localWorkerSpawner.stopWorker(taskId);
    }

    // Cleanup worktrees
    await worktreeManager.cleanup();
  }

  process.exit(0);
});
```

---

## Phase 4: Local Startup Script

### 4.1 Main Launcher

**New file: `bin/local-workermill`**

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[local-workermill]${NC} $1"; }
warn() { echo -e "${YELLOW}[local-workermill]${NC} $1"; }
error() { echo -e "${RED}[local-workermill]${NC} $1"; }

usage() {
  cat <<EOF
Usage: ./bin/local-workermill <command>

Commands:
  start       Start local WorkerMill (PostgreSQL, API, Frontend)
  stop        Stop all services
  status      Show status of services
  sync-data   Sync data from production database
  logs        Tail logs from all services
  reset       Reset local database to empty state

Options:
  --workers N   Set max concurrent workers (default: 4)
  --skip-db     Don't start PostgreSQL (use existing)
  --skip-fe     Don't start frontend dev server
EOF
}

start_postgres() {
  log "Starting PostgreSQL..."
  docker-compose -f "$PROJECT_ROOT/docker-compose.local.yml" up -d postgres

  log "Waiting for PostgreSQL to be ready..."
  until docker exec workermill-local-db pg_isready -U workermill; do
    sleep 1
  done
  log "PostgreSQL is ready"
}

run_migrations() {
  log "Running database migrations..."
  cd "$PROJECT_ROOT/api"
  DATABASE_URL=postgresql://workermill:localdev@localhost:5432/workermill \
    npm run migrate
}

start_api() {
  log "Starting API server..."
  cd "$PROJECT_ROOT/api"

  # Load local env and start
  set -a
  source "$PROJECT_ROOT/.env.local"
  set +a

  npm run dev &
  API_PID=$!
  echo $API_PID > "$PROJECT_ROOT/.local-workermill/api.pid"
  log "API started (PID: $API_PID)"
}

start_frontend() {
  log "Starting frontend dev server..."
  cd "$PROJECT_ROOT/frontend"

  VITE_API_URL=http://localhost:3001 npm run dev &
  FE_PID=$!
  echo $FE_PID > "$PROJECT_ROOT/.local-workermill/frontend.pid"
  log "Frontend started (PID: $FE_PID)"
}

initialize_worktrees() {
  log "Initializing worktree pool..."
  WORKTREE_BASE="${WORKTREE_BASE_PATH:-../workermill-workers}"
  TARGET_REPO="${TARGET_REPO_PATH:-.}"

  mkdir -p "$WORKTREE_BASE"

  # Create pool of worktrees
  for i in {0..7}; do
    WT_PATH="$WORKTREE_BASE/worker-$i"
    if [ ! -d "$WT_PATH" ]; then
      log "Creating worktree: worker-$i"
      git -C "$TARGET_REPO" worktree add "$WT_PATH" -b "local-worker-$i-init" 2>/dev/null || true
    fi
  done

  log "Worktree pool ready"
}

cmd_start() {
  mkdir -p "$PROJECT_ROOT/.local-workermill"

  # Parse options
  SKIP_DB=false
  SKIP_FE=false
  MAX_WORKERS=4

  while [[ $# -gt 0 ]]; do
    case $1 in
      --skip-db) SKIP_DB=true; shift ;;
      --skip-fe) SKIP_FE=true; shift ;;
      --workers) MAX_WORKERS=$2; shift 2 ;;
      *) shift ;;
    esac
  done

  export MAX_LOCAL_WORKERS=$MAX_WORKERS

  if [ "$SKIP_DB" = false ]; then
    start_postgres
    run_migrations
  fi

  initialize_worktrees
  start_api

  if [ "$SKIP_FE" = false ]; then
    start_frontend
  fi

  log "Local WorkerMill is running!"
  log "  API:      http://localhost:3001"
  log "  Frontend: http://localhost:5173"
  log "  Workers:  $MAX_WORKERS max concurrent"
  log ""
  log "Use './bin/local-workermill logs' to tail logs"
  log "Use './bin/local-workermill stop' to shut down"
}

cmd_stop() {
  log "Stopping local WorkerMill..."

  # Stop API
  if [ -f "$PROJECT_ROOT/.local-workermill/api.pid" ]; then
    kill $(cat "$PROJECT_ROOT/.local-workermill/api.pid") 2>/dev/null || true
    rm "$PROJECT_ROOT/.local-workermill/api.pid"
  fi

  # Stop frontend
  if [ -f "$PROJECT_ROOT/.local-workermill/frontend.pid" ]; then
    kill $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid") 2>/dev/null || true
    rm "$PROJECT_ROOT/.local-workermill/frontend.pid"
  fi

  # Stop PostgreSQL
  docker-compose -f "$PROJECT_ROOT/docker-compose.local.yml" down

  log "Stopped"
}

cmd_status() {
  echo "=== Local WorkerMill Status ==="

  # PostgreSQL
  if docker ps | grep -q workermill-local-db; then
    echo -e "PostgreSQL: ${GREEN}running${NC}"
  else
    echo -e "PostgreSQL: ${RED}stopped${NC}"
  fi

  # API
  if [ -f "$PROJECT_ROOT/.local-workermill/api.pid" ] && kill -0 $(cat "$PROJECT_ROOT/.local-workermill/api.pid") 2>/dev/null; then
    echo -e "API:        ${GREEN}running${NC} (PID: $(cat "$PROJECT_ROOT/.local-workermill/api.pid"))"
  else
    echo -e "API:        ${RED}stopped${NC}"
  fi

  # Frontend
  if [ -f "$PROJECT_ROOT/.local-workermill/frontend.pid" ] && kill -0 $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid") 2>/dev/null; then
    echo -e "Frontend:   ${GREEN}running${NC} (PID: $(cat "$PROJECT_ROOT/.local-workermill/frontend.pid"))"
  else
    echo -e "Frontend:   ${RED}stopped${NC}"
  fi

  # Worktrees
  echo ""
  echo "=== Worktrees ==="
  git worktree list 2>/dev/null || echo "No worktrees"
}

cmd_sync_data() {
  log "Syncing data from production..."

  # Ensure bastion is running
  "$PROJECT_ROOT/bin/bastion" start || true
  sleep 5

  # Create dumps directory
  mkdir -p "$PROJECT_ROOT/data/dumps"

  DUMP_FILE="$PROJECT_ROOT/data/dumps/prod-$(date +%Y%m%d-%H%M%S).sql"

  log "This requires the bastion SSH tunnel to be active."
  log "Run './bin/bastion ssh' in another terminal if not already running."
  read -p "Press Enter when tunnel is ready..."

  log "Dumping production database..."
  PGPASSWORD=$(aws secretsmanager get-secret-value \
    --secret-id workermill/dev/database-url \
    --query 'SecretString' --output text | \
    sed 's/.*:\([^@]*\)@.*/\1/') \
  pg_dump -h localhost -p 5432 -U workermill -d workermill \
    --no-owner --no-acl \
    -f "$DUMP_FILE"

  log "Restoring to local database..."
  docker exec -i workermill-local-db psql -U workermill -d workermill < "$DUMP_FILE"

  log "Data sync complete!"
}

cmd_reset() {
  warn "This will delete all local data. Continue? [y/N]"
  read -r response
  if [[ "$response" =~ ^[Yy]$ ]]; then
    docker-compose -f "$PROJECT_ROOT/docker-compose.local.yml" down -v
    rm -rf "$PROJECT_ROOT/.local-workermill"
    log "Reset complete"
  fi
}

# Main
case "${1:-}" in
  start)  shift; cmd_start "$@" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  sync-data) cmd_sync_data ;;
  reset)  cmd_reset ;;
  logs)   docker-compose -f "$PROJECT_ROOT/docker-compose.local.yml" logs -f ;;
  *)      usage ;;
esac
```

---

## Phase 5: Worker Execution Parity

### 5.1 Reuse Existing Worker Components

The following existing components will be reused as-is:

| Component | Path | Usage |
|-----------|------|-------|
| Worker directives | `worker/directives/` | Loaded into Claude Code context |
| Execution scripts | `worker/execution-compiled/` | Called by Claude Code |
| Coordination client | `worker/epic/coordination-client.ts` | API calls for locks/feed |
| Git operations | `worker/epic/git-ops.ts` | Branch/PR creation |
| AGENTS.md | `worker/AGENTS.md` | Worker instructions |

### 5.2 Task Context File

Each worker receives context via `.workermill/task.json`:

```json
{
  "taskId": "uuid",
  "title": "Implement feature X",
  "description": "Full description from Jira/Linear",
  "ticketUrl": "https://jira.example.com/browse/OCS-123",
  "persona": "backend_developer",
  "organization": {
    "id": "org-uuid",
    "scmProvider": "bitbucket",
    "defaultRepo": "oncallshift/oncallshift-api"
  },
  "labels": ["workermill"],
  "api": {
    "baseUrl": "http://localhost:3001",
    "key": "local-xxx-test"
  }
}
```

### 5.3 Local Worker Entrypoint

**New file: `worker/local-entrypoint.sh`**

Simplified version of `worker/entrypoint.sh` for local execution:

```bash
#!/bin/bash

# Local worker entrypoint
# Runs inside the worktree, spawns Claude Code

TASK_FILE=".workermill/task.json"
API_BASE="${WORKERMILL_API:-http://localhost:3001}"
TASK_ID="${TASK_ID:-$(jq -r '.taskId' "$TASK_FILE")}"
API_KEY="${WORKERMILL_API_KEY:-$(jq -r '.api.key' "$TASK_FILE")}"

# Log posting function (same as production)
post_log() {
  local content="$1"
  curl -s -X POST "$API_BASE/api/tasks/$TASK_ID/logs" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "{\"content\": $(echo "$content" | jq -Rs .)}" \
    > /dev/null
}

post_log "=== Local Worker Started ==="
post_log "Task: $TASK_ID"
post_log "Worktree: $(pwd)"

# Load directives based on persona
PERSONA=$(jq -r '.persona' "$TASK_FILE")
DIRECTIVES_PATH="$(dirname "$0")/../directives/$PERSONA"

# Run Claude Code with task context
claude -p "
You are a WorkerMill AI worker executing task $TASK_ID.

Read the task details from .workermill/task.json and execute the work.

Your directives are in: $DIRECTIVES_PATH

Post progress using the execution scripts in /app/execution-compiled/

When complete, output ::result::completed or ::result::failed
"

EXIT_CODE=$?
post_log "=== Worker Exited (code: $EXIT_CODE) ==="
exit $EXIT_CODE
```

---

## Phase 6: Integration & Testing

### 6.1 Integration Test

Create a test task locally and verify the full flow:

```bash
# 1. Start local WorkerMill
./bin/local-workermill start

# 2. Create a test task via API
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-xxx-test" \
  -d '{
    "title": "Test local execution",
    "description": "Create a test file to verify local worker execution",
    "persona": "backend_developer"
  }'

# 3. Watch task get claimed and executed
# Open http://localhost:5173 and monitor the task

# 4. Verify worktree was used and cleaned up
git worktree list
```

### 6.2 Multi-Worker Test

Test concurrent worker execution:

```bash
# Create multiple tasks rapidly
for i in {1..4}; do
  curl -X POST http://localhost:3001/api/tasks \
    -H "Content-Type: application/json" \
    -H "X-API-Key: local-xxx-test" \
    -d "{\"title\": \"Concurrent test $i\", \"description\": \"Test worker $i\"}"
done

# All 4 should be claimed and executed in parallel
```

---

## File Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `docker-compose.local.yml` | PostgreSQL container config |
| `.env.local` | Local environment variables |
| `bin/local-workermill` | Main launcher script |
| `bin/sync-prod-data` | Production data migration |
| `api/src/services/local-worker-spawner.ts` | Local Claude Code spawner |
| `api/src/services/worktree-manager.ts` | Git worktree pool manager |
| `worker/local-entrypoint.sh` | Local worker startup script |

### Files to Modify

| File | Changes |
|------|---------|
| `api/src/services/orchestrator.ts` | Add EXECUTION_MODE switch |
| `api/src/index.ts` | Add graceful shutdown for local mode |
| `.gitignore` | Add `.local-workermill/`, `data/dumps/` |

---

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `ecs` | `local` or `ecs` |
| `MAX_LOCAL_WORKERS` | `4` | Max concurrent Claude Code processes |
| `WORKTREE_BASE_PATH` | `../workermill-workers` | Where to create worktrees |
| `TARGET_REPO_PATH` | `.` | Repository for workers to operate on |
| `WORKTREE_POOL_SIZE` | `8` | Pre-created worktree count |

---

## Usage

### Daily Development Workflow

```bash
# Morning: Start local stack
./bin/local-workermill start

# Work: Create tasks, monitor dashboard
# http://localhost:5173

# Evening: Stop
./bin/local-workermill stop
```

### Sync Fresh Data from Prod

```bash
./bin/local-workermill sync-data
```

### Scale Workers Up/Down

```bash
# Start with more workers
./bin/local-workermill start --workers 8
```

---

## Future Enhancements

1. **Hot reload for directives** - Watch `worker/directives/` and reload on change
2. **Worker resource limits** - CPU/memory limits per Claude Code process
3. **Distributed mode** - Run workers on multiple machines
4. **Task prioritization** - Priority queue for urgent tasks
5. **Worker specialization** - Route tasks to workers with specific capabilities

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Local data diverges from prod | Regular `sync-data` runs |
| Workers exhaust system resources | `MAX_LOCAL_WORKERS` limit |
| Worktree conflicts | Pool manager handles cleanup |
| Stale worktrees accumulate | Cleanup on shutdown + manual prune |
| API key exposure in local mode | Use dedicated local API keys |

---

## Implementation Order

1. **Phase 1** (Day 1): Docker Compose + local PostgreSQL + data sync
2. **Phase 2** (Day 1-2): LocalWorkerSpawner + WorktreeManager
3. **Phase 3** (Day 2): Orchestrator local mode switch
4. **Phase 4** (Day 2): Launcher script
5. **Phase 5** (Day 3): Worker execution parity
6. **Phase 6** (Day 3): Integration testing

**Estimated total effort:** 2-3 days for full implementation

---

## Appendix: Comparison with Production

| Aspect | Production | Local |
|--------|------------|-------|
| Database | RDS PostgreSQL | Docker PostgreSQL |
| Workers | ECS Fargate containers | Claude Code processes |
| Worker isolation | Container per task | Worktree per task |
| Log streaming | SSE via API | SSE via API (same) |
| Coordination | API endpoints | API endpoints (same) |
| Git operations | Clone per container | Worktree per worker |
| Concurrency | ECS task limits | MAX_LOCAL_WORKERS |
| Cost | ECS Fargate pricing | Claude Code Max subscription |
