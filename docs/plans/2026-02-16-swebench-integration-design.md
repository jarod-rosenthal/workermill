# SWE-bench Lite Integration Design

**Date:** 2026-02-16
**Status:** Approved

## Goal

Measure WorkerMill's AI worker performance on the industry-standard SWE-bench Lite benchmark (300 real GitHub issue→patch tasks across 11 Python repos). Start with a 50-instance pilot, 4 concurrent workers in SDK mode, targeting ~40 min runtime.

## Part 1 — KbCard Repo Override

### Problem

KbCard has no `githubRepo` field. `runCardAsWorkerTask()` in `boards.ts` always uses `org.getDefaultRepo()`, ignoring per-task repo targeting. The downstream `WorkerTask.githubRepo` field exists and the local spawner already respects it (line 593 of `local-epic-spawner.ts`), but it's never set from a board card.

### Fix (3 touch points)

1. **Migration** — Add nullable `github_repo` varchar(255) column to `kb_cards` table
2. **KbCard model** (`api/src/models/KbCard.ts`) — Add `githubRepo` field (varchar 255, nullable)
3. **boards.ts** (`api/src/routes/boards.ts`) —
   - Accept optional `githubRepo` in `POST /api/boards/:boardId/cards` (line 1021 area)
   - In `runCardAsWorkerTask()`, use `card.githubRepo || org.getDefaultRepo()` instead of just `org.getDefaultRepo()` (line 149)

No spawner changes needed — `local-epic-spawner.ts` already reads `task.githubRepo` first.

## Part 2 — SWE-bench Runner Script

### Location

`bin/swebench` — standalone TypeScript script (tsx), no new npm package.

### Flow

```
Download SWE-bench Lite (HuggingFace JSON)
  → Sample 50 instances (stratified across repos)
  → Pre-clone 11 repos, checkout base_commit per instance (~/.swebench/repos/<instance_id>/)
  → Create "SWE-bench" KbBoard via POST /api/boards
  → Create 50 KbCards (title=instance_id, description=problem_statement, githubRepo=repo, label=sdk)
  → Run 4 cards concurrently via POST /api/boards/:boardId/cards/:cardId/run
  → Poll for completion via GET /api/tasks/:id or control-center stream
  → Extract diffs (git diff base_commit..HEAD in worker branch)
  → Write swebench_predictions.jsonl
  → Print summary (pass/fail, cost, time)
```

### SWE-bench Instance Format (from HuggingFace)

```json
{
  "repo": "django/django",
  "instance_id": "django__django-11039",
  "base_commit": "abc123...",
  "problem_statement": "The GitHub issue description...",
  "hints_text": "Optional hints...",
  "patch": "The gold-standard solution diff",
  "test_patch": "Test cases to verify",
  "FAIL_TO_PASS": "[\"test_case_1\", ...]",
  "PASS_TO_PASS": "[\"test_case_2\", ...]"
}
```

### KbCard → WorkerTask Mapping

| SWE-bench field | KbCard field | WorkerTask field |
|-----------------|-------------|-----------------|
| `instance_id` | `title` | `summary` |
| `problem_statement` | `description` | `description` |
| `repo` | `githubRepo` | `githubRepo` |
| — | label: `sdk` | `standardSdkMode: true` |

### Prediction Output Format (JSONL)

```json
{"instance_id": "django__django-11039", "model_name_or_path": "workermill-v0.9", "model_patch": "diff --git a/..."}
```

### Evaluation (separate step)

```bash
pip install swebench
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path swebench_predictions.jsonl \
  --max_workers 8 \
  --run_id workermill_v0.9
```

## What This Does NOT Include

- No worker container or spawner changes
- No SWE-bench evaluation harness integration (separate Python toolchain)
- No dashboard UI changes for benchmarking
- No planning/multi-expert mode (SDK mode only for speed)

## Constraints

- **Environment:** Local WorkerMill only (Docker workers + Claude Max)
- **Concurrency:** 4 workers (local default)
- **Scope:** 50-instance pilot, scalable to full 300
- **Runtime target:** ~40 minutes
- **Repos:** 11 public GitHub Python repos (django, flask, sympy, scikit-learn, matplotlib, astropy, requests, seaborn, sphinx, xarray, pylint, pytest)
