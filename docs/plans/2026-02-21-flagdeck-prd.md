# FlagDeck PRD — Full Build Specification

> **"FlagDeck — Built by WorkerMill"**
>
> Open-source feature flag and experimentation platform with targeting rules, percentage rollouts, A/B experiments, and a real-time dashboard. Deployed to Railway (compute) + MongoDB Atlas (database) + Upstash Redis (cache). Built entirely by autonomous AI workers.

## Source of Truth

- **Spec**: This document
- **Target repo**: `workermill-examples/flagdeck` (GitHub, public)
- **Live URL**: https://flagdeck.workermill.com
- **API compute**: Railway (Hobby plan, Docker container)
- **Frontend compute**: Railway (SvelteKit with `adapter-node`, NOT adapter-static)
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

**IMPORTANT — No third-party linters:** Do NOT use `golangci-lint`, `staticcheck`, or any third-party tool. Use only standard Go toolchain commands (`go vet`, `go test`, `go build`, `gofmt`). These commands run in a minimal container where third-party tools are not installed.

**IMPORTANT — CI must use the EXACT same commands:** The CI workflow (`.github/workflows/ci.yml`) MUST run the exact same commands as this quality gate. No additional linters, no different flags. If the quality gate passes, CI must also pass. Any divergence is a bug.

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
- `on:event` → `onevent` (lowercase, no colon)

If any component is found using Svelte 4 syntax, it MUST be rewritten before the card is complete.

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

### Shared Service Interface Contracts (CRITICAL — Cross-Card)

**These interfaces are consumed by multiple cards. The signatures below are the SINGLE SOURCE OF TRUTH.** Any card calling these methods MUST use the exact signature shown.

**AuditService** (defined in `services/audit.go`, consumed by all handler files):

```go
type AuditEntryInput struct {
    ActorID      string                 // User who performed the action
    ActorEmail   string                 // Denormalized for display
    Action       string                 // e.g., "flag.created", "segment.deleted"
    ResourceType string                 // "flag", "segment", "experiment", "apikey", "environment"
    ResourceID   string                 // MongoDB ObjectID as string
    ResourceKey  string                 // Human-readable key (e.g., "dark-mode")
    Changes      map[string]interface{} // Field-level diff (old/new values)
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
| **Backend framework** | Go + Fiber | Go 1.22+, Fiber v2 | High-performance, Express-like API for Go. Fiber is the most starred Go web framework after Gin, with familiar middleware patterns. |
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
| **Container** | Docker (multi-stage) | — | Minimal scratch-based Go binary. Frontend uses adapter-node (NOT nginx). |
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
| `PUBLIC_API_URL` | `https://flagdeck.workermill.com` | API base URL for the frontend |

**Railway Deployment Requirements (CRITICAL):**

1. **SvelteKit MUST use `@sveltejs/adapter-node`** — Railway requires a long-running process. `adapter-static` generates static HTML files with no server process, which causes Railway builds to fail with "no start command". The `svelte.config.js` must import `adapter-node`, NOT `adapter-static`.

2. **`web/package.json` MUST include a `"start"` script:** `"start": "node build"` — Railway auto-detects the start command from package.json. Without it, the service won't start after build. The `adapter-node` output goes to the `build/` directory.

3. **SvelteKit layout MUST use `ssr: true`** (NOT `prerender: true`) — `adapter-node` serves pages dynamically via SSR. Setting `export const prerender = true` in `+layout.ts` conflicts with adapter-node and causes build failures. Use `export const ssr = true` instead.

4. **Railway project token is project-scoped** — The `RAILWAY_TOKEN` GitHub secret must be a project-scoped token generated from Railway project settings (Settings → Tokens → Create Token), NOT a personal API token. Project tokens have the format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

5. **Service names in `railway up` MUST be exact** — Use `--service flagdeck-api` and `--service flagdeck-web` (the exact names from the Railway dashboard). Using any other name creates a new service instead of deploying to the existing one.

### MongoDB Atlas (Database)

| Resource | Details |
|----------|---------|
| Plan | M0 free tier (512 MB storage, shared cluster) |
| Cluster | `flagdeck` (Atlas project: Flagdeck) |
| Region | `us-east-1` (AWS) |
| Database | `flagdeck` |
| DB user | `rosenthaljarod_db_user` |
| Collections | `flags`, `environments`, `segments`, `experiments`, `audit_log`, `users`, `api_keys` |
| Status | **Ready** |

**Connection string format (password in Railway env vars):**
```
mongodb+srv://rosenthaljarod_db_user:<password>@flagdeck.rakqc31.mongodb.net/flagdeck?retryWrites=true&w=majority&appName=Flagdeck
```

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

### DNS (Custom Domains)

| Record | Type | Value | Status |
|--------|------|-------|--------|
| `flagdeck.workermill.com` | CNAME | `flagdeck-api-production.up.railway.app` | **Ready** (Route53) |
| `flagdeck-app.workermill.com` | CNAME | `flagdeck-web-production.up.railway.app` | **Ready** (Route53) |

Custom domains are also registered in Railway for automatic TLS certificate provisioning.

---

## Project Structure

```
flagdeck/
├── api/
│   ├── cmd/
│   │   └── server/
│   │       └── main.go                  # Entry point, Fiber app bootstrap, graceful shutdown
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
│   │   │   └── health.go               # Health check
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
│   └── Dockerfile                       # Multi-stage: build → scratch
├── web/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +layout.svelte           # Root layout (sidebar, nav)
│   │   │   ├── +layout.server.ts        # Auth guard
│   │   │   ├── +page.svelte             # Dashboard home (flag overview)
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
│   │   │   │   ├── auth.ts              # Auth state store
│   │   │   │   └── flags.ts             # Flag list store
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
│   ├── svelte.config.js                 # SvelteKit config (adapter-node — REQUIRED for Railway)
│   ├── vite.config.ts                   # Vite config
│   ├── tailwind.config.js               # Tailwind config
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile                       # Build → adapter-node (NOT nginx)
├── docker-compose.yml                   # Local dev (MongoDB + Redis)
├── .github/
│   └── workflows/
│       ├── ci.yml                       # Lint, test, build on push/PR
│       └── deploy.yml                   # Deploy to Railway on CI success
├── .gitignore
├── .prettierignore                      # Exclude non-JS files from Prettier
├── CLAUDE.md                            # Worker instructions for this repo
└── README.md                            # Setup, architecture, API docs
```

---

## Core Domain Model

> **CRITICAL — Exact Names Matter:** MongoDB collection names and field names in this section are the **canonical source of truth**. Use them exactly as written. Do NOT rename collections (e.g., `audit_log` is correct, NOT `audit_logs`). Do NOT rename fields (e.g., `impressions` is correct, NOT `exposures`). Do NOT omit fields marked in the schema — every field listed is required in the Go struct and MongoDB document.

### Flag Document (`flags` collection)

```json
{
  "_id": "ObjectId",
  "key": "string (unique, slug-format: lowercase, hyphens, e.g. 'dark-mode')",
  "name": "string (human-readable, e.g. 'Dark Mode')",
  "description": "string (optional)",
  "type": "string (enum: 'boolean', 'string', 'number', 'json')",      // ⚠ REQUIRED — used in evaluation response and UI type display
  "default_value": "any (matches type — false for boolean, '' for string, 0 for number, {} for json)",  // ⚠ REQUIRED — returned when flag is disabled or no rules match
  "environments": {
    "production": {
      "enabled": "boolean",
      "rules": [
        {
          "id": "string (uuid)",
          "priority": "integer (lower = evaluated first)",  // ⚠ REQUIRED — rules MUST be sorted by this field during evaluation
          "conditions": [
            {
              "attribute": "string (e.g. 'country', 'plan', 'email')",
              "operator": "string (enum: 'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'lt', 'gte', 'lte', 'regex')",
              "value": "any (string, number, or array for 'in'/'not_in')"
            }
          ],
          "logic": "string (enum: 'and', 'or') — how conditions within this rule combine. Default: 'and'",  // ⚠ REQUIRED — must implement both AND and OR evaluation
          "value": "any (the value served when this rule matches)",
          "rollout_percentage": "number (0-100, optional — if set, only this % of matched users get the value)"
        }
      ],
      "fallthrough": {
        "value": "any (value for users who match no rules)",
        "rollout_percentage": "number (0-100, optional)"
      }
    },
    "staging": { "...same structure..." },
    "development": { "...same structure..." }
  },
  "tags": ["string"],
  "created_by": "ObjectId (ref: users)",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

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
  "color": "string (hex color for UI, e.g. '#22c55e' for production)",
  "sort_order": "integer",
  "created_at": "datetime"
}
```

Default environments seeded: `production` (#22c55e), `staging` (#f59e0b), `development` (#3b82f6).

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
          "attribute": "string",
          "operator": "string",
          "value": "any"
        }
      ],
      "logic": "string ('and' | 'or')"
    }
  ],
  "created_by": "ObjectId",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

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

```json
{
  "_id": "ObjectId",
  "actor_id": "ObjectId (ref: users)",
  "actor_email": "string (denormalized for display)",
  "action": "string (enum: 'flag.created', 'flag.updated', 'flag.deleted', 'flag.toggled', 'experiment.started', 'experiment.stopped', 'segment.created', 'segment.updated', 'segment.deleted', 'apikey.created', 'apikey.revoked')",
  "resource_type": "string ('flag', 'experiment', 'segment', 'apikey')",
  "resource_id": "string",
  "resource_key": "string (human-readable reference)",
  "changes": {
    "field_name": { "old": "any", "new": "any" }
  },
  "environment": "string (optional — which environment was affected)",
  "ip_address": "string",
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
  3. If flag is disabled in this environment → return default_value
  4. Evaluate rules in priority order (lowest priority number first):
     a. For each rule, evaluate all conditions:
        - If rule.logic == "and": ALL conditions must match
        - If rule.logic == "or": ANY condition must match
     b. If conditions match:
        - If rule.rollout_percentage is set:
          hash = FNV1a32(flag_key + ":" + user_id) % 100
          If hash < rollout_percentage → return rule.value
          Else → continue to next rule
        - If no rollout_percentage → return rule.value
     c. If conditions don't match → continue to next rule
  5. No rules matched → evaluate fallthrough:
     - If fallthrough.rollout_percentage is set:
       hash = FNV1a32(flag_key + ":" + user_id) % 100
       If hash < rollout_percentage → return fallthrough.value
       Else → return default_value
     - If no rollout_percentage → return fallthrough.value
  6. Return: { "key": "dark-mode", "value": true, "reason": "rule_match" | "fallthrough" | "disabled" | "default" }
```

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
// Deterministic percentage rollout using FNV-1a 32-bit (Go stdlib hash/fnv)
// CRITICAL: hash is based on flagKey + ":" + userID (NOT userID alone)
// This ensures a user in the 10% bucket for flag A is NOT necessarily
// in the 10% bucket for flag B (statistical independence).
// Do NOT use spaolacci/murmur3 — it uses unsafe pointer arithmetic that
// crashes under Go's -race detector (checkptr violation).

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

Cache MISS flow:
  1. GET from Redis → null
  2. Fetch from MongoDB
  3. SET in Redis with 30s TTL
  4. Return flag config

Cache DOWN flow (Redis unreachable):
  1. Log warning (slog.Warn)
  2. Fetch directly from MongoDB
  3. Return flag config (degraded mode, no caching)
  4. Do NOT fail the request — cache is an optimization, not a requirement
```

> **CRITICAL**: Redis failure MUST NOT cause evaluation failure. The evaluation endpoint must ALWAYS return a result — either from cache, from MongoDB, or the default value. Flag evaluation is the most latency-sensitive path.

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

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

If MongoDB or Redis is unreachable, return status `"degraded"` with the affected service as `"disconnected"`. Still return HTTP 200 — Railway healthcheck only checks status code.

### Authentication (Dashboard)

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `POST /api/v1/auth/register` | POST | None | 5/min per IP | Create dashboard user |
| `POST /api/v1/auth/login` | POST | None | 10/min per IP | Get JWT tokens |
| `POST /api/v1/auth/refresh` | POST | Refresh token | 30/min per IP | Refresh access token |
| `GET /api/v1/auth/me` | GET | JWT | 100/min | Current user profile |

**JWT Implementation:**
- Access token: 30-minute expiry, contains `sub` (user_id), `email`, `role`
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
| `PUT /api/v1/flags/:key/environments/:env` | PUT | JWT (editor+) | Update flag config for specific environment (rules, enabled, fallthrough) |
| `POST /api/v1/flags/:key/toggle` | POST | JWT (editor+) | Toggle flag on/off for environment |

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

**Paginated response format (all list endpoints):**
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

> **Exact sort parameter names:** Use `sort_by` and `sort_order` as separate query parameters (not a combined `sort=name:asc` format). The Go API parses these as individual params. Frontend stores must send `?sort_by=name&sort_order=asc`, NOT `?sort=name:asc`.

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
  "rule_id": "uuid-of-matching-rule",
  "environment": "production",
  "evaluation_ms": 2.3
}
```

**Reason values:**
- `rule_match` — a targeting rule matched
- `fallthrough` — no rules matched, using fallthrough value
- `disabled` — flag is disabled in this environment
- `default` — flag not found or error, returning type default
- `experiment` — user is in an experiment variant

**POST /evaluate/bulk — Request:**
```json
{
  "flag_keys": ["dark-mode", "new-checkout", "premium-features"],
  "context": {
    "user_id": "u_abc123",
    "country": "US",
    "plan": "pro"
  }
}
```

**POST /evaluate/bulk — Response (200):**
```json
{
  "evaluations": [
    { "key": "dark-mode", "value": true, "type": "boolean", "reason": "rule_match" },
    { "key": "new-checkout", "value": "variant_b", "type": "string", "reason": "experiment" },
    { "key": "premium-features", "value": false, "type": "boolean", "reason": "disabled" }
  ],
  "environment": "production",
  "evaluation_ms": 4.7
}
```

> **CRITICAL**: `context.user_id` is REQUIRED for percentage rollouts and experiments. If missing, rollouts evaluate to 0% (deterministic — no user_id means no hash). Evaluation still works for non-rollout rules.

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

**POST /experiments/:key/track — Request (SDK-facing):**
```json
{
  "user_id": "u_abc123",
  "metric_key": "conversion",
  "value": 1
}
```

### Environments

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /api/v1/environments` | GET | JWT | List environments |
| `POST /api/v1/environments` | POST | JWT (admin) | Create environment |
| `PUT /api/v1/environments/:key` | PUT | JWT (admin) | Update environment |
| `DELETE /api/v1/environments/:key` | DELETE | JWT (admin) | Delete environment (must have no active flags) |

> **Response format:** `GET /api/v1/environments` returns the standard paginated envelope `{"data": [...], "pagination": {...}}` — same as all other list endpoints (see "Paginated response format" above). Do NOT return a bare JSON array.

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

**Query parameters:** `page`, `per_page`, `resource_type`, `action`, `actor_id`, `start_date`, `end_date`, `resource_key`.

---

## Error Handling

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

| Code | HTTP Status | When |
|------|-------------|------|
| `VALIDATION_ERROR` | 422 | Invalid request body or parameters |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `ALREADY_EXISTS` | 409 | Duplicate key or name |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient role |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `FLAG_KEY_RESERVED` | 400 | Flag key conflicts with reserved word |
| `EXPERIMENT_ACTIVE` | 400 | Cannot modify flag with active experiment |
| `ENVIRONMENT_IN_USE` | 400 | Cannot delete environment with active flags |
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

> **CRITICAL — Rate limits MUST be wired in `router.go`:** Defining the rate limit middleware in `middleware/ratelimit.go` is not sufficient. The rate limiter MUST be applied to the actual route groups in `router/router.go`. Each endpoint group in the table above must have its rate limiter attached as Fiber middleware on the corresponding route group. If rate limits are defined but not mounted on routes, they do nothing.

**Rate limit headers on every response:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 997
X-RateLimit-Reset: 1708300800
```

429 responses include `Retry-After` header.

---

## Experiment Statistics

When an experiment is running, track impressions and conversions per variant.

### Chi-Squared Test for Statistical Significance

```
For each variant pair (control vs treatment):
  1. Build 2x2 contingency table:
     | | Converted | Not Converted | Total |
     |---|---|---|---|
     | Control | a | b | a+b |
     | Treatment | c | d | c+d |

  2. Calculate chi-squared statistic:
     χ² = Σ (observed - expected)² / expected

  3. Degrees of freedom = 1 (2x2 table)

  4. Look up p-value:
     p < 0.05 → "significant" (>95% confidence)
     p < 0.01 → "highly significant" (>99% confidence)
     p >= 0.05 → "not significant"

  5. Confidence = (1 - p-value) * 100
```

**Minimum sample size:** Do not report significance until each variant has ≥ 100 impressions. Display "Collecting data..." instead.

---

## Configuration Files

### api/go.mod

```go
module github.com/workermill-examples/flagdeck/api

go 1.22

require (
    github.com/gofiber/fiber/v2 v2.52.0
    github.com/golang-jwt/jwt/v5 v5.2.0
    github.com/kelseyhightower/envconfig v1.4.0
    github.com/redis/go-redis/v9 v9.7.0
    // NOTE: Do NOT add spaolacci/murmur3 — use stdlib hash/fnv instead
    github.com/stretchr/testify v1.9.0
    go.mongodb.org/mongo-driver/v2 v2.0.0
    golang.org/x/crypto v0.31.0
)
```

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
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node build"
  },
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.0.0",
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

> **Testing deps are required:** `vitest`, `@testing-library/svelte`, `@testing-library/jest-dom`, and `jsdom` must be in devDependencies. The `test` and `test:watch` scripts must be present. Without these, frontend tests cannot run.

> **Vitest requires at least one test file:** If `npm run test` is in the CI pipeline, there MUST be at least one `.test.ts` file when the test step runs. Vitest exits with a non-zero code when no test files are found, which fails CI. The CI/CD card MUST create a placeholder test:
> ```typescript
> // web/src/lib/utils/format.test.ts
> import { describe, it, expect } from 'vitest';
> describe('placeholder', () => {
>   it('passes', () => { expect(true).toBe(true); });
> });
> ```
> This file gets replaced by real tests in later cards. Do NOT remove it until real test files exist.

### web/eslint.config.js

ESLint 9 uses flat config. This config enforces strict TypeScript rules:

```js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: ts.parser }
    }
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  { ignores: ['build/', '.svelte-kit/', 'dist/'] }
);
```

> **`no-explicit-any` is an error, not a warning.** Workers MUST use proper types instead of `any`. Use `unknown` for truly unknown values, or define an interface.

### web/tsconfig.json

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true
  }
}
```

> **`strict: true` is required.** This enables `noImplicitAny`, `strictNullChecks`, and other safety checks. Do NOT set `strict: false` or omit it.

### docker-compose.yml (local development)

```yaml
services:
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_DATABASE: flagdeck
    volumes:
      - mongodata:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.runCommand('ping').ok"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mongodata:
```

### api/Dockerfile

```dockerfile
# Stage 1: Build
FROM golang:1.22-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

# Stage 2: Runtime
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /server /server

EXPOSE 8080
ENTRYPOINT ["/server"]
```

> **NOTE**: `scratch` base image produces the smallest possible container (~10-15 MB). `ca-certificates.crt` is copied for TLS connections to MongoDB Atlas and Upstash Redis.

### .gitignore

```gitignore
# Go
api/server
api/tmp/

# Node
web/node_modules/
web/.svelte-kit/
web/build/

# Environment
.env
.env.*
!.env.example

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db
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

> **Why this is mandatory:** The frontend `npm run format` runs `prettier --write .` which, without this file, will attempt to reformat Go source files, `go.mod`, YAML, and Dockerfiles — corrupting their syntax. This caused 2 CI failures. Create this file in the repo root as part of the first card.

---

## Seed Data

A seed script (`api/cmd/seed/main.go`) populates the database with demo data. MUST be idempotent — running twice does not create duplicates.

### 1 Admin User

| Field | Value |
|-------|-------|
| Email | `demo@workermill.com` |
| Password | `demo1234` |
| Name | `Demo Admin` |
| Role | `admin` |

### 3 Default Environments

1. **Production** (#22c55e, sort: 1)
2. **Staging** (#f59e0b, sort: 2)
3. **Development** (#3b82f6, sort: 3)

### 2 SDK API Keys

| Name | Key Prefix | Environment | Permissions |
|------|-----------|-------------|-------------|
| Production Backend | `fd_live_demo_...` | production | evaluate, read |
| Development Backend | `fd_test_demo_...` | development | evaluate, read, write |

### 10 Feature Flags

| # | Key | Name | Type | Description |
|---|-----|------|------|-------------|
| 1 | `dark-mode` | Dark Mode | boolean | Enable dark mode UI theme |
| 2 | `new-checkout` | New Checkout Flow | boolean | Redesigned checkout experience |
| 3 | `premium-features` | Premium Features | boolean | Unlock premium feature set |
| 4 | `max-upload-size` | Max Upload Size | number | Maximum file upload size in MB |
| 5 | `welcome-message` | Welcome Message | string | Customizable welcome banner text |
| 6 | `beta-dashboard` | Beta Dashboard | boolean | New analytics dashboard for beta users |
| 7 | `api-rate-limit` | API Rate Limit | number | Configurable per-user rate limit |
| 8 | `onboarding-flow` | Onboarding Flow | string | Which onboarding variant to show (v1, v2, v3) |
| 9 | `maintenance-mode` | Maintenance Mode | boolean | Enable maintenance page |
| 10 | `feature-config` | Feature Config | json | Dynamic feature configuration object |

Each flag has targeting rules in at least the `production` environment:
- `dark-mode`: 50% rollout in production, 100% in development
- `new-checkout`: targeting rule `country in ["US", "CA"]` AND `plan eq "pro"`
- `premium-features`: targeting rule `plan in ["pro", "enterprise"]`
- `beta-dashboard`: targeting rule `email contains "@beta.com"` OR segment `beta-users`
- `maintenance-mode`: disabled in all environments

### 3 Segments

1. **Beta Users** — `email contains "@beta.com"` OR `tag in ["beta-tester"]`
2. **Enterprise** — `plan eq "enterprise"` AND `seats gte 10`
3. **Internal Team** — `email regex ".*@workermill\\.com$"`

### 2 Experiments

1. **Checkout Conversion** — on `new-checkout` flag, variants: `control` (old checkout, 50%), `variant_a` (new checkout, 50%). Metric: `conversion`. Status: `running`. Seed with ~500 impressions and ~50 conversions per variant.
2. **Welcome Message Test** — on `welcome-message` flag, variants: `control` ("Welcome!", 33%), `variant_a` ("Get started in 60 seconds", 33%), `variant_b` ("Your dashboard is ready", 34%). Metric: `click_rate`. Status: `draft`.

### 30 Audit Log Entries

Mix of flag created/updated/toggled events over the past 14 days.

---

## Testing

### Go Backend Tests

Tests run against local MongoDB and Redis (docker-compose services or testcontainers).

| File | What it tests |
|------|--------------|
| `evaluator_test.go` | Core evaluation logic — rule matching, priority ordering, default values |
| `targeting_test.go` | All 11 operators, AND/OR logic, nested conditions, edge cases |
| `rollout_test.go` | FNV-1a determinism, independence, uniformity (statistical), stability |
| `cache_test.go` | Cache hit, cache miss, cache invalidation, Redis down fallback |
| `handlers_test.go` | HTTP handlers — CRUD, auth, evaluate endpoint |
| `experiment_stats_test.go` | Chi-squared calculation, confidence intervals, minimum sample guard |
| `auth_test.go` | JWT lifecycle, API key auth, role enforcement |

> **Go test model construction — MUST match struct definitions exactly.** When constructing test models (e.g., `models.Flag{}`, `models.Segment{}`), every field name and type must match the struct definition in `models/*.go`. Common mistakes that cause compile errors:
> - Using `Variations` instead of `Variants` on experiments
> - Using `Conditions` as a direct field instead of `Rules[].Conditions`
> - Mixing up `string` and `primitive.ObjectID` types for ID fields
> - Using `time.Now()` where the struct expects `primitive.DateTime`
> - Missing required fields (Go zero values may not satisfy business logic)
>
> **Rule:** After writing any `_test.go` file, run `go build ./...` and `go vet ./...` immediately. Do NOT wait until the end of the card to discover type mismatches.

### SvelteKit Frontend Tests

Tests use Vitest + `@testing-library/svelte` to mount and interact with real Svelte components. Tests MUST render actual Svelte components — not raw HTML strings. Each test file imports the component, mounts it with `render()`, and asserts on the rendered DOM.

#### Vitest + Svelte 5 Configuration (MUST be set up before writing any component test)

Svelte 5 components use runes (`$state`, `$props`, `$derived`) which are client-only APIs. Vitest defaults to SSR module resolution, which will cause `mount(...) is not available on the server` errors unless configured correctly.

**`web/vite.config.ts`** — MUST include these test settings:

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
    // Without this, Vitest loads SSR modules and mount() fails.
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

Without this line, TypeScript will report errors on matchers like `toBeInTheDocument()`, `toHaveTextContent()`, etc.

#### Component Prop Interfaces (tests MUST only use props that exist)

Tests MUST only reference props that are defined on the component. These are the prop interfaces for shared components:

| Component | Props | Notes |
|-----------|-------|-------|
| `RolloutSlider` | `{ value: number, disabled?: boolean, label?: string, showPercentage?: boolean }` | No callback props — value is display-only |
| `FlagCard` | `{ flag: Flag }` | Uses the `Flag` type from the domain model |
| `FlagToggle` | `{ enabled: boolean, onToggle: (enabled: boolean) => void, disabled?: boolean }` | `onToggle` fires on click |
| `TargetingRuleBuilder` | `{ rules: TargetingRule[], onUpdate: (rules: TargetingRule[]) => void, operators: string[] }` | `onUpdate` fires when rules change |
| `EmptyState` | `{ title: string, description?: string, icon?: string }` | Decorative placeholder |
| `Sidebar` | `{ items: NavItem[], activePath: string }` | Navigation sidebar |
| `ExperimentChart` | `{ results: Record<string, VariantResult>, variants: Variant[] }` | Results visualization |
| `AuditTimeline` | `{ entries: AuditEntry[] }` | Audit log timeline |

Do NOT invent props that are not listed (e.g., do NOT use `onValueChange` on `RolloutSlider`).

#### Test Files

| File | What it tests |
|------|--------------|
| `flags.test.ts` | Flag list page — renders flag table, search input, tag filters, pagination |
| `flag-detail.test.ts` | Flag detail page — environment tabs, rule display, toggle functionality |
| `segments.test.ts` | Segment list page — renders segment table, search, delete confirmation |
| `experiments.test.ts` | Experiment list page — status badges, variant display |
| `auth.test.ts` | Login page — form validation, submit behavior, error display |
| `components.test.ts` | Shared components — EmptyState, Sidebar, FlagToggle, RolloutSlider |

> **CRITICAL — Real Component Tests Required:** Every test MUST use `@testing-library/svelte` to `render()` the actual Svelte component. Tests that create raw HTML with `document.createElement` or `innerHTML` and never import/mount a `.svelte` file are **not valid tests** and do not satisfy this requirement. The purpose of frontend tests is to verify component behavior — element rendering, user interactions, conditional display, API call mocking — not to test that HTML strings contain substrings.

```bash
# Run frontend tests
cd web && npm run test

# Run specific test
cd web && npx vitest run src/routes/flags/flags.test.ts
```

> **Mock data MUST match the domain model exactly.** Test factory functions and mock API responses must use the same field names as the Core Domain Model section above. Common mistakes to avoid:
> - Segments: Use `rules[].conditions[].attribute` (NOT `conditions[].property`)
> - Experiments: Use `variants[].weight` (NOT `variations[].traffic`)
> - Flags: Use `fallthrough.value` (NOT `fallthrough.variation`), and `rollout.attribute` is required on rollout objects
> - Pagination: Use `total` (NOT `total_items`)

> **Query selectors — use specific queries when multiple elements exist.** When a page renders multiple buttons, text labels, or similar elements, use `getAllByRole`/`getAllByText` and select the specific index, or use `getByRole` with `{ name: "..." }` to narrow the match. Do NOT use bare `getByText("Submit")` if multiple "Submit" elements exist — the test will fail with "found multiple elements."

### Key Test Scenarios

1. **Evaluation determinism**: Same (flagKey, userID) → same result across 1,000 evaluations
2. **Rollout uniformity**: 10K users at 50% rollout → 5000 ± 200 (2% tolerance)
3. **Rollout independence**: Different flagKey, same userID → statistically independent (chi-squared p > 0.05)
4. **AND/OR logic**: `(A AND B) OR C` targeting produces correct matches
5. **Rule priority**: Lower priority number evaluated first, first match wins
6. **Cache hit**: Evaluate → check Redis was queried, MongoDB was NOT
7. **Cache miss**: Clear Redis → evaluate → check MongoDB was queried
8. **Cache invalidation**: Update flag → verify Redis key deleted
9. **Redis down**: Stop Redis → evaluate → still returns correct result from MongoDB
10. **Experiment tracking**: Track conversion → verify results updated atomically
11. **Statistics guard**: < 100 impressions → confidence = 0, not "significant"
12. **Bulk evaluation**: 3 flags in one request → all evaluated correctly
13. **Role enforcement**: Viewer cannot create flags (403), editor can, admin can delete

### Running Tests

```bash
# Start test dependencies
docker compose up -d

# Run all Go tests
cd api && go test ./... -v -count=1 -race

# Run with coverage
cd api && go test ./... -coverprofile=coverage.out -covermode=atomic
go tool cover -func=coverage.out

# Run specific package
cd api && go test ./internal/services/... -v -run TestEvaluation
```

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
          go-version: "1.22"

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
```

### Deploy — `.github/workflows/deploy.yml`

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

> **Deploy commands are EXACT — do NOT add flags.** Use the `railway up` commands EXACTLY as shown above. Do NOT add `--environment production`, `--build`, or any other flags not present in this spec. Adding unspecified flags will cause deployment failures.
>
> **Railway service names are EXACT.** The `--service` flag must use the exact service name from Railway: `flagdeck-api` and `flagdeck-web`. Do NOT use `api`, `backend`, `web`, `frontend`, or any other name. These are the service IDs configured in Railway (see Pre-Provisioned Resources table). If you use the wrong name, `railway up` will create a **new** service instead of deploying to the existing one.

---

## Quality Gates

| Gate | Threshold | Command |
|------|-----------|---------|
| Go vet | 0 errors | `cd api && go vet ./...` |
| Go format | Fully formatted | `gofmt -d ./api/` (no output) |
| Go tests | 100% pass | `cd api && go test ./... -v -count=1 -race` |
| Go build | Successful binary | `cd api && go build -o /dev/null ./cmd/server` |
| Frontend lint | 0 errors | `cd web && npm run lint` |
| Frontend tests | 100% pass | `cd web && npm run test` |
| Frontend types | 0 errors | `cd web && npm run check` |
| Frontend build | Successful | `cd web && npm run build` |
| Docker build | Successful | `docker build -f api/Dockerfile api/` |
| Health check | Returns 200 | `curl -f https://flagdeck.workermill.com/api/v1/health` |

---

## CLAUDE.md for Target Repo

Workers MUST create a `CLAUDE.md` in the root of `workermill-examples/flagdeck`:

```markdown
# CLAUDE.md

## Quick Reference

| Task | Command |
|------|---------|
| Start local services | `docker compose up -d` |
| Run API | `cd api && go run ./cmd/server` |
| Run frontend | `cd web && npm run dev` |
| Run Go tests | `cd api && go test ./... -v` |
| Run Go tests (race) | `cd api && go test ./... -v -race -count=1` |
| Vet Go | `cd api && go vet ./...` |
| Format Go | `cd api && gofmt -w .` |
| Seed database | `cd api && go run ./cmd/seed` |
| Frontend type check | `cd web && npm run check` |
| Frontend lint | `cd web && npm run lint` |
| Frontend build | `cd web && npm run build` |

## Local Development

1. `docker compose up -d` — Start MongoDB + Redis
2. `cp .env.example .env` — Copy env template
3. `cd api && go run ./cmd/seed` — Seed demo data
4. `cd api && go run ./cmd/server` — Start API (port 8080)
5. `cd web && npm install && npm run dev` — Start frontend (port 5173)

## Environment Variables

- `MONGODB_URI` — MongoDB connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret key for JWT signing (min 32 chars)
- `PORT` — API server port (default 8080)
- `CORS_ORIGINS` — Comma-separated allowed origins
- `ENVIRONMENT` — Runtime environment (development/staging/production)

## Conventions

- Go packages: lowercase, single word (`handlers`, `services`, `models`)
- API endpoints prefixed with `/api/v1`
- MongoDB documents use snake_case field names
- All write operations create audit log entries
- Flag keys: lowercase, hyphens, slug format (`dark-mode`, not `darkMode`)
- Error format: `{"error": {"code": "...", "message": "...", "details": [...]}}`
- Paginated responses: `{"data": [...], "pagination": {"page", "per_page", "total", "total_pages"}}`

## Architecture

- `api/cmd/server/` — Entry point, Fiber app bootstrap
- `api/internal/handlers/` — HTTP route handlers
- `api/internal/services/` — Business logic (evaluator, targeting, cache)
- `api/internal/models/` — MongoDB document schemas
- `api/internal/middleware/` — Auth, rate limiting, request ID
- `web/src/routes/` — SvelteKit pages (file-based routing)
- `web/src/lib/components/` — Reusable Svelte components
```

---

## README.md

Workers MUST create a `README.md` covering:

1. **Title and tagline** — "FlagDeck — Open-Source Feature Flags & Experimentation"
2. **"Built by WorkerMill" badge** — Link to workermill.com
3. **Live demo links** — Dashboard URL, API health check, evaluation endpoint
4. **Demo credentials** — Email, password, SDK API key for testing
5. **Features list** — Feature flags, targeting rules, percentage rollouts, A/B experiments, audit log
6. **Quick start** — Clone, docker compose, seed, run
7. **API endpoint summary** — All endpoints with method, auth, description
8. **Evaluation engine** — Brief explanation of how flag evaluation works
9. **Architecture** — Text diagram: Railway → Go/Fiber → MongoDB Atlas + Upstash Redis
10. **Tech stack table** — Same as this PRD
11. **Testing** — How to run tests locally
12. **Deployment** — How Railway deployment works

---

## Acceptance Criteria (Final State)

### Flag Evaluation Engine
- [ ] `POST /evaluate` returns correct value based on targeting rules
- [ ] AND logic: all conditions must match within a rule
- [ ] OR logic: any condition must match within a rule
- [ ] Rules evaluated in priority order, first match wins
- [ ] All 11 operators work correctly (eq, neq, contains, not_contains, in, not_in, gt, lt, gte, lte, regex)
- [ ] Percentage rollout is deterministic (FNV-1a of flagKey + ":" + userID)
- [ ] Rollout is statistically independent across flags
- [ ] Rollout distribution is uniform (10K users at 50% → ~5000 ± 2%)
- [ ] Disabled flags return default value
- [ ] Missing context attributes don't crash evaluation
- [ ] Bulk evaluation works for multiple flags in one request
- [ ] Evaluation latency < 10ms with Redis cache hit

### Caching
- [ ] Redis cache hit serves flag config without MongoDB query
- [ ] Cache miss fetches from MongoDB and populates cache with 30s TTL
- [ ] Flag update invalidates the cache key
- [ ] Redis failure degrades gracefully — evaluation still works via MongoDB
- [ ] No request fails because of cache unavailability

### API Functionality
- [ ] Health check returns MongoDB and Redis status
- [ ] User registration, login, token refresh work
- [ ] JWT auth and API key auth both work
- [ ] Role-based access: admin > editor > viewer
- [ ] Flag CRUD with per-environment configuration
- [ ] Flag toggle (enable/disable per environment)
- [ ] Segment CRUD with reusable targeting rules
- [ ] Experiment CRUD with variant weights summing to 100
- [ ] Experiment start/stop lifecycle
- [ ] Conversion tracking with atomic counter updates
- [ ] Chi-squared significance calculation with minimum sample guard
- [ ] Environment CRUD with cascade protection
- [ ] API key create (returns raw key once) and revoke
- [ ] Audit log records every write operation with changes diff
- [ ] Audit log query with filters (resource type, action, date range, actor)

### Dashboard (SvelteKit)
- [ ] Login page with JWT authentication
- [ ] Flag list with search, tag filter, environment toggle
- [ ] Flag create form (`/flags/new`) with type selector, default value, tags
- [ ] Flag detail (`/flags/[id]`) with targeting rule builder UI
- [ ] Visual rollout percentage slider
- [ ] Environment switcher (tabs or dropdown)
- [ ] Segment list and segment create form (`/segments/new`) with rule builder
- [ ] Segment detail (`/segments/[id]`) with edit capability
- [ ] Experiment list with status badges
- [ ] Experiment create form (`/experiments/new`) with variant configuration
- [ ] Experiment detail (`/experiments/[id]`) with results chart and confidence indicator
- [ ] Audit log timeline view
- [ ] API key management page
- [ ] All CRUD routes have corresponding SvelteKit pages (list, create/new, detail/edit)
- [ ] Responsive layout (desktop + tablet)

### Production Hardening
- [ ] Rate limiting on all endpoints with appropriate limits
- [ ] Rate limit headers on every response
- [ ] 429 responses include Retry-After header
- [ ] All errors follow standard format
- [ ] CORS configured for frontend origin
- [ ] X-Request-Id on all responses
- [ ] Structured logging with slog

### Seed Data
- [ ] Demo user authenticates with `demo@workermill.com` / `demo1234`
- [ ] SDK API keys work for flag evaluation
- [ ] 10 feature flags with varied targeting rules
- [ ] 3 segments with reusable rules
- [ ] 2 experiments (1 running with data, 1 draft)
- [ ] 30 audit log entries
- [ ] Seed is idempotent

### Testing (Go Backend)
- [ ] All Go tests pass with `-race` flag
- [ ] Evaluation determinism test (1,000 iterations, same result)
- [ ] Rollout uniformity test (10K users, 50% ± 2%)
- [ ] Rollout independence test (chi-squared across flags)
- [ ] All 11 operators tested with edge cases
- [ ] Cache hit/miss/invalidation/failure tested
- [ ] Auth lifecycle tested (register → login → access → refresh)
- [ ] Role enforcement tested (viewer, editor, admin)

### Testing (SvelteKit Frontend)
- [ ] All frontend tests use `@testing-library/svelte` `render()` with real `.svelte` components (no raw HTML stubs)
- [ ] Flag list page test — renders table, search input works, pagination controls visible
- [ ] Flag detail page test — environment tabs render, rule display shows conditions
- [ ] Segment list page test — renders segment table with rule count
- [ ] Experiment list page test — status badges display correctly
- [ ] Login page test — form validation, error display on failed login
- [ ] Shared component tests — EmptyState, FlagToggle, RolloutSlider render correctly
- [ ] `npm run test` passes with 0 failures

### Quality
- [ ] `cd api && go vet ./...` — 0 errors
- [ ] `gofmt -d ./api/` — no output (fully formatted)
- [ ] Go build succeeds: `go build -o /dev/null ./cmd/server`
- [ ] Docker image builds, size < 20 MB (scratch-based Go binary)
- [ ] Frontend `npm run check` — 0 errors
- [ ] Frontend `npm run build` — succeeds

### Deployment
- [ ] Railway API deployment succeeds
- [ ] Railway frontend deployment succeeds
- [ ] `https://flagdeck.workermill.com/api/v1/health` returns 200
- [ ] CI workflow runs on push/PR (lint, test, build for both API and frontend)
- [ ] Deploy workflow triggers on CI success

### Cost
- [ ] Railway: ~$5-10/month (Hobby plan, two services)
- [ ] MongoDB Atlas: $0/month (M0 free tier)
- [ ] Upstash Redis: $0/month (free tier)
- [ ] Total: ~$5-10/month

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **MongoDB Atlas M0 limitations** | 512 MB storage, 100 connections, no change streams | Sufficient for showcase — 10 flags + audit logs is < 1 MB. Use polling for dashboard refresh, not change streams. |
| **Upstash free tier limit (10K commands/day)** | Evaluation endpoint could exhaust daily limit under load | Acceptable for showcase traffic. Upgrade to paid ($10/mo for 10K commands/day → pay-as-you-go) if needed. |
| **Go module version drift** | Workers generate code for wrong Go version or dependency version | Pin exact versions in `go.mod`. Use `go 1.22` directive. |
| **SvelteKit 2 vs Svelte 5 confusion** | Workers mix SvelteKit 1 patterns (no runes) with SvelteKit 2 | PRD explicitly pins SvelteKit 2.x + Svelte 5 with runes. Workers should use `$state()`, `$derived()`, `$effect()`. |
| **Hashing library compatibility** | Third-party hash libs may use unsafe pointers that crash under `-race` | Use Go stdlib `hash/fnv` (FNV-1a 32-bit). Do NOT use `spaolacci/murmur3` — it crashes with Go's `-race` detector due to unsafe pointer arithmetic (`checkptr` violation). |
| **Cross-story file conflicts** | Two workers edit same file | File cap enforced by planner. Max 5-8 files per story, no overlaps. |
| **CI broken = deploy blocked** | Demo stays on last working version | `deploy.yml` uses `workflow_run` with `if: conclusion == 'success'`. Fix CI immediately. |
| **MongoDB connection string in Atlas** | Workers might hardcode or expose credentials | Connection string is in Railway env vars only. Workers read `MONGODB_URI` from environment. |
| **Scratch Docker image missing TLS certs** | Cannot connect to Atlas or Upstash over TLS | Copy `/etc/ssl/certs/ca-certificates.crt` from builder stage (documented in Dockerfile). |
| **GitHub Actions billing on private repos** | CI never runs, all deployments blocked, workers proceed blindly | Use a **public** repository. Public repos get unlimited free Actions minutes. Verify CI runs on the very first push before starting any feature work. |

---

## Worker Execution Notes

### What Workers CAN Do

| Action | How |
|--------|-----|
| Push code to GitHub repo | GitHub PAT (already configured) |
| Create GitHub Actions workflows | Write `.yml` files, push to repo |
| Deploy to Railway | `railway up` via GitHub Actions with `RAILWAY_TOKEN` |
| Read CI failure logs | GitHub Actions API |
| Verify deployment | `curl` against live URL |

### What Workers CANNOT Do (Already Provisioned)

All infrastructure is provisioned. Workers MUST NOT attempt to create or modify these resources.

| Action | Status | Details |
|--------|--------|---------|
| Create Railway account/project/services | **Done** | Project `FlagDeck`, services `flagdeck-api` + `flagdeck-web` |
| Create MongoDB Atlas cluster | **Done** | M0 free tier, cluster `flagdeck`, region us-east-1 |
| Create Upstash Redis instance | **Done** | Free tier, `credible-falcon-44150`, region us-east-1 |
| Create GitHub repo | **Done** | `workermill-examples/flagdeck` (public) |
| Set Railway environment variables | **Done** | 6 vars on `flagdeck-api` (MONGODB_URI, REDIS_URL, JWT_SECRET, PORT, ENVIRONMENT, CORS_ORIGINS) |
| Set GitHub repo secrets | **Done** | `RAILWAY_TOKEN` configured |
| Add DNS CNAME records | **Done** | `flagdeck.workermill.com` + `flagdeck-app.workermill.com` via Route53 |
| Register custom domains in Railway | **Done** | Both services have custom domains with auto-TLS |

### CI/CD Iteration Pattern (MANDATORY)

```
BEFORE git push:
  Go files changed:
    1. cd api && gofmt -w .                        ← Auto-fix formatting
    2. cd api && go vet ./...                      ← Static analysis
    3. cd api && go test ./... -v -count=1 -race   ← Tests (with race detector — MUST match CI)
    4. cd api && go build -o /dev/null ./cmd/server ← Build

  Frontend files changed:
    1. cd web && npm run lint                  ← Lint
    2. cd web && npm run format                ← Format
    3. cd web && npm run check                 ← Type check
    4. cd web && npm run build                 ← Build

  If ANY step fails, fix and restart.
  Only push when ALL steps pass.

AFTER git push:
  → GitHub Actions triggers CI
  → Worker MUST wait for CI to complete
  → If ANY step fails: read failure, fix, re-run quality gate, push
  → When CI passes: Deploy auto-triggers
  → Worker verifies: curl -f https://flagdeck.workermill.com/api/v1/health
  → If health fails: investigate, fix, push again
```

**CRITICAL:** Workers MUST NOT move on to the next task until CI is green.

### Cross-Card Compilation Rule (MANDATORY)

Each card inherits ALL code from previous cards. When Card N pushes code, it MUST compile cleanly with all code already in the repo from Cards 1 through N-1.

**Concrete rules:**

1. **Pull before you start:** `git pull origin main` before writing any code. Your card depends on prior cards' code being present.
2. **Run the FULL quality gate, not just your files:** `go build ./cmd/server` and `go test ./...` check ALL Go code in the repo — not just the files you touched. If your code breaks a function signature that Card N-1 created, you must fix the incompatibility.
3. **Do not re-define types that already exist:** If `models/flag.go` was created by a previous card, do NOT create a conflicting `Flag` type. Import and use the existing one.
4. **Do not change function signatures created by other cards** unless your card explicitly says to refactor them. If you need a new parameter, add it with a default or create a new function.
5. **If tests from previous cards fail after your changes**, fix them. You own the full test suite, not just your new tests.

> This is the #3 failure mode — Card 4 introduces handlers that reference services from Card 3, but with wrong parameter types or missing imports, causing `go build` to fail.
