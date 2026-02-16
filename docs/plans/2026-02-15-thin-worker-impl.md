# Thin Worker: Decision Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move orchestration intelligence from worker container to API, enabling public ECR image.

**Architecture:** New `/api/worker-decisions` route group on the API that receives raw context from workers and returns decisions. Worker gets a thin `decision-client.ts` that calls these endpoints with 5-retry + circuit breaker + safe fallbacks. Existing logic is lift-and-shifted verbatim into `api/src/services/worker-decision-engine.ts`.

**Tech Stack:** Express + TypeScript (API), axios (worker client), Vitest (tests)

**Design doc:** `docs/plans/2026-02-15-thin-worker-design.md`

---

## Task 1: Create the Decision Engine Service (API side)

Lift-and-shift all IP logic from worker into a single API service file.

**Files:**
- Create: `api/src/services/worker-decision-engine.ts`
- Reference: `worker/epic/error-classifier.ts` (copy verbatim)
- Reference: `worker/epic/quality-gate.ts` (copy verbatim)
- Reference: `worker/epic/coordinator.ts:3041-3093` (review parsing)
- Reference: `worker/multi-expert/index.ts:195-241` (provider routing)
- Reference: `worker/AGENTS.md` (served at runtime)

**Step 1: Write the failing test**

Create `api/src/services/worker-decision-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
} from "./worker-decision-engine.js";

describe("Worker Decision Engine", () => {
  describe("classifyError", () => {
    it("classifies TypeScript errors as fixable", () => {
      const result = classifyError({
        errorText: "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'",
        retryCount: 0,
        maxAutoRetries: 3,
        storyContext: { title: "Add login", persona: "backend_developer", targetFiles: ["src/auth.ts"] },
      });
      expect(result.category).toBe("typescript");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("auto_retry");
    });

    it("classifies auth errors as non-fixable and escalates", () => {
      const result = classifyError({
        errorText: "401 Unauthorized - Invalid API key",
        retryCount: 0,
        maxAutoRetries: 3,
        storyContext: { title: "Deploy", persona: "devops_engineer", targetFiles: [] },
      });
      expect(result.category).toBe("auth");
      expect(result.fixable).toBe(false);
      expect(result.action).toBe("escalate");
    });

    it("skips when retry count exceeds max", () => {
      const result = classifyError({
        errorText: "error TS2345: type mismatch",
        retryCount: 3,
        maxAutoRetries: 3,
        storyContext: { title: "Fix types", persona: "backend_developer", targetFiles: [] },
      });
      expect(result.action).toBe("escalate");
    });

    it("extracts affected files from error text", () => {
      const result = classifyError({
        errorText: "src/index.ts:10:5 - error TS2345: Argument of type",
        retryCount: 0,
        maxAutoRetries: 3,
        storyContext: { title: "Fix", persona: "backend_developer", targetFiles: [] },
      });
      expect(result.affectedFiles).toContain("src/index.ts");
    });
  });

  describe("evaluateQuality", () => {
    it("passes when quality gate is disabled", () => {
      const result = evaluateQuality({
        metrics: { qualityScore: 10 },
        bypassRequested: false,
        qualityGateEnabled: false,
      });
      expect(result.pass).toBe(true);
    });

    it("passes when bypass is requested", () => {
      const result = evaluateQuality({
        metrics: { qualityScore: 10 },
        bypassRequested: true,
        qualityGateEnabled: true,
        thresholds: { minQualityScore: 80 },
      });
      expect(result.pass).toBe(true);
    });

    it("fails when score below threshold", () => {
      const result = evaluateQuality({
        metrics: { qualityScore: 50 },
        bypassRequested: false,
        qualityGateEnabled: true,
        thresholds: { minQualityScore: 80 },
      });
      expect(result.pass).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
    });
  });

  describe("parseReviewOutcome", () => {
    it("parses structured decision marker", () => {
      const result = parseReviewOutcome({
        reviewerOutput: "looks good\n::review_decision::approved\n::code_quality_score::8",
        revisionCount: 0,
        maxRevisions: 3,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: 2,
      });
      expect(result.decision).toBe("approved");
      expect(result.score).toBe(8);
      expect(result.shouldRevise).toBe(false);
    });

    it("detects natural language approval", () => {
      const result = parseReviewOutcome({
        reviewerOutput: "This code LGTM, ship it!",
        revisionCount: 0,
        maxRevisions: 3,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: 2,
      });
      expect(result.decision).toBe("approved");
    });

    it("marks revision exhausted when at max", () => {
      const result = parseReviewOutcome({
        reviewerOutput: "::review_decision::revision_needed",
        revisionCount: 3,
        maxRevisions: 3,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: 2,
      });
      expect(result.shouldRevise).toBe(false);
      expect(result.revisionExhausted).toBe(true);
    });
  });

  describe("routeQuestion", () => {
    it("routes to explicit target when available and idle", () => {
      const result = routeQuestion({
        questionText: "Is this secure?",
        targetPersona: "security_engineer",
        idleExperts: ["security_engineer", "backend_developer"],
        allExperts: ["security_engineer", "backend_developer"],
      });
      expect(result.targetExpert).toBe("security_engineer");
      expect(result.routingTier).toBe(1);
    });

    it("falls back to idle expert when target is busy", () => {
      const result = routeQuestion({
        questionText: "Is this secure?",
        targetPersona: "security_engineer",
        idleExperts: ["backend_developer"],
        allExperts: ["security_engineer", "backend_developer"],
      });
      expect(result.targetExpert).toBe("backend_developer");
      expect(result.routingTier).toBe(3);
    });

    it("returns null when no experts are idle", () => {
      const result = routeQuestion({
        questionText: "How do we deploy?",
        idleExperts: [],
        allExperts: ["backend_developer"],
      });
      expect(result.targetExpert).toBeNull();
    });
  });

  describe("routeProvider", () => {
    it("infers anthropic from claude model name", () => {
      const result = routeProvider({
        persona: "backend_developer",
        modelName: "claude-sonnet-4",
        availableProviders: ["anthropic", "openai"],
      });
      expect(result.provider).toBe("anthropic");
      expect(result.inferenceSource).toBe("model_name");
    });

    it("uses explicit routing when provided", () => {
      const result = routeProvider({
        persona: "frontend_developer",
        providerRouting: JSON.stringify({ frontend_developer: { provider: "openai", model: "gpt-4o" } }),
        availableProviders: ["anthropic", "openai"],
      });
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
      expect(result.inferenceSource).toBe("routing");
    });

    it("defaults to anthropic when no model specified", () => {
      const result = routeProvider({
        persona: "backend_developer",
        availableProviders: ["anthropic", "openai"],
      });
      expect(result.provider).toBe("anthropic");
      expect(result.inferenceSource).toBe("default");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/services/worker-decision-engine.test.ts`
Expected: FAIL — module not found

**Step 3: Write the service**

Create `api/src/services/worker-decision-engine.ts`. This is a lift-and-shift of:
- `classifyError()` — from `worker/epic/error-classifier.ts` (all regex patterns, FIXABLE_CATEGORIES, extractAffectedFiles, generateBlockerSummary, CATEGORY_INFO, extractSpecificError)
- `evaluateQuality()` — from `worker/epic/quality-gate.ts` (evaluateQualityGate logic, threshold checks)
- `parseReviewOutcome()` — from `worker/epic/coordinator.ts:3041-3093` (structured marker + text match + natural language fallback + score parsing)
- `routeQuestion()` — 3-tier routing: explicit target → specialty match → idle fallback
- `routeProvider()` — from `worker/multi-expert/index.ts:195-241` (inferProviderFromModel + getProviderForPersona + PROVIDER_DEFAULT_MODELS)
- `getWorkerConfig()` — reads `worker/AGENTS.md` from filesystem (copy to `api/data/AGENTS.md`), returns icon maps + defaults

Key differences from worker originals:
- Functions accept structured request objects instead of reading `process.env`
- `classifyError` combines error-classifier.ts + blocker-manager retry logic: if `retryCount >= maxAutoRetries` and category is fixable, action becomes `"escalate"` instead of `"auto_retry"`
- `evaluateQuality` accepts thresholds inline instead of reading from org entity (route handler resolves org thresholds before calling)

The actual regex patterns, category maps, routing algorithm, review heuristics, and provider inference logic are copied verbatim.

**Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/services/worker-decision-engine.test.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add api/src/services/worker-decision-engine.ts api/src/services/worker-decision-engine.test.ts
git commit -m "feat: add worker decision engine service (lift-and-shift from worker)"
```

---

## Task 2: Create the Decision API Routes (API side)

Wire the service into Express endpoints.

**Files:**
- Create: `api/src/routes/worker-decisions.ts`
- Modify: `api/src/routes/index.ts` (add export)
- Modify: `api/src/index.ts` (mount route)

**Step 1: Write the route file**

Create `api/src/routes/worker-decisions.ts`:

```typescript
import { Router, Request, Response } from "express";
import { authenticateApiKey } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
  getWorkerConfig,
} from "../services/worker-decision-engine.js";

const router = Router();

// All endpoints require API key auth (worker containers use x-api-key header)
router.use(authenticateApiKey);

// Health check (lightweight, no auth needed for circuit breaker probing)
// Note: defined before authenticateApiKey middleware above, but since router.use
// applies to routes defined AFTER it, we need a separate pre-auth health endpoint.
// For simplicity, health is behind auth too — workers always have the API key.
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.post("/classify-error", async (req: Request, res: Response) => {
  try {
    const result = classifyError(req.body);
    res.json(result);
  } catch (err) {
    logger.error("classify-error failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/evaluate-quality", async (req: Request, res: Response) => {
  try {
    const result = evaluateQuality(req.body);
    res.json(result);
  } catch (err) {
    logger.error("evaluate-quality failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/review-outcome", async (req: Request, res: Response) => {
  try {
    const result = parseReviewOutcome(req.body);
    res.json(result);
  } catch (err) {
    logger.error("review-outcome failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/route-question", async (req: Request, res: Response) => {
  try {
    const result = routeQuestion(req.body);
    res.json(result);
  } catch (err) {
    logger.error("route-question failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

router.post("/route-provider", async (req: Request, res: Response) => {
  try {
    const result = routeProvider(req.body);
    res.json(result);
  } catch (err) {
    logger.error("route-provider failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/worker-config", async (_req: Request, res: Response) => {
  try {
    const config = await getWorkerConfig();
    res.json(config);
  } catch (err) {
    logger.error("worker-config failed", { error: (err as Error).message });
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
```

**Step 2: Register the route**

In `api/src/routes/index.ts`, add:
```typescript
export { default as workerDecisionsRouter } from "./worker-decisions.js";
```

In `api/src/index.ts`, add import to the destructured import block (~line 60) and mount:
```typescript
app.use("/api/worker-decisions", workerLogLimiter, workerDecisionsRouter);
```
Place it near the other worker-facing routes (after line 300, near `workerApiRouter` and `remoteAgentRouter`).

**Step 3: Copy AGENTS.md to API data directory**

```bash
mkdir -p api/data
cp worker/AGENTS.md api/data/AGENTS.md
```

The `getWorkerConfig()` function reads from `api/data/AGENTS.md` (or `path.join(__dirname, '../../data/AGENTS.md')`).

**Step 4: Type check**

Run: `cd api && npm run typecheck`
Expected: PASS (ignoring pre-existing errors)

**Step 5: Commit**

```bash
git add api/src/routes/worker-decisions.ts api/src/routes/index.ts api/src/index.ts api/data/AGENTS.md
git commit -m "feat: add /api/worker-decisions route group"
```

---

## Task 3: Create the Decision Client (Worker side)

Thin HTTP client with 5-retry + circuit breaker + safe fallbacks.

**Files:**
- Create: `worker/epic/decision-client.ts`
- Reference: `worker/lib/api-retry.ts` (extend pattern)

**Step 1: Create the decision client**

Create `worker/epic/decision-client.ts`:

This file contains:

1. **`DecisionClient` class** — initialized with `apiBaseUrl` and `orgApiKey`
2. **Internal `callDecisionApi<T>(endpoint, body, timeoutMs)`** — makes POST/GET to `/api/worker-decisions/{endpoint}` with:
   - 5 retries, 500ms initial delay, 15s max, 2x backoff, 30% jitter
   - Retryable: 502, 503, 504, 408, 429 + network errors (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET, EAI_AGAIN)
   - 60s absolute timeout per call
   - Logs each retry via provided `logger` callback
3. **Circuit breaker** — 3 consecutive failures in 60s → OPEN for 30s → HALF_OPEN → test one call
4. **Public methods** (each calls `callDecisionApi` with fallback):
   - `classifyError(req)` → fallback: `{ category: "unknown", fixable: false, action: "escalate", affectedFiles: [], summary: "Decision API unavailable", fixStrategy: null }`
   - `evaluateQuality(req)` → fallback: `{ pass: true, reasons: ["Decision API unavailable - skipping gate"], blockers: [] }`
   - `parseReviewOutcome(req)` → fallback: `{ decision: "approved", score: null, feedback: null, shouldRevise: false, revisionExhausted: false, reason: "Decision API unavailable - auto-approving" }`
   - `routeQuestion(req)` → fallback: first idle expert or null
   - `routeProvider(req)` → fallback: `{ provider: "anthropic", model: modelName || "claude-haiku-4-5", inferenceSource: "fallback" }`
   - `getWorkerConfig()` → fallback: minimal stub with empty AGENTS.md, default icons, default thresholds
5. **`healthCheck()`** — GET `/api/worker-decisions/health`, retries every 5s for up to 2 min

All fallback values are intentionally dumb — no competitive IP.

**Step 2: Build to verify compilation**

Run: `cd worker/epic && npm run build`
Expected: Compiles successfully (new file produces `dist/decision-client.js`)

**Step 3: Commit**

```bash
git add worker/epic/decision-client.ts
git commit -m "feat: add decision client with retry + circuit breaker + fallbacks"
```

---

## Task 4: Wire Decision Client into Epic Coordinator

Replace inline decision logic in coordinator.ts with decision client calls.

**Files:**
- Modify: `worker/epic/coordinator.ts`
- Modify: `worker/epic/index.ts` (pass decision client to coordinator)

**Step 1: Import and inject decision client**

In `worker/epic/index.ts`, instantiate `DecisionClient` and pass it to the coordinator constructor.

In `worker/epic/coordinator.ts`:
- Add `DecisionClient` as a constructor parameter
- Store as `this.decisionClient`

**Step 2: Replace error classification calls**

Find all calls to `classifyError()` and `extractAffectedFiles()` from `error-classifier.js` in coordinator.ts. Replace with:

```typescript
const classification = await this.decisionClient.classifyError({
  taskId: this.config.parentTaskId,
  storyIndex,
  errorText: errorOutput,
  retryCount: this.retryCountByStory.get(storyIndex) || 0,
  maxAutoRetries: this.config.blockerMaxAutoRetries,
  storyContext: { title: story.title, persona: story.persona, targetFiles: story.targetFiles || [] },
});
// Use classification.category, classification.fixable, classification.action, etc.
```

**Step 3: Replace quality gate calls**

Find calls to `evaluateQualityGate()` from `quality-gate.js`. Replace with:

```typescript
const gateResult = await this.decisionClient.evaluateQuality({
  taskId: this.config.parentTaskId,
  orgId: this.config.orgId || "",
  metrics: { qualityScore, testCoveragePercent, securityVulnsHigh, typeErrors, testFailures },
  bypassRequested: process.env.QUALITY_GATE_BYPASS === "true",
  qualityGateEnabled: thresholds.qualityGateEnabled,
  thresholds,
});
```

**Step 4: Replace review decision parsing**

In the review subprocess handler (~line 3041-3093), replace the inline marker parsing with:

```typescript
const reviewResult = await this.decisionClient.parseReviewOutcome({
  taskId: this.config.parentTaskId,
  reviewerOutput: allOutput,
  revisionCount: this.revisionCount,
  maxRevisions: this.maxReviewRevisions,
  perStoryRevisionCount,
  maxPerStoryRevisions: this.maxPerStoryRevisions,
});
const decision = reviewResult.decision;
const feedback = reviewResult.feedback || "No feedback provided";
const codeQualityScore = reviewResult.score || 5;
const shouldRevise = reviewResult.shouldRevise;
```

**Step 5: Replace question routing**

Find the 3-tier routing logic in coordinator.ts. Replace with:

```typescript
const routing = await this.decisionClient.routeQuestion({
  taskId: this.config.parentTaskId,
  questionText: question.content,
  targetPersona: question.targetPersona,
  idleExperts: idleExpertNames,
  allExperts: allExpertNames,
});
```

**Step 6: Build to verify**

Run: `cd worker/epic && npm run build`
Expected: Compiles successfully

**Step 7: Commit**

```bash
git add worker/epic/coordinator.ts worker/epic/index.ts
git commit -m "feat: wire decision client into Epic coordinator"
```

---

## Task 5: Wire Decision Client into Multi-Expert and Agents

Replace provider routing and icon maps in multi-expert and agents.

**Files:**
- Modify: `worker/multi-expert/index.ts`
- Modify: `worker/agents/ai-sdk-executor.js`
- Modify: `worker/epic/executor.ts`

**Step 1: Multi-Expert — replace provider routing**

In `worker/multi-expert/index.ts`:
- Remove `inferProviderFromModel()` function (lines 195-211)
- Remove `getProviderForPersona()` function (lines 217-241)
- Remove `PROVIDER_DEFAULT_MODELS` constant (lines 184-190)
- Remove `PERSONA_EMOJIS` constant (lines 84-100)
- Remove `PROVIDER_ICONS` constant (lines 103-109)
- Add decision client as constructor parameter
- Replace calls to `getProviderForPersona()` with `await this.decisionClient.routeProvider()`
- Fetch icons from `workerConfig` (loaded at startup via `getWorkerConfig()`)

**Step 2: Agents — replace provider maps in ai-sdk-executor.js**

In `worker/agents/ai-sdk-executor.js`:
- Remove `PROVIDER_DEFAULT_MODELS` (lines 88-94)
- Remove `PROVIDER_ICONS` (lines 97-103)
- Remove `PERSONA_CONFIGS` (lines 106-123)
- Accept these as parameters passed from the spawning coordinator
- The coordinator fetches them once from `getWorkerConfig()` and passes via env vars or CLI args

Note: `ai-sdk-executor.js` is spawned as a child process. The simplest approach is for the coordinator to pass icons/defaults via environment variables (e.g., `PERSONA_ICONS_JSON`, `PROVIDER_ICONS_JSON`). The executor reads them at startup, falling back to empty objects.

**Step 3: Epic executor — replace icon maps**

In `worker/epic/executor.ts`:
- Remove `PERSONA_CONFIGS` (lines 32-48)
- Remove `PROVIDER_ICONS` (lines 51-57)
- Accept icons as constructor parameters (passed from coordinator, which gets them from `getWorkerConfig()`)

**Step 4: Build all worker modules**

Run: `cd worker/epic && npm run build && cd ../multi-expert && npm run build`
Expected: Both compile

**Step 5: Commit**

```bash
git add worker/multi-expert/index.ts worker/agents/ai-sdk-executor.js worker/epic/executor.ts
git commit -m "feat: wire decision client into multi-expert and agents"
```

---

## Task 6: Wire Decision Client into Standard and Manager Modes

**Files:**
- Modify: `worker/standard/index.ts`
- Modify: `worker/manager/reviewer.ts` (if it has inline decision parsing)

**Step 1: Standard — fetch CLAUDE.md template from API**

Replace the inline CLAUDE.md auto-generation template with a fetch from `getWorkerConfig().claudeMdTemplate`. Falls back to a minimal template if API unavailable.

**Step 2: Manager — replace review decision parsing**

If `manager/reviewer.ts` has inline decision parsing (REVIEW_DECISION markers), replace with decision client call to `parseReviewOutcome`.

**Step 3: Build**

Run: `cd worker/standard && npm run build && cd ../manager && npm run build`
Expected: Both compile

**Step 4: Commit**

```bash
git add worker/standard/index.ts worker/manager/reviewer.ts
git commit -m "feat: wire decision client into standard and manager modes"
```

---

## Task 7: Remove IP Files from Worker Image

Remove files that are now served by the API.

**Files:**
- Delete: `worker/epic/error-classifier.ts`
- Delete: `worker/epic/blocker-manager.ts`
- Delete: `worker/epic/quality-gate.ts`
- Modify: `worker/Dockerfile` (remove COPY directives, COPY AGENTS.md)

**Step 1: Delete extracted files**

```bash
rm worker/epic/error-classifier.ts
rm worker/epic/blocker-manager.ts
rm worker/epic/quality-gate.ts
```

**Step 2: Update Dockerfile**

In `worker/Dockerfile`:
- Remove line 72: `COPY directives /app/directives`
- Remove line 77: `COPY AGENTS.md /app/AGENTS.md`
- Keep all other COPY lines

**Step 3: Update imports**

In any worker file that previously imported from `error-classifier.js`, `blocker-manager.js`, or `quality-gate.js` — remove those imports. The coordinator now uses decision client instead.

Specifically check:
- `worker/epic/coordinator.ts` — remove `import { classifyError, ... } from "./error-classifier.js"`
- `worker/epic/coordinator.ts` — remove `import { BlockerManager } from "./blocker-manager.js"`
- `worker/epic/coordinator.ts` — remove `import { evaluateQualityGate, ... } from "./quality-gate.js"`
- `worker/multi-expert/index.ts` — remove quality-gate imports if any

**Step 4: Update executor directive loading fallback**

In `worker/epic/executor.ts`, the `loadDirectiveFromFile()` function (line 63) reads from `/app/directives/`. Since directives are no longer in the image, this fallback will always return empty string. That's fine — the primary path is the API call to `/api/personas/worker/:persona/bundle`. The fallback just becomes a no-op. Leave it as-is (it's not IP, just a dead code path that logs a harmless warning).

**Step 5: Build all worker modules**

Run: `cd worker/epic && npm run build && cd ../multi-expert && npm run build && cd ../standard && npm run build && cd ../manager && npm run build`
Expected: All compile successfully

**Step 6: Build Docker image**

Run: `cd /home/user/github/workermill && ./bin/local-workermill build-worker`
Expected: Image builds successfully. The directives/ and AGENTS.md are no longer in the image.

**Step 7: Commit**

```bash
git add -A worker/epic/ worker/multi-expert/ worker/standard/ worker/manager/ worker/Dockerfile
git commit -m "feat: remove IP files from worker image (served by API now)"
```

---

## Task 8: Integration Verification

End-to-end verification that the new worker + API work together.

**Step 1: Deploy API locally**

Ensure API is running with the new `/api/worker-decisions` endpoints.

Run: `cd api && npm run dev`

**Step 2: Test decision endpoints manually**

```bash
# Health check
curl -s http://localhost:3001/api/worker-decisions/health -H "x-api-key: local-dev" | jq .

# Classify error
curl -s -X POST http://localhost:3001/api/worker-decisions/classify-error \
  -H "x-api-key: local-dev" -H "Content-Type: application/json" \
  -d '{"errorText":"error TS2345: type mismatch","retryCount":0,"maxAutoRetries":3,"storyContext":{"title":"test","persona":"backend_developer","targetFiles":[]}}' | jq .

# Worker config
curl -s http://localhost:3001/api/worker-decisions/worker-config -H "x-api-key: local-dev" | jq '.defaults'
```

Expected: All return valid JSON responses.

**Step 3: Run API tests**

Run: `cd api && npm run test`
Expected: All existing tests pass, new tests pass.

**Step 4: Type check everything**

Run: `cd api && npm run typecheck`
Run: `cd worker/epic && npm run build`
Expected: Both pass.

**Step 5: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for thin worker"
```

---

## Task 9: Update Documentation

**Files:**
- Modify: `CLAUDE.md` (update worker architecture section)

**Step 1: Update CLAUDE.md**

Add a note in the Worker System section explaining:
- Worker decision logic is now served by `/api/worker-decisions` endpoints
- Worker image no longer contains directives, AGENTS.md, error classification, quality gates, or routing logic
- All competitive IP lives in `api/src/services/worker-decision-engine.ts`
- Worker has safe fallbacks if decision API is unreachable

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for thin worker architecture"
```
