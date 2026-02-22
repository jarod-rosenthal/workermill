# WorkerMill Production Readiness Audit — Pro Plan Launch

**Date:** 2026-02-21
**Scope:** Go-live readiness for Pro plan only
**Audited by:** Claude Code (6 parallel audit agents)

---

## SHOWSTOPPERS (Must fix before going live)

### 1. ~~Credit/Usage Billing Is Completely Unwired~~ RESOLVED

**Status:** Fixed 2026-02-21

Pro plan uses subscription billing ($19/mo with 90-day free trial), not credit billing. Credit billing (`deductUsage()`) is for Max plan cloud execution — not needed for Pro launch.

**What was implemented:**
- `trialExpiresAt` field added to Organization model, set on signup (90 days)
- `canCreateTask()` enforces trial expiry — blocks task creation when trial expires and no active Stripe subscription
- `STRIPE_PRICE_PRO` env var wired into config and `PRICE_IDS`
- Checkout endpoint updated to allow Pro plan subscriptions
- Trial reminder emails at 7/3/1/0 days remaining
- Dashboard trial banner when <= 14 days remaining
- Billing page subscribe button for post-trial conversion
- Pro plan enabled on pricing page ("Start Free Trial")

### 2. ~~No Password Reset Flow~~ RESOLVED

**Status:** Fixed 2026-02-21

**What was implemented:**
- `POST /auth/forgot-password` — sends Cognito verification code (doesn't leak email existence)
- `POST /auth/reset-password` — confirms code + sets new password
- `ForgotPassword.tsx` — two-step form (request code → enter code + new password)
- "Forgot password?" link added to Login page
- Rate-limited with existing auth limiter

### 3. ~~Bitbucket Webhooks Have Zero Signature Verification~~ ALREADY RESOLVED

**Status:** Already implemented (audit finding was incorrect)

Bitbucket webhook signature verification exists at `api/src/routes/webhooks/bitbucket.ts:126-167`. Uses HMAC-SHA256 with `crypto.timingSafeEqual()`. Webhook secret stored per-org in `Organization.bitbucketWebhookSecret`. Both legacy and multi-tenant (`/:orgSlug/bitbucket`) endpoints verify signatures.

### 4. ~~Team Invite Flow Is Broken~~ ALREADY RESOLVED

**Status:** Already fixed (audit finding was outdated — bugs documented 2026-02-01, code fixed since)

- Placeholder org name: `Signup.tsx` now deletes `organizationName` in invite flow
- SessionStorage persistence: `AcceptInvite.tsx` stores invite token in sessionStorage
- Onboarding redirect: `Onboarding.tsx` checks sessionStorage + backend API for pending invites
- Login redirect: `Login.tsx` correctly checks `inviteToken` before `needsSetup`
- Backend: `auth.ts` validates invite by email, creates user with `orgId: null` when invite exists

### 5. Single-Replica API on Fargate Spot with No Fallback

`desired_count = 1` with `FARGATE_SPOT` only — no `FARGATE` fallback. When AWS reclaims the Spot instance, the entire API goes down for ~40 seconds with no redundancy.

- Zero-downtime deploys impossible with 1 replica (old task terminates before new one is healthy)
- Resource constraints very tight: 256m CPU / 512MB RAM (~200-250MB available for requests)
- ~20-25 concurrent requests before OOM

**Files:** `infrastructure/terraform/modules/ecs-service/main.tf`

### 6. Single-AZ RDS with No Failover

`multi_az = false` on `db.t4g.micro`. If the AZ fails, the database is unreachable with no automatic failover. Recovery requires manual intervention (30+ minutes).

- Backup retention only 7 days
- No read replicas for DR
- No cross-region backup
- RPO: up to 24 hours (daily backups at 03:00 UTC)

**Files:** `infrastructure/terraform/modules/database/main.tf`

---

## HIGH Priority (Should fix before launch or immediately after)

### 7. SSRF Vulnerabilities

User-controlled URLs passed directly to `fetch()` with no validation against localhost, private IPs, or internal services. Admin users could probe the internal network.

- `compliance.ts:837` — SIEM webhook URL
- `integrations.ts:592` — GitLab base URL
- `integrations.ts:1224` — Slack/generic webhook test
- `prd.ts:139` — GitLab URLs from user settings

**Fix:** Validate URLs against allowlist, block `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`.

### 8. Tasks Can Get Permanently Stuck

Multiple failure paths leave tasks in unrecoverable states:

| Failure | Result | Location |
|---------|--------|----------|
| Agent crash mid-execution | Task permanently failed (no retry) | `task-cleanup.ts:672-689` |
| Planner iterations all timeout (score=0) | `plan-failed` never called, task stuck in "planning" | `agent/src/planner.ts:1077-1092` |
| Worker crash + fallback POST failure | Task shows "executing" forever | `agent/src/spawner.ts:424-451` |
| Planning timeout | 30-minute detection window before reset | `task-cleanup.ts:579` |

**Fix:**
- Requeue executing tasks on agent heartbeat dropout instead of permanent failure
- Call `plan-failed` in ALL planner error paths
- Add retry loop for worker crash fallback completion

### 9. SCM Tokens Stored Plaintext in Database

GitHub/GitLab/Bitbucket tokens in the `Organization` table are not encrypted at rest. Only masked as `"***configured***"` in API responses.

**Files:** `api/src/models/Organization.ts`
**Fix:** Encrypt with AWS KMS or use Secrets Manager per-org.

### 10. No Account Deletion (Hard Delete) for GDPR

`/api/profile/delete-account` does a soft delete (status → "inactive"). GDPR Right to Erasure requires actual data removal.

- No data export endpoint exists (privacy policy references one)
- No Data Processing Agreement (DPA) — enterprise customers will require this
- No deletion proof/audit trail
- Task logs may contain full repository content with unclear retention lifecycle

**Files:** `api/src/routes/profile.ts`

### 11. Legacy Jira Webhook Endpoint Multi-Tenancy Bug

The deprecated `/api/webhooks/jira` endpoint finds "any active user" and uses their org (`auth.ts:73-89`). A webhook for Org A could be processed by Org B.

**Files:** `api/src/routes/webhooks/jira.ts:73-89`
**Fix:** Remove legacy endpoint or enforce org verification.

### 12. No On-Call Alerting

SNS email alerts exist (CloudWatch alarms configured for ECS, RDS, ALB) but there's no PagerDuty, SMS, or Slack integration. If the system goes down at 3am, you'll only know if you check email.

**Files:** `infrastructure/terraform/modules/monitoring/main.tf`

### 13. GitHub Webhook Org Routing Vulnerability

`webhooks/github.ts` determines the org by looking up the first matching task. If tasks from multiple orgs reference the same PR number, the wrong org's secret could be used for verification.

**Files:** `api/src/routes/webhooks/github.ts:51-110`
**Fix:** Implement org-scoped webhook endpoints (`/{orgSlug}/github`).

---

## MEDIUM Priority (Fix soon after launch)

### 14. Onboarding UX Is Disorienting

- No setup wizard — users see 20+ integration cards with no guidance on which are required
- No "run your first task" tutorial or getting-started walkthrough
- Setup banner can be dismissed with X and never re-shown
- Pro vs Max plan requirements for integrations are unclear
- Internal board system is hidden — users think they must configure Jira/Linear
- API key generation not explained during onboarding
- No inline help when user clicks "Run Task" before setup is complete

**Files:** `frontend/src/pages/Dashboard/MainDashboard.tsx`, `frontend/src/pages/settings/IntegrationsSection.tsx`

### 15. MFA Account Recovery Missing

Users who enable TOTP MFA and lose their device are permanently locked out. No backup codes, no admin recovery flow, no account recovery mechanism.

**Files:** `api/src/routes/auth.ts`

### 16. Resource Constraints Too Tight

API runs on 256m CPU / 512MB RAM. After Node.js baseline (~150MB), Express + TypeORM (~80MB), only ~200-250MB remains for request handling. No horizontal auto-scaling configured.

**Files:** `infrastructure/terraform/modules/ecs-service/main.tf`

### 17. Log Streaming Can Exhaust DB Connection Pool

Recent fix (commit `9730d5d`) addressed request storms, but concurrent planner log batches can still exhaust the 15-connection pool (against db.t4g.micro's ~22 max connections), making workers appear stuck on the dashboard even though they're running.

**Files:** `api/src/db/connection.ts:254-259`, `agent/src/planner.ts:125-143`

### 18. Cost Tracking Accuracy Issue

`cost-tracker.ts` uses `usageReportedAt` for idempotency but can record $0 cost if called before tokens are finalized, then skip the real cost on subsequent calls. Organization cumulative cost will be under-reported.

**Files:** `api/src/services/cost-tracker.ts:52-65`
**Fix:** Track token finalization separately from `usageReportedAt`.

### 19. Git Clone Failures Silently Degraded

If git clone fails during planning (`planner.ts:591-607`), the planner continues without repo access. Plan quality is poor but posted as if it succeeded. User doesn't know why task results are wrong.

**Files:** `agent/src/planner.ts:582-609`
**Fix:** Escalate git clone failure as a blocker, don't silently degrade.

### 20. 3D Secure Payments Rejected

`allow_redirects: "never"` in `credit-billing.ts:324` declines any payment requiring 3D Secure redirect. Will fail legitimate cards in EU/UK markets where SCA (Strong Customer Authentication) is mandatory.

**Files:** `api/src/services/credit-billing.ts:324`

### 21. No Status Page

`status.workermill.com` redirects to `workermill.com/status` but no `/status` route handler exists. Customers have no way to check if the service is operational during an outage.

### 22. Failed Payment Notifications Not Implemented

`billing.ts:472` has a TODO comment: `// TODO: Send notification to org admins about failed payment`. When billing is paused due to failed payments, users aren't notified — they just see tasks stop running.

**Files:** `api/src/routes/billing.ts:472`

---

## Summary Scorecard

| Area | Score | Key Blocker |
|------|-------|-------------|
| **Billing** | 2/10 | Credits never deducted, Pro plan can't be purchased |
| **Auth & Security** | 6/10 | No password reset, Bitbucket webhooks unverified, SSRF |
| **Onboarding** | 4/10 | Broken invite flow, no guided setup, no password reset |
| **Task Execution** | 6/10 | Tasks can get permanently stuck, no retry for agent crashes |
| **Infrastructure** | 5/10 | Single replica, single-AZ DB, no on-call alerting |
| **Data & Privacy** | 5/10 | Plaintext SCM tokens, no hard delete, missing DPA |

---

## Positive Findings

These areas are production-ready:

- **SQL injection prevention** — parameterized queries throughout, no vulnerabilities found
- **API key hashing** — bcrypt with timing-safe comparison
- **Rate limiting** — tuned per endpoint type (auth: 10/min, webhooks: 100/min, API: 200/min)
- **Security headers** — Helmet configured (CSP, HSTS, X-Frame-Options)
- **Structured logging** — Winston JSON format with automatic sensitive field redaction
- **TLS** — Modern TLS 1.2/1.3 policy, HTTP→HTTPS redirect, wildcard cert via ACM
- **Secrets management** — All secrets in AWS Secrets Manager, injected via ECS task definition
- **Deployment safety** — Circuit breaker + auto-rollback on ECS deployments
- **Audit logging** — Comprehensive trail for user/admin actions
- **Sentry** — Error monitoring configured (10% transaction sample rate)
- **CloudWatch alarms** — ECS, RDS, ALB metrics monitored with SNS email alerts
- **Stripe webhook verification** — Signature verification implemented correctly
- **Jira webhook verification** — Implemented on org-scoped endpoints
- **S3 frontend** — Versioning enabled, public access blocked, OAC configured
- **Database deletion protection** — `deletion_protection = true` on RDS

---

## Recommended Launch Sequence

### Week 1 — Absolute Minimums

1. Wire `deductUsage()` and `canExecuteTask()` into task lifecycle, OR decide Pro is free-tier and disable billing UI
2. Build password reset flow (Cognito supports this natively)
3. Add Bitbucket webhook signature verification
4. Set `desired_count = 2` + add `FARGATE` fallback capacity provider
5. Enable Multi-AZ on RDS

### Week 2 — Critical Polish

6. Fix team invite flow (the known bug in `docs/bugs/team-onboarding-flow-issues.md`)
7. Add SSRF URL validation (block private IPs/localhost)
8. Add retry for agent crash task completion
9. Call `plan-failed` in all planner error paths
10. Add PagerDuty or Slack alerting to SNS

### Post-Launch Fast-Follows

11. Encrypt SCM tokens at rest
12. Build MFA recovery (backup codes)
13. Add onboarding wizard / first-task tutorial
14. Build status page
15. GDPR hard delete + data export
16. 3D Secure support for EU payments
17. Failed payment email notifications
18. Remove legacy Jira webhook endpoint

---

## Recovery Scenarios Reference

| Failure | Detection Time | Recovery Time | Auto-Recovery? |
|---------|---------------|---------------|----------------|
| Container crash | ~5s (ECS) | ~40s | Yes |
| Spot termination | ~5s (ECS) | ~40s | Yes (if Spot available) |
| DB pool exhaustion | ~30s (health check) | ~70s | Yes (container restart) |
| RDS AZ failure | ~5min (alarm) | 30+ min | No (manual) |
| Bad deployment | ~60s (circuit breaker) | ~90s | Yes (auto-rollback) |
| Agent crash mid-task | 10 min (cleanup) | Task failed permanently | No |
