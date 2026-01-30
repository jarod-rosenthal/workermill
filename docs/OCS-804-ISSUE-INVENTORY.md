# OCS-804 Issue Inventory

**Task ID:** `aa066432-0a74-441b-9991-ab4fa0e0d3e3`
**Status:** completed (but with `githubPrUrl: null`)
**PR Created:** https://github.com/jarod-rosenthal/pagerduty-lite/pull/302
**Execution Mode:** Multi-Provider (sequential execution with per-persona provider routing)

## Issue Summary

| Priority | Issue | Impact | Status |
|----------|-------|--------|--------|
| CRITICAL | PR URL not captured | Dashboard shows no PR link, manual intervention required | Investigating |
| CRITICAL | Missing coordination feed messages | No visibility into worker decisions/questions | Not Started |
| HIGH | Google Gemini quota exceeded | Worker retried 3 times, wasted ~5 minutes | Not Started |
| MEDIUM | CRLF line ending issues | ~8 minutes lost debugging, 20+ failed edits | Not Started |

---

## CRITICAL: Wrong Task Status (completed instead of pr_approved)

### Symptoms
- Task ended with status `completed` instead of `pr_approved`
- PR was approved by Tech Lead inline review
- Dashboard shows task as "completed" not "PR Approved"

### Root Cause
**Marker mismatch between worker and orchestrator!**

The multi-expert coordinator outputs:
```typescript
// worker/multi-expert/index.ts line 2176-2177
if (finalDecision === "approved") {
  console.log("::result::approved");  // <-- outputs "approved"
}
```

But the orchestrator expects different markers:
```typescript
// api/src/services/orchestrator.ts lines 3818-3844
switch (detectedResult) {
  case "deployed": newStatus = "deployed"; break;
  case "pr_created": newStatus = "pr_created"; break;
  case "review_requested": newStatus = "review_requested"; break;
  case "pr_approved": newStatus = "pr_approved"; break;  // <-- expects "pr_approved"
  case "escalated": newStatus = "escalated"; break;
  case "no_changes":
  case "completed": newStatus = "completed"; break;
  case "failed": newStatus = "failed"; break;
  default:
    newStatus = ecsInfo.exitCode === 0 ? "completed" : "failed";  // <-- "approved" falls here!
}
```

**Result:** `::result::approved` doesn't match any case, falls through to default, task gets `completed` status based on exit code.

### Fix Required
Change `worker/multi-expert/index.ts` line 2177:
```typescript
// Before
console.log("::result::approved");
// After
console.log("::result::pr_approved");
```

---

## CRITICAL: PR URL Not Captured

### Symptoms
- Task completed with `githubPrUrl: null` in database
- PR #302 was successfully created
- Log shows: `[Multi-Provider] PR created: https://github.com/jarod-rosenthal/pagerduty-lite/pull/302`
- But `::pr_url::` marker NOT found in logs

### Affected Tasks
- OCS-804 (this analysis)
- OCS-824 (same bug reported in previous session)

### Root Cause Analysis

The code in `worker/multi-expert/index.ts` outputs the marker in two different ways:

```typescript
// Line 1032-1033 - PR creation
await this.postLog(`PR created: ${this.currentPrUrl}`);  // ✅ This appears in logs
console.log(`::pr_url::${this.currentPrUrl}`);           // ❌ This does NOT appear

// Lines 2178-2194 - Final result output
console.log("::result::review_requested");
if (this.currentPrUrl) {
  console.log(`::pr_url::${this.currentPrUrl}`);         // ❌ This does NOT appear
}
```

**The problem:**
- `postLog()` sends logs to WorkerMill API via HTTP POST → stored in PostgreSQL
- `console.log()` writes to container stdout → should be captured by orchestrator
- The orchestrator parses `::pr_url::` from **CloudWatch logs** (container stdout)
- But multi-provider runs in ECS Fargate - stdout might not be reliably captured

### Investigation Needed
1. Check how orchestrator parses `::pr_url::` from worker output
2. Verify if CloudWatch is receiving the stdout from multi-provider coordinator
3. Consider outputting markers via `postLog()` as well for database-based parsing

### Recommended Fix
Add `::pr_url::` marker to `postLog()` output so it's captured in the database logs:

```typescript
await this.postLog(`::pr_url::${this.currentPrUrl}`);
console.log(`::pr_url::${this.currentPrUrl}`);  // Keep for backward compat
```

---

## CRITICAL: Missing Coordination Feed Messages

### Symptoms
- Coordination feed only shows automated `progress` and `completion` messages
- Worker "thinking" messages like "**Analyzing User Verification**" appear in task logs
- But `decision`, `question`, `consultation` message types are NOT in coordination feed
- Total messages: 20 (all progress/completion type)

### Expected Behavior
Workers should post to coordination feed:
- `DEC-xxx` messages for decisions made
- `Q-xxx` messages for questions asked
- `CON-xxx` messages for consultations with other personas

### Investigation Needed
1. Check if `coordination-client.ts` is being called for these message types
2. Verify the multi-provider executor is using the coordination feed correctly
3. Check if messages are being posted but filtered out

---

## HIGH: Google Gemini API Quota Exceeded

### Symptoms
```
RetryError: Failed after 3 attempts. Last error: You exceeded your current quota,
please check your plan and billing details.
```

### Occurrences
- **13:15:24 UTC** - First quota exceeded
- **13:20:34 UTC** - Second quota exceeded

### Impact
- ~5 minutes wasted on retries before fallback/failure
- Worker eventually proceeded (unclear if fallback occurred or quota reset)

### Recommended Fixes
1. **Provider Fallback**: If Google quota exceeded, fall back to Anthropic
2. **Pre-execution Quota Check**: Check quota before assigning story to Google provider
3. **Rate Limiting**: Implement request rate limiting for Google API
4. **Alert/Log Enhancement**: Log more details about which story/persona hit the quota

---

## MEDIUM: CRLF Line Ending Issues

### Symptoms
Worker log shows extensive debugging:
```
"CRLF line endings are the culprit!"
```

### Impact
- ~8 minutes spent debugging file edit failures
- 20+ failed `edit_file` attempts
- Worker resorted to creating `replace_script.js` helper to work around

### Root Cause
- Windows-style CRLF (`\r\n`) line endings in repository files
- Claude Code's edit_file tool expects LF (`\n`) line endings
- Mismatch causes string matching to fail

### Recommended Fixes
1. **Pre-clone Normalization**: Configure git to normalize line endings on clone
   ```bash
   git config core.autocrlf input
   ```
2. **Repository .gitattributes**: Add to oncallshift repo
   ```
   * text=auto eol=lf
   ```
3. **Worker Tool Enhancement**: Normalize line endings before edit_file operations

---

## Additional Observations

### Token Usage
- Input tokens: (to be calculated from logs)
- Output tokens: (to be calculated from logs)
- Estimated cost: (to be calculated)

### Execution Timeline
- Stories executed sequentially as expected for multi-provider mode
- Tech Lead review occurred inline
- Final status: `completed`

### Personas Used
- backend_developer
- tech_lead (for review)
- (others as assigned by planning agent)

---

## Action Items

### Immediate (Today)
- [ ] Manually update OCS-804 with PR URL via API
- [ ] Manually update OCS-824 with PR URL via API (from previous session)
- [ ] Fix `::pr_url::` marker output issue

### Short-term (This Week)
- [ ] Fix coordination feed message posting
- [ ] Add provider fallback for quota exceeded errors
- [ ] Add CRLF normalization to worker setup

### Medium-term
- [ ] Republish WorkerMill MCP with `updateTask` tool
- [ ] Add quota monitoring/alerting for Google API
- [ ] Improve error categorization in logs

---

## Manual Task Fixes Needed

### OCS-804
- **Task ID:** `aa066432-0a74-441b-9991-ab4fa0e0d3e3`
- **PR URL:** https://github.com/jarod-rosenthal/pagerduty-lite/pull/302
- **PR Number:** 302

### OCS-824
- **PR URL:** https://github.com/jarod-rosenthal/pagerduty-lite/pull/301
- **PR Number:** 301

Use `/api/system/fix-task` endpoint to update:
```bash
curl -X POST https://workermill.com/api/system/fix-task \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"taskId": "aa066432-0a74-441b-9991-ab4fa0e0d3e3", "prUrl": "https://github.com/jarod-rosenthal/pagerduty-lite/pull/302", "prNumber": 302}'
```
