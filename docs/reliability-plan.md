# WorkerMill reliability implementation plan

Contributor implementation guide. Use [reliability-queue.json](reliability-queue.json) for task status and ownership; this document defines scope, dependencies, and acceptance criteria, not release guarantees.

## Objective and scope

Make WorkerMill's ticket-to-PR workflow trustworthy and measurable: consistent permissions and isolation, responsive cancellation, enforced verification of the delivered code, truthful run records, and evidence for cost/quality claims. Preserve the existing provider defaults and routing selections. Improve the existing architecture incrementally; do not replace the CLI, add a server, or expand the provider/persona catalog.

This document is the task specification. [reliability-queue.json](reliability-queue.json) is a dependency/ownership index for a coordinator, not an executable WorkerMill plan or a command to launch agents. There are 24 work items, decomposed into 38 individually dispatchable packages. Do not feed the backlog into one `/build`: WorkerMill's main story executor is sequential, and its current isolated sub-agent path is itself being repaired.

Use the task contracts below when implementing changes. Publishing issues/PRs, paid evaluations, and package releases require separate authorization. User-facing behavior belongs in the configuration, commands, and architecture references; avoid adding chronological implementation reports to those documents.

## Target behavior contracts

1. **Permission precedence:** explicit deny is absolute, including under trust/bypass. Explicit ask is not silently converted into allow. Plan mode cannot acquire write tools through deferred loading, MCP, or sub-agents. Preserve existing modes otherwise; establish a single tested decision table for discrepancies. Dangerous-command confirmation cannot override a matching deny rule.
2. **Headless execution:** use the same decision function. When a decision needs a human, return `permission_required` and a nonzero CLI result without executing the tool or waiting on stdin. Existing allow rules are the automation mechanism. `--full-disk` changes filesystem scope, not permission grants. Do not add an implicit blanket approval mode.
3. **Filesystem scope:** explicit file tools validate canonical paths, including symlink targets and the nearest existing ancestor for new files. User-approved extra paths must be carried as explicit capabilities; absolute image paths do not automatically grant access. Keep intentional application-state directories separate from project file scope.
4. **OS isolation:** an explicitly requested `sandbox: "os"` fails closed if unavailable, before model work starts. Preserve default path mode and label its limitations accurately. The current optional `/build` upgrade from path mode may fall back only with a visible warning and recorded effective mode. User-selected full-disk remains explicit. Children inherit or narrow permissions and filesystem scope. Do not promise Docker socket, network, arbitrary shell, or MCP process containment that the implementation does not provide. Docker socket access must be an explicit capability, not an implicit OS-sandbox default.
5. **Command lifecycle:** all model-directed shell commands, verification commands, and gates receive run-scoped cancellation, a timeout, bounded output, and process-tree cleanup. Shell execution is asynchronous. A timeout, signal termination, or watch-mode kill is never a passing test result. Network/MCP operations need bounded cancellation and cleanup, but this project does not build an MCP server sandbox.
6. **Completion policy:** required story commands always block. Configured static gates default to blocking; a new per-gate `required: false` explicitly opts into advisory behavior outside strict mode. Planner-generated verification remains advisory outside strict mode unless promoted into required commands. Strict mode blocks on every failed gate and requires valid approval when review is enabled. Disabled review is reported as disabled, not approved. A blocked result may preserve local work and offer `/retry`; it must not enter push/PR/success-transition actions.
7. **Freshness:** blocking verification and approval must describe the same repository state delivered to completion. Record HEAD plus a digest of relevant tracked/untracked changes, not HEAD alone. A revision or other mutation invalidates the old result. Reverify and, when code changed after approval, rereview within the existing revision limit. Never create an unbounded automatic repair loop.
8. **Review identity:** keep existing model defaults and routing. Always record the actual worker/reviewer bindings. Warn once per run when bindings are shared. Add opt-in `review.requireDifferentModel` (default false); when enabled, reject a known shared binding before execution. Aliases are resolved before comparing provider endpoint/model identity; unknown identity is reported as unverified, not independent. Never silently switch to another paid model.
9. **Outcomes and evidence:** distinguish success, partial, failed, cancelled, blocked, and step-limit exhaustion where applicable. Gate/review success, task completion, and transport completion are different facts. Persist progress and terminal evidence, including unsuccessful runs. Logs/manifests must not include API keys or raw sensitive tool payloads.
10. **Cost:** reported USD is an estimate unless pricing and usage are known. Unknown pricing is not zero. Include all roles, failed attempts with reported usage, and child calls once. Any budget is an estimated execution budget with documented in-flight overshoot, not a guaranteed provider billing cap.

These are deliberate behavior changes, particularly headless permission enforcement, static gates, explicit OS-sandbox failure, and Docker capability handling. Include migration examples and release notes. Do not silently modify a user's configuration to make old automation succeed.

## Parallel execution and token discipline

- Use one coordinator plus at most two implementation workers. The coordinator owns scheduling, interface decisions, and integration. A reviewer replaces an implementation slot when needed; do not keep an idle reviewer consuming turns.
- Use the smaller coding model for bounded implementation, deterministic tests, docs, and mechanical migrations. Use the stronger model for the initial interface contract, security reviews, completion-state review, and final integration. No specific model price or quality is assumed.
- Give each worker only its task block, the behavior contracts it needs, repository `AGENTS.md`, the queue entry, and prerequisite handoffs. Do not fork the full conversation or ask every worker to review the whole repository.
- Start every worker from a known integrated commit in its own Git worktree. During this project, use the host coordinator's worktree tooling; do not rely on WorkerMill's currently unsandboxed isolated sub-agent implementation to provide containment.
- A task is ready only when every dependency is integrated and its files/ownership locks are free. A branch based on an unmerged dependency is not ready. The queue's `locks` are exclusive in addition to exact file ownership; the coordinator also rejects overlapping write paths.
- A task with `dispatches` in the queue is an aggregate, not a worker assignment. Run its numbered suffix packages in the listed order, one worker per package, retaining its locks; mark the parent complete only when all packages are integrated. Each dispatch receives the parent acceptance contract but only its specified write scope. This makes the larger tasks concrete without asking a smaller model to invent its own decomposition.
- No parallel edits to `src/engine/tools/index.ts`, `src/config.ts`, `src/ui/useAgent.ts`, or `src/orchestrator.ts`. A worker requests a scope extension if another file is necessary; it does not rewrite another worker's adapter.
- Target one coherent change, about 150–350 production lines, per dispatch. This is a split trigger, not a hard quality limit. If a task needs two distinct migrations or exceeds this range materially, split it into suffix tasks preserving dependencies before implementation.
- Each worker gets one implementation attempt and one focused correction pass. After two failed approaches or an unresolved interface ambiguity, return the exact blocker to the coordinator. Do not launch nested agents, independent planners, duplicate reviewers, or repeated broad searches.
- Workers run focused tests while iterating. Before declaring their task finished they run `npm run typecheck` and `npm test`, as repository instructions require. Do not repeatedly run the full suite during unchanged iterations. The coordinator runs the full suite once per integrated batch and build once at the batch boundary. `lint` is currently the same typecheck; do not run both locally merely to duplicate work.
- No live model calls for unit/runtime integration tests. Do not retry deterministic test failures with a larger LLM until the error has been examined. Paid benchmark work starts only with an explicit run/model/hardware/spend configuration.
- Keep worker handoffs under 300 words: commit/base, changed files, acceptance outcomes, test commands/results, known limitations, and newly exported interface signatures. Store full test output as artifacts, not repeated chat messages.
- Measure model input/output tokens and retries per task if the host exposes them. Use available host budget controls when configured; do not invent token-limit flags or promise a cap the host does not enforce.

### Scheduling guide

These are scheduling examples, not permission to bypass dependency or file locks:

| Batch | Candidate independent work | Integration condition |
| --- | --- | --- |
| A: immediate fixes and foundations | R12 + R01, then R02 + R03, then R04 + R20 | Freeze shared execution signatures; required-gate regression passes. |
| B: shared command/tool path | R05 + remaining R20 fixtures, then R14 + R06, then R07 + R08, then R09 | Tool policy is used in each migrated mode; configuration changes have one owner. |
| C: lifecycle and correctness | R10 + R13, then R11, then R15 | Cancellation works across modes; outcomes have one source of truth. |
| D: hardening and qualification | R23, then R18 + R16, then R17 + optional R21 | Actual runtime and packaged CLI pass deterministic checks. R16 usage checks test the frozen callback; ledger assertions wait for R18 integration. |
| E: release readiness | R22, then R24 | Documentation and integrated evidence match delivered behavior. |

Some batches intentionally leave a slot empty. Do not create speculative work to occupy it. R20 fixture preparation can start early; R21 live measurements remain separately budgeted and may be deferred while deterministic qualification proceeds. Strong review checkpoints: R04/R05 security contract, R10 isolation, R13 completion policy, and R24 integration. Review only the changed diff plus named call sites unless evidence requires more.

Run optional R19 after R18/R23 and outside their adapter/configuration locks. The first reliability release does not depend on R19, R20, or R21. Evaluation work can continue independently after R24; its absence is reported, never disguised as measured product quality.

### Frozen interface outline

R02/R03/R04 own the following boundaries. Concrete names may follow repository conventions, but the coordinator freezes the signatures in their handoffs before adapters start. Callbacks carry UI/hooks/checkpoint behavior; shared modules must not import React.

```ts
// R02: process-runner.ts; ordinary command execution never owns a global child.
interface ProcessRequest {
  runId: string;
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
  terminationGraceMs: number;
}
interface ProcessResult {
  reason: "exited" | "cancelled" | "timed_out" | "spawn_failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}
// R03: path-policy.ts; all paths canonicalized before granting access.
interface PathGrant { root: string; access: "read" | "read_write" }
interface PathScope { workspace: string; extraGrants: readonly PathGrant[] }
// R04: tool-policy.ts; an adapter implements asking, never a second policy.
type PermissionDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason: string };
```

Execution context also carries immutable capabilities: requested/effective sandbox mode, `PathScope`, allowed network domains, local-binding permission, and `allowDockerSocket` (false by default). R05 adds a global-user-config-only `sandboxCapabilities` object to populate these exceptions; project config or model output cannot widen it. Explicitly attached/approved files may add narrowly scoped per-run grants. Child contexts intersect parent capabilities with the child role and worktree scope; they never replace the parent's scope with full-disk access. Docker grant warnings must explain host access implications; do not claim containment of Docker-controlled processes.

OS sandbox concurrency decision: reuse the current sandbox manager behind a process-wide asynchronous lease held for the entire wrapped child's lifetime. Differing roots serialize; reset/reconfigure only when no child holds the lease. Waiting for the lease is abortable. Path/full-disk runs do not need this lease. This is an intentional throughput tradeoff until the installed sandbox library supports independent instances reliably; do not discover a new isolation architecture mid-ticket.

## Task specifications

Every task inherits the behavior contracts, file-lock rules, `.js` import convention, strict TypeScript requirement, and the shared final checks above. Listed files are write scope unless marked read-only. Existing test files may be extended; new tests named below belong in the ordinary unit suite unless explicitly under `e2e`. No source changes outside scope without coordinator reassignment.

Verification shorthand is executable as follows: a named test `foo` means `npm test -- src/__tests__/foo.test.ts`; multiple named files go in the same command. Run new test files using their specified paths. Every leaf package finishes with `npm run typecheck` and `npm test`. R17 must add documented, deterministic package/PTY/OS test commands to `package.json` and report their exact invocations before R24 starts. Integration checks run on the actual combined commit, not a worker's earlier base.

### R01 — Isolate unit-test application state

Priority P0; small-model task; dependencies none; lock `test-harness`.

Files: `vitest.config.ts`, `src/__tests__/helpers/temp-workermill-home.ts`, new `src/__tests__/helpers/setup-state.ts`, `src/__tests__/{memory-tool,logs-command,provider-registry,maturity-features}.test.ts`.

Implement per-test-worker temporary `WM_STATE_ROOT` setup and guaranteed restoration/cleanup. Repair tests that hardcode the default home or mock `os.homedir` without accounting for the override. Preserve fixtures intentionally testing default-path resolution by explicitly clearing/restoring the override within those tests. Do not overwrite `HOME` or `CODEX_HOME`. No application-state reads/writes outside test fixtures.

Acceptance: the full suite passes with and without an externally supplied temporary `WM_STATE_ROOT`; two test workers do not share project state; cleanup restores environment and working directory after errors. Preserve the baseline skip with its reason rather than deleting it to improve counts.

Verification: the four named test files, then both full-suite configurations. Handoff: exact setup lifecycle and any remaining real-home accesses.

### R02 — Replace blocking foreground shell execution

Priority P0; small-model implementation with stronger process-lifecycle review; dependencies none; lock `process-runtime`.

Files: new `src/engine/process-runner.ts`, `src/engine/tools/bash.ts`, `src/__tests__/bash-tool.test.ts`, new `src/__tests__/process-runner.test.ts`.

Introduce asynchronous subprocess execution; migrate bash off the singleton worker/SAB/`Atomics.wait`. Export a small request/result contract carrying cwd, environment, AbortSignal, timeout, output limit, exit code, termination reason, and stdout/stderr. Own children per run, not globally. TERM then KILL the process group on supported Unix systems; return actionable unsupported-platform errors where needed. Preserve existing successful bash output and OS wrapping behavior. Remove misleading prewarm comments and implement or replace `killActiveProcess` without breaking callers during migration.

Acceptance: a 500 ms child permits an event-loop heartbeat before exit; abort of a 30-second child settles within 2 seconds under the fixture environment; a TERM-ignoring descendant is killed within the configured grace period; spawn failure, signal exit, output truncation, and timeout are distinct. Concurrent commands cannot exchange output or cancel each other. Use tolerances and event ordering, not fragile sub-millisecond assertions.

Verification: named process/bash tests. Handoff: runner signature and cancellation ownership. Do not redesign the Ink renderer here.

Integrated handoff: `runProcess(ProcessRequest)` and `cancelRunProcesses(runId)` live in `src/engine/process-runner.ts`. Requests carry `runId`, `command`, `cwd`, optional `env`, `signal`, `timeoutMs`, `maxOutputBytes`, and `terminationGraceMs`. Results distinguish `exited`, `cancelled`, `timed_out`, and `spawn_failed`, with nullable exit code and output truncation flag. Bash accepts optional `signal`/`runId`; legacy cancellation affects only unscoped bash calls until adapter migration. Descendants are terminated on shell exit even when they retain inherited pipes. Native Windows requires WSL. This does not yet migrate verification, gates, background tools, or every caller's cancellation context (R05–R11).

### R03 — Canonical filesystem scope for explicit file tools

Priority P0; small-model task with security review; dependencies none; lock `tool-registry`.

Files: new `src/engine/path-policy.ts`, `src/engine/tools/index.ts` path resolution only, new `src/__tests__/path-policy.test.ts`; read-only: all path-bearing tool implementations.

Centralize realpath containment for reads, writes, directories, patches, multi-edit, downloads, images, and LSP paths. Validate all paths in a multi-target request before mutation. New files validate the closest existing parent. Preserve deliberately separate memory/application-state capabilities; do not expose the entire state root through ordinary file tools. Remove implicit absolute-image exceptions and define an explicit additional-path input for callers. Document remaining TOCTOU limits; OS containment remains necessary for arbitrary shell and race resistance.

Acceptance: traversal, sibling-prefix, existing symlink, symlinked parent for a new file, absolute out-of-root path, and one invalid target among many are rejected before mutation. In-root and explicitly granted paths work. Full-disk mode is tested separately. Tests use harmless temporary fixtures only.

Verification: path-policy, multi-edit-file, download-file, image-support tests. Handoff: resolver/grant signatures and complete audited tool list.

Integrated handoff: `createPathScope(workspace, extraGrants)` and `resolvePath(scope, inputPath, access, options)` live in `src/engine/path-policy.ts`; grants use `{ root, access: "read" | "read_write" }`. The tool factory's fourth argument is an options object, currently `{ extraPathGrants?: readonly PathGrant[] }`; extend this object in R05 rather than introducing a competing signature. Canonical paths reach file read/write/edit/multi-edit, glob/grep/ls, download destinations, images, LSP, patch, and shell/verify working directories. Shell working directories require write access. Patch scope was narrowly expanded to `tools/patch.ts` so authorization and application share header parsing. Memory retains its separate application-state scope; arbitrary shell access, child factories, and filesystem races remain later-task/OS-isolation concerns.

### R04 — Shared permission decision and tool-execution contract

Priority P0; coordinator freezes interface before small-model implementation; dependencies none; lock `policy-runtime`.

Files: new `src/engine/tool-policy.ts`, new `src/engine/tool-executor.ts`, new corresponding unit tests; read-only: `src/safety.ts`, `src/hooks.ts`, tool metadata, interactive/worker wrappers.

Extract the policy decision table into production code callable without React. Define a per-run execution context and a wrapper for built-in/MCP tools. Context includes run ID, workspace/scope, effective sandbox, cancellation, current permission state, prompt callback, lifecycle/checkpoint/event adapters. Permission decisions are typed allow/deny/ask with reasons. Evaluate cancellation and policy before any hook/tool side effect; run an authorized pre-hook before checkpoint/mutation; execute once; run post-hook/event cleanup once. Serialize mutating calls within a workspace; retain existing read-only concurrency rules. Do not add a second generic agent framework.

Acceptance: table tests prove deny precedence, explicit ask, plan mode, session allow, trust, unknown MCP tools, and headless ask rejection. A denied call causes zero hook, checkpoint, tool, or external calls. A pre-hook block prevents mutation. Two contexts do not share permissions or cancellation. Test the real helper, not a copied decision tree.

Verification: new policy/executor tests plus safety/hooks tests. Handoff: stable exported signatures and the agreed ordering table. Adapter workers may not independently redefine it.

### R05 — Route tools and gates through the shared process boundary

Priority P0; small-model task with security review; dependencies R02, R03, R04; locks `tool-registry`, `process-runtime`.

Files: `src/engine/tools/{index,verify,bash-background,bash-output,bash-kill}.ts`, `src/gate-runner.ts`, `src/sandbox-mode.ts`, `src/config.ts` capabilities interface/schema/global-only resolution, `docs/configuration.md` capabilities entry, their existing tests; new focused sandbox execution test if needed. Also hold the `config` lock.

Wire execution context into tool definitions. Reuse R02 for verify and gates; preserve their result parsing but let process failure override text claiming success. Share cancellation/output limits and enforce the chosen sandbox before launch. Explicit OS request fails closed; automatic upgrade fallback is visible. Background commands are either contained by the same runner or rejected clearly in OS mode. Remove implicit Docker socket access from the default OS profile and use the frozen capability representation.

Mandatory dispatches: R05a migrates verify/gate-runner plus tests to the shared process API; R05b implements sandbox resolution/lease, capability config/schema and tests; R05c wires the tool registry/background adapters and actual containment tests. Integrate in that order. Each dispatch may edit only its listed subset, plus a narrow factory signature needed by its successor; no full caller migration here.

Acceptance: an OS-wrapped bash/verify/gate command cannot write the harmless out-of-root sentinel; unavailable explicit OS mode executes nothing; watch-mode termination and nonzero exit with `10 passed` output fail; no subprocess survives abort; different roots cannot race a global sandbox-manager reconfiguration. Where real OS support is unavailable, integration tests skip with a reason and CI must run them on a supported host before release.

Verification: bash-tool, gate-runner, sandbox-mode, new real process containment tests. Handoff: factory signature and sandbox exception limitations. Do not claim path mode blocks arbitrary redirection or interpreter code.

### R06 — Migrate interactive chat to shared policy

Priority P1; small-model task; dependencies R04, R05; lock `interactive-runtime`.

Files: `src/ui/useAgent.ts`, `src/ui/agent/{types,utils}.ts` as necessary, `src/__tests__/useAgent-permission.test.ts`, focused executor adapter tests.

Replace the local decision tree/tool execution policy with R04 adapters while retaining UI messages, permission prompts, checkpoint tracking, model switching, and live view. Deferred tools and browser/MCP tools must pass through the same wrapper on activation. Keep permission state current without nesting wrappers each turn. Replace copied permission test logic with imports of production policy; retain a real adapter test.

Acceptance: deny/ask/allow decisions match the contract; plan mode cannot promote a write tool; cancel resolves a pending prompt; always/trust choices persist only their intended scope; denial creates no checkpoint; repeated turns execute hooks/tools once.

Verification: useAgent-permission, useAgent, app-escape, relevant hook tests. Handoff: actual prompt/cancel adapter behavior. No UI styling changes.

### R07 — Govern headless execution and report terminal results

Priority P0; small-model task; dependencies R04, R05; locks `headless-runtime`, `cli-entry`.

Files: `src/run-command.ts`, headless options/actions in `src/index.ts`, `src/__tests__/run-command.test.ts`, new headless runtime tests.

Apply R04 policy to all headless built-in and MCP tools. Make run execution return a typed result; keep process exit and JSON rendering at the CLI boundary. Preserve existing successful output fields, add stable failure reason/status fields and documented exit codes. Track permission-required, denied, cancelled, provider failure, and step-limit exhaustion. A tool-step cap is not proof the task is complete. Use finally cleanup for MCP/LSP/children/listeners, including failures before streaming starts. Do not store successful session completion on an error.

Acceptance: deny rule prevents a sentinel write; ask returns promptly without stdin; configured allow works; `--full-disk` does not approve tools; JSON remains one valid result on stdout with diagnostics on stderr; exhausted step limit is non-success; SIGINT yields cancellation and cleanup. Test actual runCommand/tool execution with a deterministic SDK stream.

Verification: run-command, index, new headless runtime tests. Handoff: result/exit-code contract and automation migration example.

### R08 — Migrate story execution to shared policy

Priority P1; small-model task; dependencies R04, R05; lock `worker-runtime`.

Files: `src/orchestrator/execution.ts`, `src/__tests__/check-tool-permission.test.ts`, focused worker runtime test; read-only: `src/orchestrator.ts`.

Use R04 for worker tools, preserving story-specific logs, checkpoints, contract checks, retries, and pause handling. Thread the existing run signal into tools. Keep the exported checkToolPermission adapter if existing callers still need it, but it delegates to the production policy rather than implementing another decision tree. Use R05 for required-command execution. Avoid broad prompt edits.

Acceptance: worker and interactive modes produce identical policy outcomes for the same context; required-command cancellation prevents story completion; retries do not retain stale permission wrappers or listeners; denied tools never mutate. Preserve existing story dependency behavior.

Verification: check-tool-permission, orchestrator tests, focused worker test. Handoff: adapter/event mapping and any remaining legacy caller.

### R09 — Govern planner, critic, reviewer, and revision tools

Priority P1; small-model task; dependencies R04, R05; lock `review-runtime`.

Files: `src/orchestrator/{planning,review}.ts`, focused planning/review policy tests, `src/program-bootstrap.ts` only if its model tools bypass the shared contract.

Audit model tool factories in planning, standalone review, inline review, and reviewer-triggered revisions; adapt them to R04. Read-only roles cannot gain mutation through persona overrides, MCP, or a nested child. Revision workers use the same policy as normal workers. Preserve model choices, prompts except required policy instructions, scoring thresholds, and revision limits. Record any newly discovered alternate model-tool entry point in the handoff before expanding scope.

Acceptance: malicious or misconfigured read-only persona tools cannot mutate; standalone and inline review follow the same permission policy; revision calls inherit cancellation/sandbox; aborted planning starts no worker. No duplicate hook/tool events.

Verification: plan-critic, orchestrator, focused planning/review policy tests. Handoff: audited entry-point list and tool capability matrix.

### R10 — Constrain and preserve isolated sub-agent work

Priority P0; small-model task with security review; dependencies R04, R05; lock `tool-registry`.

Files: `src/engine/tools/{sub-agent,index}.ts`, new `src/__tests__/sub-agent.test.ts`; existing isolated-subagent E2E test as a read-only scenario reference.

Remove the unsandboxed child factory. Inherit/narrow parent permissions, cancellation, allowed paths, and model usage reporting callback. Give write-capable children a worktree-root scope plus the minimum necessary Git metadata capability; do not grant arbitrary parent-repository writes. Use execFile/argument arrays for worktree operations. Capture starting commit and compare against it: the current `HEAD ^HEAD~0` expression cannot detect new commits. Preserve committed-only changes and include branch/worktree identity in every result. Make collisions safe for branch names as well as directory paths. No recursive sub-agent spawning.

Acceptance: child cannot modify the parent sentinel or escape via a symlink; parent cancellation ends child commands/model stream; concurrent children stay separate; committed-only work is reported and preserved; failed/cancelled dirty worktrees remain inspectable; only confirmed empty worktrees are cleaned. Tests mock the LLM and use real temporary Git repositories.

Verification: new unit/runtime sub-agent tests; no paid E2E needed. Handoff: worktree lifecycle and exact Git metadata exception.

### R11 — Wire end-to-end cancellation and deterministic cleanup

Priority P0; integration task; dependencies R06, R07, R08, R09, R10; locks `interactive-runtime`, `headless-runtime`, `worker-runtime`, `review-runtime`, `orchestrator`.

Files: adapter files above, `src/ui/useOrchestrator.ts`, `src/orchestrator.ts`, relevant cancellation tests; modify MCP/LSP stop APIs only if a demonstrated teardown gap requires it.

Join run, model, tool, gate, and child cancellation. Dispose combined-signal listeners. Stop the current run only; another context must continue. Ensure failure before a stream is constructed and cancellation during a prompt, retry delay, gate, and child all settle once. Maintain inspectable local state and stop subsequent stories/completion. This is integration of existing interfaces, not another runner rewrite.

Mandatory dispatches: R11a integrates chat/headless cancellation and tests (`useAgent`, `run-command`); R11b integrates orchestration/roles/children, `useOrchestrator`, and stage cancellation tests. R11b depends on the integrated R11a lifecycle contract.

Acceptance: a deterministic cancel scenario for each stage terminates within the configured grace period, leaves no children/open servers, removes listeners, and emits one terminal result. An independent second run remains active. Add a PTY scenario specification for R17.

Verification: cancellation scenarios, app-escape, useOrchestrator, run-command, sub-agent tests. Handoff: teardown ownership map and measured fixture bounds.

### R12 — Honor blocking gate results immediately

Priority P0; small-model task; dependencies none; lock `orchestrator`.

Files: `src/orchestrator.ts`, `src/__tests__/orchestrator.test.ts`; read-only: `src/orchestrator/gates.ts`.

Immediately branch on `gatesResult.earlyExit` before reviewer/revision/completion. Preserve the branch and retry state; emit the existing failure reason and return a non-success result using current compatible APIs. Do not bundle static-gate policy changes or manifest schema work here; R13/R15 handle those. Ensure minimal cleanup on the new exit path uses existing teardown facilities.

Acceptance: a required-command failure and a strict static-gate failure cause zero reviewer calls, zero completion calls, and zero push/PR/success-ticket transitions. A non-strict advisory verification failure retains current behavior. The test invokes production runOrchestration, not only the gate helper.

Verification: orchestrator and orchestrator-gates tests. Handoff: regression test proving the previously ignored result is honored. This can ship independently as the first bug fix.

### R13 — Enforce typed gates and final-state verification

Priority P0; integration task with stronger review; dependencies R05, R08, R09, R12; locks `orchestrator`, `review-runtime`, `config`.

Files: `src/orchestrator/{gates,review,completion,types}.ts`, `src/orchestrator.ts`, `src/config.ts` gate schema, gate/orchestrator tests; documentation of new per-gate fields in `docs/quality-gates.md` and `docs/configuration.md`.

Return typed gate results and structured review decisions; remove decisions inferred only from prose. Add static-gate `required` behavior from the contract. Use stable gate identity, not human-readable names, to determine blocking policy. Tie verification and approval to a repository-state fingerprint. Rerun invalidated verification after reviewer changes, and prevent completion from mutating unverified code through hooks or final cleanup. Gate commands that alter deliverable source invalidate the state; cap repeat cycles. Keep configured gates sequential by default unless explicitly known independent, avoiding shared build-output races.

Mandatory dispatches: R13a owns gate config/schema, stable IDs, typed results, blocking/advisory policy and helper tests; R13b owns structured review outcome and repository-state fingerprint helper/tests; R13c owns orchestration/completion wiring, final-state verification and production regression tests. Run sequentially under the same locks. Reuse existing reviewer parsing internally; remove prose reparsing by callers, not all text parsing in one pass.

Acceptance: passing first gates followed by a bad reviewer revision blocks completion; same-title gates do not confuse required/advisory status; dirty/untracked changes invalidate evidence even without a new commit; failed strict review, parse error, exhausted revisions, and absent reviewer cannot become approval; unchanged state avoids redundant gate execution. Static opt-out and review-disabled cases are explicit and tested.

Verification: production orchestration scenarios, orchestrator-gates, gate-runner, docs-consistency tests. Handoff: typed result/fingerprint contracts and the bounded completion state transitions.

### R14 — Make reviewer identity explicit without rerouting

Priority P1; small-model task; dependencies none; lock `config`.

Files: `src/config.ts`, new `src/review-identity.ts`, `src/ui/commands/settings.ts`, related config/settings/identity tests, `docs/configuration.md`; read-only: provider alias resolution.

Implement binding comparison and opt-in `review.requireDifferentModel`, with interface/schema/settings aliases/display/persist allowlist included. Resolve aliases and normalized endpoint/model identity without changing the selected models. Export a preflight result with known-shared, known-different binding, or unverified identity. Explain that different endpoint/model identifiers do not prove independent model training. R15 integrates the result once worker bindings are known.

Acceptance: two aliases of one endpoint/model compare shared; different configured bindings are recorded correctly; unknown identity cannot satisfy required independence; settings round-trip; default false leaves single-provider/local workflows available. Zero provider network calls are needed for tests.

Verification: config, model-persistence, settings/slash-command, review-identity, docs-consistency tests. Handoff: preflight API and warning text.

### R15 — Persist truthful run progress and terminal evidence

Priority P1; integration task; dependencies R11, R13, R14; locks `orchestrator`, `worker-runtime`, `review-runtime`.

Files: `src/run-manifest.ts`, `src/orchestrator.ts`, `src/orchestrator/{execution,review,completion,types}.ts` narrow event wiring, `src/runs-command.ts`, `src/recovery.ts`, manifest/runs/recovery tests.

Persist a versioned manifest at run start and material transitions using atomic replacement. Record actual story attempts, bindings, gates, review rounds, fingerprint, effective isolation, and terminal reason. Integrate R14 preflight after planning identifies roles but before workers execute; warn once or block when required. Centralize terminal persistence in finally/one finalizer, including early errors and cancellation. Success requires satisfied completion policy, not merely completed story count. Preserve readable older manifests without speculative schema adapters beyond real stored versions.

Mandatory dispatches: R15a owns run-manifest schema/storage plus runs/recovery readers and fixtures; R15b owns orchestration event/finalizer wiring and reviewer identity preflight. R15b uses R15a's integrated schema. Ledger integration is owned by R18 after both are complete.

Acceptance: planner failure, permission block, required gate failure, review rejection, cancellation, partial run, and success each leave correct evidence; interrupted write does not destroy the previous readable record; retry references prior run evidence without duplicating attempts; no credentials are persisted. Completion and runs output agree with the manifest.

Verification: runs-command, recovery, orchestrator and new run-manifest tests. Handoff: versioned outcome/event schema for R18/R21 and old-manifest fixture.

### R16 — Test actual runtime contracts with a scripted model

Priority P1; small-model task; dependencies R01, R11, R13, R15, R23; lock `test-harness`.

Files: new `src/__tests__/helpers/scripted-model.ts`, new `src/__tests__/runtime-contracts.test.ts`, `src/__tests__/useAgent.test.ts`, `src/__tests__/useOrchestrator.test.ts`, relevant copied-logic tests only.

Create one deterministic fake-model/SDK fixture that requests real registered tools and records actual execution/results, usage, finish reason, and cancellation. Reuse current mock helpers where sufficient. Exercise production adapters; do not mock the policy/gate/completion decision being tested. Replace mirrored test functions incrementally with production imports or adapter tests, preserving meaningful coverage. Keep live-provider E2E separate.

Mandatory dispatches: R16a builds/tests the scripted-model fixture; R16b adds governance runtime scenarios (permissions, final gates, terminal outcomes); R16c adds lifecycle/resume/child scenarios and removes remaining mirrored test helpers. R16c consumes R18's ledger handoff if integrated; otherwise its usage assertion stays at the frozen per-call callback and R18 owns end-to-end sum assertions. All three are sequential and test-only.

Acceptance: test matrix covers chat/headless/workers/revisions/read-only roles/children; deny has zero side effects; permission-required is non-success; final-state gate failure blocks publication; cancellation cleans descendants; session resume preserves intended state; usage is counted once. Fake fixtures must fail if production policy is bypassed. No network/keys required.

Verification: runtime-contracts plus migrated tests under ordinary npm test. Handoff: fixture usage example under 40 lines; list remaining mocks and what they do not prove.

### R17 — Qualify the packaged CLI and supported platforms in CI

Priority P1; small-model task; dependencies R01, R02, R07, R11, R16; locks `ci`, `package`.

Files: `.github/workflows/ci-cd.yml`, `package.json` test scripts only, new deterministic packaged CLI/PTY test and helper under `src/__tests__/`, optional `scripts/` launcher.

Add offline packaged-entry tests for `--help`, `--version`, headless JSON/exit status, and cancellation using the scripted provider transport. Install the packed artifact into a temporary directory when checking shipped assets/dependencies. Add Linux/macOS coverage for documented support, including Node 20 lower bound and the existing Node 22 baseline if installed dependency engines support both. Read actual lockfile/package engines first; if Node 20 is unsupported, return a concrete support-matrix correction for R22 rather than pretending a badge establishes compatibility. Native Windows shell support is not added by this ticket; document WSL boundaries. Put genuinely OS-dependent tests in a named deterministic suite and run it on supported CI hosts.

Acceptance: packaged CLI works outside the source tree; UI heartbeat/cancel succeeds under PTY with no real provider; process groups and real OS sandbox are exercised where supported; unsupported cases skip explicitly; CI requires the full unit suite once per selected matrix job, avoiding a duplicate focused suite plus identical full run. No live E2E or API keys in default CI.

Verification: new packaged/PTY tests, CI YAML inspection, typecheck/full suite/build. Handoff: tested platform/Node matrix and clear support exclusions.

### R18 — Complete the estimated usage/cost ledger

Priority P1; small-model task; dependencies R07, R10, R14, R15, R23; locks `cost`, `interactive-runtime`, `headless-runtime`, `worker-runtime`, `review-runtime`, `orchestrator`, `tool-registry`.

Files: `src/cost-tracker.ts`, `src/providers/types.ts`, `src/engine/tools/sub-agent.ts` usage callback only, `src/{run-command,orchestrator,compaction,run-manifest}.ts`, `src/ui/useAgent.ts`, `src/orchestrator/{planning,execution,review}.ts` usage callback wiring only, cost/provider tests. Broader policy or loop changes are excluded.

Add per-call identity and known/unknown pricing/usage semantics; preserve existing role/model breakdown. Include planner, critic, workers, reviewer, revisions, headless, compaction, and children once each. Record reported usage on interrupted/failed calls when available and mark missing usage unknown. Handle routed aliases and cache token fields where pricing supports them. Do not change pricing values or model defaults during this refactor.

Mandatory dispatches: R18a owns ledger/types and deterministic rate/aggregation tests only; R18b wires chat/headless/compaction/child usage callbacks; R18c wires orchestration roles, manifest/session summaries, and whole-run sum assertions. Integrate sequentially after manifest and runtime-cleanup tasks; never dispatch alongside an adapter writer. Keep no-op callback compatibility until the final wiring package lands.

Acceptance: scripted multi-role run sums exactly once; retry attempts are separate; child usage is not lost or double counted; unknown model rate is explicitly unknown; manifest/session/UI totals agree; local API charge is distinguished from estimated hardware cost (not automatically calculated).

Verification: cost-tracker, provider/model routing tests and scripted usage scenarios. Handoff: ledger snapshot contract and known limitations in provider usage reporting.

### R19 — Add optional estimated run budgets

Priority P2; small-model task with coordinator contract review; dependencies R11, R15, R18; locks `cost`, `config`, `interactive-runtime`, `headless-runtime`, `worker-runtime`, `review-runtime`, `orchestrator`.

Files: `src/config.ts`, `src/ui/commands/settings.ts`, new `src/engine/run-budget.ts`, cost/run/adapter integration seams, budget tests, configuration docs.

Add opt-in run limits for estimated USD and model-call/tool-step counts, sharing one budget across parent and children. Existing behavior remains when unset. Validate finite positive limits. Before starting a call, check known spend and reserve against a finite configured output allowance where feasible; abort/stop scheduling on exhaustion. Unknown pricing cannot be silently considered free when a USD limit is requested: block with an actionable reason or require an explicit nonmonetary limit policy. Persist `budget_exhausted` separately from provider errors. Use the shared cancellation mechanism.

Acceptance: child calls cannot reset the parent budget; revisions/critic calls count; simultaneous reservations cannot oversubscribe unnoticed; no new call after exhausted; partial usage and in-flight overshoot are recorded. Tests use fixed fake rates. Documentation states this is an estimate and cannot guarantee a provider billing cap.

Verification: run-budget and scripted ledger/cancellation tests. Handoff: configuration examples and exact overshoot limitations. This task can be deferred until the P0/P1 release is qualified; it is not a prerequisite for fixing safety defects.

### R20 — Prepare a representative evaluation set

Priority P2; small-model fixture task; dependencies none; lock `eval-fixtures`.

Files: new `evals/tasks/` fixture definitions and harmless fixture repositories or generators; new `evals/README.md` protocol. Do not import private user repositories or copyrighted benchmark tasks without suitable permission/license.

Define 20 small but realistic tickets across bug fixes (5), features (5), refactors (4), tests/maintenance (3), and security/validation repairs (3). Each includes fixed starting revision, task text, observable acceptance tests held separately from agent-visible context, permitted files/network needs, timeout, and expected human-review rubric. Include at least one multi-file dependency and one recovery scenario per suitable category. Use seeded broken examples where possible. Pin toolchain/dependency fixtures and preflight prerequisites.

Acceptance: each baseline fixture demonstrably lacks the requested behavior; the reference solution passes the held-out acceptance checks; tests reject at least one plausible incomplete solution; task IDs and initial revisions are stable; no secrets/live services required. Held-out tests are not included in model prompts or writable workspaces.

Mandatory dispatches: R20a defines protocol/schema and one example fixture; R20b builds five bug-fix fixtures; R20c builds five feature fixtures; R20d builds four refactor fixtures; R20e builds the three maintenance and three security fixtures. R20a's example counts toward its category, not as a 21st task. Keep these packages sequential under the shared fixture lock; they can run alongside an independent core work item. Prioritize P0 work over filling fixture slots.

Verification: deterministic fixture/reference-solution validation only; no model calls. Handoff: task inventory, licensing/provenance, difficulty limits, and reference results.

### R21 — Build comparison harness and evidence report

Priority P2; small-model implementation, stronger interpretation review; dependencies R15, R18, R20; lock `eval-harness`.

Files: new `evals/run.ts`, result schema/analysis script under `evals/`, `evals/README.md` harness section, deterministic harness tests.

Compare (A) WorkerMill multi-role routing and (B) WorkerMill's single-agent mode using the same capable baseline model for the same tickets. Optionally add a third external-tool baseline later; not needed to establish internal orchestration value. Pin provider/model versions when available, prompts/configs, hardware, context limits, toolchain, allowed interventions, and spend/time limits. Randomize arm order, use fresh workspaces, retain failed/cancelled attempts, and run at least three repetitions per arm for the full study (20 x 2 x 3 = 120 attempts). Start with a separately reported five-task pilot. Evaluate held-out tests outside the agent workspace.

Acceptance: dry run with scripted models produces reproducible rows, failures, aggregate metrics, and no external writes. Report accepted-task rate, total API spend per accepted task (including failed attempts), unknown-price share, elapsed median/tail, human correction minutes, and review false approvals. Distinguish zero local API charge from hardware/electricity costs. Show raw counts and uncertainty; do not claim parity from a small sample. Keep private source/tool payloads out of reports.

Execution boundary: implementation and fake dry run are in scope; live benchmark requires a user-specified provider/hardware/spend cap and access. Never discover keys and start spending automatically. Proposed continuation criterion to agree before live runs: acceptable task success within a user-chosen tolerance, materially lower cost per accepted task, and acceptable human correction/latency. Results can justify narrowing or stopping investment.

Verification: offline schema/aggregation tests and full dry run. Handoff: report artifact paths and a concrete live-run invocation template with placeholders, not an executed paid run.

### R22 — Align documentation and onboarding with actual guarantees

Priority P1; small-model task; dependencies R07, R10, R13, R14, R15, R17, R18; lock `docs`.

Files: existing `README.md`, `docs/{architecture,configuration,commands,quality-gates,troubleshooting,recipes}.md`, `SECURITY.md`, `CHANGELOG.md`, `AGENTS.md` only for demonstrably changed source guidance.

Replace unconditional different-model/quality/cost claims with verifiable wording. Document advisory versus blocking gates, headless permissions/exit results, explicit OS support/failure, worktree versus sandbox isolation, cancellation, unknown pricing, and supported Node/platform matrix. Add concise migration examples for static gates and headless allow rules. Update the source map after shared-runtime extraction. Link benchmark protocol/results only if those optional artifacts exist; otherwise state that comparative evaluation is pending and the cost/quality claim remains unvalidated. Only document R19 budgets if implemented.

Acceptance: every stated guarantee has a named regression or evidence artifact; quick-start and examples work in packaged smoke tests; all doc consistency/hook tests pass; no claims that an unavailable sandbox is active. No invented benchmark numbers.

Verification: docs-consistency, hooks, schema-command, commands tests; reviewed examples. Handoff: list of user-visible behavior changes and evidence links.

### R23 — Remove superseded runtime duplication

Priority P1; small-model mechanical task; dependencies R06, R07, R08, R09, R10, R11; locks `interactive-runtime`, `headless-runtime`, `worker-runtime`, `review-runtime`.

Files: migrated adapters, `src/permissions.ts` only after proving actual callers, obsolete worker-shell scaffolding, copied-test helpers already replaced, `src/engine/index.ts` exports if necessary.

Delete only policy/process/execution implementations made obsolete by prior tasks. Keep React responsible for UI state and callbacks; shared modules own policy/process lifecycle. Do not merge planner/chat prompts or force all model loops into a universal state machine. Use call-site searches to prove legacy exports are unused or delegate to one implementation. Keep compaction and conversation behavior stable.

Acceptance: one production permission decision implementation and one foreground model-command process runner; all adapters call them; no nested tool wrappers; no abandoned public exports or new circular dependencies. Existing public behavior changes are only the documented contracts above. No file-length target is a reason to move unrelated code.

Verification: targeted adapter tests, full typecheck/unit suite. Handoff: removed duplicates and remaining intentional differences.

### R24 — Integrate and qualify the release candidate

Priority P1; coordinator/stronger reviewer task; dependencies R16, R17, R18, R22, R23; lock `release`.

Files: narrow integration fixes only; any larger change becomes a new bounded task. R19 is optional for the first reliability release; record explicitly whether included.

Review final integrated diffs around policy bypasses, child scopes, process cleanup, required gates/freshness, manifests, unknown cost, and package behavior. Run the release checks below against one exact commit. Reconcile queue completion against actual evidence; a green helper test is not sufficient for runtime acceptance. Preserve user's unrelated changes. Prepare release notes and a concise qualification report; do not publish, tag, push, or merge without the separately applicable user authorization.

Acceptance: all P0/P1 criteria pass, skipped platform/live checks are explicit, no open severity-high finding, documented support matches qualification, and migration notes are concrete. If R20/R21 are included, benchmark dry run/protocol is complete; otherwise mark them pending. Comparative live claims stay absent until separately measured. Any remaining task has an owner and reason, not an implied completion claim.

Verification: `npm run typecheck`, `npm test`, `npm run build`, deterministic packaged/PTY and real OS-sandbox suites, documentation checks included in the unit run, offline evaluation dry run if R21 is included. Do not count duplicate lint/typecheck as additional assurance.

## Worker dispatch template

```text
Implement task <ID> from docs/reliability-plan.md on base commit <SHA>.
Read AGENTS.md, that task block, and these relevant contracts: <numbers>.
Prerequisite handoffs: <under-300-word summaries and exported signatures>.
Allowed write files: <task files>; exclusive locks held: <locks>.
Use existing patterns and .js imports. Do not change provider/model defaults.
No nested agents, live provider calls, unrelated refactors, or external writes.
Acceptance cases: <copy the task's observable cases>.
Run focused tests while iterating, then required typecheck/full tests before done.
If files/interfaces outside scope are necessary, return the exact dependency.
After one correction pass, escalate a still-failing approach with evidence.
Return base/commit, changed files, acceptance results, tests, limitations, and
exported signatures in at most 300 words. Do not mark untested criteria passed.
```

## Release success criteria and sequencing

P0 fixes are independently valuable and should not wait for the optional budget feature or live benchmark. The immediate deliverable is R12, followed by shared process/policy foundations and adapter migrations. Do not parallelize unfinished dependencies simply because multiple agent slots exist.

The implementation is qualified when configured permissions behave consistently across modes; explicit OS containment and child scoping are demonstrated on supported hosts; cancellation terminates descendants without freezing the UI; no blocking failure reaches publication; verification and approval cover the delivered state; manifests and usage describe unsuccessful runs as well as successful ones; and deterministic CI exercises the actual packaged runtime.

Commercial/product validation is a separate outcome: measured accepted-task cost, reliability, latency, and human correction. Completion of this code backlog alone does not establish the README's cost/quality proposition.

## Maintaining the queue

Keep task IDs unique, dependencies acyclic, section anchors valid, and exclusive write ownership non-overlapping. Aggregate tasks finish only after every suffix package is integrated and checked. Keep R19/R20/R21 outside the first-release dependency closure. Record completion evidence in the queue; update user-facing reference pages when behavior changes, rather than copying test-run histories into them.
