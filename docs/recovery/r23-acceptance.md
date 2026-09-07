# R23 acceptance audit

Audited at `8cd7c733` on `reliability/core` against the R23 acceptance text in
[`docs/reliability-plan.md`](../reliability-plan.md#r23--remove-superseded-runtime-duplication).
This is a source and history audit; the qualification recorded in `HANDOFF.md`
for `08077002` is 1,643 passed, 0 failed, 1 skipped, plus typecheck and build.
Those counts are not used as coverage evidence here.

## Result: ready

- **One permission decision:** `decideToolPermission` is the sole production
  decision table in [`src/engine/tool-policy.ts`](../../src/engine/tool-policy.ts).
  The common executor calls it before and after prompt/queueing
  ([`src/engine/tool-executor.ts`](../../src/engine/tool-executor.ts)), while
  the orchestration confirmation adapter delegates to the same function
  ([`src/orchestrator/execution.ts`](../../src/orchestrator/execution.ts)).
  Chat, headless, worker, planner, and review adapters call the executor
  (respectively [`useAgent.ts`](../../src/ui/useAgent.ts),
  [`run-command.ts`](../../src/run-command.ts),
  [`execution.ts`](../../src/orchestrator/execution.ts),
  [`planning.ts`](../../src/orchestrator/planning.ts), and
  [`review.ts`](../../src/orchestrator/review.ts)).  `PermissionManager` and
  `src/permissions.ts` are absent; a whole-tree search found no legacy import.

- **One foreground model-command runner:** `runProcess` owns spawn, bounded
  capture, timeout, and run/process-group cleanup in
  [`src/engine/process-runner.ts`](../../src/engine/process-runner.ts).
  Model-command adapters use it directly or through the OS-sandbox wrapper:
  orchestration startup, gates, completion, review Git context, root shell,
  bash/background bash, sub-agent Git administration, ticket probes, and MCP
  discovery. `runScopedProcess` delegates back to `runProcess` after sandbox
  preparation ([`src/engine/scoped-process.ts`](../../src/engine/scoped-process.ts)).
  Remaining direct `spawn` sites are long-lived protocol/service owners (MCP
  stdio, LSP, browser), not foreground model-command runners.

- **Removed duplicates:** commit `861008d9` deleted the legacy permission
  manager, old Git story/review helpers, and `withConcurrencyControl`; commit
  `b1fec7fe` restored the run-owned MCP tests after its cleanup. Searches find
  no `PermissionManager`, `permissions.js`, `tool-concurrency`, or
  `withConcurrencyControl` production references. The replacement executor
  owns mutation serialization and cancellation; its focused tests cover queued
  mutation cancellation and mutex release in
  [`src/__tests__/tool-executor.test.ts`](../../src/__tests__/tool-executor.test.ts).

## Removed-test coverage mapping

| Removed subject | Current meaningful evidence | Assessment |
| --- | --- | --- |
| Legacy `permissions.test.ts` prompt/trust/rule behavior | `tool-policy.test.ts`, `tool-executor.test.ts`, `useAgent-permission.test.ts`, `check-tool-permission.test.ts`, and chat/headless/worker/planner/review runtime-policy tests | Replaced by the common decision and real adapter paths. The old three-layer settings file round-trip cases were deleted without an equivalent filesystem round-trip test; config persistence is outside the removed decision implementation. |
| Legacy `tool-concurrency` tests | `tool-executor.test.ts` queue cancellation/release cases plus runtime adapters that execute through `executeToolCall` | Replaced: serialization moved into the executor. The prior read-tool parallel timing assertion has no direct replacement; it tested a removed wrapper rather than a required R23 behavior. |
| Legacy global MCP client tests (definitions, calls, server start/stop, transports) | `mcp-client.test.ts` checks schema/name sanitation, text conversion, GitHub argument hydration, workspace-scoped metadata, mocked HTTP/SSE construction and calls, unsupported transport rejection, and emergency cleanup across run-owned clients; `mcp-run-resources.test.ts` checks lazy start, equal-name isolation, abort, partial start, response bounds, and descendant cleanup; headless/chat runtime tests exercise run cleanup | Replaced by the run-owned contract. The new transport tests mock only SDK transports/clients and use no network. |
| Removed legacy Git story commit/review-diff helpers | Current `git-ops.test.ts` retains repository/branch operations; `review-git-runtime.test.ts`, `candidate-runtime.test.ts`, and `final-evidence-runtime.test.ts` cover the active review/candidate paths | Obsolete: story-commit and global review-diff helpers have no production callers after the run-owned orchestration migration. |
| Mock-only legacy MCP exports removed from runtime tests | `mcp-run-resources.test.ts`, `mcp-client.test.ts`, `headless-runtime.test.ts`, and `useAgent-runtime.test.ts` use `createMCPRunResources` | Replaced with the production run-owned API. |

Focused correction validation: `npm test -- --run src/__tests__/mcp-client.test.ts`
passed (7 tests) and `npm run typecheck` passed. No production files were
changed by this audit/correction. The removed tests have no remaining concrete
R23 coverage blocker.
