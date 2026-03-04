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

// Sanitized PRD — connection strings, project IDs, and secret references removed
export const flagDeckPrd = `# FlagDeck — Full Build Specification

## Purpose

This is a **showcase build** — a polished demo app designed to impress potential customers visiting \`flagdeck.workermill.com\`. The app must look and feel like a real product with realistic data, not a skeleton with placeholder content. When a visitor logs in with the demo credentials, they should see a populated dashboard with real-looking flags, active experiments, and a believable audit trail. Every page should have data. Empty states are failure.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Go + Fiber | Go 1.24, Fiber v2 |
| Database | MongoDB Atlas | M0 free tier |
| Cache | Upstash Redis | Free tier |
| Frontend | SvelteKit + TailwindCSS | SvelteKit 2, adapter-static, Tailwind v4 |
| Auth | JWT (access + refresh) | bcrypt for passwords |
| Deploy | Railway | Dockerfile-based |

## Global Constraints

### LLM Knowledge Gaps — DO NOT "FIX" These

Your training data may not include these — they are ALL correct and valid:

- **Go 1.24** was released February 2025. \`golang:1.24-alpine\` exists on Docker Hub. Do NOT downgrade to 1.23 or 1.22.
- **Svelte 5** with runes syntax (\`$state\`, \`$derived\`, \`$effect\`) is stable. Do NOT fall back to Svelte 4 \`$:\` syntax.
- **Tailwind v4** uses \`@tailwindcss/vite\` plugin. Do NOT use Tailwind v3 config patterns.
- **SvelteKit 2** with \`adapter-static\` is stable. Do NOT downgrade to SvelteKit 1.

If you believe a dependency version "doesn't exist", you are wrong. Trust the PRD.

### Pre-Commit Quality Gates

\`\`\`
# Backend gate (trigger: api/**)
cd api && go vet ./...
cd api && go test ./... -v -count=1 -race
cd api && go build -o /dev/null ./cmd/server
cd api && gofmt -w .

# Frontend gate (trigger: web/**)
cd web && npm run lint
cd web && npm run build
\`\`\`

Do NOT use \`golangci-lint\`, \`staticcheck\`, or any third-party linters. Do NOT use \`gofmt ./...\` (unsupported syntax).

### Code Style Rules

- Go: \`gofmt\`, no naked returns, wrap errors with \`fmt.Errorf("context: %w", err)\`
- Frontend: Svelte 5 runes (\`$state\`, \`$derived\`, \`$effect\`) — NOT legacy \`$:\` reactive syntax
- All API responses use \`snake_case\` field names — NEVER \`camelCase\`
- TypeScript strict mode, no \`any\` types
- Tailwind v4 with \`@tailwindcss/vite\` plugin — do NOT use \`@apply\` in Svelte \`<style>\` blocks (broken in v4). Use inline utility classes only.
- Import Go standard library first, then third-party, then internal packages (separated by blank lines)
- No import cycles — if package A imports B, B must NOT import A

### adapter-static Constraint

SvelteKit uses \`adapter-static\`. Dynamic routes (\`[id]\`, \`[key]\`) CANNOT use \`+page.server.ts\` load functions (they run at build time). Use client-side fetching in \`+page.svelte\` via \`$effect\` or use \`+page.ts\` with \`export const ssr = false\`.

---

## Data Models

### Flag

\`\`\`go
type Flag struct {
    ID           primitive.ObjectID        \`bson:"_id,omitempty" json:"id"\`
    Key          string                    \`bson:"key" json:"key"\`
    Name         string                    \`bson:"name" json:"name"\`
    Description  string                    \`bson:"description" json:"description"\`
    Type         string                    \`bson:"type" json:"type"\`           // "boolean", "string", "number", "json"
    DefaultValue interface{}               \`bson:"default_value" json:"default_value"\`
    IsActive     bool                      \`bson:"is_active" json:"is_active"\` // global kill switch
    Tags         []string                  \`bson:"tags" json:"tags"\`
    Environments map[string]FlagEnvironment \`bson:"environments" json:"environments"\` // key = env key, NOT array
    CreatedBy    string                    \`bson:"created_by" json:"created_by"\`
    UpdatedBy    string                    \`bson:"updated_by" json:"updated_by"\`
    CreatedAt    time.Time                 \`bson:"created_at" json:"created_at"\`
    UpdatedAt    time.Time                 \`bson:"updated_at" json:"updated_at"\`
}

type FlagEnvironment struct {
    Enabled        bool            \`bson:"enabled" json:"enabled"\`          // per-environment toggle
    Value          interface{}     \`bson:"value" json:"value"\`
    RolloutPercent float64         \`bson:"rollout_percent" json:"rollout_percent"\` // 0-100
    TargetingRules []TargetingRule \`bson:"targeting_rules" json:"targeting_rules"\`
}

type TargetingRule struct {
    ID         string      \`bson:"id" json:"id"\`
    Priority   int         \`bson:"priority" json:"priority"\`
    Conditions []Condition \`bson:"conditions" json:"conditions"\` // AND logic within a rule
    Value      interface{} \`bson:"value" json:"value"\`
}

type Condition struct {
    Property string      \`bson:"property" json:"property"\` // e.g. "country", "plan"
    Operator string      \`bson:"operator" json:"operator"\` // "equals", "not_equals", "contains", "in", "not_in", "gt", "lt", "gte", "lte", "regex"
    Value    interface{} \`bson:"value" json:"value"\`
}
\`\`\`

**Critical:** \`environments\` is an OBJECT MAP keyed by environment key (e.g., \`{"production": {...}, "staging": {...}}\`), NOT an array.

**Toggle semantics:**
- \`is_active: false\` = global kill switch, flag returns \`default_value\` regardless of environment
- \`environments["production"].enabled: false\` = disabled in production only
- \`POST /api/v1/flags/:key/toggle\` with body \`{"environment": "production"}\` toggles \`environments.production.enabled\`
- \`POST /api/v1/flags/:key/toggle\` with NO body toggles \`is_active\` (global kill switch)

### Environment

\`\`\`go
type Environment struct {
    ID          primitive.ObjectID \`bson:"_id,omitempty" json:"id"\`
    Key         string             \`bson:"key" json:"key"\`
    Name        string             \`bson:"name" json:"name"\`
    Description string             \`bson:"description" json:"description"\`
    Color       string             \`bson:"color" json:"color"\`       // hex color
    SortOrder   int                \`bson:"sort_order" json:"sort_order"\`
    IsActive    bool               \`bson:"is_active" json:"is_active"\`
    CreatedBy   string             \`bson:"created_by" json:"created_by"\`
    CreatedAt   time.Time          \`bson:"created_at" json:"created_at"\`
    UpdatedAt   time.Time          \`bson:"updated_at" json:"updated_at"\`
}
\`\`\`

### Segment

\`\`\`go
type Segment struct {
    ID          primitive.ObjectID \`bson:"_id,omitempty" json:"id"\`
    Key         string             \`bson:"key" json:"key"\`
    Name        string             \`bson:"name" json:"name"\`
    Description string             \`bson:"description" json:"description"\`
    Rules       []SegmentRule      \`bson:"rules" json:"rules"\` // OR logic between rules
    CreatedBy   string             \`bson:"created_by" json:"created_by"\`
    UpdatedBy   string             \`bson:"updated_by" json:"updated_by"\`
    CreatedAt   time.Time          \`bson:"created_at" json:"created_at"\`
    UpdatedAt   time.Time          \`bson:"updated_at" json:"updated_at"\`
}

type SegmentRule struct {
    Conditions []Condition \`bson:"conditions" json:"conditions"\` // AND within rule, OR between rules
}
\`\`\`

### Experiment

\`\`\`go
type Experiment struct {
    ID          primitive.ObjectID  \`bson:"_id,omitempty" json:"id"\`
    Key         string              \`bson:"key" json:"key"\`
    Name        string              \`bson:"name" json:"name"\`
    Description string              \`bson:"description" json:"description"\`
    FlagKey     string              \`bson:"flag_key" json:"flag_key"\`
    Status      string              \`bson:"status" json:"status"\` // "draft", "running", "paused", "completed"
    Variants    []ExperimentVariant \`bson:"variants" json:"variants"\`
    StartDate   *time.Time          \`bson:"start_date" json:"start_date"\`
    EndDate     *time.Time          \`bson:"end_date" json:"end_date"\`
    CreatedBy   string              \`bson:"created_by" json:"created_by"\`
    CreatedAt   time.Time           \`bson:"created_at" json:"created_at"\`
    UpdatedAt   time.Time           \`bson:"updated_at" json:"updated_at"\`
}

type ExperimentVariant struct {
    Key         string          \`bson:"key" json:"key"\`
    Name        string          \`bson:"name" json:"name"\`
    Weight      float64         \`bson:"weight" json:"weight"\` // 0-100, all weights sum to 100
    Value       interface{}     \`bson:"value" json:"value"\`
    Results     *VariantResults \`bson:"results" json:"results"\`
}

type VariantResults struct {
    Impressions int     \`bson:"impressions" json:"impressions"\`
    Conversions int     \`bson:"conversions" json:"conversions"\`
    Revenue     float64 \`bson:"revenue" json:"revenue"\`
}
\`\`\`

**Experiments are SEPARATE from flag evaluation.** The evaluate endpoint does NOT check for running experiments. Variant assignment is client-side. The track endpoint records conversions.

### User

\`\`\`go
type User struct {
    ID        primitive.ObjectID \`bson:"_id,omitempty" json:"id"\`
    Email     string             \`bson:"email" json:"email"\`
    Password  string             \`bson:"password" json:"-"\`    // bcrypt hash, NEVER in API responses
    Name      string             \`bson:"name" json:"name"\`
    Role      string             \`bson:"role" json:"role"\`     // "admin", "editor", "viewer"
    CreatedAt time.Time          \`bson:"created_at" json:"created_at"\`
    UpdatedAt time.Time          \`bson:"updated_at" json:"updated_at"\`
}
\`\`\`

**Registration MUST NOT accept a \`role\` field.** All registrations default to \`viewer\`. Only the seed script creates \`admin\` users.

### API Key

\`\`\`go
type ApiKey struct {
    ID          primitive.ObjectID \`bson:"_id,omitempty" json:"id"\`
    Name        string             \`bson:"name" json:"name"\`
    KeyHash     string             \`bson:"key_hash" json:"-"\`              // bcrypt, never exposed
    KeyPrefix   string             \`bson:"key_prefix" json:"key_prefix"\`   // first 8 chars for display
    Environment string             \`bson:"environment" json:"environment"\`
    Permissions []string           \`bson:"permissions" json:"permissions"\` // ["evaluate", "read"]
    CreatedBy   string             \`bson:"created_by" json:"created_by"\`
    LastUsedAt  *time.Time         \`bson:"last_used_at" json:"last_used_at"\`
    CreatedAt   time.Time          \`bson:"created_at" json:"created_at"\`
}
\`\`\`

### Audit Log Entry

\`\`\`go
type AuditLogEntry struct {
    ID         primitive.ObjectID \`bson:"_id,omitempty" json:"id"\`
    Action     string             \`bson:"action" json:"action"\`       // "flag.created", "flag.updated", "flag.toggled", etc.
    Resource   string             \`bson:"resource" json:"resource"\`   // "flag", "environment", "segment", "experiment", "api_key"
    ResourceID string             \`bson:"resource_id" json:"resource_id"\`
    UserID     string             \`bson:"user_id" json:"user_id"\`
    UserEmail  string             \`bson:"user_email" json:"user_email"\`
    Changes    interface{}        \`bson:"changes" json:"changes"\`     // before/after diff
    Metadata   interface{}        \`bson:"metadata" json:"metadata"\`
    CreatedAt  time.Time          \`bson:"created_at" json:"created_at"\`
}
\`\`\`

**MongoDB collections:** \`flags\`, \`environments\`, \`segments\`, \`experiments\`, \`audit_log\`, \`users\`, \`api_keys\`

---

## API Endpoints

**Base path:** \`/api/v1\` for all data endpoints. Auth endpoints at \`/auth\`. Health at \`/health\`.

### Health

\`\`\`
GET /health → {"status":"ok","mongodb":"connected","redis":"connected"}
\`\`\`

Flat format. NOT nested \`{services: {mongodb: {status: "healthy"}}}\`. Returns 503 if either service is down.

### Auth

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | \`/auth/register\` | None | \`{"email","password","name"}\` | \`{"access_token","refresh_token","expires_in":900,"token_type":"Bearer"}\` |
| POST | \`/auth/login\` | None | \`{"email","password"}\` | Same as register |
| POST | \`/auth/refresh\` | None | \`{"refresh_token"}\` | Same as register |
| POST | \`/auth/logout\` | JWT | None | \`{"message":"Logged out"}\` |
| GET | \`/auth/me\` | JWT | — | User object (no password) |

- Registration does NOT accept \`role\` — defaults to \`viewer\`
- Registration auto-logs in (returns tokens)
- Logout is a no-op server-side (JWTs are stateless) — client clears localStorage
- Access token expires in 15 min, refresh token in 7 days
- Rate limit: 5 requests/min per IP on register/login

### Flags

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | \`/api/v1/flags\` | JWT | Returns \`{"data":[...flags],"total":N}\` |
| GET | \`/api/v1/flags/:key\` | JWT | Single flag by key |
| POST | \`/api/v1/flags\` | JWT | Required: \`key\`, \`name\`, \`type\`, \`default_value\` |
| PUT | \`/api/v1/flags/:key\` | JWT | Partial update — omitted fields NOT cleared |
| DELETE | \`/api/v1/flags/:key\` | JWT | Hard delete |
| POST | \`/api/v1/flags/:key/toggle\` | JWT | Body \`{"environment":"prod"}\` → per-env toggle. No body → global \`is_active\` toggle |

**List wrapper format:** ALL list endpoints return \`{"data": [...], "total": N}\`, NOT bare arrays.

### Evaluation

| Method | Path | Auth | Request | Response |
|--------|------|------|---------|----------|
| POST | \`/api/v1/evaluate\` | API Key | \`{"flag_key":"dark-mode","context":{"user_id":"u1","country":"US"}}\` | \`{"key","value","type","reason","rule_id","environment","evaluation_ms"}\` |
| POST | \`/api/v1/evaluate/bulk\` | API Key | \`{"flag_keys":["a","b"],"context":{...}}\` | \`{"evaluations":[...same shape as single...]}\` |

**Evaluation flow:**
1. If \`is_active\` is false → return \`default_value\` with reason \`"flag_disabled"\`
2. Look up environment config → if \`enabled\` is false → return \`default_value\` with reason \`"environment_disabled"\`
3. Check targeting rules (ordered by priority): for each rule, check ALL conditions (AND). First match → return rule's value
4. If rollout_percent < 100: hash \`flag_key + user_id\` with FNV-1a → \`hash % 100 < rollout_percent\` → return env value or default
5. Return environment value with reason \`"default"\`

### Segments

| Method | Path | Auth |
|--------|------|------|
| GET | \`/api/v1/segments\` | JWT |
| GET | \`/api/v1/segments/:key\` | JWT |
| POST | \`/api/v1/segments\` | JWT |
| PUT | \`/api/v1/segments/:key\` | JWT |
| DELETE | \`/api/v1/segments/:key\` | JWT |

### Experiments

| Method | Path | Auth |
|--------|------|------|
| GET | \`/api/v1/experiments\` | JWT |
| GET | \`/api/v1/experiments/:key\` | JWT |
| POST | \`/api/v1/experiments\` | JWT |
| PUT | \`/api/v1/experiments/:key\` | JWT |
| DELETE | \`/api/v1/experiments/:key\` | JWT |
| POST | \`/api/v1/experiments/:key/track\` | API Key |

Track request: \`{"variant_key":"variant_a","metric_key":"conversion","value":1,"context":{"user_id":"u1"}}\`
Track response: \`{"tracked": true}\`

### Environments, API Keys, Audit Log

| Method | Path | Auth |
|--------|------|------|
| GET | \`/api/v1/environments\` | JWT |
| POST | \`/api/v1/environments\` | JWT |
| PUT | \`/api/v1/environments/:key\` | JWT |
| DELETE | \`/api/v1/environments/:key\` | JWT |
| GET | \`/api/v1/api-keys\` | JWT |
| POST | \`/api/v1/api-keys\` | JWT |
| DELETE | \`/api/v1/api-keys/:id\` | JWT |
| GET | \`/api/v1/audit-log\` | JWT |

API key creation response includes \`raw_key\` field (unmasked, shown once only).
Audit log supports query params: \`?resource=flag&action=flag.created&limit=50&offset=0\`

### Error Format

\`\`\`json
{"error": {"code": "VALIDATION_ERROR", "message": "Key is required"}}
\`\`\`

Codes: \`VALIDATION_ERROR\`, \`NOT_FOUND\`, \`UNAUTHORIZED\`, \`FORBIDDEN\`, \`CONFLICT\`, \`RATE_LIMITED\`, \`INTERNAL_ERROR\`. Uppercase.

---

## Frontend

### Routes

| Path | Page | API Calls |
|------|------|-----------|
| \`/login\` | Login form | POST \`/auth/login\` |
| \`/\` | Dashboard | GET flags, environments, experiments, audit-log (aggregate stats) |
| \`/flags\` | Flag list | GET \`/api/v1/flags\` |
| \`/flags/[id]\` | Flag detail + targeting rules | GET \`/api/v1/flags/:key\`, PUT, toggle |
| \`/flags/create\` | Create flag form | POST \`/api/v1/flags\` |
| \`/environments\` | Environment list | GET/POST/PUT/DELETE \`/api/v1/environments\` |
| \`/segments\` | Segment list + detail | GET/POST/PUT/DELETE \`/api/v1/segments\` |
| \`/experiments\` | Experiment list + detail | GET/POST/PUT/DELETE \`/api/v1/experiments\` |
| \`/audit-log\` | Audit timeline | GET \`/api/v1/audit-log\` |
| \`/settings\` | API keys management | GET/POST/DELETE \`/api/v1/api-keys\` |

### Auth Flow

- Store \`access_token\` and \`refresh_token\` in \`localStorage\`
- Attach \`Authorization: Bearer <access_token>\` to all API requests
- On 401: attempt refresh with \`refresh_token\`. If refresh fails → redirect to \`/login\`
- Unauthenticated users see \`/login\` only. All other routes require auth.

### Key Components

- \`FlagToggle\` — per-environment toggle switch
- \`RolloutSlider\` — 0-100% slider for rollout percentage
- \`TargetingRuleBuilder\` — add/remove conditions (property, operator, value)
- \`ExperimentChart\` — bar chart showing variant impressions/conversions
- \`AuditTimeline\` — chronological list of changes with user, action, timestamp

### Dashboard Stats

\`\`\`typescript
const totalFlags = flags.length;
const activeFlags = flags.filter(f => f.is_active && Object.values(f.environments).some(e => e.enabled)).length;
const totalEnvironments = environments.length;
const totalExperiments = experiments.length;
const runningExperiments = experiments.filter(e => e.status === "running").length;
\`\`\`

---

## Seed Data (CRITICAL — This Makes or Breaks the Demo)

**Run on every deploy** via Dockerfile \`CMD\`: \`./seed && ./main\`. Use **upsert** (not insert-if-missing) so seed always updates to latest spec.

This is a showcase app. The seed data IS the demo. A visitor who logs in and sees empty pages will leave immediately. Every page must have data that looks like a real team has been using FlagDeck for weeks.

### Demo User
- \`demo@workermill.com\` (role: admin)

### 3 Environments
- \`production\` — color: \`#22c55e\` (green), sort_order: 0
- \`staging\` — color: \`#eab308\` (yellow), sort_order: 1
- \`development\` — color: \`#3b82f6\` (blue), sort_order: 2

### 2 API Keys
- "Production Backend" — environment: production, permissions: [evaluate, read]
- "Staging Backend" — environment: staging, permissions: [evaluate, read]

### 10+ Flags (realistic names, varied types, populated environments)
Use real product feature names, not "test-flag-1". Examples:
- \`dark-mode\` (boolean) — enabled in all envs, 100% rollout
- \`new-checkout-flow\` (boolean) — enabled in staging/dev, disabled in production, 30% rollout in staging
- \`ai-recommendations\` (boolean) — enabled in dev only, with targeting rule: plan equals "enterprise"
- \`holiday-banner\` (string, value: "Summer Sale 2026!") — enabled in production, with end date
- \`max-upload-size\` (number, value: 10) — different values per environment (10 in prod, 50 in staging, 100 in dev)
- \`search-algorithm\` (string, value: "v2") — with targeting: country in ["US","CA"] gets "v3"
- \`beta-features\` (boolean) — with targeting rule: segment equals "beta-users", 50% rollout
- \`payment-provider\` (string, value: "stripe") — production: "stripe", staging: "mock"
- \`onboarding-flow\` (json) — complex value with steps configuration
- \`rate-limit-tier\` (number) — with targeting: plan equals "enterprise" gets 1000, default 100

Each flag MUST have \`environments\` populated for ALL 3 environments with varying \`enabled\`, \`value\`, and \`rollout_percent\` settings. Some flags should have 2-3 targeting rules with realistic conditions.

### 3 Segments
- \`beta-users\` — rules: [email contains "@beta", OR plan equals "pro"]
- \`enterprise-customers\` — rules: [plan equals "enterprise", AND employee_count gt 100]
- \`us-users\` — rules: [country in ["US", "CA", "MX"]]

### 2 Experiments (with realistic result data)
- \`checkout-redesign\` (status: running, flag: \`new-checkout-flow\`)
  - Variant A "Current Checkout": weight 50, results: {impressions: 4521, conversions: 312, revenue: 15600.00}
  - Variant B "New Checkout": weight 50, results: {impressions: 4487, conversions: 389, revenue: 19450.00}
- \`search-algorithm-test\` (status: completed, flag: \`search-algorithm\`)
  - Variant A "V2 Search": weight 50, results: {impressions: 10200, conversions: 1836, revenue: 0}
  - Variant B "V3 Search": weight 50, results: {impressions: 10150, conversions: 2132, revenue: 0}

### 50+ Audit Log Entries (tells a story)
Generate a realistic timeline over the past 2 weeks. Include:
- Environment creation (oldest entries)
- Flag creation events spread across several days
- Flag toggle events (someone enabling/disabling flags in different environments)
- Targeting rule changes (adding/modifying rules)
- Experiment creation and status changes
- API key creation
- Mix of user actions (mostly demo@workermill.com but varied actions)
- Timestamps should be spread across business hours over 14 days, NOT all at the same time

---

## Configuration Files

### \`api/Dockerfile\`

\`\`\`dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /main ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o /seed ./cmd/seed

FROM alpine:3.21
RUN apk --no-cache add ca-certificates
COPY --from=builder /main /main
COPY --from=builder /seed /seed
CMD ["/bin/sh", "-c", "./seed && ./main"]
\`\`\`

### \`web/Dockerfile\`

\`\`\`dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_API_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
\`\`\`

### \`web/nginx.conf\`

\`\`\`nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
\`\`\`

### Railway Deployment

Railway deploys from the \`main\` branch automatically on push. The project has **two services**:

| Railway Service | Root Directory | Dockerfile | Port | Domain |
|----------------|---------------|------------|------|--------|
| \`api\` | \`/api\` | \`api/Dockerfile\` | 8080 | \`flagdeck.workermill.com\` |
| \`web\` | \`/web\` | \`web/Dockerfile\` | 80 | \`flagdeck-app.workermill.com\` |

**Workers do NOT need to configure Railway.** Railway services and env vars are pre-configured in the dashboard. Workers just push code to \`main\` — Railway detects the Dockerfiles and deploys automatically.

**Do NOT** create \`railway.json\`, \`railway.toml\`, \`Procfile\`, or \`nixpacks.toml\` — Railway uses the Dockerfiles directly.

### \`docker-compose.yml\` (full local stack)

This is the **primary development and testing environment**. It runs the entire app locally — no cloud dependencies needed during development.

\`\`\`yaml
services:
  mongodb:
    image: mongo:7
    ports: ["27017:27017"]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.runCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build: ./api
    ports: ["8080:8080"]
    environment:
      - PORT=8080
      - MONGODB_URI=mongodb://mongodb:27017/flagdeck
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=\${JWT_SECRET}
    depends_on:
      mongodb: { condition: service_healthy }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 5s
      timeout: 5s
      retries: 10

  web:
    build:
      context: ./web
      args:
        PUBLIC_API_URL: http://localhost:8080
    ports: ["3000:80"]
    depends_on:
      api: { condition: service_healthy }
\`\`\`

**Usage:**
- \`docker compose up -d --wait\` — starts everything, waits for health checks
- \`docker compose down\` — stops everything

### CI Workflow (\`.github/workflows/ci.yml\`)

Single job using docker-compose — same environment as local dev. No separate service containers, no startup race conditions.

\`\`\`yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start stack
        run: docker compose up -d --wait

      - name: Go quality gates
        run: |
          cd api && go vet ./...
          MONGODB_URI=mongodb://localhost:27017/flagdeck_test REDIS_URL=redis://localhost:6379 go test ./... -v -count=1 -race
          go build -o /dev/null ./cmd/server
          gofmt -l . | grep . && exit 1 || true

      - name: Web quality gates
        run: cd web && npm ci && npm run lint && npm run build

      - name: E2E tests
        run: |
          cd web
          npx playwright install --with-deps chromium
          BASE_URL=http://localhost:3000 API_URL=http://localhost:8080 npx playwright test

      - name: Stop stack
        if: always()
        run: docker compose down
\`\`\`

### E2E Tests

Playwright tests run against the local docker-compose stack. Test file structure:

\`\`\`
web/e2e/
  login.spec.ts       — login with demo credentials, verify redirect to dashboard
  dashboard.spec.ts   — verify stats cards show seeded data, not zeros
  flags.spec.ts       — list flags, create flag, toggle flag, edit targeting rules
  experiments.spec.ts — list experiments, view results chart
  audit-log.spec.ts   — verify timeline shows seeded entries
\`\`\`

Each test authenticates first via the login page, then tests the feature. Tests verify REAL data from seed (not mocked).

---

## Acceptance Criteria

### Local (docker-compose — verified BEFORE deploying)
- [ ] \`docker compose up -d --wait\` starts all services without errors
- [ ] \`GET http://localhost:8080/health\` returns \`{"status":"ok","mongodb":"connected","redis":"connected"}\`
- [ ] Login with demo credentials returns JWT tokens
- [ ] \`GET /api/v1/flags\` returns 10+ seeded flags in \`{"data":[...],"total":N}\` format
- [ ] Flag toggle works (per-environment and global)
- [ ] Evaluation endpoint returns correct values based on targeting rules
- [ ] Dashboard shows non-zero stats (activeFlags > 0, runningExperiments > 0)
- [ ] All CRUD operations work for flags, environments, segments, experiments, API keys
- [ ] Audit log shows 50+ seeded entries spread across 14 days
- [ ] All E2E tests pass against docker-compose stack
- [ ] \`go test ./... -race\` passes against local MongoDB
- [ ] \`npm run lint && npm run build\` passes for web

### Production (Railway — verified AFTER deploying)
- [ ] API responds at \`https://flagdeck.workermill.com/health\`
- [ ] Web loads at \`https://flagdeck-app.workermill.com\`
- [ ] Login with demo credentials works on production
- [ ] Seeded data visible in production dashboard

## Anti-Patterns (Do NOT)

- Do NOT return bare arrays from list endpoints — always \`{"data":[...],"total":N}\`
- Do NOT use \`:id\` for routes that take a key — use \`:key\` for flags, segments, experiments, environments
- Do NOT accept \`role\` in registration — security vulnerability
- Do NOT use \`@apply\` in Svelte \`<style>\` blocks with Tailwind v4
- Do NOT use \`+page.server.ts\` for dynamic routes with adapter-static
- Do NOT use nested health format — flat \`{"status":"ok","mongodb":"connected"}\`
- Do NOT use camelCase in API responses — everything is \`snake_case\`
- Do NOT hardcode localhost URLs — use \`PUBLIC_API_URL\` env var for frontend
- Do NOT skip seed upsert — seed must run on every deploy and update existing data
`;

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
