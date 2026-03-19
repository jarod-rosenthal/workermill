# WorkerMill API Documentation

## Interactive API Documentation (Swagger UI)

The WorkerMill API includes auto-generated OpenAPI 3.0 documentation powered by swagger-jsdoc and swagger-ui-express. Swagger UI is available in non-production environments only.

### Accessing the Docs

| Resource | URL |
|----------|-----|
| **Swagger UI (dev)** | http://localhost:3001/api/docs |
| **OpenAPI JSON (dev)** | http://localhost:3001/api/docs.json |

Swagger UI is disabled in production (`NODE_ENV=production`) to avoid exposing the API surface publicly.

### Using Swagger UI

1. Navigate to http://localhost:3001/api/docs
2. Click the **Authorize** button (lock icon)
3. Enter your JWT token as: `Bearer YOUR_TOKEN`
4. Click **Authorize** to save
5. Use **Try it out** on any endpoint to test it interactively

### Adding Documentation to Endpoints

Documentation is defined using `@swagger` JSDoc comments in route files. swagger-jsdoc scans all files matching `./src/routes/**/*.ts` and generates the OpenAPI spec automatically.

To document a new endpoint, add a JSDoc block above the route handler:

```typescript
/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a specific task
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 */
router.get("/:id", async (req, res) => {
  // ...
});
```

Available tags are defined in `api/src/config/swagger.ts`. Available security schemes: `BearerAuth` (JWT) and `ApiKeyAuth` (x-api-key header). Shared schemas (Task, BillingStatus, Plan, Error) are also defined there.

### Code Generation

Use the OpenAPI spec to generate client SDKs:

```bash
# TypeScript
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:3001/api/docs.json \
  -g typescript-fetch \
  -o ./generated/workermill-client

# Python
openapi-generator generate \
  -i http://localhost:3001/api/docs.json \
  -g python \
  -o ./generated/workermill-client
```

---

## Authentication

The API supports four authentication strategies, applied as Express middleware on route groups. Each route uses exactly one strategy.

### 1. `authenticateUser()` -- Cognito JWT + Org Context

Used by most dashboard-facing endpoints. Verifies a Cognito JWT from the `Authorization: Bearer <token>` header, loads the user's organization, and sets `req.user`, `req.organization`, and `req.orgRole`. In local dev mode (`EXECUTION_MODE=local`), falls back to a local admin user with no JWT verification.

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://workermill.com/api/billing/status
```

**How to obtain a token:**
- Log in via the WorkerMill dashboard and extract `cognitoIdToken` from browser localStorage
- Or authenticate directly against the Cognito User Pool

### 2. `authenticateApiKey()` -- Organization or User API Key

Used for worker-to-API and programmatic access. Reads the `x-api-key` header. Two key types:
- **Organization keys** (`wm_` prefix) -- hashed in `organizations.apiKeyHash`
- **User keys** (`usr_` prefix) -- stored in `user_api_keys` table with expiry

```bash
curl -H "x-api-key: wm_your_org_api_key" \
  -H "Content-Type: application/json" \
  https://workermill.com/api/worker-decisions/ci-status
```

### 3. `authenticateUserAllowNoOrg()` -- JWT Without Org Requirement

Same as `authenticateUser()` but does not require the user to be a member of an organization. Used for onboarding flows where a user exists but has not yet joined or created an org.

### 4. `authenticateCognitoOnly()` -- JWT Only, No Org Lookup

Validates the Cognito JWT but does not load organization context. Used for signup and account creation flows where the org does not yet exist.

---

## Rate Limiting

Rate limits are applied at route mount time in `src/index.ts` (not inside route modules). Four tiers exist, backed by Redis with in-memory fallback. Rate limit headers are included in all responses:

- `X-RateLimit-Limit` -- Request quota
- `X-RateLimit-Remaining` -- Remaining requests
- `X-RateLimit-Reset` -- Reset timestamp

| Tier | Limit | Key | Used By |
|------|-------|-----|---------|
| `strictLimiter` | 10 req/min | IP | `/api/auth` |
| `webhookLimiter` | 100 req/min | IP | `/api/webhooks`, `/api/agent`, `/api/status`, `/api/showcase`, `/api/email` |
| `authenticatedLimiter` | 200 req/min | user:id or org:id | Most authenticated routes (billing, settings, analytics, etc.) |
| `workerLogLimiter` | 1000 req/min | IP | `/api/tasks`, `/api/worker`, `/api/worker-decisions`, `/api/coordination`, `/api/warm-pool`, `/api/directives`, `/api/tasks-v2` |

---

## Endpoint Reference

All endpoints are grouped by route prefix. The authentication strategy and rate limit tier are noted for each group.

### /health -- Health Checks
**Auth:** None | **Rate limit:** None

Basic health and readiness checks for load balancers and monitoring.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/ready` | Readiness check (includes DB connectivity) |

---

### /api/auth -- Authentication & SSO
**Auth:** `strictLimiter` (10/min) | Various auth strategies per endpoint

Handles user authentication, OAuth flows (Cognito, GitHub, Microsoft), signup, login, token refresh, password management, and SSO configuration.

| Subgroup | Description |
|----------|-------------|
| Signup & Login | User registration, email/password login, token refresh |
| OAuth Callbacks | GitHub and Microsoft OAuth authorization flows |
| Password | Password reset request and confirmation |
| SSO | SAML/OIDC SSO configuration for enterprise orgs |
| Session | Token validation, logout, session management |

---

### /api/profile -- User Profile
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

User profile management, notification preferences, and API key management.

| Subgroup | Description |
|----------|-------------|
| Profile CRUD | Get/update user profile, avatar, display name |
| Notification preferences | Email and in-app notification settings |
| User API keys | Create, list, revoke personal API keys (`usr_` prefix) |
| Terms of Service | TOS acceptance tracking |

---

### /api/organizations -- Organization Management
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Organization CRUD, member management, and invitation handling.

| Subgroup | Description |
|----------|-------------|
| Org CRUD | Create, read, update organizations |
| Members | List members, update roles, remove members |
| API keys | Regenerate organization API key |
| Setup | Initial organization setup and onboarding status |

---

### /api/invites -- Invitations
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Organization invitation management (create, accept, revoke invitations).

---

### /api/settings -- Organization Settings
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Comprehensive organization configuration spread across submodules:

| Submodule | File | Description |
|-----------|------|-------------|
| General | `settings/general.ts` | Worker defaults, parallel limits, quality gate toggles, auto-fix settings |
| Integrations | `settings/integrations.ts` | SCM connections (GitHub, GitLab, Bitbucket), credential management |
| Models | `settings/models.ts` | AI provider and model configuration per role (worker, planner, reviewer) |
| Org | `settings/org.ts` | Organization-level settings (name, billing email, log retention) |
| Webhooks | `settings/webhooks.ts` | Webhook endpoint configuration for external notifications |

---

### /api/tasks -- Task Management
**Auth:** Mixed (`authenticateUser()` + `authenticateApiKey()`) | **Rate limit:** `workerLogLimiter` (1000/min)

Core task lifecycle management across submodules:

| Submodule | File | Description |
|-----------|------|-------------|
| CRUD | `tasks/crud.ts` | Create, list (with filtering/pagination), get, delete tasks |
| Lifecycle | `tasks/lifecycle.ts` | Status transitions, cancel, retry, claim, complete |
| Plans | `tasks/plans.ts` | Task planning, plan approval/rejection, re-planning |
| Subtasks | `tasks/subtasks.ts` | Subtask (story) management within epic tasks |
| Usage | `tasks/usage.ts` | Token usage and cost reporting |
| Worker API | `tasks/worker-api.ts` | Worker-facing endpoints (log posting, status updates, file changes) |

---

### /api/tasks-v2 -- V2 Pipeline Tasks
**Auth:** `authenticateUser()` | **Rate limit:** `workerLogLimiter` (1000/min)

V2 pipeline for vertical slice sequential task execution. Alternative execution model to the standard epic/story approach.

---

### /api/boards -- Kanban Boards
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Kanban board management. This is the primary user-facing board system (`KbBoard`/`KbCard` entities).

| Subgroup | Description |
|----------|-------------|
| Board CRUD | Create, list, get, update, delete boards |
| Columns | Add, reorder, rename, delete board columns |
| Cards | Create, move, update, archive cards |
| Quality gates | Column-level quality gate command configuration |
| Templates | Board templates for common workflows |

---

### /api/projects -- Internal Projects
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Internal project and task management (`Project`/`InternalTask` entities). These are NOT visible in the user-facing UI -- they are used for internal orchestration.

| Subgroup | Description |
|----------|-------------|
| Project CRUD | Create, list, get, update, delete projects |
| Internal tasks | Create, assign, track internal tasks within projects |

---

### /api/billing -- Billing & Subscriptions
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Subscription management, credit billing, payment methods, and usage tracking. Integrates with Stripe.

| Subgroup | Description |
|----------|-------------|
| Plans | List available plans, current plan details |
| Status | Current billing status, quota, and usage |
| Subscriptions | Create, update, cancel subscriptions |
| Credits | Credit balance, purchase credits, usage history |
| Payment methods | Add, remove, set default payment method |
| Invoices | Invoice history and PDF download |
| Checkout | Stripe checkout session creation |
| Portal | Stripe customer portal session |

Note: Stripe webhook handling is at `POST /api/webhooks/stripe` (raw body, separate from the webhooks router).

---

### /api/analytics -- Analytics & Metrics
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Analytics data across multiple dimensions, organized in submodules:

| Submodule | File | Description |
|-----------|------|-------------|
| Tasks | `analytics/tasks.ts` | Task volume, completion rates, status distribution, trends |
| Costs | `analytics/costs.ts` | Cost breakdown by model, persona, time period |
| Quality | `analytics/quality.ts` | Code quality metrics, review pass rates, gate results |
| Efficiency | `analytics/efficiency.ts` | Cycle time, throughput, developer productivity |
| Complexity | `analytics/complexity.ts` | Task complexity analysis and estimation accuracy |

---

### /api/audit -- Audit Trail
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Activity audit log for organization actions (user actions, setting changes, task operations).

---

### /api/personas -- Persona Management
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Worker persona configuration (system prompts, tool permissions, model preferences, execution scripts, directives). Personas define the behavior and capabilities of AI workers.

---

### /api/memory -- Memory System
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Organizational memory and knowledge base. Workers read from and write to memory during task execution for context continuity.

| Subgroup | Description |
|----------|-------------|
| Memory CRUD | Create, read, update, delete memory entries |
| Categories | Memory categorization and tagging |
| Search | Full-text search across memory entries |
| Worker access | Worker-facing memory read/write endpoints |

---

### /api/coordination -- Worker Coordination
**Auth:** `authenticateApiKey()` | **Rate limit:** `workerLogLimiter` (1000/min)

Real-time worker coordination via SSE. Workers post coordination messages (file changes, decisions, blockers) and clients subscribe for live updates.

| Subgroup | Description |
|----------|-------------|
| SSE stream | Server-Sent Events for real-time coordination messages |
| Messages | Post coordination messages (file changes, decisions, blockers) |
| Status | Worker status and heartbeat |

---

### /api/control-center -- Logs & Monitoring
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Dashboard data, task log streaming, search, and real-time monitoring:

| Submodule | File | Description |
|-----------|------|-------------|
| Dashboard | `control-center/dashboard.ts` | Dashboard summary data and widgets |
| Logs | `control-center/logs.ts` | Task log retrieval and SSE streaming |
| Stream | `control-center/stream.ts` | Real-time event streaming |
| Search | `control-center/search.ts` | Full-text log search |
| Actions | `control-center/actions.ts` | Task actions from the control center UI |
| Code Events | `control-center/code-events.ts` | Code change event streaming |

**Log Streaming:** Uses Server-Sent Events (SSE) at `GET /api/control-center/logs/{taskId}/stream`. Supports automatic resume via `Last-Event-ID` header. Data source is PostgreSQL (not CloudWatch), polled at 1-second intervals.

---

### /api/webhooks -- SCM Webhooks
**Auth:** Signature verification per provider | **Rate limit:** `webhookLimiter` (100/min)

Receives webhooks from source control providers and issue trackers:

| Submodule | File | Description |
|-----------|------|-------------|
| GitHub | `webhooks/github.ts` | Push, PR, and issue events |
| GitHub App | `webhooks/github-app.ts` | GitHub App installation events |
| GitHub Issues | `webhooks/github-issues.ts` | GitHub issue sync |
| GitHub Runner | `webhooks/github-runner.ts` | Self-hosted runner webhook events |
| GitLab | `webhooks/gitlab.ts` | GitLab push and MR events |
| Bitbucket | `webhooks/bitbucket.ts` | Bitbucket push and PR events |
| Jira | `webhooks/jira.ts` | Jira issue create/update events |
| Linear | `webhooks/linear.ts` | Linear issue events |
| Email | `webhooks/email.ts` | Inbound email processing (SES) |
| Support | `webhooks/support.ts` | Support ticket webhook processing |

Note: `POST /api/webhooks/stripe` is handled directly in `index.ts` (requires raw body before JSON parsing).

---

### /api/worker-decisions -- Worker Decision Engine
**Auth:** `authenticateApiKey()` | **Rate limit:** `workerLogLimiter` (1000/min)

Server-side decision logic for workers. Keeps business logic in the API rather than in the worker binary.

| Endpoint Pattern | Description |
|-----------------|-------------|
| Error classification | Classify build/test errors and recommend fixes |
| CI status | Poll CI pipeline status (GitHub Actions, Bitbucket Pipelines, GitLab CI) |
| Quality gates | Evaluate quality gate pass/fail |
| Review decisions | Automated code review scoring |
| Fix recommendations | Suggest fix strategies for failing tasks |

---

### /api/agent -- Remote Agent API
**Auth:** `authenticateApiKey()` | **Rate limit:** `webhookLimiter` (100/min)

Communication endpoints for the remote agent binary running on user machines.

| Subgroup | Description |
|----------|-------------|
| Polling | Agent polls for new tasks to claim |
| Heartbeat | Agent sends periodic heartbeats to indicate it is alive |
| Task lifecycle | Claim, start, complete, fail tasks |
| Planning | Submit and retrieve task plans |
| Configuration | Agent configuration sync |
| Status | Report agent status and capabilities |

---

### /api/compliance -- Compliance & Audit
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Compliance policy management, audit trails, and compliance reporting for regulated environments.

| Subgroup | Description |
|----------|-------------|
| Policies | Define and manage compliance policies |
| Checks | Run compliance checks against tasks and code |
| Reports | Generate compliance reports |
| Audit trail | Detailed audit log with compliance context |

---

### /api/codebase -- Codebase RAG
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Codebase indexing and retrieval-augmented generation (RAG) for providing workers with relevant code context.

| Subgroup | Description |
|----------|-------------|
| Indexing | Trigger and monitor codebase indexing |
| Search | Semantic search across indexed codebases |
| Context | Retrieve relevant code context for tasks |

---

### /api/prd -- PRD Decomposition
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Product Requirements Document decomposition into actionable tasks.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/prd` | Submit a PRD for decomposition |
| GET | `/api/prd/:id` | Get decomposition status and results |

---

### /api/issues -- Issue Tracking
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Issue tracking integration for syncing external issues into WorkerMill.

---

### /api/manager -- Manager Agent
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Manager agent endpoints for code review coordination and team management decisions.

---

### /api/support -- Support Tickets
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Support ticket submission from within the application.

---

### /api/directives -- Directives & Scripts
**Auth:** Mixed | **Rate limit:** `workerLogLimiter` (1000/min)

System persona directives and execution scripts that define worker behavior.

---

### /api/worker -- Worker API
**Auth:** `authenticateApiKey()` | **Rate limit:** `workerLogLimiter` (1000/min)

Endpoints for local CLI workers to communicate with the API (distinct from `/api/tasks` worker endpoints).

---

### /api/build -- Build Page
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Build page for plan preview and one-click execution from the frontend.

---

### /api/specs -- Specifications
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Specification document management for tasks and projects.

---

### /api/attachments -- Attachments
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

File attachment upload and retrieval for tasks and boards.

---

### /api/showcase -- Showcase
**Auth:** None (public) | **Rate limit:** `webhookLimiter` (100/min)

Public showcase and demo endpoints. No authentication required.

---

### /api/management -- Platform Admin
**Auth:** `authenticateUser()` (platform admin only) | **Rate limit:** `authenticatedLimiter` (200/min)

Platform-level administration dashboard for managing all organizations, users, and system health.

---

### /api/marketing -- Marketing
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Marketing content management endpoints.

---

### /api/email -- Email
**Auth:** None for unsubscribe (CAN-SPAM) | **Rate limit:** `webhookLimiter` (100/min)

Email management. The unsubscribe endpoint is public to comply with CAN-SPAM requirements.

---

### /api/referrals -- Referrals
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Referral program management (create referral links, track conversions, claim rewards).

---

### /api/warm-pool -- Warm Pool
**Auth:** `authenticateApiKey()` | **Rate limit:** `workerLogLimiter` (1000/min)

Pre-warmed worker container pool management for reducing cold start times.

---

### /api/status -- System Status
**Auth:** None (public) | **Rate limit:** `webhookLimiter` (100/min)

Public system status endpoint for uptime monitoring.

---

### /api/orchestrator -- Orchestrator
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Orchestrator control and monitoring (start/stop, status, task queue inspection).

---

### /api/system -- System Administration
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

System administration endpoints (database maintenance, cache management, diagnostics).

---

### /api/watcher -- File Watcher
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

File watcher configuration for monitoring repository changes.

---

### /api/quality -- Quality Backfill
**Auth:** `authenticateUser()` | **Rate limit:** `authenticatedLimiter` (200/min)

Backfill quality metrics for historical tasks.

---

### Special Routes

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| POST | `/api/webhooks/stripe` | None (signature verified) | Stripe webhook handler (raw body, registered before JSON parser) |
| POST | `/jira` | `webhookLimiter` | Direct Jira webhook (forwards to `/api/webhooks/jira`) |

---

## Architecture Notes

### Real-Time Log Streaming

The API uses **Server-Sent Events (SSE)** for real-time data, not WebSockets:

- **Log streaming:** `GET /api/control-center/logs/{taskId}/stream`
- **Coordination:** `GET /api/coordination/stream`
- **Protocol:** SSE (`text/event-stream`)
- **Resume:** Automatic via `Last-Event-ID` header
- **Backend:** PostgreSQL with Redis pub/sub for cross-instance broadcasting

### Database-Backed Logs

Worker logs are stored in the `worker_task_logs` PostgreSQL table:
- Workers POST logs during execution via `/api/tasks/{taskId}/logs`
- Dashboard streams via SSE from the database
- Automatic cleanup after `org.logRetentionDays`

### Error Handling

The API uses custom error classes (`NotFoundError`, `BadRequestError`, `ForbiddenError`, etc.) from `utils/errors.ts`. All errors are caught by the global error handler in `middleware/error-handler.ts` and returned as JSON:

```json
{ "error": "Human-readable error message" }
```

Standard HTTP status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limited), 500 (internal error).

---

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | API server port |
| `DATABASE_URL` | -- | PostgreSQL connection string |
| `EXECUTION_MODE` | -- | Set to `local` for local dev (bypasses auth, billing, TOS) |
| `NODE_ENV` | `development` | `production` disables Swagger UI |
| `REDIS_URL` | -- | Redis URL for rate limiting and pub/sub (optional) |
| `SENTRY_DSN` | -- | Sentry error tracking DSN (optional) |
