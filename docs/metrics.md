# Metrics

Track performance, costs, and throughput across your WorkerMill deployment. Key metrics include MTTA (Mean Time to Acknowledge) and MTTR (Mean Time to Resolution).

## Key Time Metrics

### MTTA — Mean Time to Acknowledge

The average time from when a task is **created** (queued) to when it is **claimed** by a worker.

```
Task Created ──────────── Worker Claims
             [  MTTA  ]
```

**Factors affecting MTTA:**
- Queue depth (more tasks = longer wait)
- Worker availability and capacity
- Task priority (P1 acknowledged faster)
- Persona availability

**Typical MTTA:** < 2 minutes*

*Varies based on queue depth and worker availability

---

### MTTR — Mean Time to Resolution

The average time from when a task is **claimed** by a worker to when it is **completed** (PR merged or deployed).

```
Worker Claims ──────────────────────────── Task Complete
              [         MTTR            ]
```

**Factors affecting MTTR:**
- Task complexity and scope
- Number of stories in the execution plan
- Revision cycles (PR review, tech lead feedback)
- CI/CD pipeline speed
- Worker model (faster models = faster MTTR)

**Typical MTTR:** 15–45 minutes for standard tasks

---

## Cost Metrics

| Metric | Description |
|--------|-------------|
| **Cost per Task** | Total tokens × per-token price for the task |
| **Cost per Story** | Cost breakdown per expert story in an epic |
| **Cache Savings** | Tokens served from prompt cache (significant savings for long contexts) |
| **Provider Breakdown** | Costs split by AI provider when using multiple providers |
| **Monthly Spend** | Aggregated across all tasks and providers |

## Throughput Metrics

| Metric | Description |
|--------|-------------|
| **Tasks per Day** | Tasks completed in rolling 24h window |
| **Tasks per Week** | Weekly throughput trend |
| **Concurrent Workers** | Peak and average parallel workers |
| **Queue Depth** | Pending tasks waiting for workers |

## Quality Metrics

| Metric | Description |
|--------|-------------|
| **Success Rate** | Tasks completing without failure |
| **First Attempt Rate** | Tasks succeeding without retries |
| **PR Acceptance Rate** | PRs merged without major revision requests |
| **Escalation Rate** | Tasks requiring human intervention |
| **Revision Rate** | Average revisions requested per PR |

## Viewing Metrics

All metrics are available at **/analytics** in the dashboard. Time ranges:
- Last 24 hours
- Last 7 days
- Last 30 days
- Custom date range

Export as CSV for custom analysis or BI tool integration.

## Metric Targets

| Metric | Good | Investigate |
|--------|------|-------------|
| MTTA | < 2 min | > 5 min |
| MTTR | < 30 min | > 60 min |
| Success Rate | > 85% | < 70% |
| Escalation Rate | < 10% | > 20% |
| Cost per Task | < $1.00 | > $3.00 |
