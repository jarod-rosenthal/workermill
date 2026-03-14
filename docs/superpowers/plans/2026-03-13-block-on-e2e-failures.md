# Block on E2E Failures + Service Log Capture — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `blockOnE2EFailures` as a full-stack org setting (same pattern as `blockOnLintErrors`) and capture docker compose service logs when integration gates fail so the fixer agent can diagnose architectural issues.

**Architecture:** Follow the exact pattern of `blockOnLintErrors` — DB column, entity, API routes, frontend toggle, worker types, reviewer prompt, decision engine. For service logs, extend the integration fixer's `runAllGates()` to capture `docker compose logs` on failure and pass them through the retry loop into the fix prompt.

**Tech Stack:** TypeScript, TypeORM, React, Express, PostgreSQL

---

## Chunk 1: Database + API (blockOnE2EFailures setting)

### Task 1: Database Migration

**Files:**
- Create: `api/src/db/migrations/1742800000000-AddBlockOnE2EFailures.ts`
- Modify: `api/src/db/connection.ts` (add import + registration)

- [ ] **Step 1: Create migration file**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBlockOnE2EFailures1742800000000 implements MigrationInterface {
  name = "AddBlockOnE2EFailures1742800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS block_on_e2e_failures BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS block_on_e2e_failures
    `);
  }
}
```

- [ ] **Step 2: Register migration in connection.ts**

Add import after the `AddBlockOnLintErrors1742700000000` import:
```typescript
import { AddBlockOnE2EFailures1742800000000 } from "./migrations/1742800000000-AddBlockOnE2EFailures.js";
```

Add `AddBlockOnE2EFailures1742800000000` to the migrations array after `AddBlockOnLintErrors1742700000000`.

- [ ] **Step 3: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/1742800000000-AddBlockOnE2EFailures.ts api/src/db/connection.ts
git commit -m "feat(api): add block_on_e2e_failures column to organizations"
```

---

### Task 2: Organization Entity

**Files:**
- Modify: `api/src/models/Organization.ts:514` (after `blockOnLintErrors`)

- [ ] **Step 1: Add column to entity**

After `blockOnLintErrors` (line 514), add:
```typescript
@Column({ name: "block_on_e2e_failures", type: "boolean", default: false })
blockOnE2EFailures: boolean;
```

- [ ] **Step 2: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add api/src/models/Organization.ts
git commit -m "feat(api): add blockOnE2EFailures to Organization entity"
```

---

### Task 3: API Settings Routes

**Files:**
- Modify: `api/src/routes/settings/general.ts` (4 locations)

- [ ] **Step 1: Add to GET response** (after `blockOnLintErrors` at line 154)

```typescript
blockOnE2EFailures: org.blockOnE2EFailures,
```

- [ ] **Step 2: Add to destructured request body** (after `blockOnLintErrors` at line 315)

```typescript
blockOnE2EFailures,
```

- [ ] **Step 3: Add to PUT handler** (after the `blockOnLintErrors` block at line 1052)

```typescript
if (blockOnE2EFailures !== undefined) {
  org.blockOnE2EFailures = Boolean(blockOnE2EFailures);
}
```

- [ ] **Step 4: Add to PUT response** (after `blockOnLintErrors` at line 1372)

```typescript
blockOnE2EFailures: org.blockOnE2EFailures,
```

- [ ] **Step 5: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/settings/general.ts
git commit -m "feat(api): expose blockOnE2EFailures in settings GET/PUT"
```

---

### Task 4: Spawners + Remote Agent + Worker Decisions

**Files:**
- Modify: `api/src/routes/remote-agent.ts:1093`
- Modify: `api/src/services/local-epic-spawner.ts:842`
- Modify: `api/src/services/worker-spawner.ts:485`
- Modify: `api/src/routes/worker-decisions.ts:134`

- [ ] **Step 1: Add to remote-agent.ts qualityThresholds** (after `blockOnLintErrors` at line 1093)

```typescript
blockOnE2EFailures: org.blockOnE2EFailures ?? false,
```

- [ ] **Step 2: Add to local-epic-spawner.ts** (after `blockOnLintErrors` at line 842)

```typescript
blockOnE2EFailures: task.organization?.blockOnE2EFailures ?? false,
```

- [ ] **Step 3: Add to worker-spawner.ts** (after `blockOnLintErrors` at line 485)

```typescript
blockOnE2EFailures: org.blockOnE2EFailures ?? false,
```

- [ ] **Step 4: Add to worker-decisions.ts** (after `blockOnLintErrors` at line 134)

```typescript
blockOnE2EFailures: org.blockOnE2EFailures ?? false,
```

- [ ] **Step 5: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/remote-agent.ts api/src/services/local-epic-spawner.ts api/src/services/worker-spawner.ts api/src/routes/worker-decisions.ts
git commit -m "feat(api): pass blockOnE2EFailures through to worker environment"
```

---

### Task 5: Worker Decision Engine

**Files:**
- Modify: `api/src/services/worker-decision-engine.ts:76` (thresholds type)
- Modify: `api/src/services/worker-decision-engine.ts:793` (add E2E check)

- [ ] **Step 1: Add to thresholds type** (after `blockOnLintErrors` at line 76)

```typescript
blockOnE2EFailures?: boolean;
```

- [ ] **Step 2: Add to metrics type** (around line 63, after `testFailures`)

```typescript
e2eFailures?: boolean;
```

- [ ] **Step 3: Add E2E blocking logic** (after the lint errors check at line 795)

```typescript
// Check: E2E test failures
if (thresholds.blockOnE2EFailures && req.metrics.e2eFailures) {
  blockers.push("E2E test failures detected and blocking is enabled");
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add api/src/services/worker-decision-engine.ts
git commit -m "feat(api): add E2E failure blocking to worker decision engine"
```

---

### Task 6: Stack Templates

**Files:**
- Modify: `api/src/config/stack-templates.ts:22` (interface)
- Modify: `api/src/config/stack-templates.ts` (each template)

- [ ] **Step 1: Add to QualityThresholds interface** (after `blockOnLintErrors` at line 22)

```typescript
blockOnE2EFailures: boolean;
```

- [ ] **Step 2: Add to each template's qualityThresholds**

For each `STACK_TEMPLATES` entry (lines 49, 65, 81, 97, 113, 129, 145, 161), add `blockOnE2EFailures: false` to the `qualityThresholds` object.

- [ ] **Step 3: Verify typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add api/src/config/stack-templates.ts
git commit -m "feat(api): add blockOnE2EFailures to stack templates"
```

---

## Chunk 2: Worker Layer

### Task 7: Worker Types + Decision Client

**Files:**
- Modify: `worker/epic/types.ts:205` (qualityThresholds)
- Modify: `worker/epic/decision-client.ts:48` (EvaluateQualityRequest metrics)

- [ ] **Step 1: Add to EpicConfig qualityThresholds type** (after `blockOnLintErrors` at line 205)

```typescript
blockOnE2EFailures: boolean;
```

- [ ] **Step 2: Add to decision-client.ts EvaluateQualityRequest metrics** (after `testFailures` at line 46)

```typescript
e2eFailures?: boolean;
```

- [ ] **Step 3: Verify typecheck**

Run: `cd worker && npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add worker/epic/types.ts worker/epic/decision-client.ts
git commit -m "feat(worker): add E2E types to worker config and decision client"
```

---

### Task 8: Coordinator — Forward E2E to Decision API

**Files:**
- Modify: `worker/epic/coordinator.ts` (evaluateQuality call sites)

- [ ] **Step 1: Find all evaluateQuality calls**

Search for `this.decisionClient.evaluateQuality` in coordinator.ts. At each call site, add `e2eFailures` to the metrics object:

```typescript
e2eFailures: (metrics.e2eFailed ?? 0) > 0,
```

Add after `testFailures: metrics.testsFailed > 0,` at each site.

- [ ] **Step 2: Verify typecheck**

Run: `cd worker && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add worker/epic/coordinator.ts
git commit -m "feat(worker): forward E2E failures to decision API"
```

---

### Task 9: Inline Reviewer + Coordinator — E2E Display in Tech Lead Review

**Files:**
- Modify: `worker/epic/inline-reviewer.ts:455,471,479-484,506`
- Modify: `worker/epic/coordinator.ts:3800,3816,3818+`

- [ ] **Step 1: Add to inline-reviewer.ts** (after `blockOnLintErrors` at line 455)

```typescript
const blockOnE2EFailures = thresholds?.blockOnE2EFailures ?? false;
```

- [ ] **Step 2: Add E2E row to quality table** (after the Tests row at line 472)

```typescript
| E2E Tests | ${qualityMetrics.e2ePassed ?? 0} passed, ${qualityMetrics.e2eFailed ?? 0} failed | ${(qualityMetrics.e2eFailed ?? 0) > 0 ? (blockOnE2EFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
```

- [ ] **Step 3: Add E2E conditional feedback blocks** (after the lint blocks at lines 479-480)

```typescript
${(qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures ? '**❌ E2E TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}
${(qualityMetrics.e2eFailed ?? 0) > 0 && !blockOnE2EFailures ? '**ℹ️ E2E test failures detected but blocking is DISABLED in org settings — do NOT request revision for E2E failures alone.**\n' : ''}
```

- [ ] **Step 4: Update "all gates pass" condition** (line 484)

Add `&& !((qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures)` to the existing condition.

- [ ] **Step 5: Add to blocking rules** (after lint rules at line 506-507)

```typescript
if (thresholds?.blockOnE2EFailures) blockingRules.push("E2E test failures are **blocking**");
else blockingRules.push("E2E test failures are **non-blocking** (note in feedback, do not request revision)");
```

- [ ] **Step 6: Repeat steps 1-4 for coordinator.ts** (same pattern at lines 3800, 3816, 3818+)

Add `blockOnE2EFailures` variable, E2E table row, conditional blocks, and update the "all gates pass" condition — same code as inline-reviewer.ts.

- [ ] **Step 7: Verify typecheck**

Run: `cd worker && npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add worker/epic/inline-reviewer.ts worker/epic/coordinator.ts
git commit -m "feat(worker): show E2E blocking status in Tech Lead review"
```

---

### Task 10: Service Log Capture in Integration Fixer

**Files:**
- Modify: `worker/epic/inline-integration-fixer.ts` (runAllGates, buildFixPrompt, INTEGRATION_FIX_SYSTEM_PROMPT)

- [ ] **Step 1: Add service log capture to `runAllGates()`**

When a gate fails (at the return points around lines 395 and 425), before returning, check if docker compose services are running and capture logs:

```typescript
// Capture service logs if docker compose is running
let serviceLogs = "";
if (isDockerDaemonReachable()) {
  try {
    serviceLogs = execSync("docker compose logs --tail=100 2>&1", {
      cwd: this.repoPath,
      encoding: "utf-8",
      timeout: 10_000,
    });
  } catch { /* ignore — best effort */ }
}

if (serviceLogs) {
  output += "\n\n### Service Logs (docker compose logs)\n\n" + serviceLogs;
}
```

Add this before each `return { passed: false, output, failedCommand }` in `runAllGates()`.

- [ ] **Step 2: Add to INTEGRATION_FIX_SYSTEM_PROMPT** (after "Common Integration Issues" section around line 51)

Add these lines to the existing list:
```
- Service startup failures (missing env vars, database not seeded, wrong port bindings)
- Middleware configuration errors (wrong order, missing CORS, auth misconfiguration)
```

Add a new section after the common issues:
```
## Service Logs

When available, service logs from docker compose are included in the failure output.
These logs often reveal the ROOT CAUSE of E2E failures — check them FIRST before looking at test output.
Common patterns:
- "connection refused" → service not started or wrong port
- "relation does not exist" → missing database migration
- "unauthorized" / "403" → auth/middleware misconfiguration
- "ECONNREFUSED" → service dependency not ready
```

- [ ] **Step 3: Verify typecheck**

Run: `cd worker && npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add worker/epic/inline-integration-fixer.ts
git commit -m "feat(worker): capture docker compose logs on gate failure for fixer context"
```

---

## Chunk 3: Agent + Frontend + VS Code

### Task 11: Agent Local Config + Local API

**Files:**
- Modify: `agent/src/backends/local/config.ts:83` (settings type + defaults)
- Modify: `agent/src/backends/local/orchestrator.ts:261` (quality thresholds)
- Modify: `agent/src/local-api.ts:2760` (default thresholds)

- [ ] **Step 1: Add to config type** (after `blockOnLintErrors` at line 83)

```typescript
blockOnE2EFailures?: boolean;
```

- [ ] **Step 2: Add to DEFAULT_CONFIG** (after `blockOnLintErrors` at line 122)

```typescript
blockOnE2EFailures: false,
```

- [ ] **Step 3: Add to orchestrator.ts** (after `blockOnLintErrors` at line 261)

```typescript
blockOnE2EFailures: config.settings?.blockOnE2EFailures ?? false,
```

- [ ] **Step 4: Add to local-api.ts default thresholds** (after `blockOnLintErrors` at line 2760)

```typescript
blockOnE2EFailures: false,
```

- [ ] **Step 5: Verify typecheck**

Run: `cd agent && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add agent/src/backends/local/config.ts agent/src/backends/local/orchestrator.ts agent/src/local-api.ts
git commit -m "feat(agent): add blockOnE2EFailures to standalone config and local API"
```

---

### Task 12: Frontend Settings UI

**Files:**
- Modify: `frontend/src/pages/settings/types.ts:104` (Settings interface)
- Modify: `frontend/src/pages/settings/index.tsx:168,509` (default + fetch mapping)
- Modify: `frontend/src/pages/settings/QualitySection.tsx:307` (add toggle)

- [ ] **Step 1: Add to Settings type** (after `blockOnLintErrors` at line 104)

```typescript
blockOnE2EFailures: boolean;
```

- [ ] **Step 2: Add default value** (after `blockOnLintErrors` at line 168)

```typescript
blockOnE2EFailures: false,
```

- [ ] **Step 3: Add to fetch mapping** (after `blockOnLintErrors` at line 509)

```typescript
blockOnE2EFailures: data.blockOnE2EFailures,
```

- [ ] **Step 4: Add toggle to QualitySection.tsx** (after the lint errors toggle, before the closing `</div>` at line 307)

```tsx
<div className="flex items-center justify-between">
  <div>
    <span className="text-sm text-foreground">Block on E2E Test Failures</span>
    <p className="text-xs text-muted-foreground">Require E2E tests to pass before PR approval</p>
  </div>
  <label className="relative inline-flex items-center cursor-pointer">
    <input
      type="checkbox"
      checked={settings.blockOnE2EFailures}
      onChange={(e) => updateSetting("blockOnE2EFailures", e.target.checked)}
      className="sr-only peer"
    />
    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
  </label>
</div>
```

- [ ] **Step 5: Verify typecheck**

Run: `cd frontend && npx tsc -b`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/settings/types.ts frontend/src/pages/settings/index.tsx frontend/src/pages/settings/QualitySection.tsx
git commit -m "feat(frontend): add Block on E2E Failures toggle to quality gate settings"
```

---

### Task 13: VS Code Extension Settings

**Files:**
- Modify: `packages/vscode-workermill/package.json:365` (add setting)
- Modify: `packages/vscode-workermill/src/settings-panel.ts` (6 locations)

- [ ] **Step 1: Add to package.json** (after `blockOnLintErrors` entry at line 365)

```json
"workermill.blockOnE2EFailures": {
  "type": "boolean",
  "default": false,
  "description": "Block PR creation on E2E test failures."
},
```

- [ ] **Step 2: Add to settings defaults** (after `blockOnLintErrors` at line 429)

```typescript
blockOnE2EFailures: settings.blockOnE2EFailures ?? false,
```

- [ ] **Step 3: Add to interface** (after `blockOnLintErrors` at line 653)

```typescript
blockOnE2EFailures: boolean;
```

- [ ] **Step 4: Add to settings update handler** (after `blockOnLintErrors` at line 663)

```typescript
settings.blockOnE2EFailures = msg.blockOnE2EFailures;
```

- [ ] **Step 5: Add to WebviewMessage interface** (after `blockOnLintErrors` at line 816)

```typescript
blockOnE2EFailures: boolean;
```

- [ ] **Step 6: Add to WebviewMessage construction** (after `blockOnLintErrors` at line 831)

```typescript
blockOnE2EFailures: msg.blockOnE2EFailures,
```

- [ ] **Step 7: Add HTML checkbox** (after `qg-block-lint-errors` div at line 2018)

```html
<div class="field">
  <label style="display:flex;align-items:center;gap:8px;">
    <input type="checkbox" id="qg-block-e2e-failures" />
    Block on E2E test failures
  </label>
  <div class="hint">Fail the quality gate if end-to-end tests fail.</div>
</div>
```

- [ ] **Step 8: Add to JS save function** (after `blockOnLintErrors` at line 2590)

```javascript
blockOnE2EFailures: document.getElementById("qg-block-e2e-failures").checked,
```

- [ ] **Step 9: Add to change listener array** (line 2596)

Add `"qg-block-e2e-failures"` to the array.

- [ ] **Step 10: Add to populate function** (after `qgLintErrors` at line 2868)

```javascript
var qgE2EFailures = document.getElementById("qg-block-e2e-failures");
```

And in the population block (after line 2874):
```javascript
if (qgE2EFailures) qgE2EFailures.checked = !!d.blockOnE2EFailures;
```

- [ ] **Step 11: Commit**

```bash
git add packages/vscode-workermill/package.json packages/vscode-workermill/src/settings-panel.ts
git commit -m "feat(vscode): add Block on E2E Failures toggle to quality gate settings"
```

---

## Chunk 4: Verification + Deploy

### Task 14: Full Typecheck + Tests

- [ ] **Step 1: API typecheck**

Run: `cd api && npm run typecheck`

- [ ] **Step 2: Worker typecheck**

Run: `cd worker && npm run typecheck`

- [ ] **Step 3: Agent typecheck**

Run: `cd agent && npm run typecheck`

- [ ] **Step 4: Frontend typecheck**

Run: `cd frontend && npx tsc -b`

- [ ] **Step 5: API tests**

Run: `cd api && npm run test`

---

## Post-Implementation

After all tasks complete:
1. Deploy API: `./deploy.sh --api`
2. Deploy worker: `./deploy.sh --worker`
3. Deploy frontend: `./deploy.sh --frontend`
4. Bump + release agent if needed
5. Package VS Code extension if needed
6. Enable `block_on_e2e_failures = true` for showcase orgs via bastion when ready
