# Analytics

Track effectiveness, code quality, costs, and throughput across your WorkerMill deployment.

## Effectiveness Metrics

| Metric | Description |
|--------|-------------|
| **Success Rate** | Percentage of tasks completed successfully |
| **Deployment Rate** | Tasks that were deployed to production |
| **First Attempt Rate** | Tasks completed without retries |
| **PR Acceptance Rate** | Pull requests accepted by reviewers |
| **Escalation Rate** | Tasks escalated to human intervention |

## Code Quality

| Metric | Description |
|--------|-------------|
| **Quality Score** | Overall code quality rating (0–100) |
| **Lint Score** | Code style and formatting compliance |
| **Typecheck Score** | TypeScript type safety |
| **Test Score** | Test pass rate |
| **Coverage Score** | Code coverage percentage |
| **Security Score** | Security vulnerability assessment |

## Token & Cost

| Metric | Description |
|--------|-------------|
| **Total Tokens** | Input + output tokens consumed |
| **Cache Efficiency** | Percentage of tokens served from cache |
| **Cost per Task** | Average spend per completed task |
| **Cost per Story** | Average spend per expert story |
| **Monthly Spend** | Aggregated costs across all providers |

## Time Metrics

| Metric | Description |
|--------|-------------|
| **MTTA** | Mean Time to Acknowledge — queue time before worker claims |
| **MTTR** | Mean Time to Resolution — total task execution time |
| **Planning Duration** | Time spent in planning phase |
| **Execution Duration** | Time spent in active execution |
| **Review Duration** | Time waiting for PR review |

## Persona Analytics

Track performance per worker persona:
- Success rate by persona
- Average cost per persona
- Task count and throughput
- Revision request rate
- Escalation rate by persona

## Viewing Analytics

Analytics are available at **/analytics** in the dashboard. You can filter by:
- Date range
- Persona
- Repository
- AI provider
- Task status

Export data as CSV for further analysis.
