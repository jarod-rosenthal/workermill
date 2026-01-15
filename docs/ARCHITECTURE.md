# WorkerMill Architecture

This document describes the technical architecture of WorkerMill, including component interactions, data flows, and design decisions.

---

## System Overview

WorkerMill is a distributed system for orchestrating AI coding agents. It consists of:

1. **Dashboard** - React SPA for real-time monitoring
2. **API Server** - Express REST API with SSE streaming
3. **Orchestrator** - Background service for task management
4. **Worker Containers** - Ephemeral ECS Fargate tasks running AI agents
5. **Supporting Services** - Coordination, checkpointing, log streaming

---

## Component Architecture

```
                                    ┌─────────────────────────────────┐
                                    │          CloudFront             │
                                    │      (CDN + SSL termination)    │
                                    └────────────────┬────────────────┘
                                                     │
                              ┌──────────────────────┴──────────────────────┐
                              │                                             │
                              ▼                                             ▼
                    ┌─────────────────┐                           ┌─────────────────┐
                    │   S3 Bucket     │                           │   API Server    │
                    │   (Frontend)    │                           │   (ECS Fargate) │
                    └─────────────────┘                           └────────┬────────┘
                                                                           │
                    ┌──────────────────────────────────────────────────────┤
                    │                                                      │
                    ▼                                                      ▼
          ┌─────────────────┐                                   ┌─────────────────┐
          │   PostgreSQL    │◄──────────────────────────────────│   Orchestrator  │
          │     (RDS)       │                                   │   (Background)  │
          └─────────────────┘                                   └────────┬────────┘
                    ▲                                                    │
                    │                                                    │
                    │    ┌───────────────────────────────────────────────┘
                    │    │
                    │    ▼
                    │  ┌─────────────────────────────────────────────────────────────┐
                    │  │                    Worker Containers                        │
                    │  │                    (ECS Fargate Spot)                       │
                    │  │                                                             │
                    │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
                    │  │  │Worker 1 │  │Worker 2 │  │Worker 3 │  │Worker N │        │
                    │  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
                    │  │       │            │            │            │              │
                    │  └───────┼────────────┼────────────┼────────────┼──────────────┘
                    │          │            │            │            │
                    │          ▼            ▼            ▼            ▼
                    │    ┌─────────────────────────────────────────────────┐
                    └────│              Log Streaming API                  │
                         │           POST /api/tasks/:id/logs              │
                         └─────────────────────────────────────────────────┘
                                              │
                                              ▼
                         ┌─────────────────────────────────────────────────┐
                         │                 S3 Bucket                       │
                         │            (Worker Checkpoints)                 │
                         └─────────────────────────────────────────────────┘
```

---

## Data Flow

### Task Lifecycle

```
┌───────────┐     ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Jira    │────▶│   Webhook     │────▶│   Database    │────▶│ Orchestrator  │
│  Webhook  │     │   Handler     │     │   (queued)    │     │   Poll Loop   │
└───────────┘     └───────────────┘     └───────────────┘     └───────┬───────┘
                                                                      │
                                                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Task Execution                                   │
│                                                                               │
│  1. Claim task (atomic UPDATE...WHERE status='queued')                       │
│  2. Spawn ECS Fargate task                                                    │
│  3. Worker executes:                                                          │
│     a. Clone repo                                                             │
│     b. Read ticket                                                            │
│     c. Implement changes                                                      │
│     d. Create PR                                                              │
│  4. Parse output markers (::result::, ::pr_url::, etc.)                      │
│  5. Update task status                                                        │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Real-Time Log Streaming

```
Worker Container                    API Server                      Dashboard
      │                                  │                              │
      │  POST /api/tasks/:id/logs       │                              │
      │  {type: "terminal",              │                              │
      │   message: "Cloning repo..."}    │                              │
      │────────────────────────────────▶│                              │
      │                                  │  INSERT INTO                 │
      │                                  │  worker_task_logs            │
      │                                  │──────────────┐               │
      │                                  │              │               │
      │                                  │◀─────────────┘               │
      │                                  │                              │
      │                                  │  GET /logs/:id/stream (SSE) │
      │                                  │◀─────────────────────────────│
      │                                  │                              │
      │                                  │  Query logs since lastId     │
      │                                  │  (every 500ms)               │
      │                                  │                              │
      │                                  │  data: {logs: [...]}         │
      │                                  │─────────────────────────────▶│
```

---

## Key Components

### 1. API Server (`api/`)

Express application providing:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/webhooks/jira` | Receive Jira webhooks, create tasks |
| `POST /api/webhooks/linear` | Receive Linear webhooks, create tasks |
| `POST /api/webhooks/github` | Receive GitHub PR review webhooks |
| `POST /api/webhooks/github-issues` | Receive GitHub Issues webhooks |
| `GET /api/control-center` | Dashboard data (tasks, stats) |
| `GET /api/control-center/stream` | SSE stream for real-time updates |
| `POST /api/tasks/:id/logs` | Receive worker log output |
| `POST /api/coordination/*` | Multi-worker coordination |
| `GET/PUT /api/settings` | Organization configuration |

### 2. Orchestrator (`api/src/services/orchestrator.ts`)

Background service with multiple loops:

| Loop | Interval | Purpose |
|------|----------|---------|
| Poll | 5s | Find queued tasks, spawn workers |
| Monitor | 5s | Check running task status |
| Cleanup | 1hr | Remove old logs, checkpoints |
| Coordination | 1min | Clean up stale worker locks |

### 3. Worker Container (`worker/`)

Docker container with:

- **entrypoint.sh** - Main execution script
- **checkpoint.sh** - State persistence library
- **directives/** - Role-specific instructions
- **execution/** - TypeScript helper scripts

### 4. Coordination Service (`api/src/services/coordination.ts`)

Multi-worker conflict prevention:

| Function | Purpose |
|----------|---------|
| `checkIn()` | Register worker presence |
| `heartbeat()` | Update liveness |
| `acquireFileLocks()` | Lock files before editing |
| `declareManifest()` | Declare intended file changes |
| `cleanupStaleCoordination()` | Release stale locks |

### 5. Checkpointing Service (`worker/lib/checkpoint.sh` + `api/src/config/index.ts`)

State persistence for Spot recovery:

| Function | Location | Purpose |
|----------|----------|---------|
| `checkpoint_init()` | Worker | Initialize/load state |
| `checkpoint_save()` | Worker | Upload to S3 |
| `getTaskCheckpoint()` | API | Retrieve from S3 |
| `cleanupOldCheckpoints()` | Orchestrator | Delete old checkpoints |

---

## Database Schema

### Core Tables

```sql
-- Tasks
CREATE TABLE worker_tasks (
    id UUID PRIMARY KEY,
    jira_issue_key VARCHAR(50),
    status VARCHAR(50),  -- queued, executing, review_requested, escalated, deployed
    worker_model VARCHAR(100),
    worker_provider VARCHAR(50),  -- anthropic, openai, google, ollama
    worker_persona VARCHAR(50),
    ecs_task_arn VARCHAR(255),
    cost_usd DECIMAL(10, 4),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    pr_url VARCHAR(500),
    pr_number INTEGER,
    created_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Log storage (for SSE streaming)
CREATE TABLE worker_task_logs (
    id SERIAL PRIMARY KEY,
    task_id UUID REFERENCES worker_tasks(id),
    type VARCHAR(50),
    message TEXT,
    severity VARCHAR(20),
    created_at TIMESTAMP
);

-- Worker coordination
CREATE TABLE worker_check_ins (
    id UUID PRIMARY KEY,
    task_id UUID,
    worker_id VARCHAR(255),
    repo VARCHAR(255),
    branch VARCHAR(255),
    status VARCHAR(50),
    current_file VARCHAR(500),
    last_heartbeat_at TIMESTAMP
);

CREATE TABLE worker_file_locks (
    id UUID PRIMARY KEY,
    task_id UUID,
    file_path VARCHAR(500),
    locked_at TIMESTAMP,
    expires_at TIMESTAMP
);
```

---

## AI Provider Integration

### Provider Abstraction Layer

```typescript
// api/src/providers/types.ts
interface ProviderPricingEngine {
  calculateCost(usage: TokenUsage, model: string): number;
  getModelInfo(model: string): ModelInfo | null;
  getSupportedModels(): string[];
}

// api/src/providers/index.ts
const providers = {
  anthropic: new AnthropicPricingEngine(),
  openai: new OpenAIPricingEngine(),
  google: new GooglePricingEngine(),
  ollama: new OllamaPricingEngine(),
};
```

### Provider Selection Flow

```
Jira Ticket Labels
       │
       ▼
┌──────────────────┐
│ Webhook Handler  │
│ parseLabels()    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ Provider Label?  │─YES─▶│ Use that provider│
│ (openai, gemini) │      └──────────────────┘
└────────┬─────────┘
         │ NO
         ▼
┌──────────────────┐
│ Use org default  │
│ (Settings page)  │
└──────────────────┘
```

---

## Checkpointing System

### State Schema

```json
{
  "taskId": "uuid",
  "version": 1,
  "stage": "implementing",
  "repoCloned": true,
  "branch": "ai/OCS-123",
  "commits": ["abc123", "def456"],
  "filesModified": ["src/api/route.ts"],
  "testsRun": false,
  "testsPassed": null,
  "lastAction": "Implementing feature",
  "resumeCount": 0
}
```

### Checkpoint Flow

```
Normal Execution                    Spot Interruption
      │                                    │
      ▼                                    ▼
┌─────────────┐                    ┌─────────────┐
│ Work on     │                    │ SIGTERM     │
│ task        │                    │ received    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       ▼                                  ▼
┌─────────────┐                    ┌─────────────┐
│ Every 60s   │                    │ Immediate   │
│ save to S3  │                    │ save to S3  │
└─────────────┘                    └──────┬──────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │ Task        │
                                   │ re-queued   │
                                   └──────┬──────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │ New worker  │
                                   │ loads       │
                                   │ checkpoint  │
                                   └──────┬──────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │ Resume from │
                                   │ saved state │
                                   └─────────────┘
```

---

## Escalation Flow

### Decision Tree

```
Worker Executing
       │
       ▼
┌──────────────────┐
│ Can complete     │
│ the task?        │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
   YES        NO
    │         │
    ▼         ▼
┌────────┐  ┌────────────────────┐
│ Normal │  │ Why not?           │
│ flow   │  └─────────┬──────────┘
└────────┘            │
              ┌───────┴───────┐
              │               │
              ▼               ▼
       ┌──────────┐    ┌──────────┐
       │ Technical│    │ Needs    │
       │ failure  │    │ human    │
       └────┬─────┘    │ input    │
            │          └────┬─────┘
            ▼               ▼
       ┌──────────┐    ┌──────────┐
       │ ::result │    │ ::result │
       │ ::failed │    │::escalate│
       └──────────┘    └──────────┘
```

### Escalation Reasons

| Reason | Example | Resolution |
|--------|---------|------------|
| Unclear requirements | "Fix the thing" | Clarify in ticket |
| Missing attachments | Screenshots didn't download | Re-attach files |
| Security concern | Found vulnerability | Human decision needed |
| Breaking change | Would break API contract | Explicit authorization |
| Cannot reproduce | Bug doesn't occur | More reproduction steps |

---

## Integration Webhooks Architecture

WorkerMill supports multiple issue tracking platforms via webhook integrations.

### Webhook Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Issue Tracker Platforms                               │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│    Jira     │   Linear    │   GitHub    │   Asana     │   ClickUp           │
│             │             │   Issues    │  (planned)  │  (planned)          │
└──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────────────┘
       │             │             │             │             │
       ▼             ▼             ▼             ▼             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Webhook Handlers                                     │
│                          (api/src/routes/webhooks.ts)                        │
├──────────────────────────────────────────────────────────────────────────────┤
│  1. Validate webhook signature (if applicable)                               │
│  2. Parse payload into common format                                         │
│  3. Extract labels (workermill, persona, model)                             │
│  4. Create WorkerTask with normalized metadata                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Common Task Queue                                    │
│                          (PostgreSQL worker_tasks table)                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Supported Integrations

| Platform | Status | Webhook Path | Trigger |
|----------|--------|--------------|---------|
| Jira | ✅ Production | `/api/webhooks/jira` | `workermill` label added |
| Linear | ✅ Production | `/api/webhooks/linear` | `workermill` label added |
| GitHub Issues | ✅ Production | `/api/webhooks/github-issues` | `workermill` label added |
| GitHub PRs | ✅ Production | `/api/webhooks/github` | PR approved |
| Asana | 🔜 Planned | `/api/webhooks/asana` | Tag added |
| ClickUp | 🔜 Planned | `/api/webhooks/clickup` | Tag added |
| GitLab Issues | 🔜 Planned | `/api/webhooks/gitlab` | Label added |

### Common Webhook Payload Format

All webhooks normalize to this internal format:

```typescript
interface WebhookPayload {
  issueKey: string;           // e.g., "OCS-123", "linear-abc", "gh-456"
  issueUrl: string;           // Link to original issue
  title: string;              // Issue title
  description: string;        // Issue description/body
  labels: string[];           // All labels on the issue
  source: 'jira' | 'linear' | 'github' | 'asana' | 'clickup';
  metadata: {
    projectKey?: string;      // Jira project key
    teamId?: string;          // Linear team ID
    repoFullName?: string;    // GitHub owner/repo
    assignee?: string;
    priority?: string;
  };
}
```

---

## Worker Personas

Workers are specialized by persona, each with domain-specific knowledge and behaviors.

### Persona Architecture

```
                    ┌─────────────────────────────┐
                    │      Worker Container       │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │   Base Directives     │  │
                    │  │   (AGENTS.md)         │  │
                    │  └───────────┬───────────┘  │
                    │              │              │
                    │              ▼              │
                    │  ┌───────────────────────┐  │
                    │  │   Persona Directive   │  │
                    │  │   (directives/*)      │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
```

### Available Personas

| Persona | Domain | Status |
|---------|--------|--------|
| `backend_developer` | APIs, databases, services | ✅ Production |
| `frontend_developer` | UI, React, CSS | ✅ Production |
| `devops_engineer` | CI/CD, infrastructure | ✅ Production |
| `security_engineer` | Security audits, vulnerabilities | ✅ Production |
| `qa_engineer` | Testing, test automation | ✅ Production |
| `tech_writer` | Documentation | ✅ Production |
| `project_manager` | Planning, coordination | ✅ Production |
| `data_engineer` | ETL, data pipelines, dbt | 🔜 Coming Soon |
| `ml_engineer` | ML pipelines, model deployment | 🔜 Coming Soon |
| `mobile_developer_ios` | Swift, SwiftUI | 🔜 Coming Soon |
| `mobile_developer_android` | Kotlin, Compose | 🔜 Coming Soon |
| `api_developer` | REST, GraphQL, OpenAPI | 🔜 Coming Soon |
| `database_administrator` | Schema design, optimization | 🔜 Coming Soon |

### Persona Selection Flow

```
Jira Ticket Labels
       │
       ▼
┌──────────────────┐
│ Persona Label?   │──YES──▶ Use that persona
│ (backend, qa)    │
└────────┬─────────┘
         │ NO
         ▼
┌──────────────────┐
│ Use org default  │
│ persona setting  │
└──────────────────┘
```

---

## Performance Considerations

### Log Streaming Optimization

**Why PostgreSQL instead of CloudWatch?**

| Metric | PostgreSQL | CloudWatch |
|--------|------------|------------|
| Latency | ~50ms | 1000ms minimum |
| Query pattern | Simple SELECT | Log Insights query |
| Cost | Included in RDS | Per-query charge |
| Complexity | Simple SQL | CloudWatch Logs API |

### Checkpoint Efficiency

**Why S3 instead of database?**

| Aspect | S3 | Database |
|--------|-----|----------|
| Blob storage | Native | Requires BYTEA |
| Lifecycle rules | Built-in | Manual cleanup |
| Cost | $0.023/GB | RDS storage cost |
| Durability | 11 9s | Depends on RDS config |

### Worker Coordination

**Why in-memory coordination?**

| Aspect | Database | Redis |
|--------|----------|-------|
| Latency | ~5ms | ~1ms |
| Persistence | Yes | Optional |
| Complexity | Already have | New dependency |
| Lock expiry | Application code | TTL built-in |

Decision: Use database with application-level TTL checks. Simpler architecture, acceptable latency for 30-second heartbeat intervals.

---

## Security Model

### Authentication

```
External Requests                    Worker Requests
       │                                   │
       ▼                                   ▼
┌──────────────┐                   ┌──────────────┐
│ Cognito JWT  │                   │ Org API Key  │
│ Verification │                   │ (X-API-Key)  │
└──────┬───────┘                   └──────┬───────┘
       │                                  │
       ▼                                  ▼
┌──────────────┐                   ┌──────────────┐
│ User context │                   │ Org context  │
│ from token   │                   │ from key     │
└──────────────┘                   └──────────────┘
```

### Credential Management

| Credential | Storage | Access Pattern |
|------------|---------|----------------|
| Anthropic API Key | Secrets Manager | Orchestrator reads |
| OpenAI API Key | Secrets Manager | Orchestrator reads |
| GitHub Token | Secrets Manager | Worker reads |
| Jira Token | Secrets Manager | Worker reads |
| Org API Keys | Database | API validates |

---

## Deployment Architecture

### AWS Resources

| Resource | Service | Purpose |
|----------|---------|---------|
| API | ECS Fargate | API server + orchestrator |
| Workers | ECS Fargate Spot | Task execution |
| Database | RDS PostgreSQL | Primary data store |
| Frontend | S3 + CloudFront | Dashboard hosting |
| State | S3 | Worker checkpoints |
| Secrets | Secrets Manager | API keys, tokens |

### Terraform Structure

```
infrastructure/terraform/
├── environments/
│   └── dev/
│       ├── main.tf           # Provider config
│       ├── variables.tf      # Environment vars
│       ├── worker-state.tf   # Checkpoint S3 bucket
│       └── outputs.tf        # Resource references
└── modules/
    ├── ecs-cluster/          # Cluster definition
    ├── ecs-worker/           # Worker task definition
    ├── rds/                  # PostgreSQL instance
    └── cloudfront/           # CDN distribution
```

---

## Future Considerations

### Potential Improvements

1. **Redis for coordination** - Lower latency for high-frequency operations
2. **WebSocket streaming** - Replace SSE for bidirectional communication
3. **Distributed tracing** - OpenTelemetry for cross-service visibility
4. **Multi-region** - Global worker deployment for latency optimization

### Scalability Limits

| Component | Current Limit | Bottleneck |
|-----------|---------------|------------|
| Concurrent workers | ~50 | ECS task limits |
| Log throughput | ~1000 msg/s | PostgreSQL write capacity |
| SSE connections | ~500 | API server memory |

