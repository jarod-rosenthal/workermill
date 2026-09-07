# Spec Check, Plan Critic & Quality Gates

Quality gates run shell commands against the prepared candidate before review, and run again if reviewer revisions change it. Static gates and required story commands block completion when they fail. Planner-generated verification remains reviewer context outside strict mode.

Use gates to check observable acceptance criteria independently of a worker's explanation. Passing tests and model review provide evidence about the checks performed; neither proves the absence of defects.

---

## Spec Check

Before the planner runs, a spec check can identify ambiguities in your task description that would likely cause a revision cycle — things where the expert will have to guess, and guessing wrong means rework.

When a gap is found, you're prompted to answer it inline before planning starts:

```
Spec check: What format should the export output? (json/csv/both)
Suggestion: json  (Enter to accept, or type your answer)
◆ _
```

Press **Enter** to accept the suggestion, or type your answer. Press **Esc** to skip and use the suggestion automatically. The answer is appended to your spec before it reaches the planner.

If you run `/build` unattended (e.g. via a script), suggestions are applied silently and logged — no prompt blocks the run.

**What it flags:** Only high-severity gaps — things where the wrong assumption causes real rework. It won't interrupt you for implementation details, naming, or anything a reasonable developer would handle correctly.

**Enable it:**
```json
// .workermill/config.json
{
  "review": {
    "specCheck": true
  }
}
```

---

## Planner Critic

The spec check catches a bad *task*. The planner critic catches a bad *plan*.

With `review.critic` enabled, the plan is scored between planning and execution — before a single worker starts. The critic reads the task and the proposed stories and scores them 1-10 across five dimensions:

| Dimension | The question it asks |
|---|---|
| **completeness** | Does executing every story actually satisfy the task? Is a required deliverable missing? |
| **feasibility** | Can a worker execute each story from its description alone? Are the named files and patterns concrete? |
| **dependencies** | Is the ordering right? Does a story need something a later story creates? |
| **scope** | Is a story too large for one pass, or so trivial it should be merged? Is there work nobody asked for? |
| **risk** | Are the risky parts identified? Do `requiredTests`/`requiredCommands` actually prove the story landed? |

A score below `criticThreshold` (default 8) sends the plan back for a targeted refinement pass against the critic's specific issues, then it's scored again — up to 3 rounds.

```
🔍 Scoring the plan with anthropic/claude-sonnet-4-6 (threshold 8/10)
🔍 Plan scored 5/10 (needs 8) — no story covers the migration rollback path
🔍   [completeness] Schema change has no rollback story
🔍   [risk] requiredCommands don't exercise the new column
🔍 Refining the plan (round 1 of 2)...
🔍 Plan approved — 9/10. Rollback and verification now covered.
```

**If the plan still doesn't pass after 3 rounds**, the remaining issues are printed and the run continues to the normal "Execute this plan?" confirmation — you decide whether it's good enough. Under `review.strict`, it aborts instead.

**A critic that errors never blocks a build.** If the model is unreachable or returns something unparseable, the run proceeds with the planner's original plan and says so.

**Enable it:**
```
/settings review.critic true
/settings review.criticThreshold 8
```

**Route it separately if useful.** The critic reads the plan and adds model calls; actual cost depends on the selected model, usage, and refinements:

```json
{
  "routing": { "critic": "anthropic" }
}
```

**When to use it:** refactors, schema migrations, security-sensitive work — anything where a bad plan costs more than a few critic calls.

**When to skip it:** trivial tasks, quick fixes, exploration. The critic adds latency and tokens to every `/build`.

---

## Quality Gates

There are two sources of quality gates:

1. **Planner-generated (dynamic)** — the planner generates verification commands per story based on what it reads in your codebase. **On by default** (`verifyEnabled: true`). If the planner can't generate meaningful commands for a story, nothing runs — there's no cost.

2. **Static gates** — shell commands you define in `qualityGates` that run on every `/build`. **Off by default** (empty array). You must add these yourself.

No configuration is required for dynamic gates — the planner handles it. To disable them:

```json
// .workermill/config.json
{
  "review": {
    "verifyEnabled": false
  }
}
```

---

## How It Works

The final verification sequence is:

```
Prepare candidate → Run gates → Review/revise → Recheck changed state → Publication prompt
```

Candidate preparation commits remaining changes on the feature branch before collecting final evidence. Blocking gate failures stop immediately, preserving local work. Otherwise, the reviewer receives the gate summary, including advisory failures. Without configured acceptance checks, review has no corresponding automated pass/fail evidence.

If a gate changes non-ignored source, WorkerMill prepares that new candidate and runs gates once more. A second source change blocks completion rather than repeating indefinitely. Reviewer revisions invalidate earlier gate evidence: gates run again, and must pass the applicable policy without changing the reviewed state. Unchanged state does not trigger redundant gate execution.

Review approval requires both `REVIEW_DECISION: approved` and a score meeting
`review.approvalThreshold`. A high score does not override a rejected or
revision-needed decision. Missing, contradictory, or invalid markers are a
failed review parse, not approval; disabled review is reported separately.

With `review.strict: true` and review enabled, publication requires valid approval. Outside strict mode, review can remain advisory, but a failed or unavailable review is never reported as approval. Setting `review.enabled: false` skips approval, not required gates or final-state checks.

### Stale evidence and recovery

Evidence includes HEAD, index entries, and current tracked/untracked non-ignored file content, modes, symlink targets, and deletions. Merely keeping the same commit does not preserve an approval. WorkerMill rechecks evidence after publication confirmations and verifies that the expected feature branch still points at the candidate before pushing or creating a PR.

If source changes during a prompt, publication stops. Inspect your changes, fix the cause, and use `/retry`; a saved run can need final verification even when every story is implemented. A source-changing `ship_complete` hook invalidates the final local result and preserves retry state. That hook runs after the publication phase: it cannot undo a push, PR, or external action already completed.

Fingerprinting does not run Git filters or external diff programs. It excludes ignored files and currently fails closed for unsupported repository states, including submodules, unmerged index entries, files over 16 MiB, or more than 64 MiB of file content. An unverified state is not permission to publish. These checks detect observed changes; they are not an atomic filesystem lock against concurrent external writers.

---

## Definition-of-Done Contracts

The planner emits structured completion requirements per story — not just prose:

```json
{
  "id": "story-2",
  "title": "Implement wm stats command",
  "requiredFiles": ["src/stats-command.ts"],
  "requiredTests": ["src/__tests__/stats-command.test.ts"],
  "requiredCommands": ["npm run typecheck", "npx vitest run src/__tests__/stats-command.test.ts"]
}
```

After each story executes, the orchestrator validates:
- Every `requiredFile` exists on disk
- Every `requiredTest` exists and is not only in excluded suites (e.g. e2e-only)
- Every `requiredCommand` passes (exit code 0)

Failures block story completion with machine-readable failure codes: `missing_required_file`, `missing_required_test`, `test_only_in_excluded_suite`, `required_command_failed`, `worker_no_output`.

---

## Two Sources of Gates

### 1. Planner-generated (dynamic)

When `verifyEnabled: true`, the planner generates `verificationCommands` per story based on what it reads in your codebase. You never write these yourself.

**Example — Node.js REST API, adding a new endpoint:**
```json
{
  "id": "add-search-endpoint",
  "title": "Add GET /api/search endpoint",
  "verificationCommands": [
    "curl -sf 'http://localhost:3000/api/search?q=test' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.results) process.exit(1)\"",
    "curl -sf 'http://localhost:3000/api/search' -o /dev/null -w '%{http_code}' | grep -E '^(200|400)$'"
  ]
}
```

**Example — Python CLI tool, adding an export command:**
```json
{
  "id": "add-export-command",
  "title": "Add export subcommand",
  "verificationCommands": [
    "python -m mytool export --format json | python3 -c \"import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)\"",
    "python -m mytool export --help | grep -E 'format|output'"
  ]
}
```

**Example — Go CLI, adding a config validation command:**
```json
{
  "id": "add-config-validate",
  "title": "Add config validate subcommand",
  "verificationCommands": [
    "./bin/mytool config validate --config testdata/valid.yaml && echo OK",
    "./bin/mytool config validate --config testdata/invalid.yaml; [ $? -ne 0 ] && echo 'correctly rejected'"
  ]
}
```

**Example — Ruby on Rails, adding a rake task:**
```json
{
  "id": "add-report-task",
  "title": "Add rake reports:generate task",
  "verificationCommands": [
    "bundle exec rake reports:generate FORMAT=json | ruby -e \"require 'json'; JSON.parse(STDIN.read)\""
  ]
}
```

### 2. Static config (manual)

For project-wide output assertions that should run on every `/build`. Only useful for things that don't change per-feature.

Static gates can include `typecheck`, `npm test`, `go build`, or `pytest` when you require those checks against the final candidate. A worker's earlier test run is not a substitute for final-state verification. Keep the suite bounded and avoid watch-mode commands.

**Use static gates for:** invariants about the built artifact that should always hold:

```json
// .workermill/config.json
{
  "qualityGates": [
    {
      "name": "app starts",
      "commands": ["timeout 5 ./bin/myapp --help > /dev/null"]
    },
    {
      "name": "config schema valid",
      "commands": ["./bin/myapp config validate --config config/defaults.yaml"]
    }
  ]
}
```

---

## What the Reviewer Sees

When all gates pass:

```
## Quality Gate Results — ALL PASSED

- ✓ verify: Add GET /api/search endpoint
- ✓ verify: Add pagination to search results
- ✓ app starts
```

When a gate fails:

```
## Quality Gate Results — 1 FAILED

### verify: Add GET /api/search endpoint — FAILED
```
curl -sf 'http://localhost:3000/api/search?q=test' | node -e ...
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

Planner-generated verification failures are informational outside strict mode — factor them into your review score and flag as must-fix if they represent acceptance criteria gaps. Static gates and required story commands are blocking by default.
```

The reviewer flags it; the expert fixes it in the revision loop.

---

## What Makes a Good Verification Command

**Must:**
- Assert observable output — run the thing, check what comes out
- Exit non-zero if the acceptance criteria aren't met
- Run from the project root with no manual setup
- Be scoped to this story's deliverable

**Must not:**
- Duplicate what the expert already ran (`npm test`, `pytest`, `go build`, `tsc`)
- Start a server or watch process
- Require external services not in the repo

**The test:** if the command would pass even if the feature was only half-implemented, it's not a good gate.

---

## Configuration Reference

### `config.review.verifyEnabled`

| Value | Behavior |
|-------|----------|
| `true` (default) | Planner generates output-assertion commands per story. Run post-execution before review. |
| `false` | No dynamic gates run. Planner does not generate `verificationCommands`. |

### `config.qualityGates`

Static gates that run on every `/build`.

```typescript
qualityGates: Array<{
  name: string;       // Label shown in output and reviewer context
  commands: string[]; // Run sequentially; first failure stops the gate
  required?: boolean; // Defaults true; false makes this static gate advisory outside strict mode
}>
```

Configured gates run sequentially to avoid races over shared build output. A gate is marked failed on the first command that exits non-zero.

To migrate a static gate that intentionally used the previous advisory behavior,
set `required` explicitly:

```json
{
  "qualityGates": [
    {
      "name": "optional browser smoke check",
      "commands": ["./scripts/browser-smoke"],
      "required": false
    }
  ]
}
```

`required: false` does not opt out of `review.strict`; strict mode blocks every failed gate.

### `config.review.specCheck`

| Value | Behavior |
|-------|----------|
| `false` (default) | No spec check. Planning starts immediately. |
| `true` | Checks spec for ambiguities before planning. Prompts for up to 3 high-severity gaps. Suggestions applied silently in unattended mode. |

### `config.review.critic`

| Value | Behavior |
|-------|----------|
| `false` (default) | No plan critic. Execution starts as soon as you confirm the plan. |
| `true` | Scores the plan before execution and refines it until it reaches `criticThreshold` or 3 rounds are spent. |

### `config.review.criticThreshold`

Integer 1-10, default `8`. The plan score the critic must reach to approve. Only used when `critic` is `true`.

---

## Full Config Example

```json
// .workermill/config.json
{
  "review": {
    "enabled": true,
    "specCheck": true,
    "critic": true,
    "criticThreshold": 8,
    "verifyEnabled": true,
    "autoRevise": true
  },
  "routing": {
    "critic": "anthropic"
  }
}
```

With everything enabled:

1. **Spec check** — you answer 1–3 targeted questions before planning starts
2. **Planner** runs with your clarified spec, generates stories with `verificationCommands`
3. **Plan critic** scores the plan and refines it until it passes
4. **You confirm** the plan, and the feature branch is created
5. **Stories execute** — experts build and self-verify
6. **Quality gates** run configured checks, required story commands, and the planner's output assertions; blocking failures stop the run
7. **Tech lead reviewer** sees the gate results alongside the diff if no blocking gate failed
