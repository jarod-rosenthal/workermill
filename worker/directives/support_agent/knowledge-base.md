***REMOVED*** Support Agent Knowledge Base

This document contains essential knowledge for troubleshooting and answering customer questions about WorkerMill.

***REMOVED******REMOVED*** Platform Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks.

***REMOVED******REMOVED******REMOVED*** Key Concepts

| Term | Definition |
|------|------------|
| **Worker** | AI agent running in an ECS Fargate container that executes coding tasks |
| **Task** | A unit of work from a Jira/Linear ticket, tracked through execution lifecycle |
| **Persona** | Role-specific AI agent type (backend_developer, frontend_developer, etc.) |
| **Orchestrator** | Central control plane that polls for work and spawns workers |
| **Epic Mode** | Default execution mode where tasks are decomposed into stories and run in parallel |

***REMOVED******REMOVED******REMOVED*** Architecture Basics

```
Jira Ticket (with 'workermill' label)
    ↓
Webhook → WorkerMill API
    ↓
Task created in database (status: queued)
    ↓
Orchestrator claims task
    ↓
ECS Fargate container spawned
    ↓
AI worker executes task
    ↓
PR created on target repository
    ↓
Task marked complete
```

***REMOVED******REMOVED*** Common Issues and Solutions

***REMOVED******REMOVED******REMOVED*** 1. Task Stuck in "Running" Status

**Symptoms:**
- Task shows "running" for extended period (>30 minutes)
- No new logs appearing
- Dashboard shows no progress

**Possible Causes:**
1. **Spot Instance Interruption** (exit code 137)
   - AWS reclaimed the Spot instance
   - Task should auto-retry up to 3 times
   - Solution: Wait for retry or manually retry from dashboard

2. **Memory Exhaustion** (exit code 137)
   - Worker ran out of memory (large repo, complex analysis)
   - Solution: Report to support for memory limit increase

3. **Network Timeout**
   - Container lost connectivity
   - Solution: Retry the task

4. **Worker Crash**
   - Unhandled exception in worker code
   - Solution: Check logs for error details, report if unclear

**Diagnostic Steps:**
1. Go to Dashboard → Task Details
2. Check the "Logs" tab for recent output
3. Look for error messages or exit codes
4. Check task creation time vs current time

***REMOVED******REMOVED******REMOVED*** 2. PR Not Created

**Symptoms:**
- Task completes but no PR appears
- Status shows "completed" or "failed" without PR URL

**Possible Causes:**
1. **No Code Changes**
   - Worker analyzed but found nothing to change
   - Check logs for "nothing to commit" message

2. **Branch Conflict**
   - Target branch has diverged, merge conflict
   - Solution: Update base branch and retry

3. **GitHub Rate Limiting**
   - Exceeded API limits (60 req/hr unauthenticated, 5000 authenticated)
   - Solution: Wait 1 hour and retry

4. **Token Permissions**
   - GitHub token lacks required scopes
   - Required scopes: `repo`, `workflow`
   - Solution: Re-authorize GitHub integration in Settings

5. **Repository Access**
   - Worker can't access the target repository
   - Solution: Verify GitHub integration has access to the repo

**Diagnostic Steps:**
1. Check task logs for GitHub API errors
2. Verify GitHub integration status in Settings → Integrations
3. Check if target repo is accessible

***REMOVED******REMOVED******REMOVED*** 3. Task Fails Immediately

**Symptoms:**
- Task goes from "queued" to "failed" in seconds
- No meaningful logs

**Possible Causes:**
1. **Missing Integration**
   - Jira or GitHub not connected
   - Solution: Complete integration setup in Settings

2. **Invalid Ticket Format**
   - Jira ticket missing required fields (summary, description)
   - Solution: Update ticket with proper content

3. **Organization Limits**
   - Exceeded concurrent worker limit
   - Solution: Wait for running tasks to complete or upgrade plan

4. **API Key Issues**
   - Organization API key not configured
   - Solution: Contact support to verify API key setup

***REMOVED******REMOVED******REMOVED*** 4. Worker Not Responding to Tickets

**Symptoms:**
- Added `workermill` label but no task created
- Jira webhook not triggering

**Possible Causes:**
1. **Webhook Not Configured**
   - Jira webhook URL not set up
   - Solution: Admin must configure webhook in Jira settings

2. **Label Spelling**
   - Label must be exactly `workermill` (lowercase)
   - Solution: Remove and re-add the correct label

3. **Project Not Enabled**
   - Jira project not in webhook JQL filter
   - Solution: Update webhook JQL to include project

4. **Orchestrator Paused**
   - System orchestrator is stopped
   - Solution: Contact support to verify system status

***REMOVED******REMOVED******REMOVED*** 5. Slow Task Execution

**Symptoms:**
- Tasks take much longer than expected
- Frequent timeouts

**Possible Causes:**
1. **Large Repository**
   - Clone time increases with repo size
   - Solution: Consider splitting into smaller repos

2. **Complex Analysis**
   - AI needs more time for complex codebases
   - Solution: Break tickets into smaller, focused tasks

3. **Rate Limiting**
   - External API rate limits (GitHub, npm)
   - Solution: Wait and retry

4. **Model Selection**
   - Using slower model (Opus vs Haiku)
   - Solution: Use `haiku` label for faster execution

***REMOVED******REMOVED*** Execution Modes

***REMOVED******REMOVED******REMOVED*** Epic Mode (Default)

All tasks run in Epic mode by default:
- Planning agent decomposes ticket into stories
- Multiple expert agents work in parallel
- Stories have dependencies and execute accordingly
- Single consolidated PR created at end

**Labels:**
- `workermill` - Triggers Epic mode (default)
- `epic` - Explicit Epic mode (same as default)

***REMOVED******REMOVED******REMOVED*** Multi-Provider Mode

For using different AI providers per persona:
- Add `multi-provider` label
- Configure provider routing in Settings → AI Workers
- Stories execute sequentially
- Supports: Anthropic, OpenAI, Google, Ollama

***REMOVED******REMOVED******REMOVED*** Standard Mode (Legacy)

Single-persona execution (deprecated):
- Add `standard` or `v1` label to opt out of Epic
- Single worker executes entire task
- Not recommended for complex tasks

***REMOVED******REMOVED*** Model Selection

| Label | Model | Speed | Use Case |
|-------|-------|-------|----------|
| `haiku` | claude-haiku-4-5 | Fastest | Simple fixes, quick tasks |
| `sonnet` | claude-sonnet-4 | Medium | Default, balanced |
| `opus` | claude-opus-4 | Slowest | Complex analysis |

Default model is configurable in Settings → AI Workers.

***REMOVED******REMOVED*** Billing & Plans

**IMPORTANT: Always escalate billing questions to human support.**

General information only:
- Usage is measured in compute time and API tokens
- Costs visible in Dashboard → Billing
- Plans available: Free trial, Pro, Enterprise
- For pricing details, direct to: https://workermill.com/pricing

***REMOVED******REMOVED*** Integration Status Checks

***REMOVED******REMOVED******REMOVED*** Jira Integration
- Settings → Integrations → Jira
- Requires: Jira Cloud URL, API token
- Webhook: `https://workermill.com/api/webhooks/jira`

***REMOVED******REMOVED******REMOVED*** GitHub Integration
- Settings → Integrations → GitHub
- Requires: OAuth or personal access token
- Scopes needed: `repo`, `workflow`

***REMOVED******REMOVED******REMOVED*** Linear Integration
- Settings → Integrations → Linear
- Requires: API key
- Webhook: `https://workermill.com/api/webhooks/linear`

***REMOVED******REMOVED*** Documentation Links

| Topic | URL |
|-------|-----|
| Getting Started | https://workermill.com/docs/getting-started |
| API Reference | https://workermill.com/docs/api |
| Troubleshooting | https://workermill.com/docs/troubleshooting |
| Pricing | https://workermill.com/pricing |
| Status Page | https://status.workermill.com |
| GitHub | https://github.com/workermill |

***REMOVED******REMOVED*** Useful API Endpoints

For internal reference when diagnosing issues:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/tasks/:id` | Fetch task details |
| `GET /api/tasks/:id/logs` | Fetch task logs |
| `GET /api/control-center` | Dashboard data |
| `GET /api/settings` | Organization settings |
| `GET /api/orchestrator/status` | System status |

***REMOVED******REMOVED*** Response Templates by Issue

***REMOVED******REMOVED******REMOVED*** Template: Task Failure

```
Hi [Name],

I see your task [TICKET-ID] failed with [error type]. Here's what happened:

[Explanation of error]

To resolve this:
1. [Step 1]
2. [Step 2]
3. [Step 3]

If you'd like me to retry the task, just let me know!
```

***REMOVED******REMOVED******REMOVED*** Template: PR Not Created

```
Hi [Name],

I checked the logs for task [TICKET-ID] and found [finding].

[Explanation]

Here's what you can do:
- [Option 1]
- [Option 2]

Let me know if you need any clarification!
```

***REMOVED******REMOVED******REMOVED*** Template: Integration Issue

```
Hi [Name],

It looks like there may be an issue with your [Jira/GitHub/Linear] integration.

To verify the setup:
1. Go to Settings → Integrations
2. Check that [integration] shows "Connected"
3. [Additional steps]

If you're still having trouble, I can escalate this to our team for a deeper look.
```

***REMOVED******REMOVED******REMOVED*** Template: Feature Not Available

```
Hi [Name],

Thanks for asking about [feature]! Currently, WorkerMill [does/doesn't] support this.

[If available: Here's how to use it...]
[If not available: I've noted this as a feature request for our product team.]

Is there anything else I can help with?
```

***REMOVED******REMOVED*** Escalation Triggers

See `escalation-rules.md` for complete escalation criteria. Quick reference:

**Always Escalate:**
- Billing, payments, refunds
- Account security
- Data deletion requests
- Legal/compliance questions
- Explicit request for human

**Consider Escalating:**
- Issue unresolved after 2+ responses
- Ticket age > 24 hours
- Confidence < 70%
- Complex multi-system issues
