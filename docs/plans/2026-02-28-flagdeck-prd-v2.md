# FlagDeck — Full Build Specification

> **"FlagDeck — Built by WorkerMill"**
>
> Open-source feature flag and experimentation platform with targeting rules, percentage rollouts, A/B experiments, and a real-time dashboard. Deployed to Railway (compute) + MongoDB Atlas (database) + Upstash Redis (cache).

---

## Source of Truth

- **Spec**: This document
- **Target repo**: `workermill-examples/flagdeck` (GitHub, public)
- **Live URL**: https://flagdeck.workermill.com
- **API compute**: Railway (Hobby plan, Docker container)
- **Frontend compute**: Railway (SvelteKit with `adapter-static` + nginx Dockerfile)
- **Database**: MongoDB Atlas (M0 free tier, 512 MB)
- **Cache**: Upstash Redis (free tier, 10K commands/day)
- **CI/CD**: GitHub Actions → Railway CLI deploy

---

## ⛔ Global Worker Constraints — EVERY Card MUST Follow These

**These rules apply to EVERY card in this PRD. Workers MUST follow them on every commit, no exceptions.**

### Pre-Commit Quality Gate — Go Backend (MANDATORY)

Before EVERY `git commit` that touches `api/` files, workers MUST run the following commands **in this exact order** and fix ALL errors before committing:

```bash
# Step 1: Format all Go files
cd api && gofmt -w .

# Step 2: Run static analysis
cd api && go vet ./...

# Step 3: Run tests (with race detector — MUST match CI exactly)
cd api && go test ./... -v -count=1 -race

# Step 4: Verify build
cd api && go build -o /dev/null ./cmd/server
```

**If ANY step produces errors, DO NOT commit.** Fix the errors and re-run from step 1.

**IMPORTANT — No third-party linters:** Do NOT use `golangci-lint`, `staticcheck`, or any third-party tool. Use only standard Go toolchain commands (`go vet`, `go test`, `go build`, `gofmt`). These commands run in a minimal container where third-party tools are not installed. `golangci-lint` in particular has version-coupling issues with Go — older versions misreport errors on newer Go code. It is BANNED from this project entirely (quality gates, CI, and local development).

**IMPORTANT — CI must match the quality gate:** The CI workflow (`.github/workflows/ci.yml`) MUST verify the same things as this quality gate. The one difference: `gofmt -w .` (pre-commit) auto-formats files before committing, while CI uses `gofmt -l .` to CHECK that files are already formatted (failing if they aren't). All other commands (`go vet`, `go test`, `go build`) are identical. If the quality gate passes, CI must also pass.

**IMPORTANT — Go version must be IDENTICAL everywhere:** The Go version in `api/go.mod`, `api/Dockerfile` (`FROM golang:X.XX-alpine`), and `.github/workflows/ci.yml` (`go-version: "X.XX"`) MUST all specify the EXACT same version. This project uses **Go 1.24**. Do NOT change the Go version in any one location without updating all three. A version mismatch causes CI failures because the CI Go toolchain cannot compile code that requires a newer Go version than it has installed.

### Pre-Commit Quality Gate — SvelteKit Frontend (MANDATORY)

Before EVERY `git commit` that touches `web/` files, workers MUST run:

```bash
# Step 1: Lint and format
cd web && npm run lint
cd web && npm run format

# Step 2: Run tests
cd web && npm run test

# Step 3: Type check
cd web && npm run check

# Step 4: Build
cd web && npm run build
```

**If ANY step fails, DO NOT commit.** Fix and re-run.

### TypeScript & ESLint Strictness (ALL frontend cards)

**These rules are non-negotiable. Every `web/` file must comply.**

- `tsconfig.json` MUST use `"strict": true`
- ESLint MUST be configured with `@typescript-eslint/no-explicit-any` as an error
- **NEVER use `any` type** — use proper types, `unknown`, or generics instead
- **NEVER leave unused imports or variables** — ESLint must flag `@typescript-eslint/no-unused-vars` as an error
- Workers MUST run `npm run lint` after EVERY file creation/modification and fix all violations before moving to the next file — do NOT batch lint fixes at the end

### Svelte 5 Syntax — Runes ONLY (ALL frontend cards)

**ALL Svelte components MUST use Svelte 5 runes syntax exclusively.** Do NOT mix Svelte 4 and Svelte 5 patterns.

```svelte
<!-- WRONG — Svelte 4 syntax (DO NOT USE): -->
<script>
  export let value;
  $: doubled = value * 2;
</script>
<form on:submit|preventDefault={handler}>

<!-- RIGHT — Svelte 5 runes syntax (REQUIRED): -->
<script>
  let { value } = $props();
  let doubled = $derived(value * 2);
</script>
<form onsubmit={(e) => { e.preventDefault(); handler(e); }}>
```

**Key Svelte 5 breaking changes:**
- `export let` → `$props()` destructuring
- `$:` reactive declarations → `$derived()` or `$effect()`
- Event modifiers like `on:click|preventDefault` → `onclick={(e) => { e.preventDefault(); ... }}`
- `on:event` → `onevent` (lowercase, no colon): `onclick`, `oninput`, `onkeydown`, `onsubmit`

If any component is found using Svelte 4 syntax, it MUST be rewritten before the card is complete.

### E2E Quality Gate — Full Stack Integration (Card 5+ ONLY)

> **⛔ TIMING: This gate does NOT exist during Cards 1–4.** The `e2e` CI job is not in `ci.yml` until Card 5 adds it. Workers on Cards 1–4 only run the Go and/or SvelteKit quality gates above. If a worker on Cards 1–4 tries to run E2E tests, they will fail because the full stack does not exist yet. **Do NOT add E2E to CI before Card 5.**

After Card 5 introduces the E2E test suite, workers on Card 5 and Card 6 MUST also run:

```bash
# Step 0: Ensure local MongoDB + Redis are running (started by Card 1's docker-compose.yml)
docker compose up -d

# Step 1: Build and start API locally
cd api && go build -o ./server ./cmd/server
cd api && go build -o ./seed ./cmd/seed
cd api && MONGODB_URI=mongodb://localhost:27017/flagdeck REDIS_URL=redis://localhost:6379 JWT_SECRET=dev-secret ./seed
cd api && MONGODB_URI=mongodb://localhost:27017/flagdeck REDIS_URL=redis://localhost:6379 JWT_SECRET=dev-secret PORT=8080 CORS_ORIGINS=http://localhost:4173 ./server &

# Step 2: Wait for API to be ready
for i in $(seq 1 30); do curl -sf http://localhost:8080/api/v1/health && break; sleep 1; done

# Step 3: Build and preview frontend
cd web && PUBLIC_API_URL=http://localhost:8080 npm run build
cd web && npm run preview -- --port 4173 &

# Step 4: Install Playwright and run E2E tests
npx playwright install --with-deps chromium
npx playwright test --config e2e/playwright.config.ts

# Step 5: Clean up background processes
kill %1 %2 2>/dev/null  # Stop API server and preview server
```

**If ANY E2E test fails, DO NOT push.** Fix the integration issue first. E2E failures mean the frontend and backend disagree on something.

### Post-Push Verification (MANDATORY)

After every `git push`, workers MUST:

1. Check GitHub Actions CI status (wait for it to complete — use `gh run list` or `gh run watch`)
2. If CI fails due to **code issues**: read the failure log, fix the issue, run the pre-commit quality gate again, push the fix
3. If CI fails due to **infrastructure issues** (billing, runner unavailable, service container failure): STOP and report the failure. Do NOT continue to the next task. Do NOT assume the code is correct just because it passes locally.
4. Do NOT move on to the next task until CI is green — no exceptions

### Import and Package Conventions (Go)

- Standard library imports first, third-party second, local packages third
- Each group separated by a blank line
- Use `goimports` or `gofmt` to auto-sort
- Package names: lowercase, single word, no underscores (`flagservice`, not `flag_service`)

### Go Error Handling — EVERY Return Value MUST Be Checked

**Every function that returns an error MUST have its error checked.** `go vet` catches many of these, and unchecked errors cause runtime bugs. This is the #1 source of quality issues.

```go
// WRONG — errcheck violation, CI will fail:
json.NewEncoder(w).Encode(response)
collection.InsertOne(ctx, doc)
cursor.Close(ctx)
defer conn.Close()

// RIGHT — always check or explicitly discard with _:
if err := json.NewEncoder(w).Encode(response); err != nil {
    return fmt.Errorf("encode response: %w", err)
}
_, err := collection.InsertOne(ctx, doc)
if err != nil { ... }
if err := cursor.Close(ctx); err != nil { ... }
defer func() { _ = conn.Close() }()
```

**Common errcheck traps:**
- `fmt.Fprintf(w, ...)` — returns `(int, error)`, must handle the error
- `redis.Set(ctx, key, val, ttl)` — returns `*StatusCmd`, check `.Err()`
- `json.NewEncoder(w).Encode(...)` — returns `error`, must check
- `defer file.Close()` → `defer func() { _ = file.Close() }()` (explicit discard)
- `io.Copy(dst, src)` — returns `(int64, error)`, must check

### Go Import Cycle Prevention (MANDATORY)

Go does NOT allow circular imports. Plan your package dependencies as a **DAG** (directed acyclic graph).

```
ALLOWED dependency direction (top → bottom):
  cmd/server → internal/router → internal/handlers → internal/services → internal/models
                                                   → internal/database
                                                   → internal/middleware

NEVER:
  internal/models → internal/handlers  (models must NOT import handlers)
  internal/services → internal/handlers (services must NOT import handlers)
  internal/database → internal/services (database must NOT import services)
```

**Rules:**
- `models/` imports NOTHING from this project (only stdlib + drivers)
- `database/` imports only `models/` and `config/`
- `services/` imports `models/` and `database/`
- `handlers/` imports `services/`, `models/`, and `middleware/`
- `router/` imports `handlers/` and `middleware/`
- If you need a type in two packages, put it in `models/`
- If two packages need each other, extract the shared interface into `models/` or a new `types/` package

### Go Code Style Patterns (MANDATORY)

Avoid these common anti-patterns — they indicate code quality issues even if `go vet` doesn't flag them all:

```go
// WRONG (S1002): if x == true { ... }
// RIGHT:         if x { ... }

// WRONG (S1039): fmt.Sprintf("simple string") with no format verbs
// RIGHT:         "simple string"

// WRONG (S1025): fmt.Sprintf("%s", someString)
// RIGHT:         someString

// WRONG (S1024): time.After in select without cancel
// RIGHT:         Use time.NewTimer with defer timer.Stop()

// WRONG: strings.Replace(s, old, new, -1)
// RIGHT: strings.ReplaceAll(s, old, new)
```

### Redis Client — Use go-redis v9 API (NOT v8)

The PRD specifies `github.com/redis/go-redis/v9`. Do NOT use deprecated v8 patterns:

```go
// WRONG (v8 patterns — will not compile with v9):
rdb.Set(ctx, key, value, 0).Err()                    // v8 chaining
rdb.Do(ctx, "SET", key, value)                        // raw command (use typed methods)
redis.NewClient(&redis.Options{Addr: "localhost:6379"}) // missing TLS for Upstash

// RIGHT (v9 patterns):
err := rdb.Set(ctx, key, value, 0).Err()              // must capture error
val, err := rdb.Get(ctx, key).Result()                 // always check Result()
if errors.Is(err, redis.Nil) { /* key doesn't exist */ }

// Upstash TLS connection (v9):
opt, err := redis.ParseURL(os.Getenv("REDIS_URL"))    // rediss:// auto-enables TLS
if err != nil { ... }
rdb := redis.NewClient(opt)
```

---

## Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **Backend framework** | Go + Fiber | Go 1.24 (exact), Fiber v2 | High-performance, Express-like API for Go. Fiber is the most starred Go web framework after Gin, with familiar middleware patterns. **Go version is pinned — do NOT change without updating Dockerfile and CI.** |
| **Database** | MongoDB | 7.x (Atlas M0) | Document-based storage fits schema-flexible flag configs. Targeting rules vary per flag — documents model this naturally. |
| **Cache** | Redis | 7+ (Upstash) | Sub-millisecond flag evaluation caching. Upstash provides serverless Redis with REST API fallback. |
| **Frontend framework** | SvelteKit | 2.x (Svelte 5) | Compiled reactivity, file-based routing, SSR/SPA flexibility. Stack diversity from existing Next.js showcases. |
| **Frontend styling** | TailwindCSS | 4.x | Utility-first CSS, consistent with WorkerMill design language. |
| **MongoDB driver** | mongo-driver | v2 | Official Go driver with connection pooling and BSON codecs. |
| **Redis client** | go-redis | v9 | Full-featured Redis client for Go with pipeline and pub/sub support. |
| **Logging** | slog | stdlib | Structured logging built into Go 1.21+ standard library. |
| **Config** | envconfig | v1 | Simple, popular env-var-to-struct binding for Go. |
| **Testing (Go)** | testing + testify | stdlib + v1 | Standard Go testing with testify assertions and mocks. |
| **Testing (frontend)** | Vitest + Testing Library | latest | Fast Vite-native test runner with Svelte component testing. |
| **Linting (Go)** | go vet (stdlib) | — | Standard Go static analysis. Do NOT use golangci-lint — it is not available in worker containers. |
| **Linting (frontend)** | ESLint + Prettier | latest | Standard JS/TS linting and formatting. |
| **Container** | Docker (multi-stage) | — | API: alpine-based Go binary + seed script. Frontend: `adapter-static` build served by nginx (NOT adapter-node). |
| **Compute** | Railway | Hobby plan | Docker container hosting with auto-HTTPS. |
| **CI/CD** | GitHub Actions | — | Automated test + deploy pipeline. |
| **Hashing** | FNV-1a | `hash/fnv` (stdlib) | FNV-1a 32-bit for deterministic percentage rollouts. Uses Go standard library — no unsafe pointer arithmetic, passes `-race` detector. |

---

## Pre-Provisioned Resources

All resources are **provisioned and ready**. Workers do NOT create accounts or sign up for services — they use what is already provisioned.

### GitHub Repository

| Resource | Details |
|----------|---------|
| Repository | `workermill-examples/flagdeck` (public, empty) |
| URL | https://github.com/workermill-examples/flagdeck |
| Agent access | Push via GitHub PAT (already configured in WorkerMill org settings) |
| Repo secret | `RAILWAY_TOKEN` — configured for GitHub Actions deployment |
| Status | **Ready** |

### Railway (Compute)

| Resource | Details |
|----------|---------|
| Plan | Hobby ($5/month, includes $5 usage credit) |
| Project | `FlagDeck` (ID: `64bd7465-cc4d-410e-8083-10021053680e`) |
| Environment | `production` (ID: `7d7b9b5e-6b6c-4b41-afec-2364c7d23758`) |
| Status | **Ready** |

**Services:**

| Service | ID | Root Dir | Railway Domain | Custom Domain |
|---------|----|----------|---------------|---------------|
| `flagdeck-api` | `af0a26b1-0c55-4548-91cf-fa055a9c1e71` | `api` | `flagdeck-api-production.up.railway.app` | `flagdeck.workermill.com` |
| `flagdeck-web` | `3a82f27a-2cda-420a-a100-38efc2970da5` | `web` | `flagdeck-web-production.up.railway.app` | `flagdeck-app.workermill.com` |

**Railway environment variables (set on `flagdeck-api` service):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `MONGODB_URI` | *(configured — Atlas connection string)* | Database connection |
| `REDIS_URL` | *(configured — Upstash Redis TLS URL)* | Cache connection |
| `JWT_SECRET` | *(configured — 64-char random hex)* | JWT token signing |
| `PORT` | `8080` | Railway injects PORT; set explicitly |
| `ENVIRONMENT` | `production` | Runtime environment flag |
| `CORS_ORIGINS` | `https://flagdeck-app.workermill.com,https://flagdeck.workermill.com` | Allowed CORS origins |

**Railway environment variables (set on `flagdeck-web` service):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `PORT` | `80` | **REQUIRED** — tells Railway which port nginx listens on |
| `PUBLIC_API_URL` | `https://flagdeck.workermill.com` | API base URL for the frontend |

**Railway Deployment Requirements (CRITICAL):**

1. **Frontend uses `adapter-static` + nginx Dockerfile** — The `web/Dockerfile` builds SvelteKit with `adapter-static`, then serves the static output via nginx. This is the correct approach — Railway detects the Dockerfile and uses it. Do NOT switch to `adapter-node`.

2. **`PORT=80` MUST be set as an env var on the web service** — The nginx Dockerfile exposes port 80, but Railway may not auto-detect it. Explicitly set `PORT=80` in the web service's environment variables, otherwise Railway returns HTTP 502 "Application failed to respond".

3. **API Dockerfile Go version MUST match `go.mod`** — The `FROM golang:X.XX-alpine` in `api/Dockerfile` MUST use the exact same Go version as `api/go.mod`. A mismatch causes Railway builds to fail with `go.mod requires go >= X.XX (running go Y.YY; GOTOOLCHAIN=local)`. This project uses **Go 1.24** — all three locations (`go.mod`, `Dockerfile`, `ci.yml`) must agree.

4. **Railway project token is project-scoped** — The `RAILWAY_TOKEN` GitHub secret must be a project-scoped token generated from Railway project settings (Settings → Tokens → Create Token), NOT a personal API token. Project tokens have the format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

5. **Service names in `railway up` MUST be exact** — Use `--service flagdeck-api` and `--service flagdeck-web` (the exact names from the Railway dashboard). Using any other name creates a new service instead of deploying to the existing one.

6. **Deploy workflow must NOT include Docker build steps** — The deploy job runs inside the `ghcr.io/railwayapp/cli:latest` container, which has NO Docker daemon. Any `docker build` or `docker run` commands will fail with `docker: not found`. The deploy workflow should ONLY do `checkout` + `railway up --service <name> --detach`. Railway handles the Docker build on its own infrastructure.

7. **CI workflow must NOT use `golangci-lint`** — Use only standard Go toolchain: `go vet ./...`, `go test ./...`, `go build`. `golangci-lint` has version-coupling issues with Go (older versions produce false type-check errors on newer Go code) and is not available in worker containers. It is BANNED from this project.

### MongoDB Atlas (Database)

| Resource | Details |
|----------|---------|
| Plan | M0 free tier (512 MB storage, shared cluster) |
| Cluster | `flagdeck` (Atlas project: Flagdeck) |
| Atlas Project ID | `699b3e8707cbf03e603e6a74` |
| Region | `us-east-1` (AWS) |
| Database | `flagdeck` |
| DB user | `rosenthaljarod_db_user` |
| Collections | `flags`, `environments`, `segments`, `experiments`, `audit_log`, `users`, `api_keys` |
| Status | **Ready** |

**Connection string format (password in Railway env vars):**
```
mongodb+srv://rosenthaljarod_db_user:<password>@flagdeck.rakqc31.mongodb.net/flagdeck?retryWrites=true&w=majority&appName=Flagdeck
```

**CRITICAL — IP Access List:** MongoDB Atlas blocks all connections from IPs not in the project's IP Access List. Railway uses dynamic outbound IPs, so `0.0.0.0/0` (allow from anywhere) MUST be added to the Atlas Network Access → IP Access List. Without this, the Go API crashes on startup with `tls: internal error` on every MongoDB connection attempt. Atlas terminates the TLS handshake before authentication when the source IP is not whitelisted.

### Upstash Redis (Cache)

| Resource | Details |
|----------|---------|
| Plan | Free tier (10K commands/day, 256 MB) |
| Instance | `credible-falcon-44150` |
| Host | `credible-falcon-44150.upstash.io` |
| Region | `us-east-1` (AWS) |
| Port | `6379` (TLS) |
| Status | **Ready** |

**Connection string format (password in Railway env vars):**
```
rediss://default:<password>@credible-falcon-44150.upstash.io:6379
```

> **NOTE**: Upstash uses `rediss://` (double-s, TLS). The `go-redis` client handles TLS automatically when the URL scheme is `rediss`.

### DNS (Custom Domains) — Route53

**CRITICAL — Railway custom domains require TWO DNS records each: a CNAME and a TXT verification record.** The CNAME must point to Railway's per-domain verification target (NOT the service's default `*-production.up.railway.app` domain). The TXT record proves domain ownership so Railway can provision an SSL certificate.

**Current DNS records (Route53, hosted zone `Z0049130JRIXFAC8U9AH`):**

| Hostname | Type | Value | Purpose |
|----------|------|-------|---------|
| `flagdeck.workermill.com` | CNAME | `uewe43o0.up.railway.app` | Routes traffic to Railway API service |
| `flagdeck-app.workermill.com` | CNAME | `978huubd.up.railway.app` | Routes traffic to Railway web service |
| `_railway-verify.flagdeck.workermill.com` | TXT | `railway-verify=14558bad3077e586db7b4fa09e260bef60009f2cfb6e1c9bfaf46fdde5777314` | Proves domain ownership for SSL cert |
| `_railway-verify.flagdeck-app.workermill.com` | TXT | `railway-verify=094654c42cfcd40ca96a8a073468b9e53dbd4ea4530f1a9bd955a5964a4348cd` | Proves domain ownership for SSL cert |

---

## Project Structure

```
flagdeck/
├── api/
│   ├── cmd/
│   │   ├── server/
│   │   │   └── main.go                  # Entry point, Fiber app bootstrap, graceful shutdown
│   │   └── seed/
│   │       └── main.go                  # Seed script — populates demo data (idempotent, upsert-based)
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go                # Env var loading via envconfig
│   │   ├── database/
│   │   │   ├── mongodb.go               # MongoDB client, connection, indexes
│   │   │   └── redis.go                 # Redis client, connection, health check
│   │   ├── models/
│   │   │   ├── flag.go                  # Flag document schema
│   │   │   ├── environment.go           # Environment document (production, staging, dev)
│   │   │   ├── segment.go              # User segment (targeting group)
│   │   │   ├── experiment.go            # A/B experiment schema
│   │   │   ├── audit.go                 # Audit log entry
│   │   │   ├── user.go                  # Dashboard user
│   │   │   └── apikey.go                # SDK API key
│   │   ├── handlers/
│   │   │   ├── flags.go                 # Flag CRUD endpoints
│   │   │   ├── evaluate.go              # Flag evaluation endpoint (SDK-facing)
│   │   │   ├── environments.go          # Environment CRUD
│   │   │   ├── segments.go              # Segment CRUD
│   │   │   ├── experiments.go           # Experiment CRUD + results
│   │   │   ├── audit.go                 # Audit log queries
│   │   │   ├── auth.go                  # Login, register, API key management
│   │   │   ├── health.go               # Health check
│   │   │   └── pagination.go           # Shared pagination parameter parsing
│   │   ├── services/
│   │   │   ├── evaluator.go             # Core flag evaluation engine
│   │   │   ├── targeting.go             # Targeting rule parser and matcher
│   │   │   ├── rollout.go               # Percentage rollout (FNV-1a stdlib)
│   │   │   ├── cache.go                 # Redis cache layer (get/set/invalidate)
│   │   │   ├── experiment_stats.go      # Experiment statistics (chi-squared)
│   │   │   └── audit.go                 # Audit log recording
│   │   ├── middleware/
│   │   │   ├── auth.go                  # JWT + API key authentication
│   │   │   ├── ratelimit.go             # Rate limiting (in-memory)
│   │   │   └── requestid.go             # X-Request-Id header
│   │   └── router/
│   │       └── router.go               # Route registration, middleware mounting
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile                       # Multi-stage: build → alpine (NOT scratch — needs /bin/sh for seed)
├── web/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +layout.svelte           # Root layout (sidebar, nav)
│   │   │   ├── +layout.server.ts        # Auth guard
│   │   │   ├── +page.svelte             # Dashboard home (client-side stats from flags list)
│   │   │   ├── login/
│   │   │   │   └── +page.svelte         # Login page
│   │   │   ├── flags/
│   │   │   │   ├── +page.svelte         # Flag list with search/filter
│   │   │   │   ├── new/
│   │   │   │   │   └── +page.svelte     # Create flag form
│   │   │   │   └── [id]/
│   │   │   │       ├── +page.svelte     # Flag detail (targeting, rollout, history)
│   │   │   │       └── +page.server.ts  # Flag detail loader
│   │   │   ├── segments/
│   │   │   │   ├── +page.svelte         # Segment list
│   │   │   │   ├── new/
│   │   │   │   │   └── +page.svelte     # Create segment form (rule builder)
│   │   │   │   └── [id]/
│   │   │   │       └── +page.svelte     # Segment detail/edit
│   │   │   ├── experiments/
│   │   │   │   ├── +page.svelte         # Experiment list
│   │   │   │   ├── new/
│   │   │   │   │   └── +page.svelte     # Create experiment form
│   │   │   │   └── [id]/
│   │   │   │       └── +page.svelte     # Experiment detail with stats
│   │   │   ├── environments/
│   │   │   │   └── +page.svelte         # Environment management
│   │   │   ├── audit/
│   │   │   │   └── +page.svelte         # Audit log viewer
│   │   │   └── settings/
│   │   │       └── +page.svelte         # API keys, account settings
│   │   ├── lib/
│   │   │   ├── api.ts                   # API client (fetch wrapper)
│   │   │   ├── stores/
│   │   │   │   ├── auth.svelte.ts       # Auth state store (Svelte 5 runes)
│   │   │   │   ├── flags.svelte.ts      # Flag list store
│   │   │   │   └── audit.svelte.ts      # Audit log store
│   │   │   ├── components/
│   │   │   │   ├── Sidebar.svelte       # Navigation sidebar
│   │   │   │   ├── FlagCard.svelte      # Flag summary card
│   │   │   │   ├── FlagToggle.svelte    # On/off toggle with environment selector
│   │   │   │   ├── TargetingRuleBuilder.svelte  # Visual rule builder
│   │   │   │   ├── RolloutSlider.svelte # Percentage rollout control
│   │   │   │   ├── ExperimentChart.svelte # Results visualization
│   │   │   │   ├── AuditTimeline.svelte # Audit log timeline
│   │   │   │   └── EmptyState.svelte    # Empty state placeholder
│   │   │   └── utils/
│   │   │       ├── format.ts            # Date, number formatting
│   │   │       └── constants.ts         # Operator labels, status colors
│   │   ├── app.html                     # HTML shell
│   │   └── app.css                      # TailwindCSS imports
│   ├── static/
│   │   └── favicon.png
│   ├── svelte.config.js                 # SvelteKit config (adapter-static — REQUIRED for Railway nginx deploy)
│   ├── vite.config.ts                   # Vite config (MUST include browser resolve conditions for Svelte 5 tests)
│   ├── tailwind.config.js               # Tailwind config
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile                       # Build → adapter-static + nginx
├── docker-compose.yml                   # Local dev (MongoDB + Redis)
├── e2e/
│   ├── login.spec.ts                    # Auth flow — login, token storage, redirect
│   ├── dashboard.spec.ts                # Dashboard stats — flag counts, quick actions
│   ├── flags.spec.ts                    # Flag list + detail — names, types, environments, targeting
│   ├── segments.spec.ts                 # Segment list — names, rule counts
│   ├── experiments.spec.ts              # Experiment list — statuses, variants
│   ├── audit.spec.ts                    # Audit log — actor emails, actions, timestamps
│   └── playwright.config.ts             # Playwright config — baseURL, headless, retries
├── .github/
│   └── workflows/
│       ├── ci.yml                       # Cards 1-4: api + web jobs ONLY. Card 5 ADDS the e2e job.
│       └── deploy.yml                   # Created by Card 6 ONLY — does NOT exist until Card 6
├── .gitignore
├── .prettierignore                      # Exclude non-JS files from Prettier
├── CLAUDE.md                            # Worker instructions for this repo
└── README.md                            # Setup, architecture, API docs
```

---

## Canonical Collection Names (CRITICAL)

**ALL code — models, handlers, services, seeds, index creation — MUST use these EXACT collection names.** Using a different name (e.g., `audit_logs` instead of `audit_log`) will cause data to be written to one collection and read from another.

| Collection | Go Constant | Purpose |
|------------|-------------|---------|
| `flags` | `"flags"` | Feature flag documents |
| `environments` | `"environments"` | Environment configuration |
| `segments` | `"segments"` | User segments |
| `experiments` | `"experiments"` | A/B experiments |
| `audit_log` | `"audit_log"` | Audit log entries (SINGULAR — NOT `audit_logs`) |
| `users` | `"users"` | Dashboard users |
| `api_keys` | `"api_keys"` | SDK API keys |

---

## Core Domain Model

> **CRITICAL — Exact Names Matter:** MongoDB collection names and field names in this section are the **canonical source of truth**. Use them exactly as written. Do NOT rename collections. Do NOT rename fields. Do NOT omit fields marked in the schema — every field listed is required in the Go struct and MongoDB document.

### Flag Document (`flags` collection)

```json
{
  "_id": "ObjectId",
  "key": "string (unique, slug-format: lowercase, hyphens, e.g. 'dark-mode')",
  "name": "string (human-readable, e.g. 'Dark Mode')",
  "description": "string (optional)",
  "type": "string (enum: 'boolean', 'string', 'number', 'json')",
  "is_active": "boolean (default: true — global kill switch, overrides all environments)",
  "default_value": "any (matches type — false for boolean, '' for string, 0 for number, {} for json)",
  "environments": {
    "production": {
      "enabled": "boolean (per-environment on/off — independent of is_active)",
      "value": "any (the value served when this environment is enabled and no rules match)",
      "targeting_enabled": "boolean (default: false — whether targeting rules are evaluated)",
      "targeting_rules": [
        {
          "name": "string (human-readable rule name)",
          "priority": "integer (lower = evaluated first)",
          "conditions": [
            {
              "property": "string (e.g. 'country', 'plan', 'email')",
              "operator": "string (enum: 'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'lt', 'gte', 'lte', 'regex')",
              "value": "any (string, number, or array for 'in'/'not_in')"
            }
          ],
          "operator": "string (enum: 'and', 'or') — how conditions within this rule combine. Default: 'and'",
          "value": "any (the value served when this rule matches)",
          "percentage": "number (0-100, optional — if set, only this % of matched users get the value)"
        }
      ]
    },
    "staging": { "...same structure..." },
    "development": { "...same structure..." }
  },
  "tags": ["string"],
  "created_by": "ObjectId (ref: users)",
  "updated_by": "ObjectId (ref: users, set on every update)",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

> **CRITICAL — Two levels of enable/disable:**
> - **`is_active`** (top-level) = global kill switch. When `false`, the flag is OFF in ALL environments regardless of per-environment `enabled` state. Evaluation returns `default_value` with `reason: "disabled"`. The dashboard shows a clear visual indicator (e.g., strikethrough or "KILLED" badge).
> - **`environments.{env}.enabled`** (per-environment) = environment-specific toggle. Controls whether the flag is on/off in a single environment. Only evaluated when `is_active` is `true`.
>
> The toggle endpoint (`POST /flags/:key/toggle`) operates on **per-environment `enabled`** — it does NOT touch `is_active`. To kill a flag globally, use `PUT /flags/:key` with `{ "is_active": false }`.

> **CRITICAL — `environments` is an OBJECT MAP, not an array.** The key is the environment name (e.g., `"production"`), the value is the environment config. Frontend code MUST use `Object.entries(flag.environments)` to iterate, NOT `.map()` or `.reduce()`.

> **CRITICAL — Field naming in environment config:** The environment config uses `targeting_rules` (not `rules`), `property` (not `attribute`), `operator` for rule logic (not `logic`), and `percentage` (not `rollout_percentage`). These names match the Go struct tags exactly. Do NOT rename them.

**Indexes:**
- `{ "key": 1 }` — unique
- `{ "tags": 1 }` — for tag filtering
- `{ "updated_at": -1 }` — for recent changes

### Environment Document (`environments` collection)

```json
{
  "_id": "ObjectId",
  "key": "string (unique slug: 'production', 'staging', 'development')",
  "name": "string (human-readable)",
  "description": "string (optional)",
  "color": "string (hex color for UI, e.g. '#22c55e' for production)",
  "is_active": "boolean (default: true)",
  "sort_order": "integer",
  "created_by": "ObjectId (ref: users)",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

Default environments seeded: `production` (#22c55e, sort: 1, active), `staging` (#f59e0b, sort: 2, active), `development` (#3b82f6, sort: 3, active).

### Segment Document (`segments` collection)

Reusable user segments that can be referenced in targeting rules.

```json
{
  "_id": "ObjectId",
  "key": "string (unique slug, e.g. 'beta-users')",
  "name": "string (e.g. 'Beta Users')",
  "description": "string (optional)",
  "rules": [
    {
      "conditions": [
        {
          "property": "string (e.g. 'country', 'plan', 'email')",
          "operator": "string (same operators as targeting rules)",
          "value": "any"
        }
      ],
      "operator": "string ('and' | 'or') — how conditions combine"
    }
  ],
  "created_by": "ObjectId",
  "updated_by": "ObjectId",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

> **CRITICAL — Segments use `rules` as the top-level field, NOT `conditions`.** Each rule contains a `conditions` array. The frontend MUST reference `segment.rules`, not `segment.conditions`.
> **CRITICAL — Field names match flag targeting rules:** Use `property` (not `attribute`), `operator` (not `logic`) for rule-level condition combining. These names are identical to flag targeting rules for consistency.

### Experiment Document (`experiments` collection)

```json
{
  "_id": "ObjectId",
  "key": "string (unique slug)",
  "name": "string",
  "description": "string (optional)",
  "flag_key": "string (ref: flags.key — the feature flag this experiment controls)",
  "environment": "string (which environment this experiment runs in)",
  "status": "string (enum: 'draft', 'running', 'paused', 'completed')",
  "variants": [
    {
      "key": "string (e.g. 'control', 'variant_a', 'variant_b')",
      "name": "string",
      "value": "any (the flag value for users in this variant)",
      "weight": "number (0-100, must sum to 100 across all variants)"
    }
  ],
  "metrics": [
    {
      "key": "string (e.g. 'conversion', 'revenue', 'click_rate')",
      "name": "string",
      "type": "string (enum: 'conversion', 'revenue', 'count')"
    }
  ],
  "results": {
    "variant_key": {
      "impressions": "integer",
      "conversions": "integer",
      "conversion_rate": "number",
      "revenue": "number (optional)",
      "confidence": "number (0-100, statistical significance)"
    }
  },
  "started_at": "datetime (nullable)",
  "ended_at": "datetime (nullable)",
  "created_by": "ObjectId",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### Audit Log Document (`audit_log` collection)

> **Actions are simple present-tense verbs, NOT compound strings.** The `changes` field is a flat map, NOT `{old, new}` pairs.

```json
{
  "_id": "ObjectId",
  "actor_id": "ObjectId (ref: users)",
  "actor_email": "string (denormalized for display)",
  "action": "string (enum: 'create', 'update', 'delete', 'view', 'export', 'enable', 'disable', 'start', 'stop')",
  "resource_type": "string ('flag', 'experiment', 'segment', 'apikey', 'environment', 'user')",
  "resource_id": "string",
  "resource_key": "string (human-readable reference, optional)",
  "changes": {
    "field_name": "any (the new value — flat map, NOT {old, new} pairs)"
  },
  "metadata": {
    "key": "any (additional context, e.g. environment name, IP address)"
  },
  "environment": "string (optional — which environment was affected)",
  "ip_address": "string",
  "user_agent": "string (optional)",
  "timestamp": "datetime"
}
```

**Indexes:**
- `{ "timestamp": -1 }` — recent first
- `{ "resource_type": 1, "resource_id": 1 }` — filter by resource
- `{ "actor_id": 1 }` — filter by user

**TTL index:** `{ "timestamp": 1 }, expireAfterSeconds: 7776000` (90-day retention on free tier).

### User Document (`users` collection)

```json
{
  "_id": "ObjectId",
  "email": "string (unique)",
  "name": "string",
  "password_hash": "string (bcrypt)",
  "role": "string (enum: 'admin', 'editor', 'viewer')",
  "active": "boolean (default: true)",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### API Key Document (`api_keys` collection)

Server-side SDK keys for flag evaluation.

```json
{
  "_id": "ObjectId",
  "name": "string (e.g. 'Production Backend')",
  "key_hash": "string (SHA-256 hash of the key)",
  "key_prefix": "string (e.g. 'fd_live_abc12' — first 14 chars for identification)",
  "environment": "string (which environment this key can evaluate flags in)",
  "permissions": ["string (enum: 'evaluate', 'read', 'write')"],
  "last_used_at": "datetime (nullable)",
  "created_by": "ObjectId",
  "created_at": "datetime",
  "revoked_at": "datetime (nullable)"
}
```

**Key format:** `fd_live_<32-char-random>` (production) or `fd_test_<32-char-random>` (non-production). The raw key is returned ONLY on creation — only the SHA-256 hash is stored.

---

## Shared Service Interface Contracts (CRITICAL — Cross-Card)

**These interfaces are consumed by multiple cards. The signatures below are the SINGLE SOURCE OF TRUTH.** Any card calling these methods MUST use the exact signature shown.

**AuditService** (defined in `services/audit.go`, consumed by all handler files):

```go
type AuditEntryInput struct {
    ActorID      string                 // User who performed the action
    ActorEmail   string                 // Denormalized for display
    Action       string                 // Simple present tense: "create", "update", "delete", "enable", "disable", "start", "stop"
    ResourceType string                 // "flag", "segment", "experiment", "apikey", "environment"
    ResourceID   string                 // MongoDB ObjectID as string
    ResourceKey  string                 // Human-readable key (e.g., "dark-mode")
    Changes      map[string]interface{} // Flat map of changed field values (NOT {old, new} pairs)
    Environment  string                 // Optional — which environment was affected
    IPAddress    string                 // Client IP
}

func (s *AuditService) LogAction(ctx context.Context, input AuditEntryInput) error
```

All handler files MUST call `LogAction` with an `AuditEntryInput` struct. Do NOT pass individual arguments.

**FlagCacheInterface** (defined in `services/cache.go`, consumed by handlers):

```go
type FlagCacheInterface interface {
    GetFlag(ctx context.Context, environment, flagKey string) (*models.Flag, error)
    InvalidateFlag(ctx context.Context, environment, flagKey string) error
}
```

**EvaluatorInterface** (defined in `services/evaluator.go`, consumed by handlers):

```go
type EvaluatorInterface interface {
    Evaluate(ctx context.Context, flagKey string, context map[string]interface{}, environment string) (*EvalResult, error)
    EvaluateBulk(ctx context.Context, flagKeys []string, context map[string]interface{}, environment string) ([]EvalResult, error)
}
```

### JWT Middleware Type Contract (CRITICAL)

The JWT authentication middleware MUST store a **pointer** to the user in Fiber's context:

```go
// In middleware/auth.go — JWT validation success:
c.Locals(UserContextKey, &user)  // POINTER — &user, NOT user

// In ALL handlers — extracting user:
user, ok := c.Locals(middleware.UserContextKey).(*models.User)  // Assert POINTER type
if !ok {
    return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
        "error": "INTERNAL_ERROR", "message": "Invalid user context",
    })
}
```

> **Why this matters:** If the middleware stores a value (`user`) but handlers assert a pointer (`*models.User`), the type assertion silently fails and EVERY authenticated endpoint returns "Invalid user context".

---

## Frontend API Contract (CRITICAL — NEW SECTION)

> **This section is the SINGLE SOURCE OF TRUTH for frontend-to-backend integration.** Every TypeScript interface, API call pattern, and response format is specified here. Frontend workers MUST use these exact interfaces — do NOT guess field names, do NOT use camelCase.

### Golden Rule: snake_case Everywhere

The Go API uses snake_case for ALL JSON fields. The frontend MUST use snake_case in:
- TypeScript interface field names (e.g., `created_at`, NOT `createdAt`)
- Request body field names (e.g., `flag_key`, NOT `flagKey`)
- Query parameter names (e.g., `per_page`, NOT `limit`)

### API Base URL and Auth Routing

```typescript
// API client configuration
const API_BASE = 'https://flagdeck.workermill.com';  // From PUBLIC_API_URL env var

// Auth endpoints have NO /api prefix:
//   POST /auth/login
//   POST /auth/register
//   POST /auth/refresh
//   GET  /auth/me

// All other endpoints use /api/v1 prefix:
//   GET  /api/v1/flags
//   GET  /api/v1/audit-log
//   etc.
```

> **CRITICAL — Auth routes are at `/auth/*`, NOT `/api/v1/auth/*`.** This is the single most common frontend integration bug. The Go router mounts auth routes at the root, not under the `/api/v1` group.

### List Response Wrapper

**ALL list endpoints** return this envelope. The frontend MUST read from `response.data`, NOT from named arrays like `response.flags` or `response.segments`.

```typescript
interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        per_page: number;
        total: number;
        total_pages: number;
    };
}
```

### Auth Response

```typescript
// POST /auth/login response:
interface AuthResponse {
    access_token: string;   // JWT, 30-min expiry
    refresh_token: string;  // 7-day expiry
    expires_in: number;     // Seconds until access_token expires
    token_type: string;     // "Bearer"
}
// NOTE: No `user` object in the response. Decode user data from the JWT payload.
// JWT payload contains: sub (user_id), email, role, name

// localStorage keys (all three MUST be present for authenticated state):
//   flagdeck_access_token
//   flagdeck_refresh_token
//   flagdeck_user  (JSON-serialized user object decoded from JWT)
```

### Error Response

```typescript
// ALL error responses from the Go API use this flat format:
interface ErrorResponse {
    error: string;      // Error code, e.g., "VALIDATION_ERROR", "UNAUTHORIZED"
    message: string;    // Human-readable message
    details?: unknown;  // Optional additional details
}

// NOT the nested format: { error: { code, message, details } }
// The Go API uses fiber.Map{"error": "CODE", "message": "..."}, which is flat.
```

### TypeScript Interfaces (EXACT — Copy These)

```typescript
// === Flag ===
interface Flag {
    id: string;           // MongoDB _id as hex string
    key: string;
    name: string;
    description: string;
    type: 'boolean' | 'string' | 'number' | 'json';
    is_active: boolean;   // Global kill switch — false = OFF in all environments
    default_value: unknown;
    environments: Record<string, FlagEnvironmentConfig>;  // OBJECT MAP, NOT array
    tags: string[];
    created_by: string;
    updated_by: string;
    created_at: string;   // ISO datetime
    updated_at: string;   // ISO datetime
}

interface FlagEnvironmentConfig {
    enabled: boolean;              // Per-environment on/off toggle
    value: unknown;                // Value served when enabled (and no targeting rules match)
    targeting_enabled: boolean;    // Whether targeting rules are evaluated
    targeting_rules: TargetingRule[];
}

interface TargetingRule {
    name: string;
    priority: number;
    conditions: RuleCondition[];
    operator: 'and' | 'or';       // How conditions combine (NOT "logic")
    value: unknown;
    percentage?: number;           // 0-100, optional rollout percentage (NOT "rollout_percentage")
}

interface RuleCondition {
    property: string;              // User attribute name (NOT "attribute")
    operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'gt' | 'lt' | 'gte' | 'lte' | 'regex';
    value: unknown;
}

// === Environment ===
interface Environment {
    id: string;
    key: string;
    name: string;
    description?: string;
    color: string;
    is_active: boolean;
    sort_order: number;
    created_by?: string;
    created_at: string;
    updated_at?: string;
}

// === Segment ===
interface Segment {
    id: string;
    key: string;
    name: string;
    description?: string;
    rules: SegmentRule[];        // TOP-LEVEL is `rules`, NOT `conditions`
    created_by: string;
    created_at: string;
    updated_at: string;
}

interface SegmentRule {
    conditions: RuleCondition[];  // Same RuleCondition as flag targeting rules (property, operator, value)
    operator: 'and' | 'or';      // How conditions combine (NOT "logic")
}

// === Experiment ===
interface Experiment {
    id: string;
    key: string;
    name: string;
    description?: string;
    flag_key: string;            // snake_case
    environment: string;
    status: 'draft' | 'running' | 'paused' | 'completed';
    variants: Variant[];
    metrics: Metric[];
    results: Record<string, VariantResult>;
    started_at: string | null;   // snake_case
    ended_at: string | null;     // snake_case
    created_by: string;
    created_at: string;
    updated_at: string;
}

interface Variant {
    key: string;
    name: string;
    value: unknown;
    weight: number;
}

interface Metric {
    key: string;
    name: string;
    type: 'conversion' | 'revenue' | 'count';
}

interface VariantResult {
    impressions: number;
    conversions: number;
    conversion_rate: number;
    revenue?: number;
    confidence: number;
}

// === Audit Event ===
interface AuditEvent {
    id: string;
    actor_id: string;
    actor_email: string;
    action: string;              // Present tense: "create", "update", "delete", "view", "enable", "disable"
    resource_type: string;       // "flag", "segment", "experiment", etc.
    resource_id: string;
    changes?: Record<string, unknown>;  // Flat map, NOT {old, new} pairs
    metadata?: Record<string, unknown>;
    timestamp: string;
    ip_address?: string;
    user_agent?: string;
}

// === User ===
interface User {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'editor' | 'viewer';
    created_at: string;
    updated_at?: string;
}

// === API Key ===
interface ApiKey {
    id: string;
    name: string;
    key_prefix: string;
    environment: string;
    permissions: string[];
    last_used_at: string | null;
    created_by: string;
    created_at: string;
    revoked_at: string | null;
}
```

### Dashboard Overview — Client-Side Computation

**There is NO dedicated `/dashboard/overview` endpoint.** The dashboard page computes stats client-side:

```typescript
// Fetch all flags, then compute:
const flags: Flag[] = response.data;
const totalFlags = flags.length;
const activeFlags = flags.filter(f =>
    Object.values(f.environments).some(env => env.enabled)
).length;
const inactiveFlags = totalFlags - activeFlags;
```

### Audit Log Query Parameters

```typescript
// GET /api/v1/audit-log accepts these query params (all snake_case):
interface AuditQueryParams {
    page: number;
    per_page: number;                // NOT "limit"
    sort_by: string;                 // "timestamp" | "resource_type" | "action" | "actor_email"
    sort_order: string;              // "asc" | "desc"
    resource_type?: string;          // NOT "resource"
    action?: string;
    actor_id?: string;               // NOT "actor"
    resource_key?: string;
    start_date?: string;             // NOT "startDate"
    end_date?: string;               // NOT "endDate"
}
```

### Audit Timeline Display

The Go API stores actions in **present tense** (`create`, `update`, `delete`, `view`, `enable`, `disable`). The frontend MUST convert to past tense for display:

```typescript
const actionLabels: Record<string, string> = {
    'create': 'created',
    'update': 'updated',
    'delete': 'deleted',
    'view': 'viewed',
    'export': 'exported',
    'enable': 'enabled',
    'disable': 'disabled',
    'start': 'started',
    'stop': 'stopped',
};

// Display: "{actor_email} {past_tense_action} {resource_type} {resource_id}"
// Example: "demo@workermill.com created flag dark-mode"
```

---

## Flag Evaluation Engine (CRITICAL — Core IP)

This is the most important component. It determines which value a user sees for a given flag.

### Evaluation Flow

```
Client sends: POST /api/v1/evaluate
  Body: { "flag_key": "dark-mode", "context": { "user_id": "u123", "country": "US", "plan": "pro" } }
  Header: X-API-Key: fd_live_abc12...

  1. Authenticate API key → determine environment (e.g. "production")
  2. Check Redis cache: key = "flag:{environment}:{flag_key}"
     → Cache HIT: use cached flag config
     → Cache MISS: fetch from MongoDB, write to cache with 30s TTL
  3. If flag.is_active == false → return default_value with reason: "disabled" (global kill switch)
  4. If flag.environments[env].enabled == false → return default_value with reason: "disabled" (env disabled)
  5. If flag.environments[env].targeting_enabled == false → return environments[env].value with reason: "default"
  6. Evaluate targeting_rules in priority order (lowest priority number first):
     a. For each rule, evaluate all conditions:
        - If rule.operator == "and": ALL conditions must match
        - If rule.operator == "or": ANY condition must match
     b. If conditions match:
        - If rule.percentage is set:
          hash = FNV1a32(flag_key + ":" + user_id) % 100
          If hash < percentage → return rule.value with reason: "rule_match"
          Else → continue to next rule
        - If no percentage → return rule.value with reason: "rule_match"
     c. If conditions don't match → continue to next rule
  7. No rules matched → return environments[env].value with reason: "default"
  8. Return: { "key": "dark-mode", "value": true, "reason": "rule_match" | "default" | "disabled" }
```

> **Evaluation precedence:** `is_active` (global) → `environments[env].enabled` (per-env) → `targeting_enabled` (per-env) → `targeting_rules` → environment `value` (fallback). If `is_active` is false, nothing else matters. If `enabled` is false for the environment, targeting rules are not evaluated.

### Targeting Rule Operators

| Operator | Description | Value Type | Example |
|----------|-------------|------------|---------|
| `eq` | Equals | string, number | `country eq "US"` |
| `neq` | Not equals | string, number | `plan neq "free"` |
| `contains` | String contains | string | `email contains "@beta.com"` |
| `not_contains` | String does not contain | string | `email not_contains "@test"` |
| `in` | Value in list | array | `country in ["US", "CA", "UK"]` |
| `not_in` | Value not in list | array | `country not_in ["CN", "RU"]` |
| `gt` | Greater than | number | `age gt 18` |
| `lt` | Less than | number | `age lt 65` |
| `gte` | Greater than or equal | number | `usage gte 100` |
| `lte` | Less than or equal | number | `usage lte 1000` |
| `regex` | Regex match | string (regex) | `email regex ".*@company\\.com$"` |

### Percentage Rollout — FNV-1a (stdlib)

```go
func isInRollout(flagKey, userID string, percentage int) bool {
    h := fnv.New32a()
    h.Write([]byte(flagKey + ":" + userID))
    bucket := h.Sum32() % 100
    return int(bucket) < percentage
}
```

**Properties that MUST hold (tested):**
1. **Determinism**: Same (flagKey, userID) → same result, every time
2. **Independence**: Different flagKey with same userID → statistically independent distribution
3. **Uniformity**: 10K users at 50% rollout → ~5000 ± 2% tolerance
4. **Stability**: Changing rollout from 10% → 20% keeps all original 10% users in (monotonic)

### Cache Strategy

```
Redis key format: "flag:{environment}:{flag_key}"
TTL: 30 seconds
Invalidation: On flag update, DELETE the cache key (lazy repopulation)

Cache DOWN flow (Redis unreachable):
  1. Log warning (slog.Warn)
  2. Fetch directly from MongoDB
  3. Return flag config (degraded mode, no caching)
  4. Do NOT fail the request — cache is an optimization, not a requirement
```

> **CRITICAL**: Redis failure MUST NOT cause evaluation failure. The evaluation endpoint must ALWAYS return a result — either from cache, from MongoDB, or the default value.

---

## API Endpoints

### Route Prefixes (CRITICAL — TWO DIFFERENT PREFIXES)

| Route Group | Prefix | Auth | Notes |
|-------------|--------|------|-------|
| Auth routes | `/auth/*` | None (public) | Login, register, refresh, logout |
| Dashboard API | `/api/v1/*` | JWT | Flags, segments, experiments, environments, audit, API keys |
| SDK API | `/api/v1/*` | API Key | Evaluate, bulk evaluate, track |
| Health | `/api/v1/health` | None | Health check |

> **CRITICAL:** Auth endpoints are at `/auth/*` with NO `/api/v1` prefix. The frontend auth store MUST call `/auth/login`, `/auth/register`, etc. — NOT `/api/v1/auth/login`.

### Health Check

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/api/v1/health` | GET | None | None | Service health with DB/Redis status |

**Response (200):**
```json
{
  "status": "ok",
  "mongodb": "connected",
  "redis": "connected",
  "version": "1.0.0",
  "built_by": "WorkerMill"
}
```

### Authentication (Dashboard)

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `POST /auth/register` | POST | None | 5/min per IP | Create dashboard user |
| `POST /auth/login` | POST | None | 10/min per IP | Get JWT tokens |
| `POST /auth/refresh` | POST | Refresh token | 30/min per IP | Refresh access token |
| `GET /auth/me` | GET | JWT | 100/min | Current user profile |

**POST /auth/login — Request:**
```json
{
  "email": "demo@workermill.com",
  "password": "demo1234"
}
```

**POST /auth/login — Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 1800,
  "token_type": "Bearer"
}
```

> **No `user` object in auth response.** User data (id, email, name, role) must be decoded from the JWT `access_token` payload. The frontend should decode the JWT, extract user fields, and store as `flagdeck_user` in localStorage.

**JWT Implementation:**
- Access token: 30-minute expiry, contains `sub` (user_id), `email`, `role`, `name`
- Refresh token: 7-day expiry
- Password hashing: bcrypt (`golang.org/x/crypto/bcrypt`)
- Algorithm: HS256
- Roles: `admin` (full access), `editor` (CRUD flags/segments/experiments), `viewer` (read-only)

### Flag Management (Dashboard)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/flags` | GET | JWT | List flags (paginated, filterable by tag/status) |
| `POST /api/v1/flags` | POST | JWT (editor+) | Create flag |
| `GET /api/v1/flags/:key` | GET | JWT | Flag detail with all environments |
| `PUT /api/v1/flags/:key` | PUT | JWT (editor+) | Update flag (name, description, tags) |
| `DELETE /api/v1/flags/:key` | DELETE | JWT (admin) | Delete flag |
| `PUT /api/v1/flags/:key/environments/:env` | PUT | JWT (editor+) | Update flag config for specific environment |
| `POST /api/v1/flags/:key/toggle` | POST | JWT (editor+) | Toggle flag on/off for a specific environment |

**POST /flags/:key/toggle — Request:**

> **CRITICAL — This toggles per-environment `enabled`, NOT the global `is_active` kill switch.**

```json
{
  "environment": "production"
}
```

The `environment` query parameter specifies which environment to toggle. The handler reads the current `environments.{env}.enabled` value and flips it (`true` → `false`, `false` → `true`). If no `environment` is provided, default to `"production"`.

**POST /flags/:key/toggle — Response (200):** Returns the full updated flag document (same shape as `GET /flags/:key`).

**POST /flags/:key/toggle — Implementation:**
1. Read current flag from MongoDB by key
2. Read `environment` from query param (default: `"production"`)
3. Get current `environments[environment].enabled` value
4. Set `environments[environment].enabled = !currentValue` using `$set` on `environments.{env}.enabled`
5. Set `updated_by` and `updated_at`
6. Use `FindOneAndUpdate` with `ReturnDocument: After` to return the updated flag
7. Invalidate Redis cache for this flag+environment
8. Log audit entry with action `"enable"` or `"disable"`
9. Return the full flag document

**DO NOT** toggle `is_active` — that is a separate operation done via `PUT /flags/:key` with `{ "is_active": false }`. The toggle endpoint is specifically for per-environment enable/disable.

**Test for toggle (`handlers_test.go`):**
1. Create a flag with `environments.production.enabled = true`
2. `POST /flags/my-flag/toggle?environment=production`
3. Assert response status 200
4. Assert `flag.Environments["production"].Enabled == false` (toggled from true → false)
5. Assert `flag.IsActive` is still `true` (unchanged — toggle does NOT touch is_active)

**GET /flags query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 20 | Items per page (max 100) |
| `search` | string | null | Search flag key/name |
| `tag` | string | null | Filter by tag |
| `enabled` | bool | null | Filter by enabled state in given environment |
| `environment` | string | "production" | Which environment to check enabled state |
| `sort_by` | string | "updated_at" | Sort: name, key, created_at, updated_at |
| `sort_order` | string | "desc" | asc or desc |

**Paginated response format (ALL list endpoints):**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 50,
    "total_pages": 3
  }
}
```

> **Exact field names:** Use `total` (not `total_items` or `count`), `total_pages` (not `pages`), `per_page` (not `limit` or `page_size`). Frontend components depend on these exact names.

### Flag Evaluation (SDK-facing)

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `POST /api/v1/evaluate` | POST | API Key | 1000/min per key | Evaluate single flag |
| `POST /api/v1/evaluate/bulk` | POST | API Key | 200/min per key | Evaluate multiple flags |

**POST /evaluate — Request:**
```json
{
  "flag_key": "dark-mode",
  "context": {
    "user_id": "u_abc123",
    "email": "jane@company.com",
    "country": "US",
    "plan": "pro",
    "age": 28
  }
}
```

**POST /evaluate — Response (200):**
```json
{
  "key": "dark-mode",
  "value": true,
  "type": "boolean",
  "reason": "rule_match",
  "rule_id": "name-of-matching-rule (empty string if no rule matched)",
  "environment": "production",
  "evaluation_ms": 2.3
}
```

> **`reason` values:** `"rule_match"` (a targeting rule matched), `"default"` (no rules matched or targeting disabled — returned environment value), `"disabled"` (flag killed via `is_active` or environment `enabled` is false — returned `default_value`).
> **`rule_id` field:** Contains the matching rule's `name` (not a UUID). Empty string when reason is not `"rule_match"`. Field is kept as `rule_id` in the JSON response for SDK compatibility.

### Segments

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/segments` | GET | JWT | List segments |
| `POST /api/v1/segments` | POST | JWT (editor+) | Create segment |
| `GET /api/v1/segments/:key` | GET | JWT | Segment detail |
| `PUT /api/v1/segments/:key` | PUT | JWT (editor+) | Update segment |
| `DELETE /api/v1/segments/:key` | DELETE | JWT (admin) | Delete segment |

### Experiments

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/experiments` | GET | JWT | List experiments |
| `POST /api/v1/experiments` | POST | JWT (editor+) | Create experiment |
| `GET /api/v1/experiments/:key` | GET | JWT | Experiment detail with results |
| `PUT /api/v1/experiments/:key` | PUT | JWT (editor+) | Update experiment |
| `POST /api/v1/experiments/:key/start` | POST | JWT (editor+) | Start experiment |
| `POST /api/v1/experiments/:key/stop` | POST | JWT (editor+) | Stop experiment |
| `POST /api/v1/experiments/:key/track` | POST | API Key | Track conversion event |

### Environments

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/environments` | GET | JWT | List environments |
| `POST /api/v1/environments` | POST | JWT (admin) | Create environment |
| `PUT /api/v1/environments/:key` | PUT | JWT (admin) | Update environment |
| `DELETE /api/v1/environments/:key` | DELETE | JWT (admin) | Delete environment (must have no active flags) |

> **Response format:** `GET /api/v1/environments` returns the standard paginated envelope `{"data": [...], "pagination": {...}}` — same as all other list endpoints.

### API Keys

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/api-keys` | GET | JWT (admin) | List API keys (masked) |
| `POST /api/v1/api-keys` | POST | JWT (admin) | Create API key (returns raw key once) |
| `DELETE /api/v1/api-keys/:id` | DELETE | JWT (admin) | Revoke API key |

### Audit Log

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/audit-log` | GET | JWT | Query audit log (paginated, filterable) |

> **Endpoint path is `/api/v1/audit-log`** (with hyphen), NOT `/api/v1/audit` or `/api/v1/dashboard/audit-log`. For the showcase, audit logs are viewable by ANY authenticated user (not admin-only).

**Query parameters:** `page`, `per_page`, `sort_by`, `sort_order`, `resource_type`, `action`, `actor_id`, `start_date`, `end_date`, `resource_key`.

---

## Error Handling

All error responses follow this **flat** format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "details": "optional additional context"
}
```

> **The error format is FLAT** (`{"error": "CODE", "message": "..."}`) — NOT nested (`{"error": {"code": "...", "message": "..."}}`). This matches how Go Fiber's `fiber.Map` serializes.

| Code | HTTP Status | When |
|------|-------------|------|
| `VALIDATION_ERROR` | 422 | Invalid request body or parameters |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `ALREADY_EXISTS` | 409 | Duplicate key or name |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient role |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unhandled error (log full trace, return generic message) |

---

## Rate Limiting

| Endpoint Group | Limit | Key |
|---------------|-------|-----|
| `POST /auth/register` | 5/min | IP |
| `POST /auth/login` | 10/min | IP |
| `POST /evaluate`, `POST /evaluate/bulk` | 1000/min, 200/min | API key |
| All dashboard endpoints | 100/min | User ID from JWT |

In-memory rate limiting (token bucket). State resets on container restart — acceptable for single-instance showcase.

> **CRITICAL — Rate limits MUST be wired in `router.go`:** The rate limiter MUST be applied to the actual route groups in `router/router.go`. Defining the middleware without mounting it on routes does nothing.

---

## Seed Data

A seed script (`api/cmd/seed/main.go`) populates the database with demo data.

### Seed Behavior (CRITICAL — Upsert, NOT Skip)

**The seed script MUST use MongoDB upsert with `$set` for mutable fields.** Do NOT use "check if exists, skip if found" — this causes bugs when the user was created via the Register endpoint before the seed runs (e.g., user has `viewer` role instead of `admin`).

```go
// WRONG — "check and skip":
count, _ := collection.CountDocuments(ctx, bson.M{"email": "demo@workermill.com"})
if count > 0 { return } // Skips — role is never corrected to admin

// RIGHT — upsert with $set:
_, err = collection.UpdateOne(ctx,
    bson.M{"email": "demo@workermill.com"},
    bson.M{
        "$set": bson.M{
            "name":          "Demo Admin",
            "role":          "admin",
            "password_hash": hashedPassword,
            "active":        true,
            "updated_at":    time.Now(),
        },
        "$setOnInsert": bson.M{
            "email":      "demo@workermill.com",
            "created_at": time.Now(),
        },
    },
    options.UpdateOne().SetUpsert(true),
)
```

### Auto-Seed on Deploy (MANDATORY)

**The API Dockerfile MUST build both the seed and server binaries.** The container entrypoint runs the seed script before starting the server. This ensures the dashboard is never empty after a deploy.

```dockerfile
# Build stage
FROM golang:1.24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o seed ./cmd/seed

# Runtime stage — alpine (NOT scratch — needs /bin/sh for CMD)
FROM alpine:3.21
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/main /main
COPY --from=builder /app/seed /seed
EXPOSE 8080
CMD ["/bin/sh", "-c", "/seed && /main"]
```

> **Uses `alpine:3.21`, NOT `scratch`.** The `scratch` image has no shell — you can't run `CMD ["/bin/sh", "-c", "/seed && /main"]`. Alpine adds ~5MB but enables the seed-then-server pattern.

### Seed Contents

#### 1 Admin User

| Field | Value |
|-------|-------|
| Email | `demo@workermill.com` |
| Password | `demo1234` |
| Name | `Demo Admin` |
| Role | `admin` |

#### 3 Default Environments

1. **Production** (#22c55e, sort: 1, is_active: true)
2. **Staging** (#f59e0b, sort: 2, is_active: true)
3. **Development** (#3b82f6, sort: 3, is_active: true)

#### 2 SDK API Keys

| Name | Key Prefix | Environment | Permissions |
|------|-----------|-------------|-------------|
| Production Backend | `fd_live_demo_...` | production | evaluate, read |
| Development Backend | `fd_test_demo_...` | development | evaluate, read, write |

#### 10 Feature Flags

| # | Key | Name | Type | Description |
|---|-----|------|------|-------------|
| 1 | `dark-mode` | Dark Mode | boolean | Enable dark mode UI theme |
| 2 | `new-checkout` | New Checkout Flow | boolean | Redesigned checkout experience |
| 3 | `premium-features` | Premium Features | boolean | Unlock premium feature set |
| 4 | `max-upload-size` | Max Upload Size | number | Maximum file upload size in MB |
| 5 | `welcome-message` | Welcome Message | string | Customizable welcome banner text |
| 6 | `beta-dashboard` | Beta Dashboard | boolean | New analytics dashboard for beta users |
| 7 | `api-rate-limit` | API Rate Limit | number | Configurable per-user rate limit |
| 8 | `onboarding-flow` | Onboarding Flow | string | Which onboarding variant to show |
| 9 | `maintenance-mode` | Maintenance Mode | boolean | Enable maintenance page |
| 10 | `feature-config` | Feature Config | json | Dynamic feature configuration object |

#### 3 Segments

1. **Beta Users** — `email contains "@beta.com"` OR `tag in ["beta-tester"]`
2. **Enterprise** — `plan eq "enterprise"` AND `seats gte 10`
3. **Internal Team** — `email regex ".*@workermill\\.com$"`

#### 2 Experiments

1. **Checkout Conversion** — on `new-checkout` flag, variants: `control` (50%), `variant_a` (50%). Metric: `conversion`. Status: `running`. Seed with ~500 impressions per variant.
2. **Welcome Message Test** — on `welcome-message` flag, variants: `control` (33%), `variant_a` (33%), `variant_b` (34%). Metric: `click_rate`. Status: `draft`.

#### 30 Audit Log Entries

Mix of `create`, `update`, `enable`, `disable`, `view` events over the past 14 days. Each entry has `actor_email: "demo@workermill.com"`, proper `resource_type`, `resource_id`, and `timestamp`.

---

## Testing

### Go Backend Tests

| File | What it tests |
|------|--------------|
| `evaluator_test.go` | Core evaluation logic — rule matching, priority ordering, default values |
| `targeting_test.go` | All 11 operators, AND/OR logic, nested conditions, edge cases |
| `rollout_test.go` | FNV-1a determinism, independence, uniformity (statistical), stability |
| `cache_test.go` | Cache hit, cache miss, cache invalidation, Redis down fallback |
| `handlers_test.go` | HTTP handlers — CRUD, toggle (per-environment `enabled`), auth, evaluate endpoint |
| `experiment_stats_test.go` | Chi-squared calculation, confidence intervals, minimum sample guard |
| `auth_test.go` | JWT lifecycle, API key auth, role enforcement |

### SvelteKit Frontend Tests

Tests use Vitest + `@testing-library/svelte` to mount and interact with real Svelte components.

#### Vitest + Svelte 5 Configuration (MUST be set up before writing any component test)

**`web/vite.config.ts`** — MUST include browser resolve conditions:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts']
  },
  resolve: {
    // CRITICAL: Force browser (client) module resolution for Svelte 5 runes.
    conditions: ['browser']
  }
});
```

**`web/src/test/setup.ts`** — Test setup file:
```ts
import '@testing-library/jest-dom/vitest';
```

**`web/src/app.d.ts`** — MUST include jest-dom type declarations:
```ts
/// <reference types="@testing-library/jest-dom" />
```

#### Component Prop Interfaces (tests MUST only use props that exist)

| Component | Props | Notes |
|-----------|-------|-------|
| `RolloutSlider` | `{ value: number, disabled?: boolean, label?: string, showPercentage?: boolean }` | No callback props |
| `FlagCard` | `{ flag: Flag }` | Uses the `Flag` type from the domain model |
| `FlagToggle` | `{ enabled: boolean, environment: string, onToggle: (environment: string, enabled: boolean) => void, disabled?: boolean }` | `onToggle` fires on click, passes environment + new state. Calls `POST /flags/:key/toggle?environment={env}` |
| `TargetingRuleBuilder` | `{ rules: TargetingRule[], onUpdate: (rules: TargetingRule[]) => void, operators: string[] }` | `onUpdate` fires when rules change |
| `EmptyState` | `{ title: string, description?: string, icon?: string }` | Decorative placeholder |
| `AuditTimeline` | `{ events: AuditEvent[], loading?: boolean }` | Audit log timeline |

### End-to-End Tests (Playwright) — CRITICAL

> **Why this exists:** Quality gates (lint, unit tests, type check, build) verify that code compiles and passes its own tests. They do NOT verify that the frontend works when talking to the real API. E2E tests are the gate that catches frontend-backend integration bugs.

#### What E2E Tests Verify

E2E tests run the **full stack locally in CI** — Go API + MongoDB + Redis + seeded data + SvelteKit frontend — then use Playwright to open a browser and verify every page works with real API responses.

| Test File | What It Catches | Integration Bugs Prevented |
|-----------|----------------|-------------------------------|
| `login.spec.ts` | Auth flow — login, token storage, redirect to dashboard | #7 (wrong auth endpoint), #8 (wrong token field names), #9 (wrong localStorage keys) |
| `dashboard.spec.ts` | Dashboard shows real stats — flag counts, quick action buttons navigate | #6 (no overview endpoint), #17 (stub buttons) |
| `flags.spec.ts` | Flag list shows names/types/tags, flag detail shows environment configs | #1 (snake_case), #2 (response wrapper), #3 (environments as object map), #18 (detail page) |
| `segments.spec.ts` | Segment list shows names and rule counts | #4 (`rules` not `conditions`) |
| `experiments.spec.ts` | Experiment list shows statuses, variants, flag_key | #1 (snake_case `flag_key`, `started_at`) |
| `audit.spec.ts` | Audit log shows actor emails, actions in past tense, resource types | #22 (interface mismatch), #23 (query params), #24 (action format) |

**These 6 test files cover all critical integration points between frontend and backend.**

#### Playwright Configuration

```typescript
// e2e/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',  // SvelteKit preview server
    headless: true,
  },
  // NO webServer block — the full stack (API + frontend preview) is started
  // manually BEFORE running tests (see E2E Quality Gate section).
  // Playwright's webServer.command runs from the config file's directory (e2e/),
  // which would break relative paths like "cd web". Starting servers manually
  // gives full control over the startup sequence (Docker → API → seed → frontend).
});
```

> **No `webServer` in Playwright config.** The full stack (Docker containers, API server, seed, frontend preview) must be started manually before running `npx playwright test`. See the "E2E Quality Gate" section for the exact startup sequence. `baseURL` points to the SvelteKit preview server (port 4173), NOT the dev server. The API runs on port 8080 and the frontend's `PUBLIC_API_URL` is set to `http://localhost:8080` during E2E tests.

#### E2E Test Scenarios (EXACT)

```typescript
// e2e/login.spec.ts
// 1. Navigate to /login
// 2. Fill email: demo@workermill.com, password: demo1234
// 3. Click login button
// 4. Assert: redirected to / (dashboard)
// 5. Assert: localStorage has flagdeck_access_token, flagdeck_refresh_token, flagdeck_user
// 6. Assert: sidebar navigation is visible

// e2e/dashboard.spec.ts (login first via helper)
// 1. Navigate to / (dashboard)
// 2. Assert: "Total Flags" shows "10" (not "0", not "NaN", not "undefined")
// 3. Assert: "Active Flags" shows a number > 0
// 4. Assert: "Create New Flag" button exists and navigates to /flags/new
// 5. Assert: "View All Flags" button exists and navigates to /flags

// e2e/flags.spec.ts (login first)
// 1. Navigate to /flags
// 2. Assert: at least 10 flag cards visible
// 3. Assert: first flag has a name (not empty), a type badge, and tags
// 4. Assert: flag "dark-mode" exists with type "boolean"
// 5. Click on "dark-mode" flag → navigate to detail page
// 6. Assert: environment tabs visible (production, staging, development)
// 7. Assert: targeting rules section exists
// 8. Assert: no "undefined" or "NaN" text visible on the page

// e2e/segments.spec.ts (login first)
// 1. Navigate to /segments
// 2. Assert: at least 3 segments visible
// 3. Assert: "Beta Users" segment exists
// 4. Assert: each segment shows a rule count > 0 (not "0 rules / 0 conditions")

// e2e/experiments.spec.ts (login first)
// 1. Navigate to /experiments
// 2. Assert: at least 2 experiments visible
// 3. Assert: "Checkout Conversion" has status "running"
// 4. Assert: "Welcome Message Test" has status "draft"
// 5. Assert: each experiment shows a flag_key (not undefined)

// e2e/audit.spec.ts (login first)
// 1. Navigate to /audit
// 2. Assert: at least 10 audit events visible
// 3. Assert: first event shows an actor email (contains "@")
// 4. Assert: first event shows an action in past tense ("created", "updated", "viewed", etc.)
// 5. Assert: first event shows a resource type ("flag", "segment", "experiment", etc.)
// 6. Assert: no "undefined" text visible in any event
```

#### Login Helper (Shared Across Tests)

```typescript
// e2e/helpers.ts
import { Page } from '@playwright/test';

export async function loginAsDemo(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@workermill.com');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await page.waitForURL('/');  // Redirect to dashboard after login
}
```

#### E2E Dependencies

Add to `package.json` in the **repo root** (not inside `web/`):

```json
{
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  },
  "scripts": {
    "test:e2e": "playwright test --config e2e/playwright.config.ts"
  }
}
```

Install browsers in CI: `npx playwright install --with-deps chromium`

#### How E2E Tests Run in CI

The E2E job starts the full stack locally, seeds the database, then runs Playwright:

1. Start MongoDB + Redis (service containers — already in CI)
2. Build the Go API binary
3. Seed the database
4. Start the Go API server (background, port 8080)
5. Build the SvelteKit frontend (with `PUBLIC_API_URL=http://localhost:8080`)
6. Start the SvelteKit preview server (background, port 4173)
7. Wait for both servers to be healthy
8. Run Playwright tests
9. If ANY test fails → CI fails → deploy is blocked

This means **integration bugs are caught before deploy, not after.**

---

## CI/CD Pipelines

### CI — `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  api:
    name: API — Lint, Test, Build
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:7
        ports:
          - "27017:27017"
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand(\"ping\").ok'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - "6379:6379"
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"

      - name: Format check
        working-directory: api
        run: |
          unformatted=$(gofmt -l .)
          if [ -n "$unformatted" ]; then
            echo "::error::Go files not formatted:"
            echo "$unformatted"
            gofmt -d .
            exit 1
          fi

      - name: Vet
        working-directory: api
        run: go vet ./...

      - name: Test
        working-directory: api
        run: go test ./... -v -count=1 -race -coverprofile=coverage.out
        env:
          MONGODB_URI: mongodb://localhost:27017/flagdeck_test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-for-ci

      - name: Build
        working-directory: api
        run: CGO_ENABLED=0 go build -o /dev/null ./cmd/server

  web:
    name: Frontend — Lint, Test, Check, Build
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install
        working-directory: web
        run: npm ci

      - name: Lint
        working-directory: web
        run: npm run lint

      - name: Test
        working-directory: web
        run: npm run test

      - name: Type check
        working-directory: web
        run: npm run check

      - name: Build
        working-directory: web
        run: npm run build

# ┌─────────────────────────────────────────────────────────────────────┐
# │ ⛔ STOP — The e2e job below is ADDED BY CARD 5, not Card 1.       │
# │                                                                     │
# │ Cards 1-4 create ci.yml with ONLY the `api` and `web` jobs above. │
# │ Card 5 appends the `e2e` job below to the EXISTING ci.yml.        │
# │ Card 6 creates deploy.yml (shown in the next section).            │
# │                                                                     │
# │ If the e2e job exists before Card 5, it WILL FAIL because the     │
# │ full stack (API + seed + frontend) is not ready yet. This will    │
# │ cause CI to fail, which causes the worker's post-push gate to     │
# │ fail, which causes infinite retry loops. DO NOT add this early.   │
# └─────────────────────────────────────────────────────────────────────┘

  # --- ADDED BY CARD 5 (not present in Cards 1-4) ---
  e2e:
    name: E2E — Full Stack Integration
    needs: [api, web]  # Only run if both unit test jobs pass
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:7
        ports:
          - "27017:27017"
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand(\"ping\").ok'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - "6379:6379"
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      # --- Build and start Go API ---
      - uses: actions/setup-go@v5
        with:
          go-version: "1.24"

      - name: Build API + Seed
        working-directory: api
        run: |
          go build -o ./server ./cmd/server
          go build -o ./seed ./cmd/seed

      - name: Seed database
        working-directory: api
        env:
          MONGODB_URI: mongodb://localhost:27017/flagdeck
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-for-ci
        run: ./seed

      - name: Start API server
        working-directory: api
        env:
          MONGODB_URI: mongodb://localhost:27017/flagdeck
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-secret-for-ci
          PORT: "8080"
          ENVIRONMENT: test
          CORS_ORIGINS: http://localhost:4173
        run: ./server &

      - name: Wait for API
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:8080/api/v1/health && break
            sleep 1
          done

      # --- Build and start SvelteKit frontend ---
      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install frontend deps
        working-directory: web
        run: npm ci

      - name: Build frontend
        working-directory: web
        env:
          PUBLIC_API_URL: http://localhost:8080
        run: npm run build

      - name: Start preview server
        working-directory: web
        run: npm run preview -- --port 4173 &

      - name: Wait for frontend
        run: |
          for i in $(seq 1 15); do
            curl -sf http://localhost:4173 && break
            sleep 1
          done

      # --- Run E2E tests ---
      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npx playwright test --config e2e/playwright.config.ts
        env:
          CI: true

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

> **The E2E job runs AFTER `api` and `web` jobs pass** (`needs: [api, web]`). This means unit tests, lint, type checks, and build all pass before E2E runs. E2E is the final gate before deploy. If E2E fails, the deploy workflow never triggers.
>
> **CI evolution by card:**
> - **Cards 1–4**: `ci.yml` has `api` + `web` jobs only. CI passes when both compile/lint/test.
> - **Card 5**: Adds the `e2e` job above to `ci.yml`. CI now has 3 jobs. E2E must pass.
> - **Card 6**: Creates `deploy.yml` (below). Deploy triggers only when ALL 3 CI jobs pass on `main`.

### Deploy — `.github/workflows/deploy.yml` (CREATED BY CARD 6 ONLY)

> **⛔ This file does NOT exist until Card 6 creates it.** Cards 1–5 do NOT have a deploy workflow. There are NO Railway deployments until Card 6. This prevents intermediate deploys of incomplete code (e.g., an API with no frontend, or a frontend with no backend). Card 6 creates this file, merges to main, CI runs all 3 jobs, and ONLY then does the first deploy happen.

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["CI"]
    branches: [main]
    types: [completed]

jobs:
  deploy-api:
    name: Deploy API
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    container: ghcr.io/railwayapp/cli:latest

    steps:
      - uses: actions/checkout@v4

      - name: Deploy API to Railway
        working-directory: api
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service flagdeck-api --detach

  deploy-web:
    name: Deploy Frontend
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    container: ghcr.io/railwayapp/cli:latest

    steps:
      - uses: actions/checkout@v4

      - name: Deploy Frontend to Railway
        working-directory: web
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: railway up --service flagdeck-web --detach
```

---

## Decomposition Guide (NEW — CRITICAL)

### Why This Section Exists

Without explicit decomposition guidance, builds fail due to:
- Integration bugs between backend and frontend (no shared contract)
- No integration testing until after deploy
- Serial execution when parallelization is possible
- Quality gate retry loops that rewrite entire stories from scratch

### Card Architecture

Cards should be organized into these phases:

```
Phase 1: Foundation (sequential)
  Card 1: Project scaffold + ci.yml (api + web jobs ONLY) + config files
  Card 2: Go domain models + database connection + seed script

Phase 2: Core Backend + Frontend Foundation (parallel tracks)
  Card 3a: Go API — handlers, middleware, services, evaluation engine
  Card 3b: Frontend scaffold — layout, routing, auth store, API client

Phase 3: Feature Implementation (parallel tracks, after Phase 2)
  Card 4a: Go API — remaining handlers (experiments, segments, audit)
  Card 4b: Frontend pages — flags, segments, experiments, audit, dashboard

Phase 4: E2E Tests + Deploy (sequential — AFTER all code cards complete)
  Card 5: E2E test suite — add e2e job to ci.yml, write all 6 Playwright test files, verify full stack
  Card 6: Production deploy — create deploy.yml, merge to main, deploy to Railway, smoke test
```

> **⛔ CI/CD file ownership is strict:**
> - **Card 1** creates `ci.yml` with `api` + `web` jobs. NO `e2e` job. NO `deploy.yml`.
> - **Card 5** adds the `e2e` job to the existing `ci.yml`. Still NO `deploy.yml`.
> - **Card 6** creates `deploy.yml`. This is the FIRST time deploys can happen.
>
> Violating this order causes cascading failures: E2E without a full stack = CI failure = worker gate failure = infinite retry loop. Deploy without E2E = broken code ships to production.

### Card Dependency Rules

1. **Phase 1 is sequential** — Card 2 depends on Card 1 (needs go.mod, CI config, project structure)
2. **Phase 2 can parallelize** — Card 3a (backend) and Card 3b (frontend scaffold) have no code dependencies. Both depend on Phase 1 being complete.
3. **Phase 3 can parallelize** — Card 4a and 4b have no code dependencies. Both depend on their respective Phase 2 card.
4. **Phase 4 is strictly sequential** — Card 5 (E2E tests) depends on ALL Phase 2+3 cards being merged. Card 6 (deploy) depends on Card 5 passing. **Card 5 MUST NOT start until Cards 3a, 3b, 4a, and 4b are ALL complete and merged to main** — it needs the full working stack to test against.

### The E2E Test Card (Card 5 — MOST CRITICAL)

**Card 5 is the gate between "code exists" and "it actually works."** It:

1. **Adds the `e2e` job to the existing `.github/workflows/ci.yml`** — this is the FIRST time CI includes E2E. The job definition is in the "CI Workflow" section of this PRD, clearly marked "ADDED BY CARD 5".
2. Writes the 6 Playwright test files (`login.spec.ts`, `dashboard.spec.ts`, `flags.spec.ts`, `segments.spec.ts`, `experiments.spec.ts`, `audit.spec.ts`) plus the login helper
3. Writes the Playwright config (`e2e/playwright.config.ts`)
4. Adds root `package.json` with `@playwright/test` dependency
5. Runs `npm run test:e2e` locally against the full stack (API + seed + frontend preview)
6. Pushes and verifies the E2E CI job passes (CI now has 3 jobs: api, web, e2e)
7. **If ANY E2E test fails**: traces the failure to the exact frontend-backend mismatch, **fixes the offending backend or frontend code**, and re-runs. Card 5 has permission to fix bugs in any file across the entire codebase — it is the integration fixer.

**The E2E tests are automated, repeatable, and run on every push.** These tests:
- Block the deploy pipeline if they fail
- Catch regressions on future changes
- Provide exact failure messages (not "the page looks broken")
- Run in CI without human intervention

### The Deploy Card (Card 6)

**Card 6 only runs after Card 5 (E2E) passes.** It:

1. **Creates `.github/workflows/deploy.yml`** — this is the FIRST time a deploy workflow exists. The definition is in the "Deploy Workflow" section of this PRD, clearly marked "CREATED BY CARD 6 ONLY".
2. Merges to main → CI runs all 3 jobs (api, web, e2e)
3. CI passes → deploy workflow triggers → Railway deploys both services
4. Runs a smoke test against the live URLs:
   - `curl -f https://flagdeck.workermill.com/api/v1/health` returns 200
   - `curl -f https://flagdeck-app.workermill.com` returns 200
5. Logs into the live site to verify seed data is present (login with demo@workermill.com / demo1234)
6. Creates README.md, CLAUDE.md, and any final documentation

**By this point, E2E tests have already verified every page works.** The smoke test is just confirming Railway deployment didn't break anything. No deploy workflow exists before this card — there are ZERO Railway deploys until Card 6.

### Shared Contract Enforcement

The "Frontend API Contract" section in this PRD is the shared contract between backend and frontend cards. Both card tracks MUST reference it:

- **Backend cards** MUST implement the exact response formats specified in the contract
- **Frontend cards** MUST use the exact TypeScript interfaces specified in the contract
- **The contract is the source of truth** — if the Go API deviates from it, the API is wrong. If the frontend deviates from it, the frontend is wrong.

### What Each Card Must Verify

Every card that produces code MUST verify:

1. **Backend cards (Cards 1, 2, 3a, 4a):** `go vet ./...` → `go test ./... -v -count=1 -race` → `go build -o /dev/null ./cmd/server` → `git push` → CI green (api + web jobs only)
2. **Frontend cards (Cards 3b, 4b):** `npm run lint` → `npm run test` → `npm run check` → `npm run build` → `git push` → CI green (api + web jobs only)
3. **E2E card (Card 5):** All the above PLUS adds e2e job to ci.yml PLUS `npm run test:e2e` passes locally AND the E2E CI job passes (CI now has 3 jobs)
4. **Deploy card (Card 6):** Creates deploy.yml → merges to main → all 3 CI jobs green → deploy triggers → smoke test passes

> **Cards 1–4 only see 2 CI jobs (api + web).** They do NOT check for E2E. Card 5 adds the e2e job. Card 6 adds the deploy workflow. Each card only verifies the CI jobs that exist at the time it runs.

### Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails | What To Do Instead |
|-------------|--------------|-------------------|
| Skip quality gate when "it's just a small change" | Small changes compound into broken builds | Run the full gate every time |
| Retry quality gate by rewriting the entire story | Rewrites introduce new bugs | Make surgical fixes to the failing code |
| Assume frontend field names match backend | 18/25 bugs were field name mismatches | Copy interfaces from the API Contract section |
| Test only in isolation (backend tests pass, frontend tests pass) | Integration is untested | E2E tests verify full stack end-to-end |
| Rely on manual verification instead of automated E2E | Human misses things, not repeatable | Playwright tests run in CI on every push |
| Use `adapter-node` for SvelteKit on Railway | Contradicts working deploy config | Use `adapter-static` + nginx |
| Skip the seed step on deploy | Dashboard is empty | Dockerfile runs `/seed && /main` |
| Add E2E job to ci.yml before Card 5 | E2E fails (no full stack yet) → CI fails → worker retries forever | Card 1 creates ci.yml with api+web ONLY. Card 5 adds e2e. |
| Add deploy.yml before Card 6 | Intermediate deploys of incomplete code to Railway | Card 6 creates deploy.yml. No deploys until then. |

---

## Configuration Files

### api/go.mod

```go
module github.com/workermill-examples/flagdeck/api

go 1.24  // PINNED — must match Dockerfile (golang:1.24-alpine) and CI (go-version: "1.24")

require (
    github.com/gofiber/fiber/v2 v2.52.0
    github.com/golang-jwt/jwt/v5 v5.2.0
    github.com/kelseyhightower/envconfig v1.4.0
    github.com/redis/go-redis/v9 v9.7.0
    github.com/stretchr/testify v1.9.0
    go.mongodb.org/mongo-driver/v2 v2.0.0
    golang.org/x/crypto v0.31.0
)
```

> **These are the TARGET dependencies.** Workers should run `go mod init github.com/workermill-examples/flagdeck/api` then `go get` each dependency. The exact patch versions may differ from above — that's fine, Go modules handle version resolution. Do NOT manually edit `go.sum`.
>
> **CRITICAL — Use mongo-driver v2, NOT v1.** The import path is `go.mongodb.org/mongo-driver/v2` (with `/v2`). Do NOT use `go.mongodb.org/mongo-driver` (no `/v2` suffix) — that's the legacy v1 driver with different APIs. v2 uses `bson.M` from `go.mongodb.org/mongo-driver/v2/bson`, NOT `go.mongodb.org/mongo-driver/bson`.

### web/package.json

```json
{
  "name": "flagdeck-web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@testing-library/svelte": "^5.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "jsdom": "^25.0.0",
    "svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0",
    "tailwindcss": "^4.0.0",
    "eslint": "^9.0.0",
    "eslint-plugin-svelte": "^2.0.0",
    "typescript-eslint": "^8.0.0",
    "globals": "^15.0.0",
    "prettier": "^3.0.0",
    "prettier-plugin-svelte": "^3.0.0"
  },
  "type": "module"
}
```

> **Uses `@sveltejs/adapter-static`** (NOT `adapter-node`). The web Dockerfile uses nginx to serve the static build output.

### docker-compose.yml (Local Development — MongoDB + Redis)

```yaml
version: "3.8"

services:
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mongodb_data:
```

> **This is for local development and Card 5 E2E testing ONLY.** CI uses GitHub Actions service containers (defined in `ci.yml`), not this file. Workers MUST run `docker compose up -d` before running E2E tests locally.

### web/Dockerfile (SvelteKit + adapter-static + nginx)

```dockerfile
# Build stage — SvelteKit with adapter-static
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage — nginx serves static files
FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html

# SPA fallback — all routes serve index.html (SvelteKit handles routing client-side)
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

> **Uses `adapter-static`, NOT `adapter-node`.** SvelteKit builds to static HTML/JS/CSS, served by nginx. Railway detects the Dockerfile and uses it. `PORT=80` MUST be set as a Railway environment variable so Railway routes traffic correctly.

### .gitignore

```
# Dependencies
node_modules/

# Build output
api/server
api/seed
web/build
web/.svelte-kit

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Test output
coverage/
playwright-report/
test-results/

# Go
*.exe
*.test
*.out
```

### .prettierignore (REQUIRED — prevents Prettier from formatting Go files)

```
api/
*.go
go.mod
go.sum
docker-compose.yml
*.dockerfile
Dockerfile
```

---

## Acceptance Criteria (Final State)

### Flag Evaluation Engine
- [ ] `POST /evaluate` returns correct value based on targeting rules
- [ ] AND logic: all conditions must match within a rule
- [ ] OR logic: any condition must match within a rule
- [ ] Rules evaluated in priority order, first match wins
- [ ] All 11 operators work correctly
- [ ] Percentage rollout is deterministic (FNV-1a)
- [ ] Rollout is statistically independent across flags
- [ ] Disabled flags return default value
- [ ] Bulk evaluation works for multiple flags in one request

### API Functionality
- [ ] Health check returns MongoDB and Redis status
- [ ] Auth endpoints at `/auth/*` — register, login, refresh work
- [ ] Auth response returns `access_token`, `refresh_token`, `expires_in` (flat, no `user` object)
- [ ] JWT middleware stores `*models.User` (pointer) in context
- [ ] All handlers assert `*models.User` (pointer) from context
- [ ] Flag CRUD with per-environment configuration (object map, not array)
- [ ] Segment CRUD with `rules` (not `conditions`) at top level
- [ ] Experiment CRUD with variant weights summing to 100
- [ ] Environment CRUD with `is_active`, `description`, `sort_order`, `color`
- [ ] Audit log records every write operation — actions are present tense (`create`, `update`, `delete`)
- [ ] Audit log viewable by any authenticated user (not admin-only for showcase)
- [ ] ALL list endpoints return `{ data: [...], pagination: { page, per_page, total, total_pages } }`
- [ ] ALL error responses use flat format `{ error: "CODE", message: "..." }`

### Dashboard (SvelteKit)
- [ ] Login page at `/login` — calls `POST /auth/login` (NOT `/api/v1/auth/login`)
- [ ] Auth stores `flagdeck_access_token`, `flagdeck_refresh_token`, `flagdeck_user` in localStorage
- [ ] Dashboard computes overview stats client-side from flags list (no `/dashboard/overview` endpoint)
- [ ] Quick action buttons navigate: "Create New Flag" → `/flags/new`, "View All Flags" → `/flags`
- [ ] Flag list reads from `response.data` (NOT `response.flags`)
- [ ] Flag cards use `Object.entries(flag.environments)` to iterate environments
- [ ] Flag detail converts environment object map to array for rendering
- [ ] Segment list shows `segment.rules` (NOT `segment.conditions`)
- [ ] All TypeScript interfaces use snake_case matching Go API responses
- [ ] All Svelte components use Svelte 5 runes: `$props()`, `$state`, `$derived`, `onclick`/`oninput`
- [ ] Audit log timeline handles present-tense actions, converts to past tense for display
- [ ] Audit log shows `event.actor_email`, `event.resource_type`, `event.resource_id`

### E2E Tests (Playwright)
- [ ] `e2e/login.spec.ts` — login with demo credentials, tokens stored, redirected to dashboard
- [ ] `e2e/dashboard.spec.ts` — "Total Flags" shows "10", quick action buttons navigate correctly
- [ ] `e2e/flags.spec.ts` — 10 flags visible, "dark-mode" has type "boolean", detail page shows environment tabs
- [ ] `e2e/segments.spec.ts` — 3 segments visible, each shows rule count > 0
- [ ] `e2e/experiments.spec.ts` — 2 experiments visible with correct statuses (running, draft)
- [ ] `e2e/audit.spec.ts` — events show actor emails, past-tense actions, resource types, no "undefined"
- [ ] E2E CI job passes — full stack (API + seed + frontend) runs in CI, all Playwright tests green
- [ ] E2E job blocks deploy — if E2E fails, deploy workflow does NOT trigger
- [ ] No "undefined", "NaN", or "null" text visible on any tested page

### Seed Data
- [ ] Seed uses upsert with `$set` (NOT "check and skip")
- [ ] Seed writes to `audit_log` collection (NOT `audit_logs`)
- [ ] Dockerfile builds seed binary and runs `/seed && /main` on startup
- [ ] Demo user role is always `admin` after seed (even if user existed as `viewer`)

### Deployment
- [ ] API Dockerfile uses `alpine:3.21` (NOT `scratch`) — needs shell for seed
- [ ] Frontend uses `adapter-static` + nginx (NOT `adapter-node`)
- [ ] CI workflow (Cards 1–4) has ONLY `api` + `web` jobs — NO `e2e` job
- [ ] CI workflow (Card 5+) has `api` + `web` + `e2e` jobs — e2e added by Card 5
- [ ] Deploy workflow created by Card 6 ONLY — does NOT exist before Card 6
- [ ] CI workflow uses standard Go toolchain only (no golangci-lint)
- [ ] Deploy workflow uses exact service names: `flagdeck-api`, `flagdeck-web`

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Frontend-backend field name mismatch** | Every page broken | Frontend API Contract section with exact TypeScript interfaces |
| **Auth endpoint path wrong** | Login fails silently | Auth routes are at `/auth/*` — documented prominently |
| **Seed doesn't upsert** | Demo user has wrong role, empty dashboard | Upsert pattern required; auto-seed on deploy |
| **JWT middleware type mismatch** | All authenticated endpoints return 500 | Pointer contract documented; integration card verifies |
| **Collection name inconsistency** | Data written to wrong collection | Canonical collection name registry |
| **No integration verification** | Bugs ship to production undetected | Mandatory Card 5: integration verification |
| **adapter-node vs adapter-static confusion** | Build or deploy fails | Single clear answer: adapter-static + nginx |
| **E2E job added to CI before full stack exists** | CI fails on every push → workers retry forever | Card 1 creates ci.yml with api+web ONLY. Card 5 adds e2e job. |
| **Deploy workflow created before code is complete** | Railway deploys broken/incomplete code | Card 6 creates deploy.yml. No deploys before that. |
| **Quality gate retry rewrites from scratch** | Introduces more bugs than it fixes | Surgical fixes, not rewrites |
| **MongoDB Atlas M0 limitations** | 512 MB storage, 100 connections | Sufficient for showcase |
| **Upstash free tier limit (10K commands/day)** | Evaluation could exhaust limit | Acceptable for showcase traffic |
| **Go module version drift** | Workers generate code for wrong version | Pin exact versions |
| **SvelteKit 2 vs Svelte 5 confusion** | Workers mix syntax | Runes-only enforcement with examples |

---

## Worker Execution Notes

### Host Prerequisites (Native Binary Mode)

Workers run directly on the host machine with full system access. These tools MUST be installed before the build starts:

| Tool | Version | Verify Command |
|------|---------|---------------|
| Go | 1.24 exactly | `go version` → `go1.24.x` |
| Node.js | 22+ | `node --version` → `v22.x` |
| npm | 10+ | `npm --version` |
| Docker | Latest | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| gh CLI | Latest | `gh --version` |
| git | 2.x+ | `git --version` |

**On first card (Card 1)**, workers MUST:
1. Verify all tools are installed (run the verify commands above)
2. Verify Docker daemon is running: `docker info > /dev/null 2>&1`
3. Start local services: `docker compose up -d` (after creating `docker-compose.yml`)

**On Card 5 (E2E)**, the worker MUST:
1. Install Playwright browsers: `npx playwright install --with-deps chromium`
2. Build and start the full stack locally before running tests (see E2E Quality Gate section)

### What Workers CAN Do

| Action | How |
|--------|-----|
| Push code to GitHub repo | GitHub PAT (already configured) |
| Create GitHub Actions workflows | Write `.yml` files, push to repo |
| Deploy to Railway | `railway up` via GitHub Actions with `RAILWAY_TOKEN` |
| Read CI failure logs | `gh run view --log-failed` |
| Verify deployment | `curl -sf https://flagdeck.workermill.com/api/v1/health` |
| Run Docker containers | `docker compose up -d` for local MongoDB + Redis |
| Run E2E tests locally | Full stack: API + seed + frontend preview + Playwright |
| Install npm packages | `npm ci`, `npx playwright install` |

### What Workers CANNOT Do (Already Provisioned)

All infrastructure is provisioned. Workers MUST NOT attempt to create or modify these resources.

### CI/CD Iteration Pattern (MANDATORY)

```
BEFORE git push:
  Go files changed:
    1. cd api && gofmt -w .
    2. cd api && go vet ./...
    3. cd api && go test ./... -v -count=1 -race
    4. cd api && go build -o /dev/null ./cmd/server

  Frontend files changed:
    1. cd web && npm run lint
    2. cd web && npm run format
    3. cd web && npm run check
    4. cd web && npm run build

  If ANY step fails, fix and restart.
  Only push when ALL steps pass.

AFTER git push:
  → GitHub Actions triggers CI (api + web jobs for Cards 1-4, + e2e for Cards 5-6)
  → Worker MUST wait for CI to complete
  → If ANY CI job fails: read failure, fix, re-run quality gate, push again
  → When CI passes: card is done (Cards 1-5) or deploy triggers (Card 6 only)
```

### Cross-Card Compilation Rule (MANDATORY)

Each card inherits ALL code from previous cards. When Card N pushes code, it MUST compile cleanly with all code from Cards 1 through N-1.

1. **Pull before you start:** `git pull origin main`
2. **Run the FULL quality gate, not just your files**
3. **Do not re-define types that already exist** — import existing ones
4. **Do not change function signatures from other cards** without explicit requirement
5. **If tests from previous cards fail after your changes**, fix them
