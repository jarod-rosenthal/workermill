# Integrations

WorkerMill connects your issue trackers, SCM providers, AI models, and notification systems into an automated development pipeline.

## How It Works

```
Issue Tracker → WorkerMill (AI Worker Executes) → SCM Provider → Notifications
Jira/Linear/GitHub           AI planning + coding           GitHub/GitLab/BitBucket   Slack/Email
```

---

## AI Providers

WorkerMill works with **all major AI providers**. Choose the provider and model that best fits your needs, or configure per-persona provider routing for maximum flexibility.

| Provider | Models | Best For |
|----------|--------|---------|
| Anthropic Claude | Opus 4.6, Sonnet 4.6, Haiku 4.5 | Complex coding tasks |
| OpenAI | GPT-5.4, GPT-5.4-mini, GPT-5.4-pro | Strong general purpose |
| Google Gemini | Gemini 3.1 Pro, Gemini 3.1 Flash Lite | Fast and efficient |
| Ollama | Llama, Qwen, DeepSeek | Self-hosted models |

**Bring Your Own API Key** — Use your own API keys for any supported provider. Full control over costs and data.

**Per-Persona Provider Routing** — Route different worker personas to different providers. Use flagship models for security, efficient models for simple tasks.

---

## Issue Trackers

### Jira

WorkerMill monitors your Jira projects for tasks with the configured label and automatically assigns them to AI workers.

**Required Configuration:**
- Jira instance URL (e.g., `your-org.atlassian.net`)
- API token with read/write access
- Project key(s) to monitor
- Task label (e.g., `workermill`)

**What WorkerMill Does:**
- Receives webhooks for labeled tickets
- Reads ticket summary, description, and comments
- Updates ticket status during execution
- Posts PR links and results as comments
- Transitions tickets on completion

**Webhook URL:** `/api/webhooks/jira`

---

### Linear

WorkerMill integrates with Linear for status-change events.

> **Note:** Linear's webhook API does not fire events when labels are added or removed, so Linear tasks are typically created via the dashboard **Run Task** button rather than label-based triggers.

**Setup:**
- Configure Linear webhook in Settings
- Point webhook to `/api/webhooks/linear`
- Create `workermill` label in your Linear workspace
- Optionally add model labels (`haiku`, `sonnet`, `opus`)

**Supported Labels:**
- `workermill` — Triggers task creation
- `haiku` / `sonnet` / `opus` — Model selection
- `deploy` — Auto-deploy without PR approval
- `review` — Require Tech Lead Reviewer review

**Webhook URL:** `/api/webhooks/linear`

---

## SCM Providers

### GitHub

Workers create branches and pull requests automatically for completed work. You can also trigger workers directly from GitHub Issues.

**Required Configuration:**
- GitHub personal access token or app token
- Repository URL with push permissions
- Default branch for PR targets (usually `main`)
- Webhook for PR reviews and Issues (optional)

**What WorkerMill Does:**
- Creates branch from ticket key (e.g., `feature/PROJ-123`)
- Commits code changes with descriptive messages
- Opens pull request with summary and test results
- Links PR back to issue tracker

**GitHub Issues Integration:**
Trigger workers directly from GitHub Issues by adding the `workermill` label.
Webhook URL: `/api/webhooks/github-issues`

---

### GitLab

WorkerMill supports GitLab as both an SCM provider and issue tracker.

**Setup:**
- Configure GitLab in Settings → Integrations
- Add personal access token with `api` scope
- Set up webhook to `/api/webhooks/gitlab`
- Create `workermill` label in your project

**Features:**
- Merge request creation with descriptions
- MR approval webhook handling
- Self-hosted GitLab support
- Same label workflow as Jira/Linear

---

### BitBucket

WorkerMill integrates with Atlassian BitBucket for teams using the Atlassian ecosystem. Supports both BitBucket Cloud and self-hosted BitBucket Server.

**Setup:**
- Configure BitBucket in Settings → Integrations
- Add Repository Access Token with repository write access
- Set up webhook to `/api/webhooks/bitbucket`
- Works with Jira for end-to-end Atlassian workflow

**Features:**
- Pull request creation with reviewers
- PR approval webhook handling
- Self-hosted BitBucket Server support
- Seamless Jira + BitBucket workflow

---

## Notifications

### Slack
Real-time notifications to Slack channels for task updates, PR creation, and completions.
- Incoming webhook integration
- Customizable notifications
- Channel-based routing

### Email
Email notifications for task completions, failures, cost alerts, and team invites.
- Task completion & failure alerts
- Cost budget warnings
- Per-user notification preferences

**Notification Events:** task started, PR created, task completed, task failed

---

## Issue Tracker Updates

WorkerMill posts status updates as comments on your issues at key milestones:

```
When task is claimed:
  AI Worker (backend_developer) has started working on this ticket.

When PR is created:
  Pull request created: github.com/org/repo/pull/123

When task completes:
  Task completed successfully. Duration: 12m, Cost: $0.45
```

---

## Execution Modes

**Remote Agent** — Part of the VS Code extension workflow. Connects the extension to local Docker workers. Code stays on your machine. BYOK — pay your provider directly.

**Cloud Mode** — Workers run as managed containers in the cloud. BYOK — pay your provider directly. Includes automatic scaling, worker checkpointing, and real-time log streaming.
