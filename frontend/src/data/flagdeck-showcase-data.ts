// Auto-generated from WorkerMill showcase build data
// Repo: workermill-examples/flagdeck
// Generated: 2026-03-02

export interface FlagDeckEpic {
  id: string;
  title: string;
  priority: string;
  storyCount: number;
  duration: string;
  status: "completed" | "escalated" | "deployed";
  techLeadScore?: string;
  prNumber: number;
  prUrl: string;
  commentCount: number;
  personas: string[];
  description: string;
  buildLog: string;
}

export const flagDeckEpics: FlagDeckEpic[] = [
  {
    id: "fd-1",
    title: "FDFBS-1: Root config files, Docker Compose & CI pipeline",
    priority: "high",
    storyCount: 6,
    duration: "~75 min",
    status: "completed",
    techLeadScore: "7/10",
    prNumber: 1,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/1",
    commentCount: 1,
    personas: ["backend_developer", "devops_engineer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Bootstrap the FlagDeck monorepo with Go backend scaffold, SvelteKit frontend scaffold, Docker Compose for local MongoDB + Redis, CI pipeline, and all configuration files. This card creates the foundation every other card builds on.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- This is the first card — nothing precedes it
- Creates only scaffolding, configuration, and minimal app entry points
- Must NOT implement any API endpoints, domain models, or business logic
- CI pipeline includes only \`api\` and \`web\` jobs — NO e2e job yet

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`api/cmd/server/main.go\` — Go Fiber app bootstrap with graceful shutdown
2. \`api/cmd/seed/main.go\` — Idempotent seed script for demo data
3. \`api/go.mod\` + \`api/go.sum\` — Go 1.24 with Fiber v2, mongo-driver v2, go-redis v9, envconfig, testify, jwt-go
4. \`api/Dockerfile\` — Multi-stage build: golang:1.24-alpine builder → alpine runtime with seed binary
5. \`api/internal/config/config.go\` — Env var loading via envconfig (MongoDB, Redis, JWT, CORS, Port)
6. \`api/internal/database/mongodb.go\` — MongoDB client connection with index creation
7. \`api/internal/database/redis.go\` — Redis client with TLS support for Upstash
8. \`api/internal/handlers/health.go\` — Health check endpoint returning DB + Redis status
9. \`api/internal/router/router.go\` — Route registration and middleware mounting
10. \`web/\` — Full SvelteKit 2 scaffold with Svelte 5, TailwindCSS 4, adapter-static, vitest, Playwright
11. \`web/Dockerfile\` — SvelteKit adapter-static build + nginx serve
12. \`docker-compose.yml\` — Local MongoDB 7 + Redis 7 for development
13. \`.github/workflows/ci.yml\` — Go vet, test, build + SvelteKit lint, test, check, build
14. \`CLAUDE.md\` — Worker instructions for the repository

***REMOVED******REMOVED******REMOVED*** Tech Stack
- Go 1.24 + Fiber v2 (backend)
- SvelteKit 2 + Svelte 5 + TailwindCSS 4 (frontend)
- MongoDB 7 + Redis 7 (data layer)
- Docker multi-stage builds (deployment)
- GitHub Actions CI (quality gates)`,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR bootstraps the entire FlagDeck monorepo — Go backend, SvelteKit frontend, Docker Compose, CI pipeline, and configuration.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Root config files — go.mod, package.json, Docker Compose**
  - Files: go.mod, go.sum, docker-compose.yml, .gitignore (+4 more)
- **Go backend scaffold — Fiber app, config, database connections**
  - Files: cmd/server/main.go, internal/config/config.go, internal/database/mongodb.go (+3 more)
- **SvelteKit frontend scaffold — Svelte 5 runes, TailwindCSS 4, adapter-static**
  - Files: web/src/app.html, web/src/app.css, web/svelte.config.js (+8 more)
- **Docker multi-stage builds — API alpine + frontend nginx**
  - Files: api/Dockerfile, web/Dockerfile, .dockerignore
- **GitHub Actions CI — api + web jobs**
  - Files: .github/workflows/ci.yml
- **Developer documentation — CLAUDE.md**
  - Files: CLAUDE.md, README.md

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Go Vet | ✅ Pass | 0 errors |
| Go Test | ✅ Pass | Race detector clean |
| Go Build | ✅ Pass | Compiles to /dev/null |
| SvelteKit Lint | ✅ Pass | 0 warnings |
| SvelteKit Check | ✅ Pass | 0 type errors |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**Score: 7/10 — Revision needed.** Solid foundation with clean project structure and proper configuration. Go backend scaffold, Docker Compose, multi-stage Dockerfiles, and SvelteKit with Svelte 5 all correctly set up. Revision addressed remaining configuration gaps before approval.`,
  },
  {
    id: "fd-2",
    title: "FDFBS-3: Domain models — flags, environments, segments, experiments",
    priority: "high",
    storyCount: 7,
    duration: "~80 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 2,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/2",
    commentCount: 1,
    personas: ["backend_developer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Implement all MongoDB document models, database connection logic (MongoDB + Redis), and the idempotent seed script. This card defines the entire data layer — every subsequent card reads from or writes to these models.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- Builds on Card 1's project scaffold, go.mod, and config
- Creates ONLY the data layer — no API endpoints, no handlers, no services
- All 7 MongoDB collections with proper indexes
- Seed script must be idempotent (upsert-based)

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`api/internal/models/flag.go\` — Flag document with nested environment config, targeting rules, and rollout percentages
2. \`api/internal/models/environment.go\` — Environment document (production, staging, development) with sort order and color
3. \`api/internal/models/segment.go\` — User segment with rules and conditions for targeting groups
4. \`api/internal/models/experiment.go\` — A/B experiment with variants, metrics, and results tracking
5. \`api/internal/models/audit.go\` — Audit log entry with actor, action, resource, and changes
6. \`api/internal/models/user.go\` — Dashboard user with email, bcrypt password hash, and role
7. \`api/internal/models/apikey.go\` — SDK API key with SHA-256 hash, prefix, environment binding, and permissions
8. \`api/cmd/seed/main.go\` — Idempotent seed: 3 environments, demo user, 5 sample flags with targeting rules, 2 segments, 1 experiment

***REMOVED******REMOVED******REMOVED*** Technical Specification
- MongoDB snake_case field names via \`bson:"field_name"\` struct tags
- All models use \`primitive.ObjectID\` for IDs and \`time.Time\` for timestamps
- Flag \`environments\` field is a map (\`map[string]EnvironmentConfig\`), NOT an array
- Targeting rules use \`property\` (not \`attribute\`), \`operator\` for logic (not \`logic\`)
- Seed uses upsert (\`UpdateOne\` with \`upsert: true\`) to be safe for re-runs`,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR implements all MongoDB document models, database connection logic, and the idempotent seed script.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Flag model — nested environment config with targeting rules**
  - Files: internal/models/flag.go
- **Environment, segment, and experiment models**
  - Files: internal/models/environment.go, internal/models/segment.go, internal/models/experiment.go
- **Audit log, user, and API key models**
  - Files: internal/models/audit.go, internal/models/user.go, internal/models/apikey.go
- **Database connection — MongoDB indexes and Redis health check**
  - Files: internal/database/mongodb.go, internal/database/redis.go
- **Idempotent seed script — demo data with upserts**
  - Files: cmd/seed/main.go
- **Model tests — struct tag validation, index verification**
  - Files: internal/models/flag_test.go, internal/models/environment_test.go
- **CI verification — all quality gates pass**
  - Files: (no new files — verified go vet, go test, go build)

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Go Vet | ✅ Pass | 0 errors |
| Go Test | ✅ Pass | All tests pass with race detector |
| Go Build | ✅ Pass | Both server and seed binaries compile |
| gofmt | ✅ Pass | All files formatted |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**Approved.** All requirements met. Domain models correctly implemented with proper BSON struct tags, snake_case field names, and index definitions. Seed script is idempotent with upsert-based operations. MongoDB connection properly handles index creation on startup.`,
  },
  {
    id: "fd-3",
    title: "FDFBS-4: Full API — handlers, middleware, services & evaluation engine",
    priority: "high",
    storyCount: 8,
    duration: "~210 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 3,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/3",
    commentCount: 2,
    personas: ["backend_developer", "security_engineer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Implement the complete Go API: JWT + API key authentication, rate limiting, request ID middleware, all CRUD handlers (flags, environments, segments, experiments, audit log, auth), the core flag evaluation engine with targeting rules and percentage rollouts, Redis caching layer, and comprehensive test coverage.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- Builds on Card 1 (scaffold) and Card 2 (models)
- Implements ALL backend handlers and services — nothing left for later cards
- Evaluation engine: targeting rule matching, FNV-1a percentage rollouts, Redis cache
- Auth: JWT token issuance/validation, API key authentication for SDK endpoints
- Rate limiting: in-memory token bucket per IP

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`api/internal/middleware/auth.go\` — JWT + API key dual authentication, user context injection
2. \`api/internal/middleware/ratelimit.go\` — In-memory rate limiter (100 req/min default)
3. \`api/internal/middleware/requestid.go\` — X-Request-Id header generation
4. \`api/internal/handlers/flags.go\` — Flag CRUD: list (paginated, filterable), get, create, update, delete, toggle
5. \`api/internal/handlers/evaluate.go\` — SDK-facing flag evaluation endpoint with context-based targeting
6. \`api/internal/handlers/environments.go\` — Environment CRUD
7. \`api/internal/handlers/segments.go\` — Segment CRUD with rule builder
8. \`api/internal/handlers/experiments.go\` — Experiment CRUD + start/stop + result recording
9. \`api/internal/handlers/audit.go\` — Audit log queries with pagination
10. \`api/internal/handlers/auth.go\` — Login, register, token refresh, me endpoint, API key management
11. \`api/internal/services/evaluator.go\` — Core evaluation engine: targeting rules → percentage rollout → cache
12. \`api/internal/services/targeting.go\` — Rule condition matching (eq, neq, contains, in, regex, gt/lt)
13. \`api/internal/services/rollout.go\` — FNV-1a 32-bit deterministic percentage assignment
14. \`api/internal/services/cache.go\` — Redis cache with get/set/invalidate for flag evaluations
15. \`api/internal/services/audit.go\` — Audit log recording service
16. \`api/internal/services/experiment_stats.go\` — Chi-squared statistical significance calculation

***REMOVED******REMOVED******REMOVED*** Technical Specification
- JWT tokens: 30-min access + 7-day refresh, stored in Fiber locals as pointer (\`&user\`)
- Evaluation priority: is_active check → environment enabled → targeting rules (by priority) → percentage rollout → default value
- FNV-1a hashing uses Go stdlib \`hash/fnv\` — no unsafe pointer arithmetic, passes \`-race\`
- Rate limiting: in-memory sync.Map, no Redis dependency
- API key format: \`fd_live_<32-char>\` (production) / \`fd_test_<32-char>\` (non-production)
- All handlers call AuditService.LogAction with AuditEntryInput struct`,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR implements the complete Go API — the largest card in the build. 91 files changed with 11,768 additions, covering all handlers, middleware, services, and the flag evaluation engine.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **JWT + API key authentication middleware**
  - Files: internal/middleware/auth.go, internal/middleware/auth_test.go
- **Rate limiting and request ID middleware**
  - Files: internal/middleware/ratelimit.go, internal/middleware/requestid.go
- **Flag CRUD handlers with pagination and filtering**
  - Files: internal/handlers/flags.go, internal/handlers/pagination.go
- **Flag evaluation engine — targeting rules, percentage rollouts, Redis cache**
  - Files: internal/services/evaluator.go, internal/services/targeting.go, internal/services/rollout.go, internal/services/cache.go
- **Environment, segment, experiment handlers**
  - Files: internal/handlers/environments.go, internal/handlers/segments.go, internal/handlers/experiments.go
- **Auth handlers — login, register, refresh, API key management**
  - Files: internal/handlers/auth.go
- **Audit log service and handler**
  - Files: internal/services/audit.go, internal/handlers/audit.go
- **Comprehensive test suite**
  - Files: internal/services/evaluator_test.go, internal/services/targeting_test.go (+6 more test files)

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Go Vet | ✅ Pass | 0 errors |
| Go Test | ✅ Pass | All tests pass with -race |
| Go Build | ✅ Pass | Server + seed binaries compile |
| gofmt | ✅ Pass | All files formatted |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**First review: Revision needed.** Excellent Go API implementation with proper error handling, clean architecture, and comprehensive test coverage. One critical issue: web build artifacts (.svelte-kit/ and build/) were committed to the repository.

**Second review: Approved.** Build artifacts removed, .gitignore updated to prevent future commits. All quality gates pass.`,
  },
  {
    id: "fd-4",
    title: "FDFBS-5: SvelteKit foundation — Sidebar, layout & shared components",
    priority: "medium",
    storyCount: 6,
    duration: "~65 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 4,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/4",
    commentCount: 1,
    personas: ["frontend_developer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Build the SvelteKit frontend foundation: root layout with sidebar navigation, auth store and API client, login page, and shared UI components (Sidebar, EmptyState). All components use Svelte 5 runes syntax exclusively.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- Builds on Card 1's SvelteKit scaffold
- Creates layout, routing, auth flow, and reusable components
- Must NOT implement feature pages (flags, segments, experiments) — those are in Card 5
- All components must use Svelte 5 runes (\`$props()\`, \`$state()\`, \`$derived()\`, \`$effect()\`)

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`web/src/routes/+layout.svelte\` — Root layout with Sidebar, responsive design, dark theme
2. \`web/src/routes/+layout.server.ts\` — Auth guard, SPA mode (\`ssr = false\`, \`prerender = false\`)
3. \`web/src/routes/login/+page.svelte\` — Login form with error handling and redirect
4. \`web/src/lib/api.ts\` — Fetch wrapper with JWT token injection, refresh logic, error handling
5. \`web/src/lib/stores/auth.svelte.ts\` — Auth state store with Svelte 5 runes (\`$state\`, \`$derived\`)
6. \`web/src/lib/components/Sidebar.svelte\` — Navigation sidebar with route highlighting, collapsible on mobile
7. \`web/src/lib/components/EmptyState.svelte\` — Empty state placeholder with icon, title, description, action button

***REMOVED******REMOVED******REMOVED*** Technical Specification
- Svelte 5 runes ONLY — no \`export let\`, no \`$:\` reactive declarations, no \`on:event\` syntax
- API client uses \`PUBLIC_API_URL\` env var, snake_case field names in all requests
- Auth routes at \`/auth/*\` (NOT \`/api/v1/auth/*\`) — most common integration bug
- localStorage keys: \`flagdeck_access_token\`, \`flagdeck_refresh_token\`, \`flagdeck_user\`
- adapter-static requires client-side fetching (\`$effect\`) for dynamic routes, NOT \`+page.server.ts\``,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR builds the SvelteKit frontend foundation with proper Svelte 5 runes syntax throughout.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Root layout with sidebar and responsive design**
  - Files: src/routes/+layout.svelte, src/routes/+layout.server.ts
- **Auth store with Svelte 5 runes ($state, $derived)**
  - Files: src/lib/stores/auth.svelte.ts
- **API client — fetch wrapper with JWT, refresh, snake_case**
  - Files: src/lib/api.ts
- **Login page with form validation**
  - Files: src/routes/login/+page.svelte
- **Sidebar component — navigation, route highlighting, mobile collapse**
  - Files: src/lib/components/Sidebar.svelte
- **EmptyState component — reusable placeholder**
  - Files: src/lib/components/EmptyState.svelte

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Lint | ✅ Pass | 0 errors, 0 warnings |
| Types | ✅ Pass | svelte-check clean |
| Tests | ✅ Pass | Component tests pass |
| Build | ✅ Pass | adapter-static output |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**Score: 9/10 — Approved.** Excellent implementation of the SvelteKit frontend foundation. Correct use of Svelte 5 runes throughout (\`$state\`, \`$derived\`, \`$effect\`, \`$props\`). Clean component architecture with proper TypeScript typing and responsive design.`,
  },
  {
    id: "fd-5",
    title: "FDFBS-6: Dashboard, flag list, flag detail & all feature pages",
    priority: "medium",
    storyCount: 7,
    duration: "~125 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 5,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/5",
    commentCount: 1,
    personas: ["frontend_developer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Implement all SvelteKit feature pages: dashboard with live stats, flag list with search/filter, flag detail with targeting rule builder and rollout slider, segment management, experiment tracking with results, audit log viewer, environment management, and settings page with API key management.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- Builds on Card 4's layout, auth, and shared components
- Implements ALL remaining frontend pages — nothing left for later cards
- FlagCard, FlagToggle, TargetingRuleBuilder, RolloutSlider, ExperimentChart, AuditTimeline components
- All pages use client-side fetching via \`$effect\` (adapter-static constraint)

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`web/src/routes/+page.svelte\` — Dashboard home with flag counts, environment status, recent changes
2. \`web/src/routes/flags/+page.svelte\` — Flag list with search, type filter, tag filter, environment filter
3. \`web/src/routes/flags/new/+page.svelte\` — Create flag form with type selection, default values
4. \`web/src/routes/flags/[id]/+page.svelte\` — Flag detail with targeting rules, rollout control, environment toggles, history
5. \`web/src/routes/segments/+page.svelte\` — Segment list and \`[id]\` detail/edit with visual rule builder
6. \`web/src/routes/experiments/+page.svelte\` — Experiment list and \`[id]\` detail with results chart
7. \`web/src/routes/audit/+page.svelte\` — Audit log viewer with filters (action, resource, actor)
8. \`web/src/routes/environments/+page.svelte\` — Environment management
9. \`web/src/routes/settings/+page.svelte\` — API key management, account settings
10. \`web/src/lib/components/FlagCard.svelte\` — Flag summary card with environment status dots
11. \`web/src/lib/components/FlagToggle.svelte\` — On/off toggle with environment selector
12. \`web/src/lib/components/TargetingRuleBuilder.svelte\` — Visual rule builder with condition editing
13. \`web/src/lib/components/RolloutSlider.svelte\` — Percentage rollout control with visual feedback

***REMOVED******REMOVED******REMOVED*** Technical Specification
- All data fetching in \`$effect\` — adapter-static does NOT support \`+page.server.ts\` on dynamic routes
- \`environments\` is an object map: use \`Object.entries(flag.environments)\` to iterate
- snake_case everywhere: \`is_active\`, \`targeting_rules\`, \`flag_key\`, \`created_at\`
- Dashboard stats computed client-side from flags list response (no dedicated stats endpoint)
- TargetingRuleBuilder handles nested conditions with operator dropdowns (eq, neq, contains, in, regex, gt, lt)`,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR implements all SvelteKit feature pages — the full dashboard experience with 37 files changed and 7,345 additions.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Dashboard page — flag counts, environment status, quick actions**
  - Files: src/routes/+page.svelte
- **Flag list with search, type filter, and FlagCard component**
  - Files: src/routes/flags/+page.svelte, src/lib/components/FlagCard.svelte
- **Flag detail — targeting rules, rollout slider, environment toggles**
  - Files: src/routes/flags/[id]/+page.svelte, src/lib/components/FlagToggle.svelte, src/lib/components/TargetingRuleBuilder.svelte, src/lib/components/RolloutSlider.svelte
- **Create flag form with validation**
  - Files: src/routes/flags/new/+page.svelte
- **Segments and experiments pages with rule builder**
  - Files: src/routes/segments/+page.svelte, src/routes/segments/[id]/+page.svelte, src/routes/experiments/+page.svelte, src/routes/experiments/[id]/+page.svelte
- **Audit log and environment management**
  - Files: src/routes/audit/+page.svelte, src/routes/environments/+page.svelte
- **Settings page — API key management**
  - Files: src/routes/settings/+page.svelte

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Lint | ✅ Pass | 0 errors, 0 warnings |
| Types | ✅ Pass | svelte-check clean |
| Tests | ✅ Pass | Component tests pass |
| Build | ✅ Pass | adapter-static output |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**Score: 9/10 — Approved.** Excellent implementation with strong technical competency and attention to detail. Svelte 5 runes used correctly throughout. All feature pages functional with proper API integration, form validation, and responsive design.`,
  },
  {
    id: "fd-6",
    title: "FDFBS-7: E2E test suite & CI integration",
    priority: "high",
    storyCount: 4,
    duration: "~65 min",
    status: "deployed",
    techLeadScore: "9/10",
    prNumber: 6,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/6",
    commentCount: 2,
    personas: ["qa_engineer"],
    description: `***REMOVED******REMOVED******REMOVED*** Epic Overview
Write the full Playwright E2E test suite covering all feature pages, add the \`e2e\` job to the existing CI workflow, and verify the complete stack works end-to-end. This card has permission to fix bugs in any file across the codebase — it is the integration fixer.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- Builds on ALL previous cards — requires the full working stack
- Adds \`e2e\` job to existing \`.github/workflows/ci.yml\` (CI now has 3 jobs: api, web, e2e)
- 6 Playwright test files covering: login, dashboard, flags, segments, experiments, audit
- May fix bugs discovered during E2E testing in any file

***REMOVED******REMOVED******REMOVED*** Deliverables
1. \`e2e/playwright.config.ts\` — Playwright config with baseURL, headless, retries, timeout
2. \`e2e/login.spec.ts\` — Auth flow: login, token storage, redirect to dashboard
3. \`e2e/dashboard.spec.ts\` — Dashboard stats: flag counts, quick action buttons
4. \`e2e/flags.spec.ts\` — Flag list + detail: names, types, environment toggles, targeting rules
5. \`e2e/segments.spec.ts\` — Segment list: names, rule counts
6. \`e2e/experiments.spec.ts\` — Experiment list: statuses, variants
7. \`e2e/audit.spec.ts\` — Audit log: actor emails, actions, timestamps
8. Updated \`.github/workflows/ci.yml\` — New \`e2e\` job with MongoDB + Redis service containers, API build/seed/start, frontend build/preview, Playwright test run

***REMOVED******REMOVED******REMOVED*** Technical Specification
- E2E tests run against local stack: Go API + SvelteKit preview server + MongoDB + Redis
- Seed script populates demo data before tests (demo@workermill.com / demo1234)
- All waits use proper Playwright condition-based strategies (no hardcoded \`page.waitForTimeout\`)
- Playwright report artifacts excluded from git via .gitignore`,
    buildLog: `***REMOVED******REMOVED*** Epic Implementation

This PR adds the complete E2E test suite with CI integration — the final quality gate before deployment.

***REMOVED******REMOVED******REMOVED*** Stories Included

- **Playwright config and test infrastructure**
  - Files: e2e/playwright.config.ts, package.json (@playwright/test dependency)
- **Auth and dashboard E2E tests**
  - Files: e2e/login.spec.ts, e2e/dashboard.spec.ts
- **Feature page E2E tests — flags, segments, experiments, audit**
  - Files: e2e/flags.spec.ts, e2e/segments.spec.ts, e2e/experiments.spec.ts, e2e/audit.spec.ts
- **CI integration — e2e job added to ci.yml**
  - Files: .github/workflows/ci.yml

***REMOVED******REMOVED******REMOVED*** Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| E2E Tests | ✅ Pass | All 6 test files pass |
| CI Pipeline | ✅ Pass | 3 jobs: api, web, e2e — all green |
| Go Quality | ✅ Pass | go vet + go test + go build |
| Frontend Quality | ✅ Pass | lint + check + build |

***REMOVED******REMOVED******REMOVED*** Tech Lead Review

**First review: Revision needed.** Comprehensive E2E coverage and proper CI integration. Two issues: (1) Playwright report artifacts committed to repo, (2) hardcoded \`page.waitForTimeout\` calls instead of condition-based waits.

**Second review: Approved.** All issues resolved — Playwright reports added to .gitignore, all waits converted to proper condition-based strategies. Full CI pipeline passing with 3 jobs.`,
  },
];
