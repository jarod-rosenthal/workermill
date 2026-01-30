# WorkerMill Troubleshooting Guide

## Manual Task Fixes via API

When tasks complete with missing metadata (PR URL, status issues), use the `/api/system/fix-task` endpoint.

### Fix Missing PR URL

```bash
# Get API key from MCP config
API_KEY=$(cat .mcp.json | jq -r '.mcpServers.workermill.env.WORKERMILL_API_KEY')

# Update task with PR details
curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "taskId": "YOUR_TASK_ID",
    "prUrl": "https://github.com/owner/repo/pull/123",
    "prNumber": 123
  }'
```

### Fix Wrong Status

```bash
# Valid statuses: queued, running, completed, failed, review_requested,
#                 pr_approved, pr_created, deployed, escalated

curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "taskId": "YOUR_TASK_ID",
    "status": "review_requested"
  }'
```

### Combined Fix (Status + PR)

```bash
curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "taskId": "YOUR_TASK_ID",
    "status": "review_requested",
    "prUrl": "https://github.com/owner/repo/pull/123",
    "prNumber": 123
  }'
```

### Recalculate Costs

If costs are incorrect for historical tasks:

```bash
curl -X POST https://workermill.com/api/system/recalculate-costs \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY"
```

---

## Common Issues

### Task Shows "completed" Instead of "pr_approved"

**Cause:** Multi-provider coordinator was outputting `::result::approved` but orchestrator expects `::result::pr_approved`.

**Fixed in:** commit 85286eb (2026-01-30)

**Manual fix:**
```bash
curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"taskId": "TASK_ID", "status": "pr_approved"}'
```

### PR URL Not Captured

**Cause:** `console.log(::pr_url::...)` writes to stdout but orchestrator reads from database logs. Markers were not being sent via `postLog()`.

**Fixed in:** commit 85286eb (2026-01-30) - Added `postLog()` calls for all markers.

**Manual fix:**
```bash
curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"taskId": "TASK_ID", "prUrl": "https://github.com/...", "prNumber": 123}'
```

### Google Gemini Quota Exceeded

**Symptoms:**
```
RetryError: Failed after 3 attempts. Last error: You exceeded your current quota
```

**Workaround:** Switch to Anthropic provider or wait for quota reset.

**Long-term fix needed:** Add provider fallback when quota is exceeded.

### CRLF Line Ending Issues

**Symptoms:** Worker spends excessive time debugging file edits, sees "CRLF line endings are the culprit!"

**Cause:** Repository has Windows-style CRLF line endings, Claude Code's edit_file expects LF.

**Workaround:** Worker creates helper scripts to replace file content.

**Long-term fix needed:** Add `.gitattributes` to target repos or normalize in worker setup:
```bash
git config core.autocrlf input
```

### Coordination Feed Missing Worker Messages

**Symptoms:** Only `progress` and `completion` messages appear, no `decision`, `question`, or `consultation` messages.

**Status:** Under investigation - coordination client may not be calling the API for these message types.

---

## Viewing Task Details

### Get Task by ID
```bash
curl -s "https://workermill.com/api/tasks/TASK_ID" \
  -H "x-api-key: $API_KEY" | jq '.status, .githubPrUrl, .githubPrNumber'
```

### List Recent Tasks
```bash
curl -s "https://workermill.com/api/tasks?limit=10" \
  -H "x-api-key: $API_KEY" | jq '.[] | {id, jiraIssueKey, status, githubPrUrl}'
```

### Get Task Logs
```bash
curl -s "https://workermill.com/api/control-center/logs/TASK_ID" \
  -H "x-api-key: $API_KEY" | jq '.logs[:5]'
```

---

## Historical Task Fixes

| Date | Task ID | Issue | Jira | Fix Applied |
|------|---------|-------|------|-------------|
| 2026-01-30 | aa066432-... | Missing PR URL, wrong status | OCS-804 | Set status=pr_approved, added PR #302 |
| 2026-01-30 | 10d8b2ea-... | Missing PR URL, wrong status | OCS-824 | Set status=pr_approved, added PR #301 |

