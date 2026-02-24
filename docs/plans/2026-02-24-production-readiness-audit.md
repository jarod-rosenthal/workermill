# Production Readiness Audit — 2026-02-24

Comprehensive codebase audit for go-live readiness. Excludes Stripe billing integration (known incomplete), database sizing, and autoscaling.

---

## Priority Summary

| Priority | Issue | Impact |
|----------|-------|--------|
| **P0** | Wire up `deductUsage()` + `canExecuteTask()` | Can't bill anyone |
| **P0** | Add `EXECUTION_MODE=local` + `NODE_ENV=production` startup guard | Auth bypass risk |
| **P0** | Configure `trust proxy` for ALB | Rate limiting broken |
| **P0** | Fix graceful shutdown (`server.close()`) | Dropped requests on deploy |
| **P1** | Make `ENCRYPTION_KEY` required in prod + fix decrypt-failure-returns-ciphertext | Data at rest unprotected |
| **P1** | Fix Pro plan free-pass loophole | Free usage |
| **P1** | Null out plaintext `api_key` column | Key exposure on DB compromise |
| **P1** | Enforce `email_verified` | Throwaway account abuse |
| **P1** | Fix `.save()` clobber on cost-tracker + referral | Financial data corruption |
| **P2** | Enable state machine validation | Invalid task transitions |
| **P2** | Make GitHub runner webhook secret mandatory | Unauthorized ECS spawning |
| **P2** | Strip AuthCallback debug console.logs | Token leakage in browser |
| **P2** | Remove hardcoded Cognito/IAM fallbacks | Silent dev-mode in prod |
| **P2** | Switch rate limiters to Redis store | Per-instance limits |
| **P2** | Restrict Swagger UI or add auth | API surface exposure |
| **P2** | Use `timingSafeEqual` for warm pool key | Timing attack |
| **P2** | Server-side verify quality gate bypass | Worker trust boundary |

---

## P0 — Must Fix Before Go-Live

### 1. Credit Billing Deductions Are Never Wired Up

**Files:**
- `api/src/services/credit-billing.ts:87` — `deductUsage()` defined but never called
- `api/src/services/credit-billing.ts:677` — `canExecuteTask()` defined but never called

**Issue:** The credit billing system has two key functions that are defined but never invoked anywhere in the codebase:

- `deductUsage()` — deducts credits from an org's balance after task completion
- `canExecuteTask()` — pre-flight check for balance, billing paused status, signup deposit

Costs are *tracked* via `recordTaskCost()` (which records to the DB), but credits are never *deducted* from org balances. The `canCreateTask()` function in `billing.ts` is called (checking subscription status), but the credit-specific `canExecuteTask()` is not.

**Impact:** Users can run unlimited tasks without their credit balance ever decreasing. Even after Stripe is hooked up, the billing loop is incomplete.

**Fix:** Wire `canExecuteTask()` into the task creation/dispatch path (alongside existing `canCreateTask()` calls in `routes/boards.ts:164`, `routes/tasks/crud.ts:182`, `services/task-claimer.ts:223`). Wire `deductUsage()` into cost recording (alongside `recordTaskCost()` calls in `routes/tasks/worker-api.ts:295`, `services/task-monitor.ts:1400,1474`).

---

### 2. No Production Guard for `EXECUTION_MODE=local`

**Files:**
- `api/src/middleware/auth.ts:46-64,130-146,305-322,416-434`
- `api/src/middleware/tos.ts:22-26`
- `api/src/index.ts:125`

**Issue:** Four authentication functions (`authenticateUser`, `authenticateUserAllowNoOrg`, `authenticateRequest`, `authenticateSSE`) check `process.env.EXECUTION_MODE === "local"` and auto-authenticate as the first admin user, skipping Cognito JWT verification entirely. TOS middleware and CORS also bypass on this flag.

There is **no startup guard** that rejects `EXECUTION_MODE=local` when `NODE_ENV=production`. If this env var were ever set in a production ECS task definition through a deployment mistake, the entire authentication stack collapses.

**Impact:** Complete authentication bypass in production if misconfigured.

**Fix:** Add a startup guard in `api/src/index.ts`:
```typescript
if (process.env.EXECUTION_MODE === "local" && process.env.NODE_ENV === "production") {
  logger.error("FATAL: EXECUTION_MODE=local is not allowed in production");
  process.exit(1);
}
```

---

### 3. `trust proxy` Not Configured — Rate Limiting Broken Behind ALB

**Files:**
- `api/src/index.ts` — missing `app.set("trust proxy", ...)`
- `api/src/middleware/rate-limit.ts:12`

**Issue:** Express is deployed behind an AWS ALB, which adds `X-Forwarded-For` headers. However, `app.set("trust proxy", ...)` is never called. This means `req.ip` returns the **ALB's internal IP**, not the client's IP.

All IP-based rate limiters (`strictLimiter` at 10/min, `webhookLimiter` at 100/min) see every request as coming from the same IP. An attacker can hammer auth endpoints (`POST /api/auth/login`, `POST /api/auth/signup`, `POST /api/auth/mfa/recover`) without ever hitting the rate limit.

**Impact:** IP-based rate limiting is completely ineffective for all unauthenticated endpoints.

**Fix:** Add to `api/src/index.ts` after `const app = express()`:
```typescript
app.set("trust proxy", 1); // Trust one level of proxy (AWS ALB)
```

---

### 4. Graceful Shutdown Doesn't Close the HTTP Server

**Files:**
- `api/src/index.ts:379` — `app.listen()` handle not stored
- `api/src/index.ts:395-409` — SIGTERM/SIGINT handlers

**Issue:** The SIGTERM/SIGINT handlers stop the orchestrator and disconnect Redis/DB, but never call `server.close()` to stop accepting new HTTP connections. The return value of `app.listen()` is not stored.

When ECS sends SIGTERM before killing a container, in-flight HTTP requests get interrupted instead of draining. The process exits while requests are still being processed.

Additionally, `stopPoolMonitor()` (exported from `db/connection.ts:601`) is never called from the shutdown handlers, leaving the 30-second pool monitoring interval running.

**Impact:** Intermittent 502s on every deployment. Active requests are cut off mid-response.

**Fix:**
```typescript
const server = app.listen(port, () => { ... });

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    stopOrchestrator();
    stopPoolMonitor();
    redis.disconnect().then(() => AppDataSource.destroy()).then(() => process.exit(0));
  });
});
```

---

## P1 — Should Fix Before Go-Live

### 5. Encryption Key Optional in Production + Decrypt Failure Returns Ciphertext

**Files:**
- `api/src/utils/encryption.ts:33-41` — no-op mode when key not set
- `api/src/utils/encryption.ts:150-157` — decrypt failure returns raw ciphertext

**Issue (5a):** If `ENCRYPTION_KEY` is not set, the encryption module operates in "no-op mode" (plaintext pass-through). Org API keys, webhook secrets, and provider credentials are stored unencrypted in RDS. Startup only logs a warning.

**Issue (5b):** If decryption fails for any reason (wrong key, key rotation, data corruption), the catch block **returns the raw encrypted blob** to the caller as if it were the plaintext value. No error is thrown. Callers silently receive ciphertext/garbage data.

```typescript
// encryption.ts:150-157
} catch {
  logger.warn("[Encryption] Failed to decrypt value — returning as-is");
  return encrypted; // returns ciphertext to the caller
}
```

**Impact:** Sensitive credentials stored unencrypted at rest. Silent data corruption on key rotation.

**Fix:**
- Make `ENCRYPTION_KEY` required in production (fail startup if missing when `NODE_ENV=production`)
- On decrypt failure, throw an error instead of returning ciphertext

---

### 6. Pro Plan Free-Pass Loophole

**File:** `api/src/services/billing.ts:640-652`

**Issue:** The `canCreateTask()` function has this logic for Pro plans:

```typescript
if (org.plan === "pro") {
  if (org.stripeSubscriptionStatus === "active" || org.stripeSubscriptionStatus === "trialing") {
    // Fall through
  } else if (org.trialExpiresAt && new Date() < org.trialExpiresAt) {
    // Active trial
  } else if (org.trialExpiresAt) {
    // Trial expired, no subscription — blocked
  }
  // If trialExpiresAt is null and no subscription, allow (legacy orgs / backward compat)
}
```

A Pro org with `trialExpiresAt = null` and no Stripe subscription passes all checks. The "backward compat" comment suggests this was intentional for migration, but it creates an open door for new orgs.

**Impact:** Free unlimited usage for any Pro org without a trial date or subscription.

**Fix:** Remove the legacy backward-compat pass-through, or explicitly check for it and add a sunset date.

---

### 7. Plaintext `api_key` Column Still Exists and Is Referenced

**Files:**
- `api/src/models/Organization.ts:157-158` — plaintext `api_key` column
- `api/src/middleware/auth.ts:201` — comment says "stored plaintext"
- `api/src/services/local-epic-spawner.ts:724` — reads `task.organization?.apiKey`
- `api/src/services/worker-spawner.ts:208` — reads `org?.apiKey || process.env.ORG_API_KEY || "local-dev"`

**Issue:** Auth correctly moved to bcrypt hashing (`apiKeyHash`), but the old plaintext `api_key` column was never cleaned up. It still contains values and is still read by worker spawners to pass as env vars to Docker containers.

The `OrganizationEncryptionSubscriber` does NOT include `apiKey` in its `SENSITIVE_FIELDS` array.

**Impact:** If the database is compromised, all org API keys are directly readable in plaintext.

**Fix:** Create a migration to null out all `api_key` values (since `apiKeyHash` is canonical). Update spawners to use a different mechanism. Eventually drop the column.

---

### 8. `email_verified` Extracted from JWT but Never Enforced

**Files:**
- `api/src/middleware/auth.ts:81,163,380,496`

**Issue:** The `email_verified` boolean is extracted from the Cognito JWT payload and placed into `req.cognitoUser.email_verified`, but no middleware or route handler ever checks this value. Users with unverified email addresses can fully authenticate and access the platform.

**Impact:** Throwaway/typo email accounts can be used. Potential account squatting.

**Fix:** Add a check in `authenticateUser` after JWT verification:
```typescript
if (!payload["email_verified"]) {
  res.status(403).json({ error: "Please verify your email address" });
  return;
}
```

---

### 9. TypeORM `.save()` Clobber Risk on Financial Data

**Files:**
- `api/src/services/cost-tracker.ts:125,273` — `orgRepo.save(org)`
- `api/src/services/referral.ts:337,449` — `orgRepo.save(referrerOrg)`

**Issue:** These use TypeORM's `.save()` method on the Organization entity, which writes ALL columns — not just the changed ones. If a cost update and a referral credit happen simultaneously, one overwrites the other's changes.

This is the exact anti-pattern documented in CLAUDE.md:

```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
task.status = "running";
await repo.save(task);

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

**Impact:** Race conditions can silently corrupt credit balances, cost tracking, and referral credits.

**Fix:** Replace `.save(org)` calls with atomic `UPDATE` queries using `createQueryBuilder().update()` or `repo.update()` that only touch the specific columns being changed.

---

## P2 — Fix Before or Shortly After Go-Live

### 10. State Machine Validation Disabled

**File:** `api/src/services/orchestrator-utils.ts:87-97`

**Issue:** `isValidTransition()` logs invalid task status transitions but always returns `true`:

```typescript
if (!validNextStatuses.includes(newStatus) && currentStatus !== newStatus) {
  logger.warn("Invalid status transition detected", { ... });
  // TODO: Once we're confident the state machine is complete,
  // return false here to block invalid transitions
}
return true; // always returns true
```

**Impact:** Tasks can transition to any status (e.g., `completed` → `running`), potentially causing orchestrator confusion and stuck tasks.

---

### 11. GitHub Runner Webhook Signature Optional

**File:** `api/src/routes/webhooks/github-runner.ts:24-53`

**Issue:** When `GITHUB_RUNNER_WEBHOOK_SECRET` is not set, signature verification is skipped entirely and a warning is logged. Anyone who discovers the endpoint can trigger ECS runner task spawning.

**Fix:** Make the secret mandatory — return 500 if not configured.

---

### 12. Frontend AuthCallback Has Debug Console.logs

**File:** `frontend/src/pages/AuthCallback.tsx:37,41,53,58,73,79,89`

**Issue:** 8+ `console.log` statements log OAuth state params, decoded state, invite tokens, and acceptance results. Visible in any user's browser dev tools.

```typescript
console.log("[AuthCallback] State param:", stateParam);
console.log("[AuthCallback] Decoded state:", decoded);
console.log("[AuthCallback] Found invite token in sessionStorage:", storedToken);
console.log("[AuthCallback] Final invite token:", inviteToken);
```

**Fix:** Remove all debug logging or gate behind `import.meta.env.DEV`.

---

### 13. Hardcoded Cognito/IAM Fallback Values

**Files:**
- `api/src/config/index.ts:121-124` — Cognito pool ID, client ID, domain
- `api/src/routes/settings/integrations.ts:1518` — hardcoded IAM ARN with no env-var override
- `api/src/config/index.ts:91` — hardcoded S3 bucket with AWS account ID

```typescript
userPoolId: process.env.COGNITO_USER_POOL_ID || "COGNITO_POOL_ID",
clientId: process.env.COGNITO_CLIENT_ID || "COGNITO_CLIENT_ID",
domain: process.env.COGNITO_DOMAIN || "workermill-dev-x0ru7n3p",
```

**Issue:** If env vars are not set in a prod ECS container, the API silently uses dev Cognito/AWS infrastructure. The `validateEnvironment()` function checks for these but is warning-only.

**Fix:** Remove hardcoded fallbacks. Let them be empty strings and fail at startup in production.

---

### 14. Rate Limiters Use In-Memory Store

**File:** `api/src/middleware/rate-limit.ts`

**Issue:** All `express-rate-limit` instances use the default in-memory store. With multiple ECS tasks, each container has its own counter — a user hitting different containers gets `N × limit` effective requests.

**Fix:** Use `rate-limit-redis` with the existing ElastiCache instance.

---

### 15. Swagger UI Exposed Without Auth

**File:** `api/src/index.ts:236-255`

**Issue:** `/api/docs` and `/api/docs.json` are publicly accessible without authentication. Exposes the complete API surface including endpoint paths, schemas, and auth requirements.

**Fix:** Add authentication middleware, restrict to VPC, or disable in production.

---

### 16. Warm Pool API Key Uses Plaintext Comparison

**File:** `api/src/routes/warm-pool.ts:36`

```typescript
if (!apiKey || apiKey !== platformKey) {
```

**Issue:** Uses direct string equality instead of `crypto.timingSafeEqual()`. All webhook routes properly use timing-safe comparison, but this internal route doesn't.

**Fix:**
```typescript
import { timingSafeEqual } from "crypto";
if (!apiKey || apiKey.length !== platformKey.length ||
    !timingSafeEqual(Buffer.from(apiKey), Buffer.from(platformKey))) {
```

---

### 17. Quality Gate Bypass Is Worker-Controlled

**Files:**
- `api/src/routes/worker-decisions.ts:65-68`
- `api/src/services/worker-decision-engine.ts:722-724`

**Issue:** `POST /api/worker-decisions/evaluate-quality` accepts `bypassRequested: true` from the request body. The server trusts the worker's claim without verifying the task actually has the `bypass-quality-gate` label.

**Fix:** Look up the task server-side and verify its `qualityGateBypass` flag instead of trusting the request body.

---

## Additional Issues (Lower Priority)

### Error Messages Leaked to Clients

Several routes return raw exception messages in error responses instead of using the global error handler:

| File | Line | Issue |
|------|------|-------|
| `routes/prd.ts` | 665 | `PRD decomposition failed: ${errorMsg}` — can include LLM API error details |
| `routes/tasks/crud.ts` | 647 | `Failed to create task: ${msg}` — can expose TypeORM SQL errors |
| `routes/settings/integrations.ts` | 1947 | Raw fetch error from OnCallShift connection test |
| `routes/settings/integrations.ts` | 1491 | Raw AWS SDK error (can expose ARNs, account IDs) |
| `routes/remote-agent.ts` | 686 | `detail: errorMessage` in 422 response |
| `routes/health.ts` | 32 | Raw DB error in 503 readiness response |
| `routes/compliance.ts` | 892 | Raw error in SIEM test endpoint |
| `routes/issues.ts` | 487,554 | Duck-typed `err.statusCode` forwarded verbatim |

### Incomplete Feature Stubs

| File | Line(s) | Issue |
|------|---------|-------|
| `routes/worker-api.ts` | 72-79 | `GET /planning-prompt` returns hardcoded placeholder prompt |
| `routes/worker-api.ts` | 113-118 | `POST /plan-result` stores raw LLM output in `jiraFields` |
| `routes/compliance.ts` | 2213-2230 | KMS key validation returns `valid: true` without calling AWS KMS |
| `services/management-dashboard.ts` | 578-580 | Admin billing stats always show `subscriptions: 0, overages: 0` |
| `services/marketing-agent-executor.ts` | 841-844 | X/Reddit/DevTo channel adapters commented out |

### ECS Spot Instances Suppressed

**File:** `api/src/services/ecs-task-runner.ts:418-428,603-606,737-741`

All three `RunTask` call sites have `// TEMPORARY: Using On-Demand only for demo reliability` with the Spot+fallback strategy commented out. FARGATE_SPOT is ~70% cheaper.

### Decision Client Silent Fallbacks

**File:** `worker/epic/decision-client.ts:376-492`

Every decision API method (error classification, quality gate, story approval, expert routing, model selection) has a bare `catch {}` that returns permissive defaults with **no logging**. If the decision service is down, all quality checks pass silently.

### Health Check Issues

- `/health/ready` leaks raw DB error messages in 503 responses (`routes/health.ts:32`)
- `/health/ready` has no rate limit — publicly accessible `SELECT 1` endpoint
- No Redis health check in readiness endpoint

### Debug Logging in Production Code

| File | Line(s) | Issue |
|------|---------|-------|
| `frontend/src/pages/AuthCallback.tsx` | 37-89 | OAuth state, invite tokens logged to console |
| `frontend/src/pages/settings/index.tsx` | 1024 | Jira settings payload logged |
| `api/src/config/index.ts` | 23,64-67 | `console.log` at module load (partial OAuth tokens) |
| `api/src/services/llm-backend.ts` | 414,452,467,595,614 | `console.log` instead of structured logger |
| `api/src/services/critic-agent.ts` | 574,674,696 | `console.log` instead of structured logger |

### Referral Service Query Hack

**File:** `api/src/services/referral.ts:156`

```typescript
status: MoreThan("expired") as any, // Not expired or revoked - this is a hack, should use NOT IN
```

Uses lexicographic string comparison to approximate `NOT IN` on an enum. Will break silently if enum values are reordered.

### Org Credentials Silent Failure

**File:** `api/src/services/org-credentials.ts:132-134`

Manager GitHub token fetch failure returns `""` silently with no logging. Callers get empty string, leading to silent auth failures against GitHub.

### Billing Payment Method Check Silently Ignored

**File:** `api/src/services/billing.ts:715-717`

If the Stripe API call to check payment methods fails (rate limit, network error), `hasPaymentMethod` stays `false`. A paying customer could be incorrectly treated as having no payment method.

---

## What's Already in Good Shape

- **Global error handler** — doesn't leak stack traces, returns generic 500 for unexpected errors
- **Sentry integration** — error reporting with `tracesSampleRate: 0.1`
- **Process crash handlers** — `unhandledRejection` and `uncaughtException` both handled
- **Webhook signature verification** — all webhook routes use `crypto.timingSafeEqual()`
- **Helmet security headers** — applied globally
- **CORS** — properly configured for production origins (only bypassed in local mode)
- **Rate limiting** — all authenticated routes have rate limiters applied
- **Auth middleware** — Cognito JWT verification with bcrypt API key hashing
- **Multi-tenant isolation** — org_id filtering on database queries
- **Per-org encrypted credential storage** — org_credentials table with AES-256-GCM
- **Structured logging** — Winston with JSON format in production, sensitive field redaction
- **Request timeout** — 60-second connect-timeout middleware
- **Response compression** — gzip with SSE exclusion
- **Task creation billing check** — `canCreateTask()` called in boards, tasks, and task-claimer
- **Stripe webhook** — proper signature verification with raw body parsing
- **`dangerouslySetInnerHTML`** — only one instance, properly sanitized with DOMPurify strict allowlist
- **MFA backup codes** — bcrypt hashed, rate-limited at router level
