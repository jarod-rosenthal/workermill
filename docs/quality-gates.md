# Spec Check & Quality Gates

Quality gates run shell commands after all stories complete but **before the tech lead reviewer sees the code**. When a gate fails, the failure output is included in the reviewer's context so they can flag it as a must-fix — no retry loops, no extra model calls.

The gap they fill: experts verify their code compiles and tests pass, but they don't assert "does executing this thing produce the right output?" Gates catch acceptance criteria gaps at the observable behavior level before review.

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

### Without quality gates

```
Stories execute → Tech lead reviews → Revision if needed → PR created
```

The reviewer is the first to catch acceptance criteria gaps.

### With quality gates enabled

```
Stories execute → Gates run → Results injected into review → Tech lead reviews → PR created
```

The reviewer sees a pass/fail summary before reading a single line of diff. Failures are flagged in review and fixed in the normal revision loop.

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

**Do not use static gates for:** `typecheck`, `npm test`, `go build`, `pytest` — the expert already runs these during story execution.

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

These failures are informational — factor them into your review score and flag as must-fix if they represent acceptance criteria gaps.
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
| `false` (default) | No gates run. Planner does not generate `verificationCommands`. |
| `true` | Planner generates output-assertion commands per story. Run post-execution before review. |

### `config.qualityGates`

Static gates that run on every `/build`.

```typescript
qualityGates: Array<{
  name: string;       // Label shown in output and reviewer context
  commands: string[]; // Run sequentially; first failure stops the gate
}>
```

Gates themselves run in parallel. A gate is marked failed on the first command that exits non-zero.

### `config.review.specCheck`

| Value | Behavior |
|-------|----------|
| `false` (default) | No spec check. Planning starts immediately. |
| `true` | Checks spec for ambiguities before planning. Prompts for up to 3 high-severity gaps. Suggestions applied silently in unattended mode. |

---

## Full Config Example

```json
// .workermill/config.json
{
  "review": {
    "enabled": true,
    "specCheck": true,
    "verifyEnabled": true,
    "autoRevise": true
  }
}
```

With all three enabled:
1. **Spec check** — you answer 1–3 targeted questions before planning starts
2. **Planner** runs with your clarified spec, generates stories with `verificationCommands`
3. **Stories execute** — experts build and self-verify
4. **Verification gates** run the output assertions from the planner
5. **Tech lead reviewer** sees gate results alongside the diff
