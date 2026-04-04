# Advanced Features

Advanced capabilities for teams that want deeper control over WorkerMill's planning and execution pipeline.

## Task Planning Pipeline

WorkerMill's planning pipeline breaks your ticket into an executable plan before any code is written.

### Phase 1 — Planning Phase

The Planning Agent analyzes your ticket and creates an execution plan.

- Parse ticket summary, description, and acceptance criteria
- Analyze codebase structure and requirements
- Decompose into discrete, implementable stories
- Determine dependencies between stories
- Output: `plan.json` with full execution plan

### Phase 2 — Dependency Resolution

Determine execution order based on story dependencies.

- Build dependency graph between stories
- Identify stories that can run in parallel
- Queue stories respecting dependency order
- Track ready/blocked/running states

### Phase 3 — Parallel Execution

Execute stories in parallel (respecting dependencies).

- Multiple workers execute simultaneously
- Each worker gets its own git worktree
- Workers communicate via the coordination feed
- Sibling branch rebase keeps branches in sync

### Phase 4 — Consolidation

Merge all expert changes into a single coherent PR.

- Integration check for cross-story conflicts
- Auto-fix integration issues where possible
- Single PR created with all changes

### Phase 5 — Review

Tech Lead Reviewer evaluates the consolidated PR.

- Code quality and correctness check
- Spec compliance verification
- Approve, reject, or request up to 4 revisions

## Critic-Planner Loop

Before execution begins, a **Critic Agent** scores the plan (0–100). If the plan scores below 85, the planner refines it:

1. Planner creates initial plan
2. Critic scores plan across dimensions
3. If score < 85, planner revises (up to 3 iterations)
4. Score ≥ 85 → plan approved, execution begins

This ensures workers start with high-quality, well-structured plans.

## Parallel Expert Coordination

When multiple workers are executing stories in parallel, they communicate via the **Coordination Feed**:

- Workers announce decisions that affect shared code
- Other workers see decisions before starting related work
- Blocking questions are posted and answered in real time
- The coordinator routes questions to the right expert

## Quality Gates

WorkerMill enforces two quality gates on every task:

**Gate 1 — Pre-commit**
Shell commands from the `quality_gate_commands` board column run before every commit. Typically: `npm run lint`, `npm run typecheck`, `npm run test`.

**Gate 2 — Post-push CI**
After the PR is pushed, WorkerMill polls your CI system (GitHub Actions, Bitbucket Pipelines, GitLab CI) and auto-fixes failures surgically.

## Auto-Fix Agent

When quality gates fail, the **Auto-Fix Agent** analyzes the failure and applies targeted fixes:

- Reads the error output
- Identifies the root cause
- Makes the minimum change needed to pass
- Retries the gate
- Up to `maxFixRetries` attempts (default: 5)

## Self-Improvement

After each epic completes, the **Improver Agent** analyzes execution logs and automatically improves:

- `Dockerfile` — dependency caching, build steps
- Worker directives — common mistakes, better patterns
- Persona routing rules — better task assignment

## Model & Provider Routing

Route different personas to different providers for optimal cost/performance:

```
backend_developer  → claude-opus-4-6     (complex reasoning)
frontend_developer → claude-sonnet-4-6   (fast, balanced)
qa_engineer        → claude-haiku-4-5    (efficient for test generation)
security_engineer  → claude-opus-4-6     (thorough security analysis)
```

Configure at **Settings → AI Providers → Persona Routing**.

## Spec Scorer & Improver

Before decomposing a ticket into stories, WorkerMill scores the spec (0–100) and optionally rewrites weak sections:

- Completeness, Clarity, Decomposability, Constraints, Testability
- Auto-improves specs scoring < 85
- Approval threshold configurable (default: 85)

## PRD Dependency Validator

For large PRDs (product requirements documents), a pre-decomposition check validates:

- Version conflicts between specified dependencies
- Ecosystem mismatches (e.g., mixing incompatible libraries)
- Port collisions in service definitions
- Missing infrastructure declarations

This catches problems before workers start coding.

## Feedback Aggregator

WorkerMill tracks patterns in PR feedback across all tasks:

- Collects feedback from Tech Lead Reviewer and human reviewers
- Identifies patterns occurring 3+ times → promotes to `common_mistake` or `best_practice`
- Routes findings back to persona directives automatically
- Workers improve over time without manual intervention
