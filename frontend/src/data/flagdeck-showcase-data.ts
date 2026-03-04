// Auto-generated from WorkerMill showcase build data
// Repo: workermill-examples/flagdeck
// Generated: 2026-03-04 (rebuild #2)

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
    title: "FDFBS-1: Foundation — Backend API, Seed Data, CI Pipeline & Docker Stack",
    priority: "urgent",
    storyCount: 8,
    duration: "~101 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 1,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/1",
    commentCount: 1,
    personas: ["backend_developer", "devops_engineer", "security_engineer", "qa_engineer"],
    description: `### Epic Overview
Build the entire Go backend from scratch: project scaffold, MongoDB document models, all CRUD handlers, JWT + API key authentication, flag evaluation engine with targeting rules and percentage rollouts, Redis caching, idempotent seed script, Docker multi-stage builds, and GitHub Actions CI pipeline.

### Scope Boundary
- First card — creates everything from empty repo to working backend
- Go 1.24 + Fiber router with MongoDB 7 + Redis 7 via Docker Compose
- Complete REST API with all endpoints operational
- Quality gates: go vet, go test, go build, gofmt

### What Was Built
1. **Go API scaffold** — Fiber router, graceful shutdown, health checks with MongoDB + Redis status
2. **All domain models** — Flags (with nested environment configs + targeting rules), Environments, Segments, Experiments, Audit Logs, Users, API Keys
3. **Full CRUD handlers** — Flags (list, get, create, update, delete, toggle), Environments, Segments, Experiments, Audit log queries
4. **Authentication** — JWT token issuance/validation, API key auth for SDK endpoints, bcrypt password hashing
5. **Flag evaluation engine** — Targeting rule matching, FNV-1a percentage rollouts, Redis cache layer
6. **Idempotent seed script** — 10 feature flags, 3 environments, 3 segments, demo users with upsert-based operations
7. **Docker infrastructure** — Multi-stage Go build (golang:1.24-alpine → alpine runtime), SvelteKit nginx Dockerfile, docker-compose with MongoDB + Redis
8. **CI pipeline** — GitHub Actions with go vet, go test -race, go build, gofmt checks

### Technical Highlights
- Planning: critic rejected first plan (76/100), approved second iteration (91/100)
- MongoDB snake_case field names via \`bson:"field_name"\` struct tags
- Evaluation priority: is_active → environment enabled → targeting rules (by priority) → percentage rollout → default value
- FNV-1a 32-bit deterministic percentage assignment via Go stdlib \`hash/fnv\`
- JWT: 15-min access + 7-day refresh tokens`,
    buildLog: `## Epic Implementation

This PR builds the complete Go backend — 9,063 lines added across 57 files in 40 commits. Everything from project scaffold to working API with authentication, all CRUD operations, and the flag evaluation engine.

### Stories Included (8 stories executed in parallel)

- **Docker Compose & CI Pipeline** (devops_engineer)
  - Files: docker-compose.yml, .github/workflows/ci.yml, Makefile
- **Go Module, Dockerfile & All Data Models** (backend_developer)
  - Files: go.mod, Dockerfile, internal/models/flag.go, environment.go, segment.go, experiment.go, audit.go, user.go, apikey.go
- **Remaining Models, Database & Middleware Layer** (backend_developer)
  - Files: internal/database/mongodb.go, redis.go, internal/middleware/
- **Database Connections, Middleware & Error Handling** (backend_developer)
  - Files: internal/config/config.go, internal/middleware/auth.go, error.go
- **Auth & Health Handlers with Audit Service** (backend_developer)
  - Files: internal/handlers/auth.go, health.go, internal/services/audit.go
- **Flags CRUD, Evaluate Engine & API Keys Handlers** (backend_developer)
  - Files: internal/handlers/flags.go, internal/services/evaluator.go, targeting.go, rollout.go, cache.go
- **Environments, Segments, Experiments & Audit Handlers** (backend_developer)
  - Files: internal/handlers/environments.go, segments.go, experiments.go, audit.go
- **Server Entrypoint, Seed Script & Tests** (backend_developer)
  - Files: cmd/server/main.go, cmd/seed/main.go

### Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Go Vet | ✅ Pass | 0 errors |
| Go Test | ✅ Pass | Race detector clean |
| Go Build | ✅ Pass | Server + seed binaries compile |
| gofmt | ✅ Pass | All files formatted |

### Gate Fixes
- 1 gate fix commit (inline gate fixer resolved build errors)
- CI pipeline fixes (Playwright test setup, npm ci step)

### Tech Lead Review

**Score: 9/10 — Approved.** Comprehensive backend implementation with all 33 deliverables properly implemented. Clean architecture with proper error handling, JWT authentication, API key auth, flag evaluation engine with FNV-1a hash rollout, and idempotent seed data. Minor CI configuration redundancy (both go-version and go-version-file specified) doesn't impact functionality. All quality gates passing.`,
  },
  {
    id: "fd-2",
    title: "FDFBS-2: Frontend — SvelteKit UI with All Pages, Components & Auth Flow",
    priority: "high",
    storyCount: 8,
    duration: "~134 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 2,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/2",
    commentCount: 4,
    personas: ["frontend_developer", "backend_developer", "integration_specialist", "devops_engineer", "qa_engineer"],
    description: `### Epic Overview
Build the complete SvelteKit 2 frontend with Svelte 5 runes: root layout with sidebar navigation, auth store, API client, login page, dashboard with live stats, all feature pages (flags, segments, experiments, environments, audit log, settings), and shared UI components.

### Scope Boundary
- Builds on Card 1's backend API
- SvelteKit 2 with Svelte 5 runes exclusively (\`$props()\`, \`$state()\`, \`$derived()\`, \`$effect()\`)
- TailwindCSS v4 for styling
- adapter-static for Railway deployment via nginx
- Client-side data fetching (adapter-static constraint)

### What Was Built
1. **Project scaffold** — SvelteKit 2, Svelte 5, Tailwind v4, adapter-static config
2. **Core libraries** — API client with JWT injection, auth store with Svelte 5 runes, TypeScript type definitions
3. **Root layout & auth** — Sidebar navigation with route highlighting, login page, responsive design
4. **Dashboard & flag management** — Flag counts, environment status, flag list with search/filter, detail page with targeting rule builder, rollout slider
5. **CRUD pages** — Environments, segments, experiments, audit log, settings
6. **Reusable components** — EmptyState, StatCard, FlagCard, FlagToggle, TargetingRuleBuilder, RolloutSlider
7. **Docker & nginx** — Dockerfile with multi-stage build, nginx config for SPA routing
8. **E2E tests** — Playwright test suite for critical user flows

### Technical Specification
- All components use Svelte 5 runes — NO legacy \`export let\`, \`$:\`, or \`on:event\` syntax
- Planning: critic rejected all 3 plan iterations (83, 80, 74) — auto-approved at simplified floor
- 3 tech lead revision rounds before final approval (TypeScript errors, Svelte 5 syntax, \`any\` types)
- API client uses fetch wrapper with JWT injection, token refresh, snake_case field names
- adapter-static requires \`$effect\` for dynamic route data fetching`,
    buildLog: `## Epic Implementation

This PR builds the complete SvelteKit frontend — 11,057 lines added across 43 files in 14 commits. Every page and component from login through settings, all using Svelte 5 runes.

### Stories Included (8 stories)

- **Project Config Scaffold** (frontend_developer)
  - Files: package.json, svelte.config.js, vite.config.ts, tsconfig.json
- **Core Libraries & App Shell** (frontend_developer)
  - Files: src/lib/api.ts, src/lib/stores/auth.svelte.ts, src/lib/types.ts
- **Root Layout, Sidebar & Login Page** (frontend_developer)
  - Files: src/routes/+layout.svelte, +layout.ts, src/lib/components/Sidebar.svelte, login/+page.svelte
- **Dashboard & Flag Management Pages** (frontend_developer)
  - Files: src/routes/+page.svelte, flags/+page.svelte, flags/[id]/+page.svelte, flags/new/+page.svelte
- **Environments, Segments & Settings Pages** (frontend_developer)
  - Files: src/routes/environments/, segments/, settings/
- **Experiments & Audit Log Pages** (frontend_developer)
  - Files: src/routes/experiments/, audit-log/
- **Reusable UI Components** (frontend_developer)
  - Files: src/lib/components/StatCard.svelte, EmptyState.svelte, FlagCard.svelte, TargetingRuleBuilder.svelte, RolloutSlider.svelte
- **Dockerfile & Nginx Config** (devops_engineer)
  - Files: web/Dockerfile, web/nginx.conf, playwright.config.ts

### Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Lint | ✅ Pass | 0 errors, 0 warnings |
| svelte-check | ✅ Pass | 0 type errors |
| Build | ✅ Pass | adapter-static output |
| TypeScript | ✅ Pass | 0 compilation errors |

### Gate Fixes
- 6 gate fix commits (lint errors, formatting, type corrections, Svelte 5 syntax)

### Tech Lead Review

**Score: 9/10 — Approved (after 3 revision rounds).** First review flagged TypeScript compilation errors, deprecated Svelte 5 syntax (\`<slot />\` instead of \`{@render}\`, \`on:click\` instead of \`onclick\`), and \`any\` type usage. Second review found persistent HeadersInit type error. Third review confirmed all fixes applied. Final approval: excellent implementation with correct Svelte 5 runes throughout, clean component architecture, and proper TypeScript typing.`,
  },
  {
    id: "fd-3",
    title: "FDFBS-3: Deployment — Docker Infrastructure, Smoke Tests & Go-Live",
    priority: "medium",
    storyCount: 5,
    duration: "~50 min",
    status: "deployed",
    techLeadScore: "9/10",
    prNumber: 3,
    prUrl: "https://github.com/workermill-examples/flagdeck/pull/3",
    commentCount: 1,
    personas: ["devops_engineer", "backend_developer", "qa_engineer", "tech_writer"],
    description: `### Epic Overview
Validate and fix Docker infrastructure, fix auth response format and seed data gaps, align CI workflow, create production smoke test script, and produce go-live checklist. This is a validation/deployment card — no new features, only integration fixes and verification.

### Scope Boundary
- Railway auto-deploys on merge to main — no manual deploy steps needed
- Railway services (api, web) pre-configured with MongoDB Atlas + Upstash Redis
- This card fixes integration issues discovered during deployment and validates everything works end-to-end

### What Was Built
1. **Docker infrastructure fixes** — Dockerfiles simplified and optimized, Alpine images, proper health checks
2. **Auth response alignment** — Added \`expires_in\` (900s) and \`token_type\` fields to login/register responses per spec
3. **Seed data improvements** — 60+ audit log entries spread across 14 days, full upsert for redeploy safety
4. **CI workflow alignment** — Streamlined to use docker-compose, eliminating race conditions
5. **Production smoke test** — \`scripts/smoke-test.sh\` validates health, auth, data counts, and web page loads
6. **Go-live checklist** — \`docs/go-live-checklist.md\` confirming all acceptance criteria met

### Deployment Architecture
- Planning: critic approved first iteration (87/100)
- **API**: Go binary on Railway (\`flagdeck-api-production.up.railway.app\`)
- **Web**: SvelteKit static build served by nginx on Railway (\`flagdeck-web-production.up.railway.app\`)
- **Database**: MongoDB Atlas (cloud-hosted)
- **Cache**: Upstash Redis (serverless, TLS-enabled)
- **Custom domains**: \`flagdeck-app.workermill.com\` (web), \`flagdeck.workermill.com\` (API)`,
    buildLog: `## Epic Implementation

This PR validates the full deployment stack and fixes integration issues — 737 lines added, 270 removed across 10 files in 13 commits. Railway auto-deployed on merge.

### Stories Included (5 stories)

- **Docker infrastructure & compose fixes** (devops_engineer)
  - Files: api/Dockerfile, web/Dockerfile, docker-compose.yml
- **Auth response format & seed data fixes** (backend_developer)
  - Files: api/internal/handlers/auth.go, api/cmd/seed/main.go
- **CI workflow alignment with spec** (devops_engineer)
  - Files: .github/workflows/ci.yml
- **Production smoke test script & post-deploy validation** (qa_engineer)
  - Files: scripts/smoke-test.sh
- **Go-live validation checklist** (tech_writer)
  - Files: docs/go-live-checklist.md

### Code Quality

| Metric | Score | Details |
|--------|-------|---------|
| **Overall** | **100%** | |
| Go Vet | ✅ Pass | 0 errors |
| Go Test | ✅ Pass | Race detector clean |
| Go Build | ✅ Pass | Compiles cleanly |
| Web Lint | ✅ Pass | 0 errors |
| Web Build | ✅ Pass | adapter-static output |

### Gate Fixes
- 2 gate fix commits (build errors resolved by inline fixers)

### Deployment Verification
- API health: ✅ MongoDB + Redis healthy
- Auth: ✅ Login + registration working with spec-compliant response format
- Flags API: ✅ 10 feature flags with targeting rules
- Segments: ✅ 3 segments seeded
- Environments: ✅ 3 environments (production, staging, development)
- Audit log: ✅ 60+ entries across 14 days
- Web frontend: ✅ SvelteKit serving on Railway
- 50 comprehensive E2E tests ready for execution

### Tech Lead Review

**Score: 9/10 — Approved.** Excellent implementation of deployment validation and go-live requirements. All Docker infrastructure fixes correct, auth response aligned with spec, seed data comprehensive with 60+ audit entries. Quality highlights include streamlined CI workflow and comprehensive smoke test. Minor non-blocking: 10 accessibility warnings in Svelte components, 3 low severity npm vulnerabilities.`,
  },
];
