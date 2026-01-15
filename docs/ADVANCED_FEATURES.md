# WorkerMill Advanced Features

This document provides comprehensive technical documentation for WorkerMill's advanced orchestration capabilities: Ralph Execution Engine, Worker Checkpointing, Multi-Worker Coordination, and Multi-Provider AI Support.

---

## Table of Contents

1. [Ralph Execution Engine](#1-ralph-execution-engine)
2. [Worker Checkpointing](#2-worker-checkpointing)
3. [Multi-Worker Coordination](#3-multi-worker-coordination)
4. [Multi-Provider AI Support](#4-multi-provider-ai-support)
5. [Appendix](#appendix)

---

## 1. Ralph Execution Engine

### 1.1 Overview

Ralph is an advanced PRD-to-code execution engine that transforms complex Jira tickets into structured implementation workflows. Instead of executing a single Claude Code session, Ralph breaks down requirements into discrete "stories" (sub-tasks) and orchestrates their sequential execution with progress tracking.

**Use Cases:**
- Large features spanning multiple files
- Tasks requiring careful planning before implementation
- Complex refactoring with multiple interdependent changes
- Features with detailed acceptance criteria

**Key Benefits:**
- Structured approach to complex tasks
- Granular progress visibility
- Partial completion handling (escalation vs failure)
- Resume capability after interruptions

### 1.2 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Ralph Execution Flow                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Jira Ticket                                                         │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────┐                                                 │
│  │  jira-to-prd.ts │  Phase 1: Convert ticket to PRD                │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │   .ralph/prd.md │  Product Requirements Document                 │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │  ralph plan     │  Phase 2: Plan stories from PRD                │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │ progress.json   │  Story list with execution state               │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐     ┌──────────────────┐                       │
│  │  ralph loop     │────▶│  Claude Code     │  Phase 3: Execute     │
│  │  (orchestrator) │◀────│  (per story)     │  each story           │
│  └────────┬────────┘     └──────────────────┘                       │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │  Result Mapping │  Phase 4: Map outcome to WorkerMill status     │
│  └─────────────────┘                                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Workflow Phases

#### Phase 1: PRD Generation

**Input:** Jira ticket fields (summary, description, acceptance criteria)

**Process:** The `jira-to-prd.ts` script parses Gherkin-format acceptance criteria:

```gherkin
Scenario: User Login
Given the user is on the login page
When the user enters valid credentials
Then the user is authenticated
And the user is redirected to dashboard
```

**Output:** `.ralph/prd.md` (structured PRD) + `.ralph/ticket.json` (metadata)

#### Phase 2: Configuration & Planning

**Configuration Template:** `config.template.json`
```json
{
  "agent": {
    "command": "claude --model ${CLAUDE_MODEL} --output-format stream-json"
  },
  "planning": {
    "maxStories": "${RALPH_MAX_STORIES}",
    "model": "${CLAUDE_MODEL}"
  },
  "execution": {
    "timeout": 600,
    "retryAttempts": "${RALPH_RETRIES}"
  }
}
```

**Planning Output:** `ralph plan` generates `progress.json`:
```json
{
  "stories": [
    { "id": "story-001", "title": "Implement auth endpoint", "status": "pending" },
    { "id": "story-002", "title": "Add login form component", "status": "pending" }
  ],
  "totalStories": 2,
  "completedStories": 0,
  "status": "planning"
}
```

#### Phase 3: Story Execution

The `ralph loop` command iterates through each story:

1. Updates `currentStory` in progress.json
2. Invokes Claude Code with story context
3. Claude implements the story
4. Updates `completedStories` count
5. Proceeds to next story or completes

**Background Monitoring:**
- Activity log streaming (`.ralph/activity.log`)
- Progress polling every 5 seconds
- Real-time marker emission for dashboard

#### Phase 4: Result Determination

| Ralph Status | Completed | Total | WorkerMill Result |
|--------------|-----------|-------|-------------------|
| `completed` | N | N | `deployed` |
| `partial` | X | N (X < N) | `escalated` |
| `failed` | 0 | N | `failed` |
| Any | X | N (X > 0, X < N) | `escalated` |

### 1.4 Configuration

#### Organization Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `useRalphExecution` | boolean | `false` | Enable Ralph mode for all tasks |
| `ralphMaxStories` | integer | `10` | Maximum stories per PRD (1-50) |

Configure via Settings page or API:
```bash
PUT /api/settings
{
  "useRalphExecution": true,
  "ralphMaxStories": 15
}
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_RALPH` | `false` | Enable Ralph execution mode |
| `RALPH_MAX_STORIES` | `10` | Max stories to plan |
| `RALPH_RETRIES` | `3` | Retry attempts per story |
| `REPO_PATH` | `/workspace/repo` | Working directory |

### 1.5 Progress Tracking & Markers

Ralph emits structured markers for real-time dashboard updates:

#### Progress Markers

```
::ralph_progress::<current>/<total>::<description>
```
- `current`: Current story number (1-indexed)
- `total`: Total stories planned
- `description`: Human-readable story title

Example: `::ralph_progress::2/5::Implement user authentication`

#### Completion Markers

```
::ralph_stories_completed::<count>
::ralph_status::<status>
::ralph_plan_complete::<story_count>
```

#### Final Result Markers

```
::pr_url::<github_pr_url>
::pr_number::<pr_number>
::result::<deployed|escalated|failed>
```

### 1.6 Error Handling

**Story-Level Failures:**
- Each story has up to 3 retry attempts (configurable)
- Failed stories are logged with error details
- Execution continues to next story

**Task-Level Failures:**
- If all stories fail: `::result::failed`
- If some stories succeed: `::result::escalated`
- Activity log scanned for error keywords as fallback detection

**Escalation Triggers:**
- Partial completion (some stories failed)
- Error patterns detected in activity log
- Ralph status indicates incomplete execution

### 1.7 Dashboard Integration

The dashboard displays Ralph progress via the `RalphProgress` component:

**Full View (Task Details):**
- Progress bar with percentage
- Story counter: "Story 2/5"
- Current story description
- Status badge (planning/executing/completed/failed)

**Compact View (Task List):**
- Inline progress indicator: "2/5 (40%)"
- Color-coded status icon

**SSE Events:**
```json
{
  "event": "ralph_progress",
  "data": {
    "currentStory": 2,
    "totalStories": 5,
    "currentStoryDescription": "Implement user authentication",
    "timestamp": "2025-01-15T02:30:00Z"
  }
}
```

---

## 2. Worker Checkpointing

### 2.1 Overview

Worker Checkpointing enables task resumption after interruptions by persisting execution state to S3. This is critical for AWS Fargate Spot instances, which can be reclaimed with 2-minute notice.

**Capabilities:**
- Automatic state persistence every 60 seconds
- SIGTERM handling for graceful checkpoint on Spot reclaim
- Resume from last checkpoint on task retry
- Skip completed work phases

### 2.2 State Schema

```json
{
  "taskId": "uuid",
  "version": 1,
  "createdAt": "2025-01-15T02:00:00Z",
  "updatedAt": "2025-01-15T02:15:00Z",

  "stage": "implementing",

  "repoCloned": true,
  "branch": "ai/OCS-123",
  "commits": ["abc123", "def456"],

  "filesAnalyzed": ["src/api.ts", "src/main.ts"],
  "filesModified": ["src/api.ts"],

  "testsRun": true,
  "testsPassed": true,

  "lastAction": "Tests passed, creating PR",
  "pendingWork": null,
  "resumeCount": 0
}
```

#### Stage Values

| Stage | Description |
|-------|-------------|
| `initialized` | Checkpoint created, not started |
| `cloning` | Repository clone in progress |
| `analyzing` | Analyzing codebase |
| `implementing` | Making code changes |
| `testing` | Running tests |
| `committing` | Creating git commits |
| `pr_creating` | Creating pull request |
| `interrupted` | Spot reclaim detected |

### 2.3 Checkpoint Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Checkpoint Lifecycle                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Worker Start                                                        │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────┐     ┌──────────────────┐                       │
│  │ checkpoint_init │────▶│ checkpoint_load  │  Try load from S3     │
│  └────────┬────────┘     └────────┬─────────┘                       │
│           │                       │                                  │
│           │    ┌──────────────────┴──────────────────┐              │
│           │    │                                      │              │
│           ▼    ▼                                      ▼              │
│      [Fresh Start]                            [Resume Mode]          │
│           │                                          │               │
│           └──────────────┬───────────────────────────┘              │
│                          │                                           │
│                          ▼                                           │
│  ┌───────────────────────────────────────────────────────┐          │
│  │              Background Sync Loop                      │          │
│  │         (checkpoint_save every 60 seconds)             │          │
│  └───────────────────────────────────────────────────────┘          │
│                          │                                           │
│           ┌──────────────┼──────────────┐                           │
│           │              │              │                            │
│           ▼              ▼              ▼                            │
│      [Clone Repo]   [Implement]    [Run Tests]                      │
│           │              │              │                            │
│           └──────────────┼──────────────┘                           │
│                          │                                           │
│           ┌──────────────┴──────────────┐                           │
│           │                              │                           │
│           ▼                              ▼                           │
│    [Normal Exit]               [Spot Interruption]                  │
│         │                              │                             │
│         ▼                              ▼                             │
│    checkpoint_save              checkpoint_save                      │
│    (final state)                (stage=interrupted)                  │
│                                        │                             │
│                                        ▼                             │
│                              [Task Re-queued]                        │
│                                        │                             │
│                                        ▼                             │
│                            [New Worker Spawned]                      │
│                                        │                             │
│                                        ▼                             │
│                              checkpoint_load                         │
│                              (Resume from S3)                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.4 S3 Storage Structure

**Bucket:** `workermill-{env}-worker-state-{account_id}`

**Path:** `s3://{bucket}/{taskId}/checkpoint.json`

**Configuration:**
- Versioning: Enabled
- Encryption: AES256 (server-side)
- Lifecycle: Auto-delete after 7 days
- Public Access: Blocked

### 2.5 Spot Interruption Handling

**Detection Methods:**

1. **ECS Native:** `stopCode="SpotInterruption"`
2. **Exit Code:** Exit 137 with FARGATE_SPOT capacity provider
3. **Checkpoint Stage:** `stage="interrupted"` (fallback)

**Re-queue Logic:**

```
IF Spot Interruption Detected:
    IF retryCount < maxRetries:
        status = "queued"
        retryCount += 1
        taskNotes = "SPOT_RETRY: Retry X/Y"
        → Task re-enters queue
    ELSE:
        status = "failed"
        errorMessage = "Max retries exceeded"
        → Task fails permanently
```

### 2.6 Resume Workflow

When a worker starts with an existing checkpoint:

1. **Load State:** `checkpoint_load()` retrieves S3 checkpoint
2. **Validate:** Verify taskId matches, JSON is valid
3. **Increment:** `resumeCount += 1`
4. **Skip Phases:** Jump to appropriate stage based on `stage` field
5. **Inject Context:** Add resume context to Claude prompt

**Resume Context Example:**
```
IMPORTANT: This is a RESUMED task from implementing stage.
Files previously modified: src/api.ts, src/main.ts
Commits made: abc123, def456
Last action: Implemented authentication endpoint

Continue from where you left off. Do NOT redo completed work.
```

### 2.7 Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECKPOINT_ENABLED` | `true` | Enable/disable checkpointing |
| `CHECKPOINT_BUCKET` | Auto | S3 bucket name |
| `CHECKPOINT_DIR` | `/tmp` | Local checkpoint directory |
| `CHECKPOINT_INTERVAL` | `60` | Sync interval (seconds) |

---

## 3. Multi-Worker Coordination

### 3.1 Overview

Multi-Worker Coordination enables parallel AI worker execution on the same repository without conflicts. It implements optimistic locking, heartbeat monitoring, and resource reservation to prevent concurrent edits to the same files.

**Problem Solved:**
- Concurrent workers editing the same file
- Merge conflicts from parallel branches
- Race conditions in test database access
- Deployment slot contention

### 3.2 Architecture Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Coordination Architecture                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │   Worker 1  │    │   Worker 2  │    │   Coordination Service  │  │
│  │  (OCS-101)  │    │  (OCS-102)  │    │     (API Server)        │  │
│  └──────┬──────┘    └──────┬──────┘    └───────────┬─────────────┘  │
│         │                  │                       │                 │
│         │    Check-In      │                       │                 │
│         │─────────────────────────────────────────▶│                 │
│         │                  │                       │                 │
│         │    Heartbeat (30s)                       │                 │
│         │─────────────────────────────────────────▶│                 │
│         │                  │                       │                 │
│         │    Declare Manifest                      │                 │
│         │    [src/api.ts, src/main.ts]            │                 │
│         │─────────────────────────────────────────▶│                 │
│         │                  │                       │                 │
│         │◀─────── Locks Acquired ─────────────────│                 │
│         │                  │                       │                 │
│         │                  │    Declare Manifest   │                 │
│         │                  │    [src/api.ts]       │                 │
│         │                  │─────────────────────▶│                 │
│         │                  │                       │                 │
│         │                  │◀──── 409 Conflict ───│                 │
│         │                  │    (Worker 1 holds   │                 │
│         │                  │     src/api.ts)      │                 │
│         │                  │                       │                 │
│         │                  │    Declare Manifest   │                 │
│         │                  │    [src/config.ts]    │                 │
│         │                  │─────────────────────▶│                 │
│         │                  │                       │                 │
│         │                  │◀─── Locks Acquired ──│                 │
│         │                  │                       │                 │
│         │    Check-Out     │                       │                 │
│         │─────────────────────────────────────────▶│                 │
│         │    (releases locks)                      │                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Database Schema

#### worker_check_ins
```sql
CREATE TABLE worker_check_ins (
    id UUID PRIMARY KEY,
    task_id UUID UNIQUE NOT NULL,
    org_id UUID NOT NULL,
    worker_id VARCHAR(100) NOT NULL,
    repo VARCHAR(255) NOT NULL,
    branch VARCHAR(255),
    status VARCHAR(50),
    current_file VARCHAR(500),
    files_modified JSONB DEFAULT '[]',
    heartbeat_at TIMESTAMP NOT NULL,
    started_at TIMESTAMP NOT NULL,
    metadata JSONB DEFAULT '{}'
);
```

#### worker_file_locks
```sql
CREATE TABLE worker_file_locks (
    id UUID PRIMARY KEY,
    org_id UUID NOT NULL,
    repo VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    task_id UUID NOT NULL,
    worker_id VARCHAR(100) NOT NULL,
    lock_type VARCHAR(20) DEFAULT 'exclusive',
    acquired_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    UNIQUE(org_id, repo, file_path)
);
```

#### worker_resource_reservations
```sql
CREATE TABLE worker_resource_reservations (
    id UUID PRIMARY KEY,
    org_id UUID NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    task_id UUID NOT NULL,
    worker_id VARCHAR(100) NOT NULL,
    acquired_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    UNIQUE(org_id, resource_type, resource_id)
);
```

### 3.4 Check-In/Heartbeat/Check-Out Flow

#### Check-In (Worker Startup)

```bash
POST /api/coordination/check-in
Content-Type: application/json

{
  "taskId": "uuid",
  "workerId": "ecs-task-id",
  "repo": "owner/repo",
  "branch": "ai/OCS-123",
  "status": "starting",
  "metadata": {
    "persona": "backend_developer",
    "model": "claude-sonnet",
    "jiraKey": "OCS-123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "conflicts": [
    {
      "taskId": "other-uuid",
      "workerId": "other-ecs-task",
      "branch": "ai/OCS-100",
      "status": "working"
    }
  ]
}
```

#### Heartbeat (Every 30 Seconds)

```bash
POST /api/coordination/heartbeat
Content-Type: application/json

{
  "taskId": "uuid",
  "status": "working",
  "currentFile": "src/api.ts"
}
```

Workers with no heartbeat for 5+ minutes are marked stale.

#### Check-Out (Worker Completion)

```bash
DELETE /api/coordination/check-out
Content-Type: application/json

{
  "taskId": "uuid"
}
```

Releases all file locks and resource reservations.

### 3.5 File Locking System

#### Acquire Locks

```bash
POST /api/coordination/locks/acquire
Content-Type: application/json

{
  "taskId": "uuid",
  "repo": "owner/repo",
  "filePaths": ["src/api.ts", "src/main.ts"],
  "lockType": "exclusive",
  "ttlSeconds": 300
}
```

**Response (Success):**
```json
{
  "acquired": ["src/api.ts", "src/main.ts"],
  "conflicts": []
}
```

**Response (Conflict):**
```json
{
  "acquired": ["src/main.ts"],
  "conflicts": [
    {
      "filePath": "src/api.ts",
      "heldBy": {
        "taskId": "other-uuid",
        "workerId": "other-ecs",
        "expiresAt": "2025-01-15T02:35:00Z"
      }
    }
  ]
}
```

#### Release Locks

```bash
POST /api/coordination/locks/release
Content-Type: application/json

{
  "taskId": "uuid",
  "filePaths": ["src/api.ts"]
}
```

### 3.6 Manifest Declaration

Declare intent to modify files before starting work:

```bash
POST /api/coordination/manifest/declare
Content-Type: application/json

{
  "taskId": "uuid",
  "repo": "owner/repo",
  "branch": "ai/OCS-123",
  "filesToModify": ["src/api.ts", "src/main.ts", "package.json"],
  "ttlSeconds": 1800
}
```

**Benefits:**
- Detects conflicts before work begins
- Auto-acquires locks on all declared files
- 30-minute TTL (longer than individual locks)

### 3.7 Resource Reservations

For shared, single-instance resources:

```bash
POST /api/coordination/resources/reserve
Content-Type: application/json

{
  "taskId": "uuid",
  "resourceType": "test_db",
  "resourceId": "postgres-test-01",
  "ttlSeconds": 600
}
```

**Resource Types:**
- `test_db` - Test database instances
- `deploy_slot` - Deployment pipeline slots
- `ci_runner` - CI/CD runner allocation
- `preview_env` - Preview environment slots

---

## 4. Multi-Provider AI Support

### 4.1 Supported Providers

| Provider | ID | Default Model | Requires API Key |
|----------|-----|---------------|------------------|
| Anthropic (Claude) | `anthropic` | claude-sonnet-4-5-20250929 | Yes |
| OpenAI (GPT) | `openai` | gpt-4o | Yes |
| Google (Gemini) | `google` | gemini-2.0-flash | Yes |
| Ollama (Local) | `ollama` | llama3.1:8b | No |

### 4.2 Model Catalog

#### Anthropic (Claude)

| Model ID | Display Name | Tier | Input | Output | Context |
|----------|--------------|------|-------|--------|---------|
| claude-opus-4-5-20251101 | Claude Opus 4.5 | Powerful | $5.00/M | $25.00/M | 200K |
| claude-sonnet-4-5-20250929 | Claude Sonnet 4.5 | Balanced | $3.00/M | $15.00/M | 200K |
| claude-haiku-4-5-20251001 | Claude Haiku 4.5 | Fast | $0.80/M | $4.00/M | 200K |

#### OpenAI (GPT)

| Model ID | Display Name | Tier | Input | Output | Context |
|----------|--------------|------|-------|--------|---------|
| gpt-4o | GPT-4o | Powerful | $2.50/M | $10.00/M | 128K |
| gpt-4o-mini | GPT-4o Mini | Fast | $0.15/M | $0.60/M | 128K |
| o1 | o1 (Reasoning) | Powerful | $15.00/M | $60.00/M | 200K |
| o1-mini | o1 Mini | Balanced | $3.00/M | $12.00/M | 128K |

#### Google (Gemini)

| Model ID | Display Name | Tier | Input | Output | Context |
|----------|--------------|------|-------|--------|---------|
| gemini-2.0-flash | Gemini 2.0 Flash | Balanced | $0.075/M | $0.30/M | 1M |
| gemini-1.5-pro | Gemini 1.5 Pro | Powerful | $1.25/M | $5.00/M | 2M |
| gemini-1.5-flash | Gemini 1.5 Flash | Fast | $0.075/M | $0.30/M | 1M |

#### Ollama (Local)

| Model ID | Display Name | Tier | Cost | Context |
|----------|--------------|------|------|---------|
| llama3.1:8b | Llama 3.1 8B | Fast | Free | 128K |
| llama3.1:70b | Llama 3.1 70B | Balanced | Free | 128K |
| codellama:34b | Code Llama 34B | Balanced | Free | 16K |
| deepseek-coder:33b | DeepSeek Coder 33B | Balanced | Free | 16K |

### 4.3 Provider Selection Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Provider Selection Flow                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Jira Ticket Labels                                                  │
│  [workermill, openai, sonnet]                                       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────┐                       │
│  │ Webhook Handler (webhooks.ts)            │                       │
│  │                                          │                       │
│  │ Provider Labels:                         │                       │
│  │   anthropic → anthropic                  │                       │
│  │   openai    → openai                     │                       │
│  │   gemini    → google                     │                       │
│  │   google    → google                     │                       │
│  │   ollama    → ollama                     │                       │
│  │   (none)    → org.primaryProvider        │                       │
│  │             → "anthropic" (fallback)     │                       │
│  └──────────────────────────────────────────┘                       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────┐                       │
│  │ Task Created                             │                       │
│  │   workerProvider: "openai"               │                       │
│  │   workerModel: "gpt-4o"                  │                       │
│  └──────────────────────────────────────────┘                       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────┐                       │
│  │ Orchestrator                             │                       │
│  │   Fetches credentials for provider       │                       │
│  │   Spawns ECS task with env vars          │                       │
│  └──────────────────────────────────────────┘                       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────┐                       │
│  │ Worker Container                         │                       │
│  │   WORKER_PROVIDER=openai                 │                       │
│  │   OPENAI_API_KEY=sk-...                  │                       │
│  │   CLAUDE_MODEL=gpt-4o                    │                       │
│  └──────────────────────────────────────────┘                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.4 Credential Management

#### Storage Hierarchy

1. **Organization-Specific:**
   ```
   workermill/{env}/orgs/{orgId}/providers/{providerId}
   ```

2. **Platform Default:**
   ```
   workermill/{env}/{providerId}-api-key
   ```

3. **Environment Fallback (Anthropic only):**
   ```
   ANTHROPIC_API_KEY environment variable
   ```

#### API Endpoints

**List Providers:**
```bash
GET /api/settings/providers

Response:
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "configured": true,
      "models": [...]
    },
    {
      "id": "openai",
      "name": "OpenAI",
      "configured": false,
      "models": [...]
    }
  ],
  "primaryProvider": "anthropic"
}
```

**Save Credentials:**
```bash
PUT /api/settings/providers/openai/credentials
Content-Type: application/json

{
  "apiKey": "sk-..."
}
```

**Test Credentials:**
```bash
POST /api/settings/providers/openai/test

Response:
{
  "success": true,
  "message": "OpenAI API key is valid"
}
```

### 4.5 Cost Calculation

Each provider implements a pricing engine:

```typescript
interface ProviderPricingEngine {
  calculateTokenCost(tokens: TokenUsage, model: string): number;
  calculateTotalCost(tokens: TokenUsage, model: string, durationSeconds: number): number;
}
```

**Cost Components:**
1. **Token Cost:** Input tokens + Output tokens + Cache tokens (where applicable)
2. **Compute Cost:** ECS Fargate Spot rate × Duration

**Example:**
```
Task: 50,000 input tokens, 10,000 output tokens, 300 seconds
Model: claude-sonnet-4-5-20250929

Token Cost:
  Input:  50,000 / 1,000,000 × $3.00  = $0.15
  Output: 10,000 / 1,000,000 × $15.00 = $0.15
  Total Tokens: $0.30

Compute Cost:
  300 / 3600 × $0.015 = $0.00125

Total: $0.30125
```

### 4.6 Jira Label Reference

| Label | Provider | Effect |
|-------|----------|--------|
| `anthropic` | Anthropic | Use Claude models |
| `openai` | OpenAI | Use GPT models |
| `gemini` | Google | Use Gemini models |
| `google` | Google | Use Gemini models |
| `ollama` | Ollama | Use local models |
| `haiku` | - | Use fastest/cheapest Claude |
| `sonnet` | - | Use balanced Claude |
| `opus` | - | Use most capable Claude |

**Combinations:**
- `workermill, openai` → Uses GPT-4o (OpenAI default)
- `workermill, anthropic, opus` → Uses Claude Opus 4.5
- `workermill, gemini` → Uses Gemini 2.0 Flash

---

## Appendix

### A. Environment Variables Reference

#### Core Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TASK_ID` | Yes | WorkerMill task UUID |
| `JIRA_ISSUE_KEY` | Yes | Jira ticket key (e.g., OCS-123) |
| `GITHUB_REPO` | Yes | Target repository (owner/repo) |
| `GITHUB_TOKEN` | Yes | GitHub authentication token |
| `WORKER_PERSONA` | Yes | Worker role (backend_developer, etc.) |
| `CLAUDE_MODEL` | Yes | Model identifier |
| `API_BASE_URL` | Yes | WorkerMill API endpoint |
| `ORG_API_KEY` | Yes | Organization API key |

#### Provider Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `WORKER_PROVIDER` | All | Provider ID (anthropic, openai, etc.) |
| `ANTHROPIC_API_KEY` | Anthropic | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI | OpenAI API key |
| `GOOGLE_API_KEY` | Google | Google API key |
| `OLLAMA_HOST` | Ollama | Ollama server URL |

#### Feature Variables

| Variable | Feature | Description |
|----------|---------|-------------|
| `USE_RALPH` | Ralph | Enable Ralph execution mode |
| `RALPH_MAX_STORIES` | Ralph | Maximum stories per PRD |
| `CHECKPOINT_ENABLED` | Checkpointing | Enable state persistence |
| `CHECKPOINT_INTERVAL` | Checkpointing | Sync interval (seconds) |

### B. API Endpoints Reference

#### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get all organization settings |
| PUT | `/api/settings` | Update organization settings |
| GET | `/api/settings/providers` | List available providers |
| PUT | `/api/settings/providers/:id/credentials` | Save provider credentials |
| POST | `/api/settings/providers/:id/test` | Test provider credentials |

#### Coordination

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/coordination/check-in` | Register worker presence |
| POST | `/api/coordination/heartbeat` | Update worker liveness |
| DELETE | `/api/coordination/check-out` | Deregister worker |
| POST | `/api/coordination/manifest/declare` | Declare file intent |
| POST | `/api/coordination/locks/acquire` | Acquire file locks |
| POST | `/api/coordination/locks/release` | Release file locks |
| GET | `/api/coordination/active-workers` | List active workers |

### C. Output Markers Reference

#### Standard Markers

| Marker | Format | Description |
|--------|--------|-------------|
| `::result::` | `::result::<status>` | Final task result |
| `::pr_url::` | `::pr_url::<url>` | GitHub PR URL |
| `::pr_number::` | `::pr_number::<number>` | PR number |
| `::escalate::` | `::escalate::<reason>` | Escalation trigger |

#### Ralph Markers

| Marker | Format | Description |
|--------|--------|-------------|
| `::ralph_progress::` | `::ralph_progress::<current>/<total>::<desc>` | Story progress |
| `::ralph_stories_completed::` | `::ralph_stories_completed::<count>` | Completed count |
| `::ralph_status::` | `::ralph_status::<status>` | Overall status |
| `::ralph_plan_complete::` | `::ralph_plan_complete::<count>` | Planning complete |

### D. Troubleshooting Guide

#### Ralph Not Triggering

**Symptom:** Worker runs direct Claude execution instead of Ralph

**Checklist:**
1. Verify `useRalphExecution: true` in Settings
2. Check worker logs for `USE_RALPH` environment variable
3. Verify `/app/ralph/execute.sh` exists in container

#### Checkpoint Not Saving

**Symptom:** Tasks don't resume after Spot interruption

**Checklist:**
1. Verify S3 bucket exists and IAM permissions are correct
2. Check `CHECKPOINT_ENABLED` is not set to `false`
3. Review CloudWatch logs for S3 upload errors

#### Coordination Conflicts

**Symptom:** Workers blocked waiting for locks

**Checklist:**
1. Check for stale workers (no heartbeat > 5 min)
2. Run cleanup: `cleanupExpiredLocks()` via orchestrator
3. Manually release locks via API if needed

#### Provider Credentials Failed

**Symptom:** Worker fails with "invalid API key" error

**Checklist:**
1. Test credentials via Settings → Providers → Test
2. Verify secret exists in AWS Secrets Manager
3. Check IAM role has `secretsmanager:GetSecretValue` permission

---

*Last updated: January 2025*
