# WorkerMill Troubleshooting Guide

This guide covers common issues and solutions when using WorkerMill.

---

## Table of Contents

1. [Task Issues](#task-issues)
2. [Worker Issues](#worker-issues)
3. [Integration Issues](#integration-issues)
4. [Provider Issues](#provider-issues)
5. [Infrastructure Issues](#infrastructure-issues)
6. [Dashboard Issues](#dashboard-issues)

---

## Task Issues

### Task Stuck in "Queued"

**Symptoms:** Task appears in queue but never starts executing.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Orchestrator not running | Check orchestrator status in dashboard, restart if needed |
| Max concurrent workers reached | Wait for running tasks to complete, or increase limit in Settings |
| Stale coordination locks | Check for stale locks in the coordination panel, clean up if needed |
| Ticket cooldown active | Wait 30 seconds since last ticket update |
| Missing `workermill` label | Verify the label is present on the ticket |

**Debug Steps:**
1. Check the dashboard for orchestrator status (should show "Running")
2. Verify `maxConcurrentWorkers` hasn't been reached
3. Check the task logs for any claim errors
4. Ensure the ticket has the `workermill` label

---

### Task Stuck in "Executing"

**Symptoms:** Task shows as executing but no progress is made.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Worker container crashed | Check ECS task status, review CloudWatch logs |
| Spot instance reclaimed | Task should auto-retry with checkpoint; if not, manually re-queue |
| Worker blocked on input | Check logs for prompts or questions |
| Network/API timeout | Review logs for timeout errors |
| Infinite loop in code | Check terminal output for repetitive patterns |

**Debug Steps:**
1. Expand the task card to view real-time terminal output
2. Check if checkpoint shows "interrupted" status
3. Review ECS task status in AWS Console
4. Check CloudWatch logs for the worker container

---

### Task Stuck in "Review Requested"

**Symptoms:** Task created a PR but doesn't proceed after approval.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| GitHub webhook not configured | Configure webhook at `/api/webhooks/github` |
| Webhook delivery failed | Check GitHub webhook delivery logs |
| PR not approved on GitHub | Approve the PR on GitHub |
| Worker slots full | Wait for slot availability |

**Debug Steps:**
1. Verify the PR has been approved on GitHub
2. Check GitHub's webhook delivery logs for errors
3. Manually trigger re-queue if webhook failed

---

### Task Failed

**Symptoms:** Task entered "Failed" state.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Build/test failure | Review terminal output for error details |
| Git push failed | Check branch protection rules, verify permissions |
| Max retries exceeded | Manually re-queue after fixing underlying issue |
| Container exit error | Check ECS task stopped reason |

**Debug Steps:**
1. Expand task card to view full terminal output
2. Look for error messages or stack traces
3. Check the `error` field in task details
4. Review the exit code (137 = Spot interruption)

---

### Task Escalated

**Symptoms:** Task entered "Escalated" state without completing.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Unclear requirements | Review worker's escalation comment, update ticket with details |
| Missing information | Add requested information to ticket description |
| Security concern | Review and approve/deny the security-related change |
| Cannot reproduce issue | Provide reproduction steps or environment details |

**Debug Steps:**
1. Read the escalation comment on the Jira ticket
2. Review what the worker attempted
3. Add clarifying information to the ticket
4. Remove and re-add `workermill` label to retry

---

## Worker Issues

### Worker Not Picking Up Tasks

**Symptoms:** Tasks are queued but no workers claim them.

**Solutions:**
1. Verify the orchestrator is running
2. Check if all worker slots are occupied
3. Review the `taskCooldownSeconds` setting
4. Ensure there are no stale coordination locks

---

### Worker Creating Wrong Code

**Symptoms:** Worker implements something different from ticket requirements.

**Solutions:**
1. Ensure ticket has clear acceptance criteria
2. Add specific file paths or component names
3. Use the correct persona label (e.g., `frontend`, `backend`)
4. Consider using Ralph mode for complex tasks

---

### Worker PR Failing CI

**Symptoms:** Worker creates PR but CI checks fail.

**Solutions:**
1. Review CI failure logs
2. Check if tests were run locally by worker
3. Ensure CI environment matches worker environment
4. Consider adding QA persona for test writing

---

### Worker Unable to Push

**Symptoms:** Worker fails at git push step.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Branch protection rules | Ensure worker has permission to create branches |
| Token permissions | Verify GitHub token has `repo` scope |
| Branch already exists | Worker should handle this; check for git errors |

---

## Integration Issues

### Jira Webhook Not Triggering

**Symptoms:** Adding `workermill` label doesn't create a task.

**Debug Steps:**
1. Verify webhook URL is `https://workermill.com/api/webhooks/jira`
2. Check webhook is configured for "Issue Updated" events
3. Verify JQL filter includes `labels = workermill`
4. Test webhook delivery in Jira automation settings
5. Check WorkerMill API logs for incoming webhook errors

**Solutions:**
- Ensure the label is spelled exactly `workermill`
- Check Jira automation rules are enabled
- Verify the webhook secret matches if using signature verification

---

### Linear Webhook Not Triggering

**Symptoms:** Adding `workermill` label in Linear doesn't create a task.

**Debug Steps:**
1. Verify webhook URL is `https://workermill.com/api/webhooks/linear`
2. Check webhook is subscribed to "Issue" events
3. Ensure `workermill` label exists in your Linear workspace
4. Check Linear webhook logs for delivery status

---

### GitHub Issues Not Working

**Symptoms:** GitHub Issues with `workermill` label not picked up.

**Debug Steps:**
1. Verify webhook URL is `https://workermill.com/api/webhooks/github-issues`
2. Check webhook is subscribed to "Issues" events
3. Ensure `workermill` label exists in the repository
4. Verify webhook secret configuration

---

### Slack Notifications Not Sending

**Symptoms:** No Slack messages for task events.

**Solutions:**
1. Verify Slack webhook URL is configured in Settings
2. Test the webhook URL directly with a curl command
3. Check that notification events are enabled
4. Verify the Slack channel exists and bot has permission

---

## Provider Issues

### Invalid API Key

**Symptoms:** Tasks fail immediately with authentication error.

**Solutions:**
1. Verify the API key is correct (no extra spaces)
2. Check the key hasn't expired or been revoked
3. Ensure the key has required permissions
4. Test the key directly with the provider's API

**Debug:**
```bash
# Test Anthropic key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: YOUR_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"Hi"}]}'
```

---

### Rate Limiting

**Symptoms:** Tasks fail with rate limit errors.

**Solutions:**
1. Check provider dashboard for current usage
2. Reduce `maxConcurrentWorkers` setting
3. Upgrade provider plan for higher limits
4. Use a different model tier (e.g., Haiku instead of Opus)

---

### Model Not Available

**Symptoms:** Error about model not found or unavailable.

**Solutions:**
1. Verify the model ID is correct
2. Check if model requires special access (e.g., Claude Opus)
3. Ensure your API key has access to the requested model
4. Try a different model from the same provider

---

### High Token Costs

**Symptoms:** Unexpectedly high AI costs.

**Solutions:**
1. Review task logs for excessive token usage
2. Check for stuck or infinite loop tasks
3. Use Haiku for simpler tasks
4. Set cost alert thresholds in Settings
5. Consider using Ollama for development/testing

---

## Infrastructure Issues

### ECS Task Failures

**Symptoms:** Worker containers fail to start or crash.

**Debug Steps:**
1. Check ECS task stopped reason in AWS Console
2. Review CloudWatch logs for the worker
3. Verify container has sufficient memory/CPU
4. Check for missing environment variables

**Common Stop Reasons:**

| Stop Reason | Solution |
|-------------|----------|
| OutOfMemoryError | Increase task memory allocation |
| CannotPullContainerError | Check ECR permissions and image tag |
| ResourceInitializationError | Verify IAM roles and security groups |
| SpotInterruption | Task should auto-retry; check checkpoint |

---

### Database Connection Issues

**Symptoms:** API errors about database connectivity.

**Solutions:**
1. Check RDS instance status in AWS Console
2. Verify security group allows API access to RDS
3. Check connection pool settings
4. Review RDS performance metrics for resource exhaustion

---

### Log Streaming Not Working

**Symptoms:** Terminal output doesn't appear in dashboard.

**Solutions:**
1. Verify worker is posting to `/api/tasks/:taskId/logs`
2. Check organization API key is valid
3. Review SSE connection status in browser dev tools
4. Ensure CloudFront isn't caching SSE endpoints

---

### S3 Checkpoint Failures

**Symptoms:** Checkpoints not saving or loading.

**Solutions:**
1. Verify worker IAM role has S3 permissions
2. Check S3 bucket exists and is accessible
3. Review S3 bucket policy for public access blocks
4. Check for S3 service outages in your region

---

## Dashboard Issues

### Dashboard Not Loading

**Symptoms:** Dashboard shows blank page or loading spinner.

**Solutions:**
1. Check browser console for JavaScript errors
2. Verify API is reachable at the configured endpoint
3. Clear browser cache and cookies
4. Check CloudFront distribution status

---

### Real-time Updates Not Working

**Symptoms:** Task status doesn't update automatically.

**Solutions:**
1. Check SSE connection in browser Network tab
2. Verify `/api/control-center/stream` endpoint is accessible
3. Check for browser extensions blocking connections
4. Try refreshing the page

---

### Authentication Errors

**Symptoms:** Redirected to login or "Unauthorized" errors.

**Solutions:**
1. Check if JWT token has expired
2. Verify Cognito user pool configuration
3. Clear browser storage and re-login
4. Check Cognito service status

---

## Getting Help

If you're still experiencing issues:

1. **Check the logs** - API logs, worker logs, and CloudWatch logs often contain the answer
2. **Review recent changes** - Did a deploy or configuration change cause this?
3. **Search issues** - Check [GitHub Issues](https://github.com/jarod-rosenthal/workermill/issues) for similar problems
4. **Create an issue** - Include logs, error messages, and reproduction steps

---

## Related Documentation

- **[User Guide](USER_GUIDE.md)** - Complete feature documentation
- **[Integrations Guide](INTEGRATIONS.md)** - Integration setup details
- **[BYOK Guide](BYOK_GUIDE.md)** - Provider configuration
- **[Architecture](ARCHITECTURE.md)** - Technical architecture overview
