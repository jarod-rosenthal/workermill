# WorkerMill User Guide

> Mission control for autonomous AI coding agents

WorkerMill is a real-time monitoring and orchestration system for AI agents that execute coding tasks. This guide covers all features available in the dashboard and how to configure workers for your workflows.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Task Workflows](#task-workflows)
4. [Escalation Workflow](#escalation-workflow)
5. [Worker Personas](#worker-personas)
6. [Multi-Provider AI (BYOK)](#multi-provider-ai-byok)
7. [Integrations](#integrations)
8. [Worker State Checkpointing](#worker-state-checkpointing)
9. [Multi-Worker Coordination](#multi-worker-coordination)
10. [PRD Orchestration](#prd-orchestration)
11. [Settings & Configuration](#settings--configuration)
12. [API Reference](#api-reference)
13. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Triggering Your First Worker

1. **Create a ticket** in your connected issue tracker (Jira, Linear, or GitHub Issues)
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
| `anthropic` / `openai` / `gemini` / `ollama` | AI provider selection |
| `backend` / `frontend` / `devops` / `security` / `qa` | Force specific worker persona |

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
- Ticket key and summary
- Current workflow stage (Queued → Executing → PR Creating → etc.)
- AI provider and model being used
- Real-time terminal output (expandable)
- Checkpoint status (if task has been interrupted/resumed)
- PRD workflow progress (stories completed, running, blocked)

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

## Worker Personas

WorkerMill uses specialized AI personas optimized for different types of work. Personas are automatically assigned based on ticket content, or can be manually selected using labels.

### Production Personas

| Persona | Label | Best For | Key Skills |
|---------|-------|----------|------------|
| **Backend Developer** | `backend` | APIs, database, business logic | Node.js, Python, TypeORM, REST/GraphQL, PostgreSQL |
| **Frontend Developer** | `frontend` | UI components, React, styling | React 19, TypeScript, TailwindCSS, accessibility, Zustand |
| **DevOps Engineer** | `devops` | Infrastructure, CI/CD, Docker | Terraform, GitHub Actions, ECS, CloudFormation, Kubernetes |
| **Security Engineer** | `security` | Vulnerability fixes, auth, audits | OWASP Top 10, Snyk, secrets management, penetration testing |
| **QA Engineer** | `qa` | Unit tests, E2E tests, automation | Jest, Playwright, Vitest, k6, test coverage |
| **Technical Writer** | `techwriter` | README, API docs, comments | OpenAPI/Swagger, Markdown, Docusaurus, JSDoc |
| **Project Manager** | `pm` | Task triage, planning, reports | Jira, estimation, dependency mapping, sprint planning |

### Coming Soon Personas

| Persona | Best For | Key Skills |
|---------|----------|------------|
| **Data Engineer** | ETL pipelines, data modeling | dbt, Airflow, Snowflake, BigQuery, Pandas |
| **ML Engineer** | Training pipelines, model deployment | PyTorch, MLflow, SageMaker, scikit-learn |
| **Mobile Developer (iOS)** | iOS app development | Swift, SwiftUI, Xcode, Core Data |
| **Mobile Developer (Android)** | Android app development | Kotlin, Jetpack Compose, Room |
| **API Developer** | API design, SDK creation | OpenAPI, Postman, GraphQL codegen |
| **Database Administrator** | Schema design, query optimization | PostgreSQL, indexing, migrations |

### Persona Selection

Personas are selected in this priority order:

1. **Label on ticket** - e.g., `frontend` forces Frontend Developer
2. **Ticket content analysis** - AI analyzes description to pick best fit
3. **Organization default** - Set in Settings

### Virtual Manager

The Virtual Manager is a special persona that reviews all PRs:
- Analyzes code changes for quality
- Checks for security issues
- Provides approval/rejection decisions
- Handles the review queue

---

## Multi-Provider AI (BYOK)

WorkerMill supports a **BYOK (Bring Your Own Key)** model - use your own AI provider API keys with complete cost transparency and zero markup.

### Why BYOK?

| Benefit | Description |
|---------|-------------|
| **Zero Markup** | Pay only what the provider charges - no platform fees |
| **Direct Relationship** | Access new models immediately when released |
| **Existing Contracts** | Leverage your enterprise AI agreements |
| **Cost Transparency** | See exact token costs per task |
| **Data Sovereignty** | Your API key, your data policies |

### Supported Providers

| Provider | Label | Models | Best For |
|----------|-------|--------|----------|
| **Anthropic** | `anthropic` (default) | Claude Haiku, Sonnet, Opus | Primary development, best coding quality |
| **OpenAI** | `openai` | GPT-4o, GPT-4 Turbo, o1 | Alternative reasoning, existing infrastructure |
| **Google** | `gemini` | Gemini 2.0 Flash, 1.5 Pro | Large context windows, diverse workloads |
| **Ollama** | `ollama` | Llama, Mistral, Code Llama | Local execution, sensitive code, full data control |

### Selecting a Provider

Add the provider label to your ticket alongside `workermill`:

```
Labels: workermill, openai, sonnet
```

### Provider Selection Priority

```
Task Label (e.g., "openai")
         │
         ▼
Model Label (e.g., "sonnet" → Anthropic)
         │
         ▼
Organization Default Provider
         │
         ▼
First Configured Provider
```

### Configuring API Keys

1. **Navigate to Settings** in the WorkerMill dashboard
2. **Go to AI Providers** section
3. **Enter your API key** for each provider
4. **Test the connection** using the "Validate" button
5. **Set a default provider** for your organization

For self-hosted deployments, configure via AWS Secrets Manager:
- `workermill/dev/anthropic-api-key`
- `workermill/dev/openai-api-key`
- `workermill/dev/google-api-key`

### Cost Tracking

Each task tracks AI costs with full transparency:
- Per-task cost by provider and model
- Token usage breakdown (input/output/cache)
- Aggregate spend per provider
- Daily and monthly cost reports

See [BYOK Guide](BYOK_GUIDE.md) for complete documentation.

---

## Integrations

WorkerMill integrates with issue trackers, code repositories, and notification platforms.

### Issue Trackers

| Platform | Status | Webhook Endpoint | Notes |
|----------|--------|------------------|-------|
| **Jira** | Production | `/api/webhooks/jira` | Primary integration for enterprise |
| **Linear** | Production | `/api/webhooks/linear` | Same label workflow as Jira |
| **GitHub Issues** | Production | `/api/webhooks/github-issues` | Uses `GH-{number}` as task key |
| **Asana** | Coming Soon | `/api/webhooks/asana` | Enterprise project management |
| **ClickUp** | Coming Soon | `/api/webhooks/clickup` | All-in-one productivity |

### Setting Up Jira

1. Go to **Project Settings → Automation** or **Webhooks**
2. Create a rule: "When issue updated" → "Send web request"
3. Configure:
   - **URL**: `https://workermill.com/api/webhooks/jira`
   - **Method**: POST
   - **JQL Filter**: `labels = workermill`

### Setting Up Linear

1. Go to **Settings → API → Webhooks**
2. Add webhook URL: `https://workermill.com/api/webhooks/linear`
3. Select events: Issue created, Issue updated
4. Create the `workermill` label in your workspace

### Setting Up GitHub Issues

1. Go to **Repository Settings → Webhooks**
2. Add webhook URL: `https://workermill.com/api/webhooks/github-issues`
3. Select events: Issues (opened, edited, labeled)
4. Create labels: `workermill`, `deploy`, `review`, etc.

### Code Platforms

| Platform | Status | Features |
|----------|--------|----------|
| **GitHub** | Production | PR creation, webhooks, branch management |
| **GitLab** | Coming Soon | MR creation, CI/CD integration |

### Notifications

| Platform | Status | Features |
|----------|--------|----------|
| **Slack** | Production | Task notifications, cost alerts, escalations |
| **Discord** | Coming Soon | Community/team notifications |
| **Email** | Coming Soon | Digest and real-time notifications |

See [Integrations Guide](INTEGRATIONS.md) for detailed setup instructions.

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

## PRD Orchestration

PRD Orchestration is WorkerMill's multi-story execution engine that breaks complex tickets into coordinated stories for parallel implementation. It enables a "planning agent" approach where an AI PM decomposes requirements into discrete, dependency-aware work units.

### Overview

| Aspect | Description |
|--------|-------------|
| **Purpose** | Break PRD-style tickets into parallel, coordinated stories |
| **Best For** | Complex features, multi-component work, systematic refactoring |
| **Workflow** | Ticket → Planning → Dependency Graph → Parallel Execution |
| **Dashboard** | Dedicated orchestration view with story tracking and live terminals |

### Workflow Phases

PRD Orchestration operates in two distinct phases:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Jira Ticket │────▶│  Planning   │────▶│  Execution  │
│ + workermill│     │   Phase     │     │   Phase     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                  │                   │
       ▼                  ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ PRD-style   │     │ PM analyzes │     │ Stories run │
│ requirements│     │ → Stories   │     │ in parallel │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Phase 1: Planning**
- Virtual PM (Project Manager persona) analyzes the ticket
- Decomposes requirements into discrete, implementable stories
- Establishes dependency graph between stories
- Creates `.workermill/` directory with plan artifacts

**Phase 2: Execution**
- Stories execute in parallel (respecting dependencies)
- Each story runs as a separate worker with its own terminal
- Coordination system prevents file conflicts
- Dashboard shows real-time progress across all stories

### Orchestration UI Layout

The orchestration view provides comprehensive monitoring:

```
┌──────────┬─────────────────────────────┬──────────────┐
│ Attention│      Workflow Header        │ Coordination │
│  Panel   ├─────────────────────────────┤    Feed      │
│          │      Dependency Graph       │              │
│ • Blocked│   [S0]──▶[S1]──▶[S2]       │ • file_created│
│ • Failed │      └──▶[S3]──┘           │ • decisions  │
│ • Review │                             │ • questions  │
│          ├─────────────────────────────┤              │
│          │      Story Cards            │              │
│          │  ✓ S0  ● S1  ○ S2  ⊘ S3    │              │
├──────────┴─────────────────────────────┴──────────────┤
│  Terminal Tabs: [S0] [S1] [S2] [S3]                   │
│  $ claude analyzing requirements...                    │
└───────────────────────────────────────────────────────┘
```

**Left Panel: Attention Items**
- Stories requiring human attention (blocked, failed, review needed)
- One-click actions to unblock or retry

**Center: Workflow Visualization**
- Header with workflow status and progress metrics
- Interactive dependency graph showing story relationships
- Story cards with status indicators and quick actions

**Right Panel: Coordination Feed**
- Real-time event stream (file operations, decisions, questions)
- Helps understand cross-story coordination

**Bottom: Terminal Tabs**
- One tab per story showing live worker output
- Switch between stories to monitor progress

### Story Status States

| Icon | Status | Description |
|------|--------|-------------|
| ○ | **Pending** | Waiting for dependencies to complete |
| ● | **Running** | Worker actively executing this story |
| ✓ | **Completed** | Story finished successfully |
| ✗ | **Failed** | Worker encountered an error |
| ⊘ | **Blocked** | Waiting for human input or external action |
| ⏸ | **Paused** | Manually paused by user |

### Execution Modes

PRD Orchestration supports two execution modes:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Autonomous** | Workers make decisions independently | Trusted workflows, clear requirements |
| **Supervised** | Workers pause and ask for approval on decisions | New workflows, learning phase |

Configure the default mode in Settings or override per-ticket with labels.

### Triggering PRD Orchestration

PRD Orchestration activates automatically for tickets with PRD-style content. Write your ticket as a Product Requirements Document:

```markdown
## Problem Statement
Users cannot export their data in multiple formats.

## Requirements
1. Add CSV export functionality
2. Add JSON export functionality
3. Add PDF export with formatting

## Acceptance Criteria
- Export buttons appear in data view
- Files download correctly in all formats
- Large datasets (10k+ rows) handled gracefully
```

**Required labels:**
- `workermill` - Triggers WorkerMill processing
- (Optional) `supervised` - Enable supervised execution mode

### Dependency Graph

The planning phase creates a dependency graph that determines execution order:

```
       ┌──────────────────────┐
       │   S0: Setup models   │
       └──────────┬───────────┘
                  │
         ┌───────┴───────┐
         ▼               ▼
┌─────────────┐   ┌─────────────┐
│ S1: CSV     │   │ S2: JSON    │
│ export      │   │ export      │
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                ▼
       ┌─────────────────┐
       │ S3: PDF export  │
       │ (depends on S1) │
       └─────────────────┘
```

Stories without dependencies (S1, S2) run in parallel. Stories with dependencies (S3) wait until prerequisites complete.

### Best Practices

**Writing Effective PRD Tickets:**
- Be specific about acceptance criteria
- Include technical constraints when known
- Reference existing patterns in the codebase
- Break down by feature area, not by file

**Monitoring Execution:**
- Watch the coordination feed for cross-story events
- Check the attention panel regularly for blocked stories
- Use terminal tabs to debug specific story issues

**Handling Failures:**
- Failed stories can be retried individually
- Dependent stories automatically pause when upstream fails
- Review logs before retrying to understand root cause

### Related Documentation

- **[PRD Orchestration UI](prd-orchestration-ui.md)** - Detailed UI component reference
- **[Dynamic PRD Planning](dynamic-prd-planning.md)** - Planning agent architecture
- **[Multi-Worker Coordination](#multi-worker-coordination)** - How workers coordinate

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
- Provider-specific API keys are configured in Settings or AWS Secrets Manager

### PRD Orchestration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable PRD Orchestration** | ON | Enable multi-story PRD decomposition |
| **Max Stories** | 10 | Maximum stories per ticket |
| **Default Execution Mode** | Autonomous | Worker decision mode (Autonomous/Supervised) |

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
| `/api/billing/status` | GET | Plan and usage info |
| `/api/analytics/tasks` | GET | Task statistics |
| `/api/analytics/costs` | GET | Cost breakdown by model/persona |

### Webhooks

| Platform | URL |
|----------|-----|
| Jira | `https://workermill.com/api/webhooks/jira` |
| Linear | `https://workermill.com/api/webhooks/linear` |
| GitHub Issues | `https://workermill.com/api/webhooks/github-issues` |
| GitHub PRs | `https://workermill.com/api/webhooks/github` |

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

### Provider Errors

1. Verify API key is correct and has required permissions
2. Check provider dashboard for rate limits or quota
3. Try a different model or provider

See [Troubleshooting Guide](TROUBLESHOOTING.md) for more solutions.

---

## Related Documentation

- **[BYOK Guide](BYOK_GUIDE.md)** - Complete BYOK and provider configuration
- **[Integrations Guide](INTEGRATIONS.md)** - Detailed integration setup
- **[Architecture](ARCHITECTURE.md)** - Technical architecture overview
- **[Worker Instructions](../worker/AGENTS.md)** - How AI workers operate

---

## Support

- **Issues**: https://github.com/jarod-rosenthal/workermill/issues
- **Documentation**: https://workermill.com/docs
- **Dashboard**: https://workermill.com
