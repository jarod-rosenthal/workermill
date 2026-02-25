# Intent Engineering (Org AI Guidelines) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `ai_guidelines` field to organizations that flows into every worker's system prompt and every planner prompt, so orgs can encode intent beyond task-level context.

**Architecture:** New `ai_guidelines TEXT` column on `organizations`. Field flows through two channels: (1) env var `ORG_GUIDELINES` → worker `loadConfig()` → `buildEnrichedSystemPrompt()`; (2) `PlanningInput.orgGuidelines` → `buildPlanningPrompt()`. Also added to the reviewer system prompt as an alignment check, the agent config endpoint so remote agents get it, and exposed in Settings UI + onboarding.

**Tech Stack:** TypeORM migrations, Express routes, React 19 + TailwindCSS

---

### Task 1: Database Migration

**Files:**
- Create: `api/src/db/migrations/1741000000000-AddOrgAiGuidelines.ts`
- Modify: `api/src/db/connection.ts`

**Step 1: Create the migration file**

```typescript
// api/src/db/migrations/1741000000000-AddOrgAiGuidelines.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrgAiGuidelines1741000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_guidelines TEXT DEFAULT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS ai_guidelines`
    );
  }
}
```

**Step 2: Register migration in connection.ts**

Find the `migrations` array (line ~350 in `api/src/db/connection.ts`). Add the import at the top with the other migration imports:

```typescript
import { AddOrgAiGuidelines1741000000000 } from "./migrations/1741000000000-AddOrgAiGuidelines.js";
```

Add to the `migrations` array:
```typescript
AddOrgAiGuidelines1741000000000,
```

**Step 3: Verify migration registration**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 4: Commit**

```bash
git add api/src/db/migrations/1741000000000-AddOrgAiGuidelines.ts api/src/db/connection.ts
git commit -m "feat: add ai_guidelines column to organizations"
```

---

### Task 2: Organization Model

**Files:**
- Modify: `api/src/models/Organization.ts`

**Step 1: Add the column**

Find the Organization entity class. After the last `@Column` in the "Worker Settings" block (around the `maxParallelExperts` field), add:

```typescript
// Intent Engineering
@Column({ name: "ai_guidelines", type: "text", nullable: true })
aiGuidelines: string | null;
```

**Step 2: Typecheck**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 3: Commit**

```bash
git add api/src/models/Organization.ts
git commit -m "feat: add aiGuidelines to Organization entity"
```

---

### Task 3: Settings API — GET and PUT

**Files:**
- Modify: `api/src/routes/settings/general.ts`

**Step 1: Add to GET response**

In the `res.json({...})` block of the `GET /` handler (around line 53), add after the worker settings fields:

```typescript
// Intent Engineering
aiGuidelines: org.aiGuidelines ?? null,
```

**Step 2: Add to PUT destructuring**

In the `PUT /` handler (around line 326), add `aiGuidelines` to the destructured fields from `req.body`:

```typescript
// Intent Engineering
aiGuidelines,
```

**Step 3: Add to PUT save logic**

In the save block of the PUT handler, after the other org field assignments, add:

```typescript
// Intent Engineering
if (aiGuidelines !== undefined) {
  org.aiGuidelines = aiGuidelines === "" ? null : String(aiGuidelines);
}
```

**Step 4: Typecheck**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 5: Commit**

```bash
git add api/src/routes/settings/general.ts
git commit -m "feat: expose aiGuidelines in settings GET/PUT endpoints"
```

---

### Task 4: Agent Config Endpoint (Remote Agent)

**Files:**
- Modify: `api/src/routes/remote-agent.ts`

**Step 1: Add to GET /config response**

In the `GET /config` handler (around line 990), add to the `res.json({...})` object:

```typescript
// Intent Engineering
aiGuidelines: org.aiGuidelines ?? null,
```

**Step 2: Typecheck**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 3: Commit**

```bash
git add api/src/routes/remote-agent.ts
git commit -m "feat: include aiGuidelines in agent config endpoint"
```

---

### Task 5: Worker EpicConfig Type + index.ts loadConfig()

**Files:**
- Modify: `worker/epic/types.ts`
- Modify: `worker/epic/index.ts`

**Step 1: Add to EpicConfig interface**

In `worker/epic/types.ts`, in the `EpicConfig` interface (after `maxParallelExperts`), add:

```typescript
/** Org-level AI guidelines for intent engineering */
orgGuidelines?: string;
```

**Step 2: Read from env in loadConfig()**

In `worker/epic/index.ts`, in the `return { ... }` block of `loadConfig()` (after `maxParallelExperts`), add:

```typescript
// Intent Engineering — org guidelines from settings
orgGuidelines: process.env.ORG_GUIDELINES || undefined,
```

**Step 3: Typecheck worker**

```bash
cd worker && npm run typecheck
```
Expected: no errors

**Step 4: Commit**

```bash
git add worker/epic/types.ts worker/epic/index.ts
git commit -m "feat: add orgGuidelines to EpicConfig and loadConfig()"
```

---

### Task 6: Inject into Worker System Prompt

**Files:**
- Modify: `worker/epic/executor.ts`

**Step 1: Add injection in buildEnrichedSystemPrompt()**

In `buildEnrichedSystemPrompt()` (around line 368), after the domain expertise block (after line 378 `prompt += "\n\n## Domain Expertise\n\n" + directive`), add:

```typescript
// Inject org-level AI guidelines (intent engineering)
if (this.config.orgGuidelines) {
  prompt += `\n\n## Organization Guidelines\n\nThe following guidelines are set by this organization and take precedence over general best practices. Treat these as hard constraints, not suggestions:\n\n${this.config.orgGuidelines}`;
}
```

**Step 2: Typecheck worker**

```bash
cd worker && npm run typecheck
```
Expected: no errors

**Step 3: Commit**

```bash
git add worker/epic/executor.ts
git commit -m "feat: inject orgGuidelines into worker system prompt"
```

---

### Task 7: Local Spawner (Docker mode)

**Files:**
- Modify: `api/src/services/local-epic-spawner.ts`

**Step 1: Find the env vars object**

Search for `MAX_PARALLEL_EXPERTS` in `local-epic-spawner.ts` (around line 801). It's in the `buildEnvArgs()` method's vars object.

**Step 2: Add ORG_GUIDELINES**

After the `MAX_PARALLEL_EXPERTS` line, add:

```typescript
ORG_GUIDELINES: task.organization?.aiGuidelines || "",
```

**Step 3: Typecheck**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 4: Commit**

```bash
git add api/src/services/local-epic-spawner.ts
git commit -m "feat: pass ORG_GUIDELINES env var in local epic spawner"
```

---

### Task 8: Remote Agent Spawner

**Files:**
- Modify: `agent/src/spawner.ts`

**Step 1: Find the env vars object**

Search for `MAX_PARALLEL_EXPERTS` in `agent/src/spawner.ts` (around line 355). It's in the env vars object built from `orgConfig`.

**Step 2: Add ORG_GUIDELINES**

After the `MAX_PARALLEL_EXPERTS` line, add:

```typescript
ORG_GUIDELINES: String(orgConfig.aiGuidelines || ""),
```

**Step 3: Typecheck agent**

```bash
cd agent && npm run typecheck
```
Expected: no errors (ignore pre-existing dotenv/config error — it's intentional)

**Step 4: Commit**

```bash
git add agent/src/spawner.ts
git commit -m "feat: pass ORG_GUIDELINES to remote agent worker spawner"
```

---

### Task 9: Planning Prompt Injection

**Files:**
- Modify: `api/src/services/planning-agent-local.ts`
- Modify: `api/src/routes/remote-agent.ts`

**Step 1: Add orgGuidelines to PlanningInput interface**

In `planning-agent-local.ts`, find the `PlanningInput` interface. Add:

```typescript
/** Org-level AI guidelines for intent engineering */
orgGuidelines?: string;
```

**Step 2: Inject in buildPlanningPrompt()**

In `buildPlanningPrompt()` (around line 894), after the `taskNotes` block and before the `## Instructions` section (around line 909), add:

```typescript
if (input.orgGuidelines) {
  prompt += `## Organization Guidelines\n\nThe following constraints must be reflected in your execution plan. They take precedence over general recommendations:\n\n${input.orgGuidelines}\n\n`;
}
```

**Step 3: Pass guidelines in GET /planning-prompt route**

In `api/src/routes/remote-agent.ts`, in the `GET /planning-prompt` handler, find where `planningInput` is constructed (around line 1065). Add `orgGuidelines` to the object:

```typescript
orgGuidelines: org.aiGuidelines ?? undefined,
```

**Step 4: Typecheck**

```bash
cd api && npm run typecheck
```
Expected: no errors

**Step 5: Commit**

```bash
git add api/src/services/planning-agent-local.ts api/src/routes/remote-agent.ts
git commit -m "feat: inject orgGuidelines into planning prompt"
```

---

### Task 10: Reviewer Prompt (Intent-Aware Review)

**Files:**
- Modify: `api/src/services/prompt-templates.ts`

**Step 1: Add guidelines section to TECH_LEAD_REVIEW_PROMPT**

In `prompt-templates.ts`, in `TECH_LEAD_REVIEW_PROMPT`, find the `## Code Review Standards` section. Add a new section directly before it:

```typescript
// Insert this block before "## Code Review Standards"
```

The actual string to add before `## Code Review Standards\n\n`:

```
## Organization Guidelines\n\nIf the following org-level guidelines were provided, flag any code that violates them — even if the implementation is otherwise technically correct:\n\n{{ORG_GUIDELINES}}\n\n
```

**Important:** This uses a `{{ORG_GUIDELINES}}` placeholder. The placeholder gets replaced at review time (see Step 2).

**Step 2: Replace placeholder in reviewer invocation**

Find where `TECH_LEAD_REVIEW_PROMPT` is used to build the reviewer system prompt. Search for it in `worker/epic/inline-reviewer.ts`. Replace the placeholder before passing to the reviewer:

```typescript
const reviewerPrompt = TECH_LEAD_REVIEW_PROMPT.replace(
  "{{ORG_GUIDELINES}}",
  this.config.orgGuidelines
    ? this.config.orgGuidelines
    : "(none set — skip this section)"
);
```

**Step 3: Typecheck**

```bash
cd api && npm run typecheck
cd worker && npm run typecheck
```
Expected: no errors

**Step 4: Commit**

```bash
git add api/src/services/prompt-templates.ts worker/epic/inline-reviewer.ts
git commit -m "feat: add org guidelines alignment check to tech lead reviewer"
```

---

### Task 11: Settings UI

**Files:**
- Modify: `frontend/src/pages/settings/AIWorkersSection.tsx`

**Step 1: Find the settings state**

The settings page at `frontend/src/pages/settings/index.tsx` manages a `settings` state object and saves it via `handleSaveSettings()` → `PUT /api/settings`. The `AIWorkersSection` receives these as props. Find how it receives and updates settings (look for the `settings` prop and `onChange` or similar).

**Step 2: Add aiGuidelines textarea at the top of AIWorkersSection**

Add a new card at the top of the rendered content in `AIWorkersSection`, before any existing model/persona cards:

```tsx
{/* AI Worker Guidelines */}
<div className="card p-6 space-y-4">
  <div>
    <h3 className="text-base font-semibold text-foreground">AI Worker Guidelines</h3>
    <p className="text-sm text-muted-foreground mt-1">
      Help workers understand your organization's priorities. These guidelines flow into every
      worker's context and the planning agent.{" "}
      <span className="text-muted-foreground/70">
        For repo-specific guidelines, add an <code className="text-xs bg-muted px-1 rounded">AGENT.md</code> to the repo root.
      </span>
    </p>
  </div>
  <textarea
    className="w-full min-h-[160px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    placeholder={`What should AI workers always or never do in this codebase?\nWhat does your org prioritize in ambiguous situations?\n\nExample: "Never modify files outside the specified scope. Prefer backward-compatible changes. Mobile is the primary surface — web is secondary."`}
    value={settings.aiGuidelines ?? ""}
    onChange={(e) => onChange({ ...settings, aiGuidelines: e.target.value })}
  />
</div>
```

Adjust the exact `onChange` call to match the existing settings update pattern in the file.

**Step 3: Typecheck frontend**

```bash
cd frontend && npx tsc -b
```
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/pages/settings/AIWorkersSection.tsx
git commit -m "feat: add AI guidelines textarea to AIWorkersSection settings"
```

---

### Task 12: Onboarding — Optional Guidelines Step

**Files:**
- Modify: `frontend/src/pages/Onboarding.tsx`

**Step 1: Add state**

At the top of the `Onboarding` component, find the existing `step` state and add:

```tsx
const [aiGuidelines, setAiGuidelines] = useState("");
```

**Step 2: Change post-create navigation**

In `handleCreateOrg()` (around line 70), replace `navigate("/dashboard")` with:

```tsx
setStep("guidelines");
```

**Step 3: Add handleSaveGuidelines function**

After `handleCreateOrg`, add:

```tsx
const handleSaveGuidelines = async () => {
  if (aiGuidelines.trim()) {
    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL || ""}/api/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ aiGuidelines }),
      });
    } catch {
      // Non-blocking — if it fails, they can set it in Settings later
    }
  }
  navigate("/dashboard");
};
```

Check the existing code to find the correct auth token reference (`tokens?.accessToken` or similar) and the correct API base URL pattern.

**Step 4: Add the guidelines step UI**

In the `{/* Content */}` section (around line 145), add a new condition for `step === "guidelines"`:

```tsx
{step === "guidelines" && (
  <div className="space-y-6">
    <div className="text-center">
      <div className="text-2xl mb-2">✨</div>
      <h2 className="text-xl font-semibold text-foreground mb-1">
        One last thing{" "}
        <span className="text-muted-foreground font-normal text-base">(optional)</span>
      </h2>
      <p className="text-sm text-muted-foreground">
        Help your AI workers understand your organization's priorities.
      </p>
    </div>

    <textarea
      className="w-full min-h-[140px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder={`What should workers always or never do?\nWhat does your team prioritize?\n\nExample: "Never modify files outside the specified scope. Prefer backward-compatible changes."`}
      value={aiGuidelines}
      onChange={(e) => setAiGuidelines(e.target.value)}
    />

    <p className="text-xs text-muted-foreground text-center">
      You can always update this in{" "}
      <span className="text-foreground">Settings → AI Workers</span>.
    </p>

    <div className="flex gap-3">
      <button
        onClick={() => navigate("/dashboard")}
        className="flex-1 btn-secondary py-2.5"
      >
        Skip for now
      </button>
      <button
        onClick={handleSaveGuidelines}
        className="flex-1 btn-primary py-2.5"
      >
        Save &amp; get started →
      </button>
    </div>
  </div>
)}
```

**Step 5: Typecheck frontend**

```bash
cd frontend && npx tsc -b
```
Expected: no errors

**Step 6: Commit**

```bash
git add frontend/src/pages/Onboarding.tsx
git commit -m "feat: add optional AI guidelines step to onboarding flow"
```

---

### Task 13: Final Typecheck + Lint

**Step 1: Typecheck all packages**

```bash
cd api && npm run typecheck
cd worker && npm run typecheck
cd agent && npm run typecheck
cd frontend && npx tsc -b
```

**Step 2: Lint**

```bash
cd api && npm run lint
cd frontend && npm run lint
```

**Step 3: Run API tests**

```bash
cd api && npm run test
```
Expected: all passing (no tests should break — this is additive only)

**Step 4: Final commit if any lint fixes applied**

```bash
git add -p
git commit -m "fix: lint fixes for intent engineering feature"
```

---

## What This Delivers

After these 13 tasks:

| Where | What happens |
|-------|-------------|
| Worker system prompt | Org guidelines injected after domain expertise, framed as hard constraints |
| Planning prompt | Org guidelines injected before instructions, influencing story decomposition |
| Tech lead reviewer | Guidelines used as alignment check — flags violations even in correct code |
| Remote agent | Guidelines fetched from `/api/agent/config` → passed as `ORG_GUIDELINES` env var |
| Local Docker mode | `ORG_GUIDELINES` env var set from `task.organization.aiGuidelines` |
| Settings UI | Textarea at top of AI Workers section |
| Onboarding | Optional step 4 after org creation — skippable with no friction |

## What This Does NOT Change

- Existing worker behavior if `ai_guidelines` is `NULL` (default) — all fallback paths are `|| undefined` / `|| ""` so no-op if unset
- Any existing tests — purely additive
- Agent binary version — no need to release new binary (guidelines come via env var at runtime from the API, not baked in)
