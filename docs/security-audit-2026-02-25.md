# WorkerMill Security Audit Report

**Date:** 2026-02-25
**Auditors:** 4 parallel Claude security agents (Auth/API, Secrets/Credentials, Infrastructure/Network, Frontend/IP)
**Mode:** Static analysis (READ-ONLY)
**Scope:** Full codebase — `api/`, `frontend/`, `worker/`, `agent/`, `infrastructure/`, CI/CD

---

## Executive Summary

The WorkerMill codebase demonstrates strong security fundamentals: Cognito JWT verification via `aws-jwt-verify`, bcrypt-hashed API keys, org-scoped data isolation in all queries, Helmet headers, Secrets Manager for production credentials, and no hardcoded production secrets. However, the audit identified **1 CRITICAL**, **14 HIGH**, **22 MEDIUM**, and **18 LOW** findings across authentication, infrastructure, secrets handling, and IP exposure.

**Overall counts:** 1 CRITICAL | 14 HIGH | 22 MEDIUM | 18 LOW

---

## Fixes Applied

The following issues were fixed as part of this audit:

### [FIXED] CRITICAL: Microsoft OAuth PKCE `plain` → `S256`

- **File:** `api/src/routes/auth.ts:1591-1592`
- **Was:** `code_challenge_method: "plain"` with raw `codeVerifier` as `code_challenge`
- **Fix:** `code_challenge_method: "S256"` with `createHash("sha256").update(codeVerifier).digest("base64url")`
- **Impact:** PKCE now properly protects against authorization code interception

### [FIXED] HIGH: OAuth state parameter made required (Microsoft + GitHub)

- **Files:** `api/src/routes/auth.ts` — Microsoft callback (line 1614) and GitHub callback (line 2123)
- **Was:** `body("state").optional().isString()` with conditional `if (state)` validation
- **Fix:** `body("state").isString().notEmpty()` with unconditional state validation
- **Impact:** CSRF protection is now enforced on all OAuth callbacks

---

## CRITICAL Findings (1)

### C-1: ~~Microsoft OAuth PKCE uses `plain` method~~ — FIXED

- **File:** `api/src/routes/auth.ts:1591-1592`
- **Status:** FIXED (see above)

---

## HIGH Findings (14)

### Authentication & API

#### H-1: Unauthenticated support webhook creates worker tasks

- **File:** `api/src/routes/webhooks/support.ts:24-52`
- **Risk:** `POST /api/webhooks/support` has no authentication. Accepts arbitrary `orgId` and `createdBy` UUIDs to create `WorkerTask` entries that the orchestrator processes. An attacker can submit forged tasks under any org and consume compute resources.
- **Remediation:** Add internal API key authentication or request signature verification.

#### H-2: Unauthenticated email webhook endpoint

- **File:** `api/src/routes/webhooks/email.ts:36-50`
- **Risk:** `POST /api/webhooks/email` processes inbound emails from AWS SES Lambda and can create worker tasks. No authentication middleware applied.
- **Remediation:** Add signature verification or internal API key check.

#### H-3: ~~OAuth state parameter optional~~ — FIXED

- **Status:** FIXED (see Fixes Applied above)

#### H-4: Legacy Linear webhook uses wrong org context in multi-tenant

- **File:** `api/src/routes/webhooks/linear.ts:62-67`
- **Risk:** Selects the first active user from the database and uses their org context, regardless of which org the webhook is for. Jira and GitHub legacy endpoints correctly return 410 Gone; Linear doesn't.
- **Remediation:** Return 410 Gone immediately, like the other legacy webhook endpoints.

### Infrastructure

#### H-5: RDS storage encryption NOT enabled

- **File:** `infrastructure/terraform/modules/database/main.tf:56-97`
- **Risk:** All data (user records, API keys, task logs, credentials) stored unencrypted on EBS volumes.
- **Remediation:** Add `storage_encrypted = true`. Requires snapshot+restore (brief downtime).

#### H-6: API task role has Secrets Manager write/delete permissions

- **File:** `infrastructure/terraform/modules/ecs-cluster/main.tf:146-156`
- **Risk:** Actions include `PutSecretValue`, `CreateSecret`, `UpdateSecret`, `DeleteSecret`. Combined with `recovery_window_in_days = 0`, a compromised API container could permanently destroy all secrets.
- **Remediation:** Reduce to `GetSecretValue` and `DescribeSecret` only.

#### H-7: `cloudfront:*` on `Resource = "*"` for OnCallShift role

- **File:** `infrastructure/terraform/modules/ecs-cluster/main.tf:562-568`
- **Risk:** Compromised worker can modify/delete ANY CloudFront distribution in the account.
- **Remediation:** Scope to specific actions (`CreateInvalidation`, `GetDistribution`) and specific distribution ARNs.

#### H-8: `RegisterTaskDefinition` on `Resource = "*"`

- **File:** `infrastructure/terraform/modules/ecs-cluster/main.tf:536-540`
- **Risk:** Compromised worker could register arbitrary task definitions pointing to attacker-controlled images.
- **Remediation:** Scope to task definition families matching `oncallshift-*`.

#### H-9: CI/CD uses long-lived IAM keys instead of OIDC

- **Files:** `.github/workflows/ci-cd.yml:229-233`, `.github/workflows/agent-release.yml:52-55`
- **Risk:** If the repository is compromised, the keys provide persistent AWS access until manually rotated.
- **Remediation:** Configure AWS OIDC identity provider for GitHub Actions with `role-to-assume`.

#### H-10: Lambda DB password in plaintext env var

- **File:** `infrastructure/terraform/modules/cognito-presignup/main.tf:212-219`
- **Risk:** `DB_PASSWORD` visible in AWS Console and Terraform state.
- **Remediation:** Store in Secrets Manager, fetch at Lambda runtime.

#### H-11: All Secrets Manager `recovery_window_in_days = 0`

- **File:** `infrastructure/terraform/modules/secrets/main.tf` (12 occurrences)
- **Risk:** Accidental or malicious deletion permanently destroys all secrets (JWT, encryption key, DB credentials) with no recovery.
- **Remediation:** Set to `7` (minimum) for production secrets.

### Secrets & Credentials

#### H-12: SSL verification disabled in Cognito pre-signup Lambda

- **File:** `infrastructure/terraform/modules/cognito-presignup/lambda/index.py:65-66`
- **Code:** `ssl_context.check_hostname = False` / `ssl_context.verify_mode = ssl.CERT_NONE`
- **Risk:** MITM between Lambda and RDS could intercept database credentials.
- **Remediation:** Use `ssl.CERT_REQUIRED` with the AWS RDS CA bundle.

#### H-13: OAuth token prefix (20 chars) logged to stdout

- **File:** `api/src/config/index.ts:58-64`
- **Risk:** First 20 characters of OAuth tokens logged via bare `console.log`, bypassing the logger's `sanitizeForLogging()` redaction.
- **Remediation:** Remove token prefix from log output, or reduce to 4-char suffix.

### IP Exposure

#### H-14: Complete AI system prompts shipped in agent binary

- **Files:** `worker/epic/experts.ts`, `worker/epic/inline-reviewer.ts:37-78`
- **Risk:** 12+ expert persona prompts, coordination API templates, and the tech lead review rubric are bundled into the distributable agent binary. Anyone with the binary can extract this proprietary IP.
- **Remediation:** Migrate prompts to the server-side Decision API (already partially implemented). Worker/agent receives prompts at runtime only.

---

## MEDIUM Findings (22)

### Authentication & API

| # | Finding | File |
|---|---------|------|
| M-1 | SSE accepts JWT in query parameter (visible in ALB/CloudFront logs) | `api/src/middleware/auth.ts:449-451` |
| M-2 | Quality backfill runs `npm install` on arbitrary cloned repos (RCE via postinstall) | `api/src/routes/quality-backfill.ts:232-237` |
| M-3 | Logout doesn't revoke Cognito refresh tokens server-side | `api/src/routes/auth.ts` |
| M-4 | Org API key auth sets no `req.user` — bypasses role checks, no audit trail | `api/src/middleware/auth.ts:230-235` |
| M-5 | Mixed auth middleware strategies per route creates complexity | `api/src/routes/coordination.ts` |
| M-6 | Bcrypt comparison on every API key request is CPU-expensive | `api/src/middleware/auth.ts:226-235` |
| M-7 | Health endpoint exposes Redis/PG pool telemetry unauthenticated | `api/src/routes/health.ts:19-73` |

### Infrastructure

| # | Finding | File |
|---|---------|------|
| M-8 | No CloudTrail logging configured in Terraform | (missing resource) |
| M-9 | SNS Publish + SES Send on `Resource = "*"` | `ecs-cluster/main.tf:296-328` |
| M-10 | SSM wildcard on worker task role (ECS Exec on AI containers) | `ecs-cluster/main.tf:375-383` |
| M-11 | Cognito Advanced Security disabled | `cognito/main.tf:83-85` |
| M-12 | Cognito allows `USER_PASSWORD_AUTH` (less secure than SRP-only) | `cognito/main.tf:256-261` |
| M-13 | Route53 `ChangeResourceRecordSets` on all hosted zones | `ecs-cluster/main.tf:666-672` |
| M-14 | ELB Modify on `Resource = "*"` | `ecs-cluster/main.tf:698-710` |
| M-15 | CloudFront missing security response headers (no HSTS, no CSP) | `cdn/main.tf` |
| M-16 | PgBouncer uses `AUTH_TYPE = "plain"` | `ecs-service/main.tf:221`, `orchestrator.tf:97` |
| M-17 | GitHub runner container runs as root with no `readonlyRootFilesystem` | `github-runner-ecs/main.tf:33-82` |

### Secrets & Credentials

| # | Finding | File |
|---|---------|------|
| M-18 | Frontend stores tokens in `localStorage` (XSS-exfiltrable) | `frontend/src/store/auth-store.ts:55-58` |
| M-19 | `rejectUnauthorized: false` in migration scripts | Multiple files in `api/scripts/` |
| M-20 | `ecr:*` on OnCallShift role (includes Delete/Policy) | `ecs-cluster/main.tf:489-496` |

### IP Exposure

| # | Finding | File |
|---|---------|------|
| M-21 | 213 internal API paths exposed in production JS bundle | `frontend/dist/` |
| M-22 | AWS Account ID + IAM role ARN hardcoded in frontend settings page | `frontend/src/pages/settings/index.tsx:4091` |

---

## LOW Findings (18)

| # | Finding | File |
|---|---------|------|
| L-1 | Swagger UI CSP disabled in non-production (correctly gated) | `api/src/index.ts:254-258` |
| L-2 | `EXECUTION_MODE=local` auto-authenticates as admin (guarded by prod check) | `api/src/middleware/auth.ts:46-64` |
| L-3 | Email unsubscribe renders lookup-table content in HTML | `api/src/routes/email.ts:144` |
| L-4 | Body size limit is 10MB globally | `api/src/index.ts:229` |
| L-5 | ECR image tag mutability enabled | `ecr/main.tf:4,19` |
| L-6 | PgBouncer ECR repository missing image scanning | `ecr/main.tf:56-58` |
| L-7 | Local Redis has no authentication | `docker-compose.local.yml:27-36` |
| L-8 | SSH `StrictHostKeyChecking=no` in deploy script | `deploy.sh:331` |
| L-9 | AWS Account ID hardcoded in deploy script | `deploy.sh:18` |
| L-10 | Cognito refresh token validity 365 days | `cognito/main.tf:215-221,275-281` |
| L-11 | GitHub runner SSM wildcard action | `github-runner-ecs/main.tf:195-197` |
| L-12 | Worker Dockerfile installs global npm packages as root before user switch | `worker/Dockerfile:32,54` |
| L-13 | Default JWT secret in `.env.local.example` | `.env.local.example:57` |
| L-14 | Docker Compose uses weak database passwords (local dev only) | `docker-compose.local.yml:12`, `docker-compose.yml:9` |
| L-15 | API key prefix (15 chars) logged in migration | Migration file |
| L-16 | `.env.remote.example` contains sample token pattern | `.env.remote.example:11` |
| L-17 | Personal email addresses hardcoded in database migrations | Migration files |
| L-18 | CORS includes `localhost:5173` in production Terraform config | `ecs-service/main.tf:157` |

---

## Positive Findings (Things Done Well)

1. **No hardcoded production secrets** — no AWS keys, tokens, or passwords in source
2. **Cognito JWT verification** via `aws-jwt-verify` with proper token validation
3. **Bcrypt-hashed API keys** with prefix indexing for efficient lookup
4. **Org-scoped data isolation** — `orgId` consistently in all database queries
5. **5-tier rate limiting** with Redis-backed distributed enforcement
6. **Helmet security headers** applied globally on API
7. **Secrets Manager** for all production secrets with `valueFrom` injection
8. **No source maps** in production frontend builds
9. **Error handler sanitizes responses** — no stack traces sent to clients
10. **Log redaction** for 16+ sensitive field patterns
11. **Production guard** prevents `EXECUTION_MODE=local` in prod
12. **Terraform state encrypted** in S3 with DynamoDB locking
13. **Worker containers run as non-root** with minimal IAM roles
14. **Webhook signature verification** (HMAC) on Jira, GitHub, Linear org-scoped webhooks
15. **Atomic story claiming** via database transactions preventing race conditions
16. **Agent credential storage** uses OS-native keychains (macOS Keychain, Linux libsecret)
17. **Config file permissions** enforced at 0o600
18. **TLS 1.3** enforced on ALB (`ELBSecurityPolicy-TLS13-1-2-2021-06`)
19. **Redis encryption** in transit and at rest enabled
20. **RDS in private subnets** with `publicly_accessible = false`

---

## Priority Remediation Roadmap

### Immediate (This Week)

| Priority | Severity | Fix | Effort |
|----------|----------|-----|--------|
| 1 | ~~CRITICAL~~ | ~~PKCE S256~~ | **DONE** |
| 2 | ~~HIGH~~ | ~~OAuth state required~~ | **DONE** |
| 3 | HIGH | Add auth to support + email webhooks | 2 hrs |
| 4 | HIGH | Return 410 from legacy Linear webhook | 15 min |
| 5 | HIGH | Stop logging OAuth token prefixes | 15 min |

### Short Term (Next 2 Weeks)

| Priority | Severity | Fix | Effort |
|----------|----------|-----|--------|
| 6 | HIGH | Set `recovery_window_in_days = 7` for secrets | 15 min |
| 7 | HIGH | Reduce API task role to Secrets Manager read-only | 30 min |
| 8 | HIGH | Enable RDS encryption at rest | 1 hr + downtime |
| 9 | HIGH | Fix SSL verification in Lambda | 1 hr |
| 10 | HIGH | Migrate CI/CD to OIDC federation | 2 hrs |
| 11 | HIGH | Move Lambda DB password to Secrets Manager | 1 hr |
| 12 | HIGH | Scope CloudFront/RegisterTaskDefinition IAM | 30 min |

### Medium Term (Next Month)

| Priority | Severity | Fix | Effort |
|----------|----------|-----|--------|
| 13 | HIGH | Move system prompts to Decision API | 1-2 days |
| 14 | MEDIUM | Add CloudFront security response headers | 1 hr |
| 15 | MEDIUM | Remove `localhost` from production CORS | 15 min |
| 16 | MEDIUM | Restrict health endpoint telemetry | 30 min |
| 17 | MEDIUM | Add CloudTrail logging | 1 hr |
| 18 | MEDIUM | Scope SNS/SES/Route53/ELB IAM permissions | 2 hrs |
| 19 | MEDIUM | Implement server-side token revocation on logout | 2 hrs |
| 20 | MEDIUM | Sandbox quality-backfill npm install | 4 hrs |
| 21 | MEDIUM | Move AWS ARN to server-side API response | 1 hr |
| 22 | MEDIUM | Enable Cognito Advanced Security (AUDIT mode) | 15 min |

### Backlog

- Migrate localStorage tokens to httpOnly cookies (M-18)
- Consider SSE ticket system to avoid JWT in query params (M-1)
- Remove `USER_PASSWORD_AUTH` from Cognito web client (M-12)
- Set ECR tag immutability (L-5)
- Enable scan_on_push for all ECR repos (L-6)
- Reduce body size limit with per-route overrides (L-4)
- Reduce Cognito refresh token validity to 30-90 days (L-10)
