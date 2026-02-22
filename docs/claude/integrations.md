# Jira Integration

## Triggering AI Workers

Add the `workermill` label to a Jira or GitHub Issue to trigger an AI worker task. **Linear does NOT support label-change webhooks** — Linear's webhook API does not fire events when labels are added/removed from issues. Linear tasks are created via the dashboard **Run Task** button (`POST /api/tasks` in `api/src/routes/tasks/crud.ts`), not via webhooks. The Linear webhook handlers in `linear.ts` exist for status-change events but are rarely the task creation path in practice.

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model override (default: org's `defaultWorkerModel`) |
| `deploy` | Auto-merge PR and deploy without human approval |
| `review` | Require manager review before merge |
| `sdk` / `standard` / `v1` | Standard SDK Mode (single-task, no story decomposition) |
| `critic` | Enable Planner-Critic validation |
| `manager` | Enable manager workflow |
| `improve` | Self-improvement analysis |
| `prd` / `epic` / `multi-story` / `orchestration` | PRD decomposition triggers |
| `multi-provider` | Force Vercel AI SDK execution path |
| `bypass-quality-gate` / `force-merge` | Skip quality gate checks |

## Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

## Worker Deployment Workflow

**Standard:** Worker creates PR → outputs `::result::review_requested` → human approves → webhook re-triggers → worker merges & deploys.

**Auto-deploy (with `deploy` label):** Worker creates PR → immediately merges → deploys → outputs `::result::deployed`.

**Webhooks:** All at `https://workermill.com/api/webhooks/{jira,linear,github-issues,github,gitlab,bitbucket}`. Route files in `api/src/routes/webhooks/` (directory with per-provider sub-routes: `jira.ts`, `linear.ts`, `github.ts`, `github-issues.ts`, `gitlab.ts`, `bitbucket.ts`, `email.ts`, `support.ts`, `github-runner.ts`).
