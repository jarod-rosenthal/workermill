# WorkerMill User Guide

> Mission control for autonomous AI coding agents

WorkerMill is a real-time monitoring and orchestration system for AI agents that execute coding tasks. This guide covers all features available in the dashboard and how to configure workers for your workflows.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Task Workflows](#task-workflows)
4. [Escalation Workflow](#escalation-workflow)
5. [Multi-Provider AI Support](#multi-provider-ai-support)
6. [Worker State Checkpointing](#worker-state-checkpointing)
7. [Multi-Worker Coordination](#multi-worker-coordination)
8. [Ralph Integration](#ralph-integration)
9. [Settings & Configuration](#settings--configuration)
10. [API Reference](#api-reference)

---

## Getting Started

### Triggering Your First Worker

1. **Create a Jira ticket** in your connected project
2. **Add the `workermill` label** to the ticket
3. **Watch the dashboard** - Your task will appear within seconds
4. **Monitor progress** - Real-time terminal output streams to the dashboard

### Understanding Labels

Labels control worker behavior:

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model selection (default: haiku) |
| `deploy` | Auto-deploy: Skip PR approval, merge and deploy immediately |
| `review` | Require Virtual Manager review before merge |

---

## Dashboard Overview

The WorkerMill dashboard provides a three-column layout for comprehensive monitoring:

### Left Column: Stats Panel

Real-time metrics including:
- **Active Workers** - Currently executing tasks
- **Tasks Today** - Completed tasks in the last 24 hours
- **Cost Today** - API + compute spend
- **Queue Depth** - Tasks waiting for workers
- **Checkpoint Metrics** - Active checkpoints, resume counts

### Center Column: Task List

Shows all tasks organized by status:
- **Running** - Currently executing with live terminal output
- **Queued** - Waiting for a worker slot
- **Completed** - Successfully finished tasks
- **Failed/Escalated** - Tasks requiring attention

Each task card displays:
- Jira ticket key and summary
- Current workflow stage (Queued → Executing → PR Creating → etc.)
- AI provider and model being used
- Real-time terminal output (expandable)
- Checkpoint status (if task has been interrupted/resumed)
- Ralph progress (if using Ralph execution mode)

### Right Column: Virtual Manager

AI-powered code review assistant that:
- Reviews PRs created by workers
- Provides approval/rejection decisions
- Shows review queue and history

---

## Task Workflows

### Standard Workflow (No `deploy` label)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Queued    │────▶│  Executing  │────▶│   Review     │────▶│  Approved   │
└─────────────┘     └─────────────┘     │  Requested   │     └─────────────┘
                                        └──────────────┘            │
                                                                    ▼
                                                           ┌─────────────┐
                                                           │  Deployed   │
                                                           └─────────────┘
```

1. **Queued**: Task received, waiting for worker
2. **Executing**: Worker is implementing the changes
3. **Review Requested**: PR created, awaiting approval
4. **Approved**: PR approved on GitHub
5. **Deployed**: Worker re-runs to merge and deploy

### Auto-Deploy Workflow (`deploy` label)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Queued    │────▶│  Executing  │────▶│  Deployed   │
└─────────────┘     └─────────────┘     └─────────────┘
```

The worker deploys immediately without waiting for PR approval.

---

## Escalation Workflow

When a worker cannot complete a task, it enters the **Escalated** state. This is a critical workflow for handling edge cases and maintaining quality.

### When Tasks Get Escalated

Workers escalate when they encounter:

| Condition | Example |
|-----------|---------|
| **Unclear requirements** | Ticket says "fix the bug" without specifying which bug |
| **Missing information** | Referenced attachments failed to download |
| **Blocked > 15 minutes** | Environment or access issues |
| **Security concerns** | Found vulnerability requiring human decision |
| **Breaking changes** | Required changes would break existing functionality |
| **Cannot reproduce** | Reported issue doesn't occur in testing |

### Escalation Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Executing  │────▶│  Escalated  │────▶│  Re-queued  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   ▼                   │
       │          ┌─────────────────┐          │
       │          │ Human reviews   │          │
       │          │ and clarifies   │          │
       │          └─────────────────┘          │
       │                   │                   │
       └───────────────────┴───────────────────┘
```

### Handling Escalated Tasks

1. **Review the escalation comment** - Workers add detailed comments explaining what they tried and what's blocking them
2. **Provide clarification** - Update the ticket with missing information
3. **Re-queue the task** - Remove and re-add the `workermill` label, or use the dashboard re-queue button

### Dashboard Indicators

Escalated tasks appear with:
- **Orange/amber status badge** indicating escalation
- **Escalation reason** in the task details
- **Worker's analysis** showing what was attempted
- **Re-queue button** to retry after providing clarification

### Escalation vs Failure

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| **Escalated** | Worker understood the task but couldn't complete it | Provide clarification and re-queue |
| **Failed** | Worker encountered a technical error | Check logs, fix infrastructure, retry |

---

## Multi-Provider AI Support

WorkerMill supports multiple AI providers beyond Anthropic Claude:

### Supported Providers

| Provider | Label | Models |
|----------|-------|--------|
| **Anthropic** | `anthropic` (default) | Claude Haiku, Sonnet, Opus |
| **OpenAI** | `openai` | GPT-4o, GPT-4 Turbo, o1 |
| **Google** | `gemini` or `google` | Gemini 2.0 Flash, 1.5 Pro |
| **Ollama** | `ollama` | Llama, Mistral, Code Llama (local) |

### Selecting a Provider

Add the provider label to your Jira ticket alongside `workermill`:

```
Labels: workermill, openai
```

### Provider Display in Dashboard

Each task shows its provider with an icon:
- **Anthropic**: Robot icon
- **OpenAI**: Diamond icon
- **Google**: Circle icon
- **Ollama**: House icon (local)

### Configuring Default Provider

In Settings, you can set your organization's default provider. This is used when no provider label is specified on a ticket.

### Cost Tracking

Each provider has its own pricing engine. The dashboard shows:
- Per-task cost by provider
- Aggregate spend per provider
- Token usage (input/output/cache)

---

## Worker State Checkpointing

Checkpointing enables workers to resume after interruptions (like AWS Spot instance reclaims).

### How Checkpointing Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Working   │────▶│ Interrupted │────▶│   Resumed   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Checkpoint │     │  S3 Save    │     │  S3 Load    │
│  Updated    │     │  Triggered  │     │  + Resume   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Checkpoint State

Workers save their progress to S3, including:
- Current execution stage (cloning, analyzing, implementing, etc.)
- Git branch name
- Files modified
- Commits made
- Test results

### Dashboard Indicators

Tasks with checkpoints show:
- **Checkpoint badge** with current stage
- **Resume count** (e.g., "Resumed 2x")
- **Last save time** showing when state was persisted

### Spot Interruption Handling

When AWS reclaims a Spot instance:
1. Worker receives SIGTERM signal
2. Checkpoint is immediately saved to S3
3. Task is re-queued with "interrupted" status
4. New worker loads checkpoint and continues

### Checkpoint Cleanup

Checkpoints older than 7 days are automatically deleted to prevent unbounded storage growth.

---

## Multi-Worker Coordination

When multiple workers operate on the same repository, WorkerMill coordinates them to prevent conflicts.

### Coordination Features

| Feature | Purpose |
|---------|---------|
| **Check-in** | Workers announce their presence when starting |
| **Heartbeat** | Workers send liveness signals every 30 seconds |
| **File Locks** | Workers can lock files they're modifying |
| **Manifest** | Workers declare which files they intend to modify |

### Conflict Prevention

Before editing files, workers check for other active workers:

```json
[
  {
    "taskId": "uuid",
    "workerId": "ecs-task-id",
    "repo": "owner/repo",
    "branch": "ai/OCS-123",
    "status": "implementing",
    "currentFile": "src/components/Login.tsx",
    "persona": "frontend_developer"
  }
]
```

### Per-Repository Concurrency

The orchestrator enforces limits on concurrent workers per repository:
- Default: 3 workers per repo
- Configurable in Settings

### Stale Worker Cleanup

Workers that haven't sent a heartbeat in 5+ minutes are automatically cleaned up:
- File locks released
- Resource reservations cleared
- Check-in records removed

---

## Ralph Integration

Ralph is an optional execution engine that breaks Jira tickets into smaller "stories" for systematic implementation.

### How Ralph Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Jira Ticket │────▶│  PRD Gen    │────▶│  Planning   │────▶│  Execution  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
                    │  .ralph/    │     │  Stories    │     │  Loop       │
                    │  prd.md     │     │  Created    │     │  Execution  │
                    └─────────────┘     └─────────────┘     └─────────────┘
```

### Ralph Workflow Stages

1. **PRD Generation**: Converts Jira ticket to Product Requirements Document
2. **Planning**: Breaks PRD into implementable stories
3. **Execution Loop**: Processes each story sequentially

### Dashboard Progress Display

Ralph tasks show additional progress information:
- **Story progress bar**: Visual indicator of completion (e.g., "3/7 stories")
- **Current story description**: What's being implemented now
- **Completed stories count**: Running tally

### Enabling Ralph

Ralph is disabled by default. To enable:
1. Go to Settings
2. Toggle "Use Ralph Execution" to ON
3. Configure "Max Stories" (default: 10)

### When to Use Ralph

Ralph is best for:
- Complex features requiring multiple components
- Tasks with detailed acceptance criteria
- Systematic refactoring work

Standard Claude execution is better for:
- Simple bug fixes
- Single-file changes
- Quick iterations

---

## Settings & Configuration

Access Settings from the gear icon in the dashboard header.

### Worker Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Default Model** | claude-haiku-4-5 | AI model for new tasks |
| **Default Provider** | Anthropic | AI provider when no label specified |
| **Default Persona** | backend_developer | Worker role for new tasks |
| **Max Concurrent Workers** | 3 | Parallel workers per organization |
| **Task Cooldown** | 30 seconds | Time before re-processing same ticket |
| **Default Max Retries** | 3 | Retry attempts for failed tasks |

### Provider Configuration

Select your organization's default AI provider:
- Click the provider card to select
- Provider-specific API keys are configured in AWS Secrets Manager

### Ralph Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Use Ralph Execution** | OFF | Enable Ralph PRD→Plan→Loop mode |
| **Max Stories** | 10 | Maximum stories per ticket |

### Data Retention

| Setting | Default | Description |
|---------|---------|-------------|
| **Log Retention** | 30 days | Days to keep task logs |
| **Task Retention** | 90 days | Days to keep task records |

### Cost Alerts

Set a threshold to receive alerts when daily spend exceeds a limit.

---

## API Reference

### Authentication

All API requests require an organization API key:

```bash
curl -H "X-API-Key: your-org-api-key" \
     https://workermill.com/api/control-center
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/control-center` | GET | Get all tasks and stats |
| `/api/control-center/stream` | GET | SSE stream for real-time updates |
| `/api/tasks/:taskId/logs` | POST | Post worker logs |
| `/api/coordination/check-in` | POST | Worker check-in |
| `/api/coordination/heartbeat` | POST | Worker heartbeat |
| `/api/settings` | GET/PUT | Organization settings |

### Webhook

Configure your Jira webhook to:
- **URL**: `https://workermill.com/api/webhooks/jira`
- **JQL Filter**: `labels = workermill`

---

## Troubleshooting

### Task Stuck in "Queued"

1. Check orchestrator status (should be "running")
2. Verify worker slots available (check Max Concurrent Workers)
3. Check for stale coordination locks

### Task Stuck in "Executing"

1. Check worker logs for errors
2. Look for checkpoint status (may have been interrupted)
3. Check ECS task status in AWS Console

### Worker Not Deploying

1. Verify `deploy` label is present on ticket
2. Check worker has required AWS permissions
3. Review deployment logs for errors

### Escalated Tasks

1. Read the escalation comment for details
2. Provide missing information in ticket
3. Remove and re-add `workermill` label to retry

---

## Support

- **Issues**: https://github.com/anthropics/workermill/issues
- **Documentation**: https://workermill.com/docs
- **Dashboard**: https://workermill.com

