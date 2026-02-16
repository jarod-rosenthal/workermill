# Thin Worker: Decision Service API Design

**Date:** 2026-02-15
**Goal:** Move orchestration intelligence from worker container to API server-side, enabling the worker ECR image to be made public without exposing competitive IP.
**Approach:** API-driven decisions — worker sends raw context, API returns decisions.

---

## Problem

The worker Docker image contains significant IP:

- Error classification taxonomy & fixability rules (Epic)
- Blocker escalation & auto-retry logic (Epic)
- Quality gate evaluation (Epic + Multi-Expert)
- 3-tier expert routing algorithm (Epic)
- Review decision parsing & revision loop control (Epic + Multi-Expert + Manager)
- Provider-to-model routing & inference (Multi-Expert + Agents)
- 17 persona directive prompts + AGENTS.md
- Structured output schemas, CLAUDE.md templates, review rubrics

Currently the ECR repo is private, requiring every remote agent user to have AWS credentials with ECR read access. This is a significant adoption barrier.

## Design Principles

1. **No low-confidence changes** — lift-and-shift existing logic, don't rewrite
2. **Resilient by default** — 5 retries + safe fallbacks + circuit breaker on every decision call
3. **Backwards compatible** — old workers still work, new API endpoints are additive
4. **Zero secrets in image** — already true, this change protects logic/prompts

---

## API Endpoints

Six new endpoints under `/api/worker-decisions/`, authenticated via `x-api-key` (same as all worker-to-API calls).

### 1. `POST /api/worker-decisions/classify-error`

Replaces: `error-classifier.ts`, `blocker-manager.ts` (Epic)

```
Request:
{
  taskId: string,
  storyIndex: number,
  errorText: string,
  retryCount: number,
  maxAutoRetries: number,
  storyContext: {
    title: string,
    persona: string,
    targetFiles: string[]
  }
}

Response:
{
  category: "typescript" | "lint" | "test" | "build" | "auth" | "network" | "resource" | "unknown",
  fixable: boolean,
  action: "auto_retry" | "escalate" | "skip",
  affectedFiles: string[],
  summary: string,
  fixStrategy: string | null
}
```

### 2. `POST /api/worker-decisions/evaluate-quality`

Replaces: `quality-gate.ts` (Epic + Multi-Expert)

```
Request:
{
  taskId: string,
  orgId: string,
  metrics: {
    qualityScore?: number,
    testCoveragePercent?: number,
    securityVulnsHigh?: number,
    typeErrors?: boolean,
    testFailures?: boolean
  },
  bypassRequested: boolean
}

Response:
{
  pass: boolean,
  reasons: string[],
  blockers: string[]
}
```

### 3. `POST /api/worker-decisions/review-outcome`

Replaces: review decision parsing in `coordinator.ts`, `inline-reviewer.ts`, `manager/reviewer.ts`

```
Request:
{
  taskId: string,
  reviewerOutput: string,
  revisionCount: number,
  maxRevisions: number,
  perStoryRevisionCount: number,
  maxPerStoryRevisions: number
}

Response:
{
  decision: "approved" | "revision_needed" | "rejected",
  score: number | null,
  feedback: string | null,
  shouldRevise: boolean,
  revisionExhausted: boolean,
  reason: string
}
```

### 4. `POST /api/worker-decisions/route-question`

Replaces: 3-tier routing algorithm in `coordinator.ts` (Epic)

```
Request:
{
  taskId: string,
  questionText: string,
  targetPersona?: string,
  idleExperts: string[],
  allExperts: string[]
}

Response:
{
  targetExpert: string | null,
  routingTier: 1 | 2 | 3,
  reason: string
}
```

### 5. `POST /api/worker-decisions/route-provider`

Replaces: model-to-provider inference in `ai-sdk-executor.js`, `multi-expert/index.ts`

```
Request:
{
  taskId: string,
  persona: string,
  modelName?: string,
  providerRouting?: string,
  availableProviders: string[]
}

Response:
{
  provider: "anthropic" | "openai" | "google" | "ollama",
  model: string,
  inferenceSource: "explicit" | "routing" | "model_name" | "default"
}
```

### 6. `GET /api/worker-decisions/worker-config`

Replaces: `AGENTS.md`, hardcoded icon maps, CLAUDE.md template, review schema

```
Response:
{
  agentsMd: string,
  personaIcons: Record<string, string>,
  providerIcons: Record<string, string>,
  reviewSchema: object,
  claudeMdTemplate: string,
  defaults: {
    blockerMaxAutoRetries: number,
    maxReviewRevisions: number,
    maxPerStoryRevisions: number
  }
}
```

### Existing endpoint (no changes needed)

`GET /api/personas/worker/:persona/bundle` — already serves org-customized directives. Worker stops shipping `/app/directives/` and relies entirely on this endpoint.

---

## Retry & Fallback Strategy

### Layer 1: Aggressive retry with backoff

All decision API calls use a dedicated retry wrapper:

```
maxRetries: 5
initialDelayMs: 500
maxDelayMs: 15000
backoffMultiplier: 2        (500 -> 1000 -> 2000 -> 4000 -> 8000)
jitter: 30%
retryableStatuses: [502, 503, 504, 408, 429]
retryableErrors: [ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET, EAI_AGAIN]
totalTimeout: 60000         (60s absolute ceiling per call)
```

### Layer 2: Safe local fallbacks

If all 5 retries fail, the worker falls back to conservative safe defaults. These are intentionally simple — survival mode, not competitive logic:

| Endpoint | Fallback |
|----------|----------|
| `classify-error` | `{ category: "unknown", fixable: false, action: "escalate" }` — always escalate to human |
| `evaluate-quality` | `{ pass: true, reasons: ["decision API unavailable - skipping gate"] }` — don't block PR |
| `review-outcome` | `{ decision: "approved", shouldRevise: false, reason: "decision API unavailable - auto-approving" }` |
| `route-question` | First idle expert (round-robin), no specialty matching |
| `route-provider` | Use model name as-is with "anthropic" default provider |
| `worker-config` | Minimal hardcoded AGENTS.md stub + default icons |

### Layer 3: Startup health check

```
1. GET /api/worker-decisions/health
2. If healthy -> proceed normally
3. If unhealthy -> retry every 5s for up to 2 minutes
4. If still unhealthy after 2 min -> log warning, proceed with fallbacks
```

### Call-level timeouts

| Call | Connect | Read | Why |
|------|---------|------|-----|
| `classify-error` | 5s | 10s | Parses error text |
| `evaluate-quality` | 5s | 5s | Simple threshold check |
| `review-outcome` | 5s | 10s | Parses reviewer output |
| `route-question` | 5s | 5s | Simple routing lookup |
| `route-provider` | 5s | 5s | Simple routing lookup |
| `worker-config` | 5s | 15s | Larger payload (AGENTS.md) |
| `health` | 3s | 3s | Quick ping |

### Circuit breaker

```
CLOSED    -> Normal: all calls go to API
OPEN      -> 3 consecutive failures within 60s -> all calls use fallbacks for 30s
HALF_OPEN -> After 30s, try one real call
              -> Success -> CLOSED
              -> Failure -> OPEN for another 30s
```

Every retry, fallback trigger, and circuit breaker state change is logged via `postLog()`.

---

## What Gets Removed from Worker Image

### Files removed entirely

| File | Lines | Replacement |
|------|-------|-------------|
| `worker/epic/error-classifier.ts` | ~409 | API: `classify-error` |
| `worker/epic/blocker-manager.ts` | ~367 | API: `classify-error` (summary, action) + thin escalation poster in coordinator |
| `worker/epic/quality-gate.ts` | ~284 | API: `evaluate-quality` |
| `worker/directives/` (all 17 dirs) | all | API: existing persona bundle endpoint |
| `worker/AGENTS.md` | 1,251 | API: `worker-config` |

### Files thinned (logic extracted, shell remains)

| File | What stays | What moves to API |
|------|-----------|-------------------|
| `worker/epic/coordinator.ts` | Story execution loop, git ops, Claude CLI spawning, log posting, coordination feed calls | 3-tier routing (~100 lines), review decision parsing (~60 lines), revision loop control (~40 lines) |
| `worker/epic/inline-reviewer.ts` | Spawning reviewer, collecting output | Decision parsing heuristic |
| `worker/multi-expert/index.ts` | Story execution, token tracking, coordination | Provider routing (~80 lines), persona prompt defaults (~60 lines), PR body quality template |
| `worker/agents/ai-sdk-executor.js` | Tool definitions, streaming, SDK calls | Provider factory + model inference (~60 lines), persona prompts (~60 lines), review schema |
| `worker/standard/index.ts` | Task execution, branching | CLAUDE.md template (~50 lines) |
| `worker/manager/reviewer.ts` | Subprocess spawning | Review rubric, decision markers |
| `worker/epic/executor.ts` | Claude CLI spawning, output streaming | Persona icon map |

### Files unchanged

| File | Why |
|------|-----|
| `worker/epic/coordination-client.ts` | HTTP client, no IP |
| `worker/epic/api-retry.ts` | Generic retry utility |
| `worker/epic/git-ops.ts` | Git operations |
| `worker/epic/ticket-ops.ts` | Jira/Linear API calls |
| `worker/epic/memory-client.ts` | Memory/RAG API calls |
| `worker/epic/types.ts` | Type definitions |
| `worker/epic/credential-rotator.ts` | Token refresh |
| `worker/epic/request-coalescer.ts` | Request dedup |
| `worker/epic/agent-sdk.ts` | Claude CLI wrapper (public SDK) |
| All entrypoint `.sh` scripts | Shell plumbing |

### New file in worker

**`worker/epic/decision-client.ts`** (~200 lines) — Thin client that calls decision API with retry + circuit breaker + fallbacks. Zero business logic.

### Dockerfile changes

```diff
- COPY directives /app/directives
- COPY AGENTS.md /app/AGENTS.md
  # Everything else stays
```

---

## Server-Side Implementation

### New route file

`api/src/routes/worker-decisions.ts` — Mounted at `/api/worker-decisions`, authenticated via `authenticateApiKey` middleware.

Six route handlers, each a thin wrapper calling the service layer.

### New service file

`api/src/services/worker-decision-engine.ts` — Contains all extracted IP:

- `classifyError()` — 16 regex patterns, category mapping, fixability rules, affected file extraction, blocker summary generation. Lift-and-shift from `error-classifier.ts` + `blocker-manager.ts`.
- `evaluateQuality()` — Reads org quality thresholds from DB, evaluates metrics. Lift-and-shift from `quality-gate.ts`.
- `parseReviewOutcome()` — Structured marker detection (`::review_decision::`), heuristic fallback (score-based), revision limit enforcement. Lift-and-shift from `coordinator.ts` + `inline-reviewer.ts`.
- `routeQuestion()` — 3-tier routing: explicit target, specialty match, idle fallback. Lift-and-shift from `coordinator.ts`.
- `routeProvider()` — Model-to-provider inference (claude->anthropic, gpt->openai, gemini->google, qwen/deepseek/llama->ollama), persona routing config. Lift-and-shift from `ai-sdk-executor.js` + `multi-expert/index.ts`.
- `getWorkerConfig()` — Returns AGENTS.md (from filesystem on API server), icon maps, review schema, CLAUDE.md template, default thresholds.

Logic moves verbatim. Function signatures change to accept raw data instead of reading `process.env`, but core logic is identical.

### AGENTS.md and directives storage

AGENTS.md moves to the API server filesystem (alongside existing directive files). Served via `getWorkerConfig()`. Directives already served via existing persona bundle endpoint.

---

## Migration & Rollout

### Phase 1: Ship API endpoints

Deploy `worker-decisions` routes to production API. Old workers ignore them. Zero risk — purely additive.

### Phase 2: Ship new worker image

New worker image calls decision API. If API endpoints are unreachable (e.g., old API version), fallbacks kick in — worker still functions. Build and push via `./deploy.sh --worker`.

### Phase 3: Verify in production

Run a task end-to-end with the new worker. Confirm decision API calls succeed, fallbacks don't trigger, quality gates still enforce.

### Phase 4: Make ECR public

After confirming new workers work correctly, switch ECR repo to public. The image now contains only:
- System tools (Node.js, Claude CLI, Terraform, AWS CLI, Kaniko, gh)
- Git operations, coordination client, API retry (standard patterns)
- Entrypoint shell scripts (env var names visible but no logic)
- Thin decision client (HTTP calls + retry + fallback defaults)
- Minified executor/coordinator shells (spawns Claude CLI, posts logs)

No directives, no AGENTS.md, no classification logic, no quality gates, no routing algorithms, no review rubrics.

### Rollback

Workers automatically fall back to safe defaults if decision API is unavailable. To fully rollback: deploy the old worker image (has all logic locally).

### Version compatibility

`worker-config` response includes a `version` field. Old workers (don't call decision API) continue working — old logic still runs locally. No flag day required.

---

## What Remains in the Public Image

After thinning, the public image contains:

| Content | IP risk | Notes |
|---------|---------|-------|
| System tools (Node, Claude CLI, Terraform, etc.) | None | All public |
| Entrypoint shell scripts | None | Env var names visible, no logic |
| `decision-client.ts` (compiled, minified) | None | HTTP calls + retry + dumb fallbacks |
| `coordinator.ts` shell (minified) | Low | Story execution loop, git ops — no decision logic |
| `executor.ts` (minified) | Low | Claude CLI spawning, output streaming |
| `coordination-client.ts` (minified) | None | HTTP client wrapper |
| `git-ops.ts` (minified) | None | Standard git operations |
| Execution scripts (minified) | None | PR creation, test running — standard automation |

All competitive IP lives server-side in `worker-decision-engine.ts`, served only to authenticated workers at runtime.
