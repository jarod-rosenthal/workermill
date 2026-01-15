# WorkerMill Integrations Guide

This guide covers all integrations supported by WorkerMill, including setup instructions, webhook configuration, and best practices.

## Overview

WorkerMill integrates with issue trackers, code repositories, and notification platforms to provide a seamless automation workflow:

```
Issue Tracker          WorkerMill              Code Platform
┌─────────────┐       ┌─────────────┐         ┌─────────────┐
│   Jira      │──────▶│  Webhook    │         │   GitHub    │
│   Linear    │       │  Handler    │────────▶│   GitLab    │
│   GitHub    │       │             │         │             │
│   Issues    │       │  Task       │         │   PR/MR     │
└─────────────┘       │  Execution  │         │  Creation   │
                      └─────────────┘         └─────────────┘
                             │
                             ▼
                      ┌─────────────┐
                      │   Slack     │
                      │  Discord    │
                      │   Email     │
                      └─────────────┘
                       Notifications
```

## Issue Tracker Integrations

### Jira (Production)

Jira is WorkerMill's primary integration for enterprise teams.

#### Setup

1. **Create a Jira Automation Rule** or **Webhook**:
   - Go to Project Settings → Automation
   - Create rule: "When issue updated" → "Send web request"
   - URL: `https://workermill.com/api/webhooks/jira`
   - Method: POST
   - Headers: `Content-Type: application/json`

2. **Configure JQL Filter** (recommended):
   ```
   labels = workermill AND status = "To Do"
   ```

3. **Test the webhook**:
   - Create a ticket with the `workermill` label
   - Check WorkerMill dashboard for the queued task

#### Labels

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Select AI model (default: haiku) |
| `deploy` | Auto-deploy without PR approval |
| `review` | Require Virtual Manager review |
| `anthropic` / `openai` / `gemini` / `ollama` | Select AI provider |
| `backend` / `frontend` / `devops` / `qa` / `security` | Force specific persona |

#### Webhook Payload

WorkerMill expects the standard Jira webhook payload:

```json
{
  "webhookEvent": "jira:issue_updated",
  "issue": {
    "key": "PROJ-123",
    "fields": {
      "summary": "Add user authentication",
      "description": "Implement JWT-based auth...",
      "labels": ["workermill", "backend", "sonnet"],
      "issuetype": { "name": "Story" },
      "priority": { "name": "High" }
    }
  }
}
```

---

### Linear (Production)

Linear integration follows the same label-based workflow as Jira.

#### Setup

1. **Create a Linear Webhook**:
   - Go to Settings → API → Webhooks
   - URL: `https://workermill.com/api/webhooks/linear`
   - Events: Issue created, Issue updated

2. **Add the `workermill` label** to your Linear workspace

#### Labels

Linear uses the same label system as Jira. Create labels in your workspace:
- `workermill` (required)
- `deploy`, `review` (workflow control)
- `haiku`, `sonnet`, `opus` (model selection)

#### Webhook Payload

```json
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "abc123",
    "identifier": "ENG-456",
    "title": "Implement feature X",
    "description": "...",
    "labels": [{ "name": "workermill" }, { "name": "backend" }]
  }
}
```

---

### GitHub Issues (Production)

Use GitHub Issues directly without a separate issue tracker.

#### Setup

1. **Create a GitHub Webhook**:
   - Go to Repository Settings → Webhooks
   - URL: `https://workermill.com/api/webhooks/github-issues`
   - Content type: `application/json`
   - Events: Issues (opened, edited, labeled)

2. **Create labels** in your repository:
   - `workermill` (required trigger)
   - `deploy`, `review`, etc.

#### Task Keys

GitHub Issues use `GH-{issue_number}` as the task key (e.g., `GH-42`).

---

### Coming Soon Integrations

#### Asana

Enterprise project management integration.

- **Webhook endpoint**: `/api/webhooks/asana`
- **Trigger**: Task completion or tag assignment
- **Tags**: Same as Jira labels (`workermill`, `deploy`, etc.)

#### ClickUp

All-in-one productivity platform.

- **Webhook endpoint**: `/api/webhooks/clickup`
- **Trigger**: Task status change or tag assignment

#### GitLab Issues

For teams using GitLab instead of GitHub.

- **Webhook endpoint**: `/api/webhooks/gitlab`
- **Trigger**: Issue creation or label change

---

## Code Platform Integrations

### GitHub (Production)

GitHub is the primary code platform for WorkerMill.

#### Features

- **PR Creation**: Workers create pull requests with changes
- **Webhook Approvals**: PR approval triggers deployment
- **Branch Management**: Automatic branch creation and cleanup

#### Setup

1. **GitHub App or Personal Access Token**:
   - Create a PAT with `repo` scope
   - Store in AWS Secrets Manager: `workermill/dev/github-token`

2. **Configure webhook for PR reviews**:
   - URL: `https://workermill.com/api/webhooks/github`
   - Events: Pull request reviews

#### Workflow

```
Worker creates PR
       │
       ▼
PR enters "Review Requested" state
       │
       ▼
Human approves PR on GitHub
       │
       ▼
GitHub webhook triggers WorkerMill
       │
       ▼
Worker re-runs: merges PR and deploys
       │
       ▼
Task enters "Deployed" state
```

---

### GitLab (Coming Soon)

For teams on GitLab instead of GitHub.

- **MR Creation**: Workers create merge requests
- **CI/CD Integration**: Trigger pipelines on merge
- **Branch Protection**: Respect protected branch rules

---

## Notification Integrations

### Slack (Production)

Real-time notifications to Slack channels.

#### Setup

1. **Create a Slack Incoming Webhook**:
   - Go to your Slack workspace → Apps → Incoming Webhooks
   - Create a new webhook for your channel
   - Copy the webhook URL

2. **Configure in WorkerMill**:
   - Go to Settings → Notifications
   - Paste the Slack webhook URL
   - Test the connection

#### Notifications

| Event | Message |
|-------|---------|
| Task Completed | "Task PROJ-123 completed successfully. PR: github.com/..." |
| Task Failed | "Task PROJ-123 failed: Build error in api/..." |
| Cost Alert | "Monthly AI spend exceeded threshold: $X" |
| Escalation | "Task PROJ-123 escalated: Missing requirements..." |

#### Message Format

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Task Completed" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Task:* PROJ-123" },
        { "type": "mrkdwn", "text": "*Status:* Deployed" },
        { "type": "mrkdwn", "text": "*Cost:* $2.34" },
        { "type": "mrkdwn", "text": "*Duration:* 12m 34s" }
      ]
    }
  ]
}
```

---

### Discord (Coming Soon)

Similar to Slack integration for Discord servers.

### Email (Coming Soon)

Email notifications with digest and real-time modes.

---

## Webhook Security

### Signature Verification

WorkerMill verifies webhook signatures when available:

- **Jira**: HMAC signature in `X-Hub-Signature` header
- **Linear**: Signature in `Linear-Signature` header
- **GitHub**: HMAC-SHA256 in `X-Hub-Signature-256` header

### IP Allowlisting

For enterprise deployments, WorkerMill can be configured to only accept webhooks from known IP ranges:

- Jira Cloud: `104.192.136.0/21`
- Linear: Varies by region
- GitHub: [GitHub IP ranges](https://api.github.com/meta)

---

## Troubleshooting

### Webhook Not Triggering

1. **Check the label**: Ensure `workermill` label is present
2. **Verify URL**: Confirm webhook URL is `https://workermill.com/api/webhooks/{platform}`
3. **Check logs**: View API logs for webhook receipt
4. **Test manually**: Use the platform's webhook test feature

### Task Stuck in Queued

1. **Check orchestrator**: Ensure orchestrator is running
2. **Verify worker slots**: Check if max concurrent workers reached
3. **Check cooldown**: Tickets have a 30-second re-pickup cooldown

### PR Not Created

1. **Check GitHub token**: Verify PAT has `repo` scope
2. **Check branch protection**: Worker may not have push access
3. **View task logs**: Check for git errors in log stream

---

## Best Practices

### Label Strategy

1. **Use consistent labels** across all platforms
2. **Create persona labels** to force specific worker types
3. **Use `review` label** for critical changes
4. **Reserve `deploy` label** for low-risk changes only

### Webhook Management

1. **Use separate webhooks** per project/environment
2. **Enable signature verification** in production
3. **Monitor webhook failures** in platform dashboards
4. **Set up alerting** for webhook delivery issues

### Security

1. **Rotate tokens regularly** (GitHub PAT, Jira API token)
2. **Use least-privilege access** for integrations
3. **Enable audit logging** to track all webhook events
4. **Review integration access** quarterly
