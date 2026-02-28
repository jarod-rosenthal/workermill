# Design: CI/CD Quality Gate Enforcement

> **Status:** Draft
> **Author:** Claude + Jarod
> **Date:** 2026-02-26
> **Context:** FlagDeck showcase build exposed that workers ignore CI failures. Quality gates are prompt instructions with zero enforcement. Workers push broken code, CI fails, and they move on.

## Problem

Workers are instructed to:
1. Run pre-commit quality gates (lint, test, typecheck, build) before committing
2. Check CI status after pushing and fix failures before continuing

Neither is enforced. Both are prompt text that workers routinely skip. The result: every CI run in the FlagDeck build failed, and workers never noticed.

## Principle

**Any AI can generate code. The gate proves it works.**

CI verification is not optional polish — it's the core differentiator between "AI wrote code" and "AI shipped working code." It must be a hard block in the executor, not a suggestion in a prompt.

## Current Flow (No Enforcement)

```
Expert writes code
  → git commit (no verification)
  → git push (no verification)
  → Story marked complete
  → Next story starts
```

## Proposed Flow

```
Expert writes code
  → [GATE 1] Run pre-commit quality commands
  → If fail: pass errors to expert, retry (max 3)
  → git commit
  → git push
  → [GATE 2] Wait for CI green (gh run watch / API poll)
  → If fail (code issue): read log, pass to expert, retry from Gate 1
  → If fail (infra issue): escalate as blocker, stop
  → Story marked complete
  → Next story starts
```

At epic completion:
```
All stories complete
  → Create PR
  → [GATE 3] Wait for PR CI green
  → Tech Lead review
  → Auto-merge (existing: coordinator.ts:3167-3179)
```

## Where Code Changes Live

### Gate 1: Pre-Commit Quality Gate (executor-level)

**File:** `worker/epic/executor.ts` — new phase between expert execution and git commit

The executor already has a post-execution flow:
1. Expert finishes writing code
2. Git add + commit + push
3. Post completion to coordination feed

Insert Gate 1 between steps 1 and 2:

```typescript
// After expert execution, before commit
const gateResult = await this.runQualityGate(worktreePath, qualityGateConfig);
if (!gateResult.passed) {
  // Feed errors back to expert, retry story
  return { success: false, error: gateResult.output, retryable: true };
}
```

**Quality gate commands** come from the board/card config (see "Configuration" below). The executor runs each command in sequence, captures output, and fails the story if any command returns non-zero.

### Gate 2: Post-Push CI Verification (executor-level)

**File:** `worker/epic/executor.ts` — new phase after git push

After pushing, the executor polls CI status:

```typescript
// After git push
const ciResult = await this.waitForCI(branchName, targetRepo);
if (!ciResult.passed) {
  if (ciResult.infrastructureFailure) {
    // Billing, runner unavailable, service container — escalate
    await this.postLog(`CI infrastructure failure: ${ciResult.summary}`, expert, "system");
    return { success: false, error: ciResult.summary, retryable: false };
  }
  // Code failure — feed log back to expert for fix
  return { success: false, error: ciResult.log, retryable: true };
}
```

**CI polling** uses the GitHub/Bitbucket API (already available via `gitOps`):
- GitHub: `GET /repos/{owner}/{repo}/actions/runs?branch={branch}&per_page=1` → poll until `status === "completed"`
- Read failure log: `GET /repos/{owner}/{repo}/actions/runs/{id}/jobs` → find failed step → download log
- Bitbucket: `GET /repositories/{workspace}/{repo}/pipelines/?target.branch={branch}` → similar poll

**Timeout:** 10 minutes max wait. If CI hasn't completed, escalate.

**Classify failure type:**
- Exit code from test/lint/build step → code issue → retry
- Runner unavailable, billing blocked, service container failure → infra issue → escalate as blocker

### Gate 3: PR CI Verification (coordinator-level)

**File:** `worker/epic/coordinator.ts` — insert before Tech Lead review and auto-merge

The coordinator already has the pattern at line 3167-3179 (auto-merge after approval). Add CI check before review:

```typescript
// After PR created, before Tech Lead review
const prCiPassed = await this.waitForPRCI(prNumber, targetRepo);
if (!prCiPassed) {
  await this.postLog(`PR CI failed — fixing before review`);
  // Spawn fix expert or escalate
}
// Then proceed to existing Tech Lead review + auto-merge
```

This mirrors the existing `mergePR()` pattern — a hard gate that blocks progression.

## The Greenfield Problem

In a greenfield build (like FlagDeck):
- Card 1 creates the project scaffold
- Card 4-5 creates `.github/workflows/ci.yml`
- Cards 1-4 have **no CI to wait for**
- CLAUDE.md doesn't exist until a worker writes it
- The repo starts completely empty

This means quality gate config **cannot come from the repo** — it doesn't exist yet. The config must flow from the PRD, which is the only source of truth at build start.

## Configuration: PRD → Board → Executor Pipeline

### Source of Truth: The PRD

The PRD already defines quality gates (FlagDeck PRD has exact bash commands in the "Pre-Commit Quality Gate" sections). This is structured enough to extract programmatically.

### Step 1: PRD Decomposer Extracts Gates

During `POST /api/prd/decompose`, the decomposer parses the PRD's quality gate sections and stores them as structured board metadata:

```json
{
  "qualityGates": [
    {
      "name": "backend",
      "trigger": "api/**",
      "commands": [
        "cd api && gofmt -w ./...",
        "cd api && go vet ./...",
        "cd api && golangci-lint run ./...",
        "cd api && go test ./... -v -count=1",
        "cd api && go build -o /dev/null ./cmd/server"
      ]
    },
    {
      "name": "frontend",
      "trigger": "web/**",
      "commands": [
        "cd web && npm run lint",
        "cd web && npm run format",
        "cd web && npm run test",
        "cd web && npm run check",
        "cd web && npm run build"
      ]
    }
  ],
  "ciWorkflowPath": ".github/workflows/ci.yml"
}
```

Stored on `KbBoard.metadata.qualityGates`. Available from the very first card.

### Step 2: Task Claim Delivers Gates to Worker

When the orchestrator claims a task, the claim response already includes board/card metadata. Add `qualityGates` to the payload so the executor has them without any additional API call.

### Step 3: Executor Runs Gates

The executor receives quality gates via config. For each story:

1. After expert finishes, check which files changed (`git diff --name-only`)
2. Match changed files against gate triggers (`api/**`, `web/**`)
3. Run matching gate commands in sequence
4. Fail story if any command returns non-zero

No CLAUDE.md parsing needed. No repo file dependency. Works from card 1.

### Step 4: CI Gate Is Conditional

Gate 2 (post-push CI) only activates when CI exists:

```typescript
// Check if CI workflow exists in the repo
const ciExists = await this.checkCIWorkflowExists(worktreePath, ciWorkflowPath);
if (ciExists) {
  const ciResult = await this.waitForCI(branchName, targetRepo);
  // ... enforce
} else {
  await this.postLog("No CI workflow detected — skipping post-push CI gate", expert, "system");
}
```

The `ciWorkflowPath` comes from board metadata (e.g., `.github/workflows/ci.yml`). The executor just checks if that file exists in the worktree. Once a card creates the CI workflow, all subsequent cards automatically enforce it.

### Fallback: CLAUDE.md for Non-PRD Workflows

For existing repos with no PRD (single-card tasks, manual board cards), the executor falls back to reading `CLAUDE.md` from the worktree for a `## Quality Gates` section. This covers the non-greenfield case where the repo already has quality gates defined.

Priority order:
1. Board metadata `qualityGates` (from PRD decomposer) — primary
2. CLAUDE.md `## Quality Gates` section in repo — fallback
3. No gates found — skip Gate 1, rely on Gate 2 (CI) if it exists

## Implementation Plan

### Phase 1: PRD Decomposer + Board Metadata

1. Add `qualityGates` extraction to PRD decomposer (`api/src/routes/prd.ts`)
   - Parse "Pre-Commit Quality Gate" sections from PRD text
   - Extract commands and file triggers into structured JSON
   - Store on `KbBoard.metadata.qualityGates`

2. Add `qualityGates` to task claim response
   - When orchestrator claims a task, include board's `qualityGates` in the response
   - Worker receives gates via existing config pipeline — no new API endpoint

### Phase 2: Pre-Commit Gate (Gate 1)

3. Add `runQualityGate(worktreePath: string, commands: string[])` method in `worker/epic/executor.ts`
   - Runs each command sequentially in the worktree
   - Captures stdout/stderr
   - Returns `{ passed: boolean, output: string, failedCommand: string }`

4. Add gate trigger matching
   - After expert finishes, run `git diff --name-only` to get changed files
   - Match against gate triggers (e.g., `api/**` → backend gates)
   - Run matching gates before allowing git commit

5. Wire into story execution flow
   - On failure: feed error output to expert as retry context
   - Max 3 gate retries per story before escalating as blocker
   - Fallback: if no board metadata gates, check CLAUDE.md in worktree

### Phase 3: Post-Push CI Gate (Gate 2)

6. Add `waitForCI(branch: string, repo: string)` method in `worker/epic/git-ops.ts`
   - Polls GitHub/Bitbucket CI API for run status
   - Classifies failure (code vs infrastructure)
   - Downloads failure log for code issues
   - Returns `{ passed: boolean, log?: string, infrastructureFailure?: boolean }`

7. Add `checkCIWorkflowExists(worktreePath: string, ciPath: string)` utility
   - Checks if the CI workflow file exists in the worktree
   - `ciPath` comes from board metadata (e.g., `.github/workflows/ci.yml`)
   - If no CI file → skip Gate 2 silently
   - Once a card creates the CI workflow → all subsequent cards enforce

8. Wire into story execution flow (after git push)
   - Check if CI workflow exists → if not, skip
   - Wait for CI completion (10 min timeout)
   - On code failure: retry story with CI log as context
   - On infra failure: escalate as blocker

### Phase 4: PR CI Gate (Gate 3)

9. Add CI wait before Tech Lead review in `coordinator.ts`
   - After PR creation, before `runTechLeadReview()`
   - Same `waitForCI()` from Phase 3, but for the PR/feature branch
   - On failure: spawn fix expert targeting the specific files

### Phase 5: Dashboard Visibility

10. Add CI status to task/story coordination feed
    - Post `ci_running`, `ci_passed`, `ci_failed` context messages
    - Dashboard shows CI status inline with story progress
    - Failed CI logs visible in the comms feed

## Retry Behavior

| Gate | Max Retries | On Exhaust |
|------|-------------|------------|
| Pre-commit (Gate 1) | 3 per story | Escalate as blocker |
| Post-push CI (Gate 2) | 2 per story | Escalate as blocker |
| PR CI (Gate 3) | 1 (spawn fix expert) | Escalate as blocker |

## What This Does NOT Change

- **Auto-merge flow** — unchanged, still in coordinator.ts:3167-3179
- **Tech Lead review** — unchanged, still runs after CI passes
- **Story execution** — same expert spawning, same retry logic, new gates inserted between existing steps
- **Prompt-based gates** — still included in prompts as guidance, but now enforced by executor

## Risks

| Risk | Mitigation |
|------|------------|
| CI polling adds latency to story completion | Acceptable — 1-2 min CI wait vs hours of broken builds |
| CI API rate limits (GitHub: 5000/hr) | Poll every 10s, ~60 calls per story max. Well within limits. |
| Flaky CI (test passes locally, fails in CI) | Retry once. If flaky twice, escalate — flaky tests are real bugs. |
| Greenfield repo — no CI, no CLAUDE.md | Gate 1 uses PRD-derived board metadata (works from card 1). Gate 2 auto-detects CI workflow file — skips until it exists, enforces once created. |
| Quality gate commands are slow | Timeout per command (5 min). Total gate timeout (15 min). |
| PRD doesn't define quality gates | Decomposer warns. Gate 1 skipped, Gate 2 still enforces if CI exists. Board owner can add gates manually to board metadata. |
