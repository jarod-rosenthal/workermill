# Phased Story Execution - Implementation Plan

## Overview

This document describes the implementation of **Phased Story Execution**, a new execution mode that breaks story execution into smaller phases with fresh context windows. This addresses context window degradation in long-running agent sessions.

**Trigger:** Add `phased` label to Jira ticket (alongside `epic` or `multi-provider`)

**Core Principle:** Each story is decomposed into **implementation units** (bounded work packages), with each unit running as a fresh agent session with an explicit context contract.

---

## Problem Statement

### Current State

In Epic mode, each story runs as a single agent session:

```
Story Start → Read files → Plan → Implement → Test → Fix → Commit → Story End
              ├─────────────── Single Agent Session ──────────────────┤
              └─────────────── 100-200K tokens accumulated ───────────┘
```

**Issues:**
1. Context window fills up, degrading reasoning quality
2. No recovery point if agent gets stuck mid-story
3. Late-stage reasoning operates on degraded context
4. Entire story must be re-run on failure

### Target State

Stories decomposed into **implementation units**, each with fresh context and explicit handoff contracts:

```
Story Start
    ↓
┌─────────────────────────┐
│ ANALYZE Phase           │  ~15K tokens, fresh agent
│ Produces authoritative  │
│ implementation plan     │
└────────────┬────────────┘
             ↓ outputs: { units, patterns, decisions }
┌─────────────────────────┐
│ IMPLEMENT Unit 1        │  ~25K tokens, fresh agent
│ "Auth endpoints"        │  Files: [route.ts, middleware.ts]
│ + PhaseInputBundle      │
└────────────┬────────────┘
             ↓ checkpoint commit
┌─────────────────────────┐
│ IMPLEMENT Unit 2        │  ~20K tokens, fresh agent
│ "User model"            │  Files: [User.ts, types.ts]
│ + PhaseInputBundle      │
└────────────┬────────────┘
             ↓ checkpoint commit
┌─────────────────────────┐
│ INTEGRATE Phase         │  ~15K tokens, fresh agent
│ Coherence check         │
└────────────┬────────────┘
             ↓
┌─────────────────────────┐
│ VERIFY Phase            │◄──┐  ~15K tokens
└────────────┬────────────┘   │
             │                │
        passed?               │
             │                │
      ┌──────┴──────┐         │
      ↓             ↓         │
   COMMIT        FIX ─────────┘ (max 3)
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger mechanism | New label `phased` | Safe rollout, A/B testable, doesn't break existing Epic mode |
| **Work unit** | **Implementation unit (file set)** | Files are often coupled; per-file causes thrash |
| **Phase planning** | **Analyze outputs authoritative plan** | `targetFiles` from Jira may be incomplete/wrong |
| State persistence | WorkerContext table | Existing infrastructure, SSE streaming |
| Model selection | Same model all phases | Simpler, consistent behavior |
| **Checkpointing** | **Commit after each unit** | Strong resume semantics, squash at end |

---

## Key Concepts

### Implementation Units (Not Per-File)

The original plan used per-file phases. Feedback correctly identified this is often the wrong boundary:

> "Adding a feature often requires touching model + service + route + tests together."

**Solution:** The **Analyze phase** outputs `implementationUnits`:

```typescript
interface ImplementationUnit {
  name: string;                    // "Auth endpoints", "User model update"
  files: string[];                 // Files modified together in this unit
  goal: string;                    // What this unit accomplishes
  dependencies: number[];          // Unit indices that must complete first
  allowedTouchSet: string[];       // Files the agent MAY edit (superset of files)
  estimatedTokens: number;         // Budget estimate
}
```

**Example:** A story with `targetFiles: ["route.ts", "middleware.ts", "User.ts"]` might become:

```
Unit 0: "User model and types"
  files: ["User.ts", "types.ts"]
  allowedTouchSet: ["User.ts", "types.ts", "index.ts"]

Unit 1: "Auth endpoints" (depends on Unit 0)
  files: ["route.ts", "middleware.ts"]
  allowedTouchSet: ["route.ts", "middleware.ts", "index.ts"]
```

This preserves fresh-context benefits while allowing coupled files to be modified together.

---

### PhaseInputBundle (Context Contract)

Each phase receives a deterministic **PhaseInputBundle** that provides grounding without relying on tool reads to rediscover basics:

```typescript
interface PhaseInputBundle {
  // === Always included ===
  storyRequirements: {
    title: string;
    scope: string;
    acceptanceCriteria: string[];
  };

  analyzeOutputs: {
    patterns: string[];           // From analyze phase
    keyDecisions: string[];       // Architectural decisions
    techConstraints: string[];    // From PRD/coordination feed
  };

  // === Repo state summary ===
  repoState: {
    gitDiffStat: string;          // `git diff --stat` output
    changedFiles: string[];       // Files changed so far
    newFilesCreated: string[];    // Files created this story
  };

  // === Unit-specific (for implement phases) ===
  unitContext?: {
    targetFiles: string[];        // Files to modify in this unit
    allowedTouchSet: string[];    // Files permitted to edit
    relevantSnippets: Array<{     // Pre-injected content (not via tool reads)
      filePath: string;
      content: string;            // Full file or targeted excerpt
      reason: string;             // Why included
    }>;
    priorUnitDecisions: string[]; // Decisions from completed units
  };

  // === Verify-specific ===
  verifyContext?: {
    commandsToRun: string[];      // Test commands, type-check, lint
    acceptanceCriteria: string[]; // What to check
  };
}
```

**Key insight:** Pre-injecting relevant file content in the prompt prevents token-expensive re-discovery each phase.

---

### Change of Plan Mechanism

If an implement phase realizes the plan is wrong, it should **request a plan update** instead of silently diverging:

```typescript
interface PlanUpdateRequest {
  reason: string;                  // Why the plan needs to change
  suggestedNewFiles: string[];     // Files that need to be added
  suggestedRemovals: string[];     // Files that don't need changes
  risks: string[];                 // Risks of the change
  severity: "minor" | "major";     // Minor: auto-approve. Major: mini-analyze.
}
```

**Orchestrator response:**
- `minor` severity: Auto-approve, add files to `allowedTouchSet`
- `major` severity: Spawn a "mini-analyze" phase to reassess

This prevents spec drift while allowing legitimate plan evolution.

---

## Architecture

### Phase Types

```typescript
type PhaseType =
  | "analyze"      // Read codebase, produce authoritative plan
  | "implement"    // Modify files for a specific unit
  | "integrate"    // Coherence check after all units (NEW)
  | "verify"       // Run tests, type-check, validate AC
  | "fix"          // Address specific issues (always followed by verify)
  | "commit";      // Finalize all changes (squash checkpoint commits)
```

### Phase Flow (Updated)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Story Execution Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. ANALYZE (once per story)                                            │
│     ├─ Inputs: story requirements, targetFiles (hints), repo structure  │
│     ├─ Actions: Read codebase, identify patterns, create plan           │
│     ├─ Outputs: AnalyzeResult (AUTHORITATIVE)                           │
│     │   - existingPatterns: string[]                                    │
│     │   - keyDecisions: string[]                                        │
│     │   - implementationUnits: ImplementationUnit[]  ← THE PLAN         │
│     │   - additionalFilesNeeded: string[]                               │
│     │   - techConstraints: string[]                                     │
│     └─ Token budget: 15K                                                │
│     └─ Read budget: 8 files max                                         │
│                                                                         │
│  2. IMPLEMENT (once per unit)                                           │
│     ├─ Inputs: PhaseInputBundle with unit-specific context              │
│     │   - Pre-injected file contents (no re-reading basics)             │
│     │   - Prior unit decisions                                          │
│     │   - Git diff stat showing current state                           │
│     ├─ Actions: Modify files in allowedTouchSet                         │
│     ├─ Can request: PlanUpdateRequest if plan is wrong                  │
│     ├─ Outputs: ImplementResult                                         │
│     │   - filesModified: string[]                                       │
│     │   - decisions: string[]                                           │
│     │   - exportsAdded: string[]                                        │
│     │   - importsNeeded: string[]                                       │
│     └─ Token budget: 25K                                                │
│     └─ Read budget: 5 files max (beyond pre-injected)                   │
│     └─ CHECKPOINT: git commit after each unit                           │
│                                                                         │
│  3. INTEGRATE (once, after all units) - NEW                             │
│     ├─ Inputs: All unit outputs, import/export lists                    │
│     ├─ Actions: Fix imports, exports, index files, type coherence       │
│     ├─ Outputs: IntegrateResult                                         │
│     │   - filesFixed: string[]                                          │
│     │   - issuesFound: string[]                                         │
│     └─ Token budget: 15K                                                │
│     └─ CHECKPOINT: git commit                                           │
│                                                                         │
│  4. VERIFY (with retry loop)                                            │
│     ├─ Inputs: PhaseInputBundle with verify context                     │
│     │   - Commands to run                                               │
│     │   - Acceptance criteria                                           │
│     ├─ Actions: Run tests, type-check, lint, check AC                   │
│     ├─ Outputs: VerifyResult                                            │
│     │   - passed: boolean                                               │
│     │   - issues: VerifyIssue[] (with file, line, command logs)         │
│     │   - commandOutputs: { command, exitCode, truncatedLog }[]         │
│     └─ Token budget: 20K                                                │
│                                                                         │
│  5. FIX (conditional, max 3 iterations)                                 │
│     ├─ Inputs: Verify issues with command logs                          │
│     ├─ Actions: Fix specific issues                                     │
│     ├─ Outputs: FixResult                                               │
│     │   - issuesAddressed: string[]                                     │
│     │   - filesModified: string[]                                       │
│     └─ Token budget: 20K                                                │
│     └─ ALWAYS followed by VERIFY (mandatory re-validation)              │
│                                                                         │
│  6. COMMIT (deterministic, no agent)                                    │
│     ├─ Actions: Squash checkpoint commits, create final commit          │
│     ├─ Commit message: "feat(JIRA-123): Story title"                    │
│     └─ Push branch                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Machine

```
                    ┌──────────────┐
                    │    START     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   ANALYZE    │
                    └──────┬───────┘
                           │ success → produces units[]
                           ▼
              ┌────────────────────────────┐
              │     IMPLEMENT LOOP         │
              │  (for each unit in order)  │
              │  + checkpoint commit each  │
              └────────────┬───────────────┘
                           │ all units done
                           ▼
                    ┌──────────────┐
                    │  INTEGRATE   │  ← NEW: coherence check
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
            ┌──────►│    VERIFY    │◄─────────┐
            │       └──────┬───────┘          │
            │              │                  │
            │       ┌──────┴──────┐           │
            │       │             │           │
            │  passed?         failed?        │
            │       │             │           │
            │       ▼             ▼           │
            │ ┌──────────┐  ┌──────────┐      │
            │ │  COMMIT  │  │   FIX    │──────┘
            │ │ (squash) │  └──────────┘  (always re-verify)
            │ └──────────┘        │
            │       │             │ (max 3 iterations)
            │       ▼             ▼
            │ ┌──────────┐  ┌──────────┐
            │ │ SUCCESS  │  │  FAILED  │
            │ └──────────┘  └──────────┘
            │
            └── plan_update_requested? → mini-analyze → resume
```

---

## Token Budget & Read Controls

### Per-Phase Budgets

| Phase | Token Budget | Read Budget | Rationale |
|-------|--------------|-------------|-----------|
| Analyze | 15K | 8 files | Discovery phase, needs exploration |
| Implement | 25K | 5 files (beyond pre-injected) | Focused work, content pre-injected |
| Integrate | 15K | 3 files | Targeted fixes only |
| Verify | 20K | 2 files | Mostly running commands |
| Fix | 20K | 3 files | Targeted fixes with command logs |

### Pre-Injection Strategy

To prevent re-reading the same files each phase:

1. **Analyze phase** reads files and outputs `relevantSnippets` for each unit
2. **Implement phases** receive these snippets in `PhaseInputBundle.unitContext.relevantSnippets`
3. Agent can still use Read tool for additional context, but basics are pre-injected

**Example PhaseInputBundle for Implement:**

```typescript
{
  storyRequirements: {
    title: "Add user authentication",
    scope: "Add login/logout endpoints with JWT",
    acceptanceCriteria: [
      "POST /auth/login returns JWT token",
      "POST /auth/logout invalidates token",
      "Middleware validates JWT on protected routes"
    ]
  },
  analyzeOutputs: {
    patterns: ["Express route handlers in src/routes/", "Middleware in src/middleware/"],
    keyDecisions: ["Use jsonwebtoken library", "Store refresh tokens in Redis"],
    techConstraints: ["TypeScript strict mode", "ESLint + Prettier"]
  },
  repoState: {
    gitDiffStat: "2 files changed, 45 insertions(+)",
    changedFiles: ["src/models/User.ts", "src/types/auth.ts"],
    newFilesCreated: ["src/types/auth.ts"]
  },
  unitContext: {
    targetFiles: ["src/routes/auth.ts", "src/middleware/auth.ts"],
    allowedTouchSet: ["src/routes/auth.ts", "src/middleware/auth.ts", "src/routes/index.ts"],
    relevantSnippets: [
      {
        filePath: "src/routes/users.ts",
        content: "// Full file content here...",
        reason: "Example route handler pattern to follow"
      },
      {
        filePath: "src/middleware/error.ts",
        content: "// Full file content here...",
        reason: "Example middleware pattern"
      }
    ],
    priorUnitDecisions: ["Created User model with passwordHash field", "Added AuthTokenPayload type"]
  }
}
```

---

## Data Models

### New Types (`worker/epic/phased-types.ts`)

```typescript
/**
 * Implementation unit - a bounded work package.
 * May contain multiple coupled files.
 */
export interface ImplementationUnit {
  index: number;
  name: string;                    // Human-readable name
  files: string[];                 // Primary files to modify
  goal: string;                    // What this unit accomplishes
  dependencies: number[];          // Unit indices that must complete first
  allowedTouchSet: string[];       // Files permitted to edit (superset)
  relevantSnippets: RelevantSnippet[];  // Pre-read content for this unit
  estimatedTokens: number;
}

export interface RelevantSnippet {
  filePath: string;
  content: string;
  reason: string;                  // Why this was included
}

/**
 * Phase execution result stored in WorkerContext
 */
export interface PhaseResult {
  phaseId: string;                 // "analyze", "implement-0", "integrate", etc.
  phaseType: PhaseType;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  outputs?: PhaseOutputs;
  tokenUsage?: { input: number; output: number };
  readCount?: number;              // Files read (for budget tracking)
  checkpointCommit?: string;       // Git SHA if checkpoint created
  error?: string;
}

export interface AnalyzeOutputs {
  existingPatterns: string[];
  keyDecisions: string[];
  implementationUnits: ImplementationUnit[];
  additionalFilesNeeded: string[];
  techConstraints: string[];
  estimatedTotalTokens: number;
}

export interface ImplementOutputs {
  unitIndex: number;
  filesModified: string[];
  decisions: string[];             // Decisions for sibling visibility
  exportsAdded: string[];          // For integrate phase
  importsNeeded: string[];         // For integrate phase
  planUpdateRequest?: PlanUpdateRequest;
}

export interface IntegrateOutputs {
  filesFixed: string[];
  importExportIssuesFixed: number;
  typeIssuesFixed: number;
}

export interface VerifyOutputs {
  passed: boolean;
  issues: VerifyIssue[];
  commandOutputs: CommandOutput[];
  testResults?: { passed: number; failed: number; skipped: number };
  typeCheckPassed: boolean;
  lintPassed: boolean;
  acceptanceCriteriaResults: Array<{
    criterion: string;
    met: boolean;
    evidence: string;
  }>;
}

export interface VerifyIssue {
  type: "test_failure" | "type_error" | "lint_error" | "acceptance_gap";
  file?: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
  commandLog?: string;             // Truncated log for FIX grounding
}

export interface CommandOutput {
  command: string;
  exitCode: number;
  truncatedLog: string;            // Top N lines + error excerpts
  durationMs: number;
}

export interface FixOutputs {
  issuesAddressed: string[];
  issuesRemaining: string[];
  filesModified: string[];
}

export interface PlanUpdateRequest {
  reason: string;
  suggestedNewFiles: string[];
  suggestedRemovals: string[];
  risks: string[];
  severity: "minor" | "major";
}
```

### WorkerContext Message Types

Add to existing `ContextMessageType`:

```typescript
export type ContextMessageType =
  // ... existing types ...
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "phase_outputs"
  | "phase_checkpoint"             // Checkpoint commit created
  | "phase_plan_update_requested"  // Agent requests plan change
  | "phase_plan_updated";          // Orchestrator approved change
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

| Task | File | Description |
|------|------|-------------|
| 1.1 | `worker/epic/phased-types.ts` | Type definitions |
| 1.2 | `worker/epic/phased-executor.ts` | Main orchestrator |
| 1.3 | `worker/epic/phase-input-builder.ts` | Build PhaseInputBundle |
| 1.4 | `worker/epic/checkpoint-manager.ts` | Git checkpoint commits |

### Phase 2: Phase Implementations

| Task | File | Description |
|------|------|-------------|
| 2.1 | `worker/epic/phases/analyze.ts` | Analyze phase (outputs units) |
| 2.2 | `worker/epic/phases/implement.ts` | Implement phase (per unit) |
| 2.3 | `worker/epic/phases/integrate.ts` | Integrate phase (coherence) |
| 2.4 | `worker/epic/phases/verify.ts` | Verify phase (with command logs) |
| 2.5 | `worker/epic/phases/fix.ts` | Fix phase (paired with verify) |

### Phase 3: Plan Update Mechanism

| Task | File | Description |
|------|------|-------------|
| 3.1 | `worker/epic/plan-updater.ts` | Handle PlanUpdateRequest |
| 3.2 | `worker/epic/phases/mini-analyze.ts` | Lightweight re-analyze |

### Phase 4: Coordinator Integration

| Task | File | Description |
|------|------|-------------|
| 4.1 | `worker/epic/coordinator.ts` | Add phased mode detection |
| 4.2 | `worker/epic/types.ts` | Add labels to EpicConfig |
| 4.3 | `api/src/models/WorkerContext.ts` | Add phase message types |
| 4.4 | `api/src/services/orchestrator.ts` | Pass labels to container |

### Phase 5: Testing & Metrics

| Task | File | Description |
|------|------|-------------|
| 5.1 | `worker/epic/__tests__/` | Unit tests |
| 5.2 | Metrics setup | Track success metrics |

---

## Success Metrics

### Primary Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Token reduction** | 30%+ vs monolithic | Compare total tokens per story |
| **Late-stage reasoning quality** | Fewer fix iterations | Track verify pass rate on first attempt |
| **Recovery granularity** | Phase-level retry | Track retry scope (phase vs story) |

### Diagnostic Metrics (From Feedback)

| Metric | What It Reveals | Alert Threshold |
|--------|-----------------|-----------------|
| **Redo rate per phase** | Which phases are unreliable | > 20% redo rate |
| **Verify issue locality** | Are issues from current unit or prior? | > 30% issues outside last unit |
| **Context re-discovery cost** | Tokens spent on file reads per phase | > 30% of phase budget |
| **Plan drift frequency** | How often implement deviates from analyze | > 25% of stories |
| **Time-to-first-green** | Wall clock from start → verify passed | Baseline + track improvement |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Cross-phase coherence** (main risk) | Explicit PhaseInputBundle, pre-injected snippets, structured outputs |
| Units still too coupled | Analyze can merge files; allowedTouchSet provides flexibility |
| Plan update abuse | Severity gating; major changes require mini-analyze |
| Token budget exceeded | Hard kill switch; degrade gracefully |
| Checkpoint commits clutter history | Squash at final COMMIT phase |
| FIX loop doesn't converge | Max 3 iterations; escalate to human |

---

## Comparison: Original vs Updated Plan

| Aspect | Original Plan | Updated Plan |
|--------|---------------|--------------|
| Work unit | Per-file | Implementation unit (file set) |
| Phase planning | Deterministic from metadata | Analyze outputs authoritative plan |
| Context handoff | "Prior outputs" | Explicit PhaseInputBundle with pre-injected content |
| File reading | Agent reads as needed | Read budgets + pre-injection |
| Coherence | None | INTEGRATE phase |
| Plan changes | Not handled | PlanUpdateRequest mechanism |
| Checkpoints | Final commit only | Commit after each unit |
| FIX validation | Implicit | Mandatory verify after every fix |
| Success metrics | 3 basic | 5 diagnostic + 3 primary |

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Per-file vs file-set? | File-set (implementation units) |
| Deterministic planning? | Analyze outputs authoritative plan |
| How to prevent re-reading? | PhaseInputBundle with pre-injected snippets |
| FIX without re-verify? | Mandatory verify after every fix |
| Plan goes wrong mid-story? | PlanUpdateRequest mechanism |

## Remaining Open Questions

1. **Parallel unit execution?** Units with no dependencies could run in parallel. Adds complexity. Defer to v2?

2. **Analyze phase caching?** If story retries, reuse analyze outputs? Risk: stale plan.

3. **Snippet selection algorithm?** How does Analyze decide which snippets to pre-inject for each unit? Heuristic vs LLM-selected?

4. **Integration with Tech Lead review?** Does reviewer see phases or just final result? Phase-level comments possible?
