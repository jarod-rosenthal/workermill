# Reliability release-candidate qualification

Status: **in progress**. This is the coordinator's local review record, not a published release or evidence that remote CI ran. The current executable checkpoint is in [HANDOFF.md](../../HANDOFF.md). Final commit and checks will be recorded here after session accounting and reference documentation are integrated.

## Reviewed contracts

| Contract | Production boundary reviewed | Deterministic evidence in `src/__tests__/` |
| --- | --- | --- |
| One permission decision, deny/read-only precedence, cancelled prompts | `engine/tool-policy.ts`, `engine/tool-executor.ts`; chat, headless, planner, worker, review/revision, and child call sites | `tool-policy`, `tool-executor`, `runtime-contracts`, `useAgent-runtime`, `headless-runtime`, `worker-runtime-policy`, `planner-runtime-policy`, `review-runtime-policy` |
| Canonical file scope and explicit grants | `engine/path-policy.ts`, registered file tools, child tool factory | `path-policy`, `sub-agent-runtime`, `sub-agent`, `git-tool` |
| Foreground process ownership and OS boundary | `engine/process-runner.ts`, `engine/scoped-process.ts`, `sandbox-mode.ts`, gate and shell adapters | `process-runner`, `scoped-process`, `sandbox-mode`, `root-shell-runtime`, `orchestrator-gates-cancellation`, `bash-background` |
| Child scope, cancellation, preserved work | `engine/tools/sub-agent.ts`, rebuilt tools and inherited context | `sub-agent-runtime`, `sub-agent`, `useAgent-runtime` |
| Required gates and fresh publication evidence | `orchestrator/gates.ts`, `candidate.ts`, `completion.ts`, repository fingerprint and orchestration finalizer | `orchestrator-gates`, `candidate-runtime`, `final-evidence-runtime`, `repository-fingerprint`, `publication-lifecycle` |
| Active/terminal records and typed outcomes | `run-manifest.ts`, `orchestrator.ts`, result consumers | `run-manifest`, `orchestration-manifest-runtime`, `useOrchestrator-runtime`, `runs-command` |
| Usage on failed/retried/child calls | `cost-tracker.ts`, `engine/model-usage.ts`, SDK invocation finalizers | `cost-tracker`, `headless-ledger`, `runtime-contracts`, `planner-runtime-policy`, `worker-runtime-policy`, `review-runtime-policy`, `useAgent-runtime`, `sub-agent` |
| Installed artifact and responsive cancellation | CI matrix, package lock and `package-os.test.ts` | `npm run test:package-os` packs/installs into a temporary project and exercises help/version, headless JSON, SIGINT, and active-model ESC under a real PTY |

Test basenames above mean `<name>.test.ts`. The [R16 coverage map](r16-coverage.md) distinguishes actual SDK scripted transports from mounted tests using mocked stream drivers. [R15](r15-acceptance.md) and [R23](r23-acceptance.md) retain the recovery and removed-test audits. The run-ledger agreement fixture uses mocked role adapters with a real tracker and manifest store; separate runtime tests exercise the real role adapters. It is not a live-model quality evaluation.

## Review findings addressed during continuation

- Strict active/terminal manifest storage had been integrated without its writer/finalizer contract; the recovery repaired all result exits rather than relaxing validation.
- Obsolete CostTracker doubles masked lifecycle cleanup errors after the per-call API changed. Tests now use the real tracker at those boundaries.
- Child usage still replaced observed positive step subtotals with an SDK zero placeholder. `4c7cbc05` adopts the shared normalization/settlement helper and tests both partial positive usage and genuinely reported zero.
- The expanded multi-role manifest fixture initially retained an old review token expectation. `0efe4934` aligns it with the actual scripted observation; the full suite passed afterward.

## Practical limits and remaining qualification

- Local qualification uses Linux, Node 22.22.2 and the exact `package-lock.json` graph in the dedicated qualification worktree. Linux/macOS × Node 22.12.0/22.22.2 CI is configured; other matrix jobs have not run here. Native Windows shell support is excluded; WSL depends on its Linux kernel/runtime capabilities.
- OS tests explicitly skip missing dependencies or an unsupported kernel. A skip is not containment evidence. The Linux checkpoint at `0efe4934` had only the pre-existing obsolete `useCritic` test skipped; the actual OS cases ran.
- Path mode checks explicit file-tool paths, not arbitrary shell behavior or races with hostile external filesystem mutation. OS mode limits writes and selected sensitive reads; it does not confine every host read. Worktrees separate changes and are not a security boundary. Explicit OS setup failure never executes the raw command as fallback.
- Process cleanup sends TERM/KILL to owned process groups with bounded waiting. It does not guarantee control of every process that deliberately escapes its group or becomes uninterruptible in the kernel.
- Ledgers estimate observed API usage. Missing/partial provider usage and unknown rates remain explicit; local API cost excludes hardware cost. Program decomposition in `program-bootstrap.ts` happens outside the build-run ledger; direct auxiliary planning helpers without a usage observer are also outside session accounting. These totals are not application-wide billing totals.
- The legacy `EngineAIClient` remains used by optional live E2E tests. It has no production CLI caller and is not a shipped public library entry point. Its raw-tool harness is not evidence for the governed CLI adapters. Default deterministic qualification does not run those live tests.
- Optional R19 estimated budgets and R21 comparison harness/live measurements are deferred. R20's 20 offline semantic fixtures exist; they do not establish comparative model quality or cost.
- No publication, tag, push, PR, remote merge, paid evaluation, or deletion of preserved worktrees is part of this qualification.
