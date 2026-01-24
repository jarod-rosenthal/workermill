# Technical Debt Tracker

This document tracks identified technical debt and known issues in the WorkerMill codebase. Items are prioritized by severity and blocking status.

**Last Updated**: 2025-01-23
**Review Source**: Automated code analysis + manual validation

---

## Priority Legend

| Priority | Description |
|----------|-------------|
| P0 | Blocking - Must fix before next release |
| P1 | High - Fix within current sprint |
| P2 | Medium - Schedule for upcoming sprint |
| P3 | Low - Address when convenient |

---

## P1: High Priority Issues

### 1. Streaming Proxy Buffers Entire Response

**Location**: `worker/src/proxy/anthropic-proxy.ts`

**Problem**: The Anthropic API proxy uses `responseInterceptor` with `selfHandleResponse: true`, which buffers the entire response before forwarding to the client. This breaks Server-Sent Events (SSE) streaming.

```typescript
// Line 23-27
app.use('/v1/messages', createProxyMiddleware({
  target: ANTHROPIC_API,
  changeOrigin: true,
  selfHandleResponse: true,  // <-- Causes buffering
  onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
```

**Impact**:
- Workers waiting for Claude API streaming responses won't receive tokens in real-time
- Long generations may timeout before the buffer completes
- Defeats the purpose of streaming (low latency perception)

**Suggested Fix**:
- Use a streaming-compatible approach like `on('data')` event handlers
- Or implement a separate non-blocking token counter that doesn't intercept the response

**Verification Needed**: Confirm if workers actually use this proxy for streaming calls, or if they use non-streaming endpoints.

---

### 2. Global Billing Reset Ignores Individual Billing Cycles

**Location**: `api/src/services/billing.ts:568-580`

**Problem**: The `resetMonthlyUsage()` function resets `taskUsageThisMonth` for ALL organizations simultaneously, ignoring each org's individual `billingCycleStart` date.

```typescript
export async function resetMonthlyUsage(): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const result = await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ taskUsageThisMonth: 0 })  // Resets EVERYONE
    .execute();
}
```

**Impact**:
- Orgs with mid-month billing cycles get incorrect usage tracking
- Customers may get free usage or lose quota prematurely
- Billing discrepancies with Stripe

**Suggested Fix**:
```typescript
export async function resetMonthlyUsage(): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const now = new Date();

  // Only reset orgs whose billing cycle has actually rolled over
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      taskUsageThisMonth: 0,
      billingCycleStart: now
    })
    .where("billing_cycle_start < :cutoff", {
      cutoff: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    })
    .execute();
}
```

**Verification Needed**: Check if this function is actually called via cron job (search for `resetMonthlyUsage` usage).

---

## P2: Medium Priority Issues

### 3. Multi-Tenancy Webhook Org Selection

**Location**: `api/src/routes/webhooks.ts:173-183`

**Problem**: Jira, Linear, and GitHub webhooks use a heuristic to find the organization:
1. Find first active user's org
2. Fall back to first org in database

This breaks in a true multi-tenant environment.

```typescript
const activeUser = await userRepo.findOne({
  where: { status: "active" },
  relations: ["organization"],
});
let org = activeUser?.organization;

if (!org) {
  org = await orgRepo.findOne({ where: {} }) ?? undefined;
}
```

**Impact**:
- Only one org's webhooks will work (the one selected by the heuristic)
- Other orgs' webhooks will fail signature verification (401 errors)
- Not a data leak (signature verification prevents cross-tenant access)

**Current Status**: Not blocking - WorkerMill currently operates in single-tenant mode (oncallshift target repo).

**Suggested Fix**:
- Include org identifier in webhook URL path: `/api/webhooks/jira/:orgSlug`
- Or use a lookup table mapping webhook secrets to org IDs
- Verify signature against multiple orgs' secrets if needed

---

### 4. Webhook Signature Raw Body Fallback

**Location**: `api/src/routes/webhooks.ts:197`

**Problem**: If `rawBody` buffer isn't captured by middleware, the code falls back to `JSON.stringify(req.body)`:

```typescript
const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString()
  || JSON.stringify(req.body);
```

**Impact**: `JSON.stringify` may not produce the exact bytes that were originally signed (different whitespace, key ordering). This could cause intermittent signature verification failures.

**Suggested Fix**: Ensure raw body middleware always captures the original bytes. Add error logging when fallback is used.

---

### 5. ECS Credentials as Plain Environment Variables

**Location**: `api/src/services/ecs-task-runner.ts:130-136`

**Problem**: Sensitive credentials (GitHub token, Jira API token, Anthropic API key) are passed as plain environment variables to ECS tasks.

```typescript
{ name: "GITHUB_TOKEN", value: credentials.githubToken },
{ name: "JIRA_API_TOKEN", value: credentials.jiraApiToken || "" },
{ name: "ANTHROPIC_API_KEY", value: credentials.anthropicApiKey },
```

**Impact**:
- If container is compromised, credentials can be read from `process.env`
- Environment variables may be visible in certain debugging/monitoring contexts

**Suggested Fix**: Use ECS Secrets integration with Secrets Manager:
```typescript
secrets: [
  { name: "GITHUB_TOKEN", valueFrom: "arn:aws:secretsmanager:..." },
]
```

This requires Terraform changes to the task definition.

---

## P3: Low Priority Issues

### 6. Missing Audit Log for Jira Webhook Tasks

**Location**: `api/src/routes/webhooks.ts:502`

**Problem**: Tasks created from Jira webhooks don't call `logTaskCreated()`, unlike Linear (line 1100) and GitHub Issues (line 1381) handlers.

**Impact**: Audit trail is incomplete for Jira-triggered tasks.

**Suggested Fix**: Add audit logging after task creation:
```typescript
try {
  await logTaskCreated(
    { organizationId: org.id },
    task.id,
    issueKey,
    persona
  );
} catch (auditError) {
  logger.warn("Failed to log audit event", { error: auditError });
}
```

---

### 7. Hardcoded Fallback Configuration Values

**Location**: `api/src/config/index.ts`

**Problem**: Development fallback values are hardcoded for S3 buckets, Cognito pools, etc.

```typescript
s3: {
  checkpointBucket: process.env.CHECKPOINT_BUCKET || `workermill-dev-worker-state-593971626975`,
},
cognito: {
  userPoolId: process.env.COGNITO_USER_POOL_ID || "us-east-1_oHZOtoac8",
}
```

**Impact**: Low - these are intentional for local development. Production sets env vars.

**Suggested Fix**: Consider failing fast in production if required env vars are missing, rather than silently using dev defaults.

---

## Resolved Issues

_No resolved issues yet._

---

## Notes

- This document was generated from a code review on 2025-01-23
- Issues should be moved to Jira (WM project) when work begins
- Update "Last Updated" date when modifying this document
