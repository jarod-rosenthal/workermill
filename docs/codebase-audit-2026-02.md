# Codebase Audit — February 2026

Critical assessment of the WorkerMill codebase across API, worker/agent, frontend, testing, and infrastructure. E2E tests excluded from scope.

---

## 1. Data Integrity: `.save()` Race Conditions

The single biggest systemic risk. The CLAUDE.md explicitly warns about TypeORM `.save()` clobbering concurrent changes, yet it's violated extensively:

| Location | Occurrences | Risk |
|---|---|---|
| `api/src/services/pipeline-executor.ts` | ~32 | Task status overwrites during concurrent orchestration |
| `api/src/services/credit-billing.ts` | ~14 | **Financial data** — concurrent credit deductions silently overwritten |
| `api/src/routes/remote-agent.ts:587` | 1 | Plan failure status clobbered |
| `api/src/routes/organizations.ts:166` | 1 | Role updates during concurrent access |

The billing one is the scariest — two tasks deducting credits simultaneously could overwrite each other's balance updates, leading to incorrect billing.

**Required fix:** Replace all `.save()` calls that follow async operations with atomic `UPDATE...WHERE` queries:

```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
task.status = "running";
await repo.save(task);

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

---

## 2. Test Coverage: Near Zero

- **1 of 33+ route files** has unit tests (`memory.test.ts`)
- **0 frontend component tests** — a 4,189-line MainDashboard.tsx with 11 useState hooks and no tests
- **4 integration tests** exist but test model operations, not actual HTTP routes
- One integration test (`tenant-isolation.test.ts`) contains **tautological assertions** — it compares a constructed string to the same constructed string, so it always passes
- No tests for: billing, webhooks, orchestrator, auth, coordination, remote-agent, SSE streaming
- No tests for the task status state machine (the core business logic)

### Existing Test Quality

**memory.test.ts (189 lines):** Tests real behavior (TypeORM `FindOperator` construction) but mocks 8 services to test 1 endpoint. No error case tests.

**Integration tests (4 files):**
- `jira.test.ts` — Good: tests real DB operations via transaction rollback, validates uniqueness constraints
- `task-lifecycle.test.ts` — Good: validates atomic claim pattern from critical rules
- `tenant-isolation.test.ts` — Weak: tautological assertions, tests string formatting not actual isolation
- `planning-agent-local.test.ts` — Incomplete: foundation only

---

## 3. Security: XSS Vector in Frontend

`frontend/src/pages/LogSearch.tsx:478` uses `dangerouslySetInnerHTML` to render search results sourced from log streams:

```javascript
dangerouslySetInnerHTML={{
  __html: result.headline || result.snippet,
}}
```

A compromised or malicious log message becomes executable HTML. This is a real XSS vector — workers post arbitrary terminal output into logs.

**Additional security concerns:**
- `CoordinationFeed.tsx:852` passes auth tokens in EventSource URL query params (EventSource doesn't support headers). Tokens end up in browser history, proxy logs, and CDN caches.
- No CSRF token header sent with state-changing requests in `api-client.ts`
- Tokens stored in localStorage only (accessible to any JavaScript via XSS)

---

## 4. Worker Process Management: Zombie Risk

- **`worker/ai-clients/ai-sdk-client.ts:278`** — Sends SIGTERM on timeout but has no SIGKILL fallback. If the child process doesn't respond, it becomes a zombie.
- **`agent/src/spawner.ts:414`** — A 15-second `setTimeout` fires API calls after process exit, but the timeout handle is never stored or cancelled in `stopAll()`. If the agent crashes during this window, stale API calls update task state posthumously.
- **`worker/epic/coordinator.ts:2281,2303`** — Git operations (cherry-pick, reset --hard) wrapped in `.catch(() => {})`. Silent failures mean branch corruption propagates without any signal.
- **`agent/src/planner.ts:321`** — `cleanupAll()` calls `flushTextBuffer()` which can throw (axios call), but is not wrapped in try/catch. Cleanup fails silently, progress intervals may persist.

---

## 5. Frontend Architecture: MainDashboard.tsx is 4,189 Lines

This single component owns: task listing, SSE log streaming, error parsing, terminal display, filtering, sorting, modals, polling fallback, and connection management.

### Consequences

- **Any state change re-renders everything** — 11 separate `useState` calls, no `React.memo` on children
- **SSE connections leak** — orphaned EventSource connections accumulate when the task list changes but the component stays mounted. Polling fallback starts on SSE error but SSE auto-reconnects in parallel, so both run simultaneously.
- **No error boundary** — a parse error in any SSE listener crashes the entire dashboard
- **Memory pressure** — 1000 log lines/task × 50 active tasks = 50K+ entries in state

### Additional Frontend Issues

- **No memoization** on expensive operations: `groupMessagesBySession()` in CoordinationFeed.tsx computed every render without `useMemo`
- **Coordination store message cap mismatch** — 200 in-memory vs 100 persisted in localStorage, causing data loss on reload
- **Auth store** doesn't validate token freshness on `initialize()` — expired tokens restore a falsely authenticated state
- **Inconsistent API layer** — `api-client.ts` uses Axios (with auth interceptors), but `projects-store.ts` uses native `fetch` (no interceptors)
- **`api-client.ts:80`** — Toast suppressed for 400 errors, silently hiding form validation feedback from users

---

## 6. Hardcoded Timeouts With No Override

| Location | Timeout | Issue |
|---|---|---|
| `agent/src/planner.ts:331` | 20 minutes | Large repos fail planning |
| `agent/src/plan-validator.ts:414` | ~15 minutes | Complex plans fail critic |
| `agent/src/spawner.ts:443` | 90 seconds cleanup delay | Not configurable per task |

None can be overridden via env var or config. When they bite, the only fix is a code change + npm publish + remote machine update.

---

## 7. Observability Gaps

- **180 instances of `console.error/log`** in `api/src/` instead of the structured `logger`. Console output doesn't reach CloudWatch — these are invisible in production.
- **`worker/epic/executor.ts:217`** — Log posting to the dashboard API has an empty catch block. When the API is down, diagnostic logs are silently lost with no fallback to stdout.
- **No loading states** for critical async operations in `CoordinationFeed.tsx` (`fetchExistingMessages`) and `MainDashboard.tsx` (`fetchTerminalLogs`)

---

## 8. Dependency & Docker Pinning

- `worker/Dockerfile:51` — `@anthropic-ai/claude-code@1` pins only the major version. Any minor/patch release auto-installs on rebuild.
- `worker/Dockerfile:55` — `aider-chat` is completely unpinned.
- `api/` has 1 high-severity npm vulnerability in `@modelcontextprotocol/sdk` (cross-client data leak).
- `@types/node@^22` in api/package.json doesn't match Node.js 20 runtime requirement.

---

## 9. Inconsistent API Patterns

- **Validation**: Some routes use `express-validator` chains (`coordination.ts`), others do manual `if (!field)` checks (`remote-agent.ts`).
- **Error responses**: Some routes throw `AppError` (caught by middleware), others return `res.status(400).json()` inline. No consistent error shape.
- **Type safety**: `catch (error: any)` in 9+ locations in `auth.ts`. Loose `any` types in `orchestrator-utils.ts:227` (`enforceFileDependencies`). Double casts (`as unknown as X`) in `remote-agent.ts:540`.
- **Route handler bloat**: `remote-agent.ts:425-594` (POST /plan-result) does plan parsing, validation, V2 conversion, and DB updates inline — should be a service.

---

## 10. Agent Client Interface Mismatch

`AnthropicAgentClient` (`anthropic-agent.ts`) propagates errors as exceptions. `AISdkClient` (`ai-sdk-client.ts`) catches errors internally and returns result objects. Calling code must handle both paradigms — there's no unified error contract despite a shared `AIClient` interface.

### Additional Worker/Agent Issues

- **`coordinator.ts:267`** — `accumulatedLearnings` array grows unbounded. For 100+ story tasks, memory bloat is possible.
- **`coordinator.ts:736`** — Fatal error path doesn't clean up `activeWorktrees` or `runningStoryMutexGroups`. Retry attempts find stale entries.
- **`blocker-manager.ts:78-98`** — Blind type assertions on external metadata (`as string`, `as number`) without validation. Bad data shapes corrupt blocker state machine.
- **`error-classifier.ts:165`** — First-match pattern wins; order matters but isn't documented. Edge cases may be misclassified, leading to wrong auto-retry decisions.

---

## Priority Ranking

| Priority | Issue | Effort |
|---|---|---|
| **P0 — Data loss risk** | `.save()` in credit-billing.ts (14 patterns) | 2-3 hours |
| **P0 — Security** | XSS via `dangerouslySetInnerHTML` in LogSearch.tsx | 30 min |
| **P1 — Data integrity** | `.save()` in pipeline-executor.ts (32 patterns) | 3-4 hours |
| **P1 — Reliability** | SIGKILL fallback for spawned processes | 1 hour |
| **P1 — Reliability** | Empty catch on git operations in coordinator.ts | 1 hour |
| **P2 — Observability** | Replace 180 `console.error` with `logger` | 1 hour (automated) |
| **P2 — Maintainability** | Split MainDashboard.tsx, add error boundary | 1-2 days |
| **P2 — Reliability** | Make timeouts configurable via env vars | 2 hours |
| **P3 — Quality** | Test coverage (start with billing + webhooks) | 1-2 weeks |
| **P3 — Hygiene** | Pin Docker dependency versions | 15 min |

---

## What's Done Well

The codebase has strong architectural bones:

- **Orchestrator decomposition** — monolith split into focused modules (task-claimer, worker-spawner, task-monitor, etc.)
- **Atomic patterns where used correctly** — `UPDATE...WHERE` for task claiming, transaction wrappers in cost-tracker.ts
- **SSE log streaming** — PostgreSQL polling + SSE is battle-tested and working
- **Coordination feed** — multi-expert collaboration via structured messages
- **Error handler middleware** — `asyncHandler()` wrapper catches promise rejections, error sanitizer prevents logging credentials
- **Zustand selector hooks** — prevent unnecessary re-renders in coordination store
- **Integration test setup** — transaction rollback isolation is correct and reusable
- **Multi-stage Docker builds** — proper builder/production separation, non-root user in API
