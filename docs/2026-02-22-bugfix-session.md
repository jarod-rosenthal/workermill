# Bugfix Session — 2026-02-22

## Summary

Comprehensive bug sweep across agent, worker, API, and VS Code extension. Fixed 3 categories of issues: Windows NUL device bugs, race conditions in task status updates, and deployment agent failures.

---

## 1. Windows NUL File Creation (Agent v0.10.38)

**Symptom:** Task failed with `error: short read while indexing NUL` / `fatal: adding files failed` — a literal `NUL` file appeared in the target repo.

**Root cause:** On Windows, `stdio: "ignore"` opens the NUL device relative to the process CWD. When CWD is a git repo directory, this creates a literal file named `NUL` instead of connecting to the null device. The `NUL` file then gets picked up by `git add`.

**Fix:** Replaced all `stdio: "ignore"` across the codebase with either:
- `fs.openSync(os.devNull, "r")` for spawn stdin (absolute `\\.\nul` on Windows)
- `stdio: "pipe"` for execSync/execFileSync calls where output is discarded

**Files changed:**
- `agent/src/spawner.ts` — worker and manager spawn
- `agent/src/commands/start.ts` — agent detached start
- `agent/src/commands/setup.ts` — commandExists check
- `agent/src/config.ts` — findClaudePath, checkDockerAvailable, isDockerInstalled
- `agent/src/docker-spawner.ts` — all Docker spawn and exec calls
- `agent/src/planner.ts` — git clone
- `agent/src/updater.ts` — Windows copy fallback
- `worker/ai-clients/ai-sdk-client.ts` — AI SDK executor spawn
- `worker/multi-expert/index.ts` — git clone spawn

**Related (VS Code extension, fixed in v0.2.27):** Same root cause but in the extension host — `stdio: "ignore"` resolved NUL relative to `C:\...\Microsoft VS Code\`, a protected directory. Fixed with `os.devNull` and `stdio: "pipe"`.

---

## 2. Blocker Abort/Retry/Skip Auth Error (API)

**Symptom:** Clicking abort, retry, or skip buttons in VS Code gave `"Missing or invalid authorization header"`.

**Root cause:** `POST /api/coordination/blocker-response` used `authenticateUser` middleware (JWT only), but the agent sends requests with `x-api-key` header. All other coordination endpoints correctly use `authenticateRequest` (accepts both JWT and API key).

**Fix:** Changed `authenticateUser` → `authenticateRequest` on the blocker-response route in `api/src/routes/coordination.ts`.

---

## 3. Race Conditions — Unsafe `.save()` After Async Work (API)

**Symptom:** Intermittent task state corruption. Tasks losing PR URLs, token counts, or status transitions being silently overwritten.

**Root cause:** TypeORM `.save(entity)` writes ALL columns, not just changed ones. If entity is read, async work happens, then `.save()` is called, any concurrent changes made by other processes (orchestrator, other workers, dashboard) between the read and save are silently overwritten.

**Fix:** Replaced `.save()` with atomic `taskRepo.update()` that only writes the specified fields.

**Files changed:**
| File | Instances | Context |
|------|-----------|---------|
| `api/src/routes/remote-agent.ts` | 1 | Plan failure catch block |
| `api/src/routes/tasks/worker-api.ts` | 1 | Worker-complete endpoint (full rewrite to dynamic update object) |
| `api/src/routes/control-center/actions.ts` | 3 | PR retry success, PR-already-exists, retry failure |
| `api/src/routes/system.ts` | 1 | Manual task fix admin endpoint |
| `api/src/services/support-agent-executor.ts` | 4 | All completion/failure paths |

**Pattern to follow going forward:**
```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
// ... async work ...
task.status = "running";
await repo.save(task); // writes ALL columns from stale read

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

**Remaining:** `api/src/routes/tasks-v2.ts` has 3 instances but requires larger refactor due to array mutations (commitHistory push, constraint additions).

---

## 4. Memory Leak — Cleanup Interval (Agent)

**Symptom:** Agent process leaking a `setInterval` timer on shutdown.

**Root cause:** `agent/src/local-api.ts` created a 60-second cleanup interval for old completed/failed tasks but never stored the handle or cleared it in `stopLocalApi()`.

**Fix:** Store the interval handle and clear it during cleanup.

---

## 5. Deployment Agent Failure — TB-6 (Agent v0.10.40 + v0.10.41)

**Symptom:** TB-6 deployment task failed with contradictory error `"Deployment failed: Deployment completed"`. The devops_engineer agent exited after one tool call (302 output tokens) without doing any actual deployment work.

### Bug A: FAILURE vs failed mismatch (v0.10.40)

**Root cause:** The deployment prompts instruct the agent to output `DEPLOYMENT_DECISION: FAILURE` but `parseDecision()` regex only matched `deployed|failed|blocked|escalated`. The word `FAILURE` was not recognized.

**Fix:** Extended regex to accept `failure` and normalize it to `failed`. Added debug logging that dumps the output tail when no decision marker is found.

### Bug B: TodoWrite not in allowed tools (v0.10.41) — THE ACTUAL ROOT CAUSE

**Root cause:** The deployer spawns Claude CLI with `--allowedTools Read,Glob,Grep,Bash`. The Claude agent's first action was to call `TodoWrite` to plan its deployment steps. Since `TodoWrite` wasn't in the allowed tools list, the tool call was rejected and the agent exited with code 0 after a single turn. No `DEPLOYMENT_DECISION` marker was output, `parseDecision()` defaulted to `"failed"`, and `parseSummary()` defaulted to `"Deployment completed"` — producing the contradictory error message.

Additionally, `filterBuiltinTools()` in `agent-sdk.ts` had a hardcoded whitelist of `["Read", "Write", "Edit", "Bash", "Glob", "Grep"]` that would strip out any tool not in that list, even if explicitly configured.

**Fix:**
1. Added `TodoWrite` to all 4 deployer agent configs (phase1 assessment, auto-trigger deploy, manual-trigger deploy, workflow creation)
2. Added `TodoWrite` and `TodoRead` to the `filterBuiltinTools()` whitelist in `agent-sdk.ts`

**Files changed:**
- `worker/epic/inline-deployer.ts` — 4 tool configs + decision regex + debug logging
- `worker/epic/agent-sdk.ts` — `filterBuiltinTools()` whitelist

---

## 6. Docker Sandbox NUL Error — execSync Shell Spawning (Agent v0.10.42)

**Symptom:** NUL "Failed to create file handle access is denied" error when running with Docker sandbox mode enabled on Windows (v0.10.41).

**Root cause:** `docker-spawner.ts` used `execSync()` with template string commands (e.g., `` execSync(`docker pull ${tag}`) ``). On Windows, `execSync(string)` spawns `cmd.exe` as an intermediary shell, which opens NUL device handles relative to the process CWD — the same root cause as the original NUL bug but triggered through the shell layer rather than `stdio: "ignore"`. Additionally, `spawner.ts` had one template string `execSync` for Docker container stop.

**Fix:** Replaced all `execSync` template string calls with `execFileSync("docker", [...args])` which spawns the process directly without a shell. Removed `execSync` import entirely from `docker-spawner.ts`.

**Files changed:**
- `agent/src/docker-spawner.ts` — 10 `execSync` calls → `execFileSync` (ensureImage, pre-flight check, container cleanup, stop functions)
- `agent/src/spawner.ts` — 1 Docker stop fallback converted

---

## Release Summary

| Component | Version | Changes |
|-----------|---------|---------|
| Agent | v0.10.38 | NUL fix across all spawn calls |
| Agent | v0.10.39 | Memory leak fix in local-api.ts |
| Agent | v0.10.40 | Deployer FAILURE regex + debug logging |
| Agent | v0.10.41 | Deployer TodoWrite allowed tools fix |
| Agent | v0.10.42 | Docker sandbox NUL fix — execSync → execFileSync |
| VS Code | v0.2.27 | NUL fix (released prior session) |
| API | 3 deploys | Auth fix + 10 race condition fixes |

All agent versions are built by CI on `agent-v*` tags pushed to `workermill/workermill`. Update via `workermill-agent update`.
