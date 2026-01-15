# WorkerMill Demo Cheat Sheet

**Live URL:** https://workermill.com
**Tagline:** "htop for AI workers" - Mission control for autonomous AI coding agents

---

## Quick Pitch (30 seconds)

WorkerMill is a real-time monitoring and orchestration platform for AI coding agents. It gives you:

- **7 specialized AI workers** (frontend, backend, devops, security, QA, docs, PM)
- **Virtual Manager** that auto-reviews all PRs and requests revisions
- **Real-time terminal streaming** at 500ms (faster than CloudWatch)
- **Token-level cost tracking** with cache optimization visibility
- **Deep Jira + GitHub integration** for end-to-end automation

---

## Key Numbers to Mention

| Stat | Value |
|------|-------|
| AI Worker Personas | 7 specialized roles + 1 Virtual Manager |
| Task States | 17 unique states across 6 workflow types |
| Streaming Latency | 500ms (vs CloudWatch 1s+) |
| Revision Loops | Up to 3 automated improvement cycles |
| Model Options | Haiku (fast), Sonnet (balanced), Opus (complex) |
| Cost Savings | ~70% via Spot instances + cache optimization |

---

## The 7 AI Workers

| Persona | Specialty |
|---------|-----------|
| **Frontend Developer** | React, UI/UX, styling, accessibility |
| **Backend Developer** | APIs, database, server logic, integrations |
| **DevOps Engineer** | Docker, K8s, CI/CD, Terraform, cloud |
| **Security Engineer** | Vulnerability scanning, fixes, compliance |
| **QA Engineer** | Test writing, coverage, bug reproduction |
| **Tech Writer** | API docs, guides, README, tutorials |
| **Project Manager** | Ticket breakdown, roadmaps, coordination |
| **Virtual Manager** | Auto-reviews PRs, requests revisions, approves |

---

## Jira Label Control

| Label | Effect |
|-------|--------|
| `workermill` | **Required** - Triggers AI worker |
| `haiku` / `sonnet` / `opus` | Model selection (default: haiku) |
| `deploy` | Skip human approval, auto-merge + deploy |
| `review` | Require Virtual Manager approval |

---

## Workflow Options

### Standard Flow (no `deploy` label)
```
Jira ticket → Worker creates PR → Human reviews on GitHub → Worker deploys
```

### Auto-Deploy Flow (`deploy` label)
```
Jira ticket → Worker creates PR → Auto-merge → Auto-deploy (no human gate)
```

### Manager Review Flow (`review` label)
```
Jira ticket → Worker creates PR → Virtual Manager reviews → Revision loop (up to 3x) → Deploy
```

---

## Dashboard Features to Demo

### 1. Three-Column Layout
- **Left:** Stats (workers, queue, costs, reset controls)
- **Center:** Active tasks + completed history with live progress
- **Right:** Virtual Manager (PR queue, approvals, feedback)

### 2. Live Task Visualization
- Step indicators: Queued → Executing → PR Created → Review → Deployed
- Revision count badges (shows feedback loops)
- Terminal log streaming (click to expand)

### 3. Cost Transparency
- Per-task breakdown: input tokens, output tokens, cache hits
- Period metrics: completed/failed count, period cost
- Cache benefit: 90% savings on repeated patterns

### 4. Virtual Manager Panel
- PR review queue with status
- Revision feedback displayed inline
- Auto-approve/reject with reasoning

---

## Architecture Highlights

### Why PostgreSQL + SSE (not CloudWatch)?
- CloudWatch minimum latency: 1 second
- WorkerMill SSE: **500ms updates**
- Workers POST logs to API → Stored in DB → SSE streams to dashboard

### Spot Instance Strategy
- Detects interruptions (exit code 137)
- Auto-requeues with exponential backoff
- **70% cost savings** vs on-demand

### Atomic Task Claiming
- `UPDATE ... WHERE status = 'queued'` prevents duplicates
- No race conditions with multiple orchestrators
- Database is single source of truth

---

## Cost Model

### Model Pricing (per 1K tokens)
| Model | Input | Output |
|-------|-------|--------|
| Haiku 4.5 | $0.0008 | $0.004 |
| Sonnet 4.5 | $0.003 | $0.015 |
| Opus 4.5 | $0.005 | $0.025 |

### Cache Benefits
- Cache writes: 1.25x input cost
- Cache reads: **0.1x input cost** (90% savings!)

### Compute
- Fargate Spot: ~$0.015/hour (2vCPU/4GB)

---

## Demo Flow Suggestions

### Demo 1: Basic Task Execution (~5 min)
1. Show dashboard with empty queue
2. Create Jira ticket with `workermill` label
3. Watch task appear and progress through states
4. Show real-time terminal logs streaming
5. See PR created and linked

### Demo 2: Virtual Manager Review (~5 min)
1. Create ticket with `workermill` + `review` labels
2. Worker creates PR
3. Manager auto-reviews (show feedback)
4. Worker implements revisions
5. Manager approves, PR merges

### Demo 3: Cost Analysis (~3 min)
1. Show completed task cost breakdown
2. Highlight cache read savings
3. Compare Haiku vs Opus costs
4. Show period vs cumulative metrics

### Demo 4: Model Selection (~2 min)
1. Show simple task with Haiku (fast, cheap)
2. Show complex task with Opus (thorough)
3. Explain when to use each

---

## Common Questions & Answers

**Q: How is this different from GitHub Copilot?**
A: Copilot assists humans. WorkerMill deploys autonomous agents that complete entire tickets, create PRs, and iterate on feedback - no human coding required.

**Q: What prevents infinite revision loops?**
A: Max 3 revision cycles. After that, task auto-rejects and requires human intervention.

**Q: Can workers access production?**
A: Only if `deploy` label is set. Default flow requires human PR approval before any deployment.

**Q: How do you handle API rate limits?**
A: Per-org concurrency limits (default 3 workers), cooldown periods between task pickups.

**Q: What if a worker makes a mistake?**
A: Virtual Manager catches most issues. For safety-critical deploys, use `review` label for manager gate.

---

## Technical Differentiators

| vs GitHub Actions | vs Other AI Platforms | vs Manual Dev |
|-------------------|----------------------|---------------|
| Real-time visibility | Self-hosted option | 24/7 operation |
| Cancel/pause anytime | Multiple AI personas | Consistent quality |
| Per-token costs | Cost-optimized (Spot) | Audit trail |
| Quality gates built-in | Deep integrations | Parallelizable |

---

## Quick Commands (if showing terminal)

```bash
# Deploy all services
./deploy.sh --all

# View worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

# Check orchestrator status
curl https://workermill.com/api/orchestrator/status

# Start/stop orchestrator
curl -X POST https://workermill.com/api/orchestrator/start
curl -X POST https://workermill.com/api/orchestrator/stop
```

---

## Support Links

- **Live Dashboard:** https://workermill.com
- **GitHub:** https://github.com/jarod-rosenthal/workermill
- **Jira Project (OCS):** oncallshift tasks
- **Jira Project (WM):** WorkerMill platform tasks

---

*Good luck with the demo!*
