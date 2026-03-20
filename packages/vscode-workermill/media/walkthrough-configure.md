# Configure AI & Quality Settings

Fine-tune how WorkerMill plans and executes your tasks.

### AI Models

Set which models handle each role:

| Role | Default | Purpose |
|------|---------|---------|
| **Worker** | Claude Sonnet 4.6 | Writes code for each story |
| **Planner** | Claude Opus 4.6 | Decomposes tasks into stories |
| **Reviewer** | Claude Opus 4.6 | Reviews PRs as tech lead |

You can also route individual personas to different providers (OpenAI, Google, Ollama) from the Settings panel.

### Quality Gates

WorkerMill enforces quality at two checkpoints:

- **Pre-commit** — runs lint, typecheck, and tests before every commit. Failures trigger an auto-fix agent.
- **Post-push** — polls your CI pipeline (GitHub Actions, GitLab CI, Bitbucket Pipelines) after push.

Configure which gates are active, auto-fix behavior, and retry limits in **Settings > Quality**.

### Issue Trackers

Connect Jira, Linear, or GitHub Issues so you can trigger tasks directly from your tracker by adding the `workermill` label.
