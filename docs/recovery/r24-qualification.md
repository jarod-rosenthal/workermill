# Reliability release-candidate qualification

Status: **qualified on the supported CI matrix** at `b67160f8393370fc99019b3a5bcff305570e381f`, 2026-09-07. Ubuntu22.04 and macOS26 arm64 passed on Node22.12.0/22.22.2. Ubuntu24.04 remains an explicit open compatibility limitation. The original local qualification and failed remote attempts are retained below. No release or live comparative evaluation occurred.

## Final checks

All executable checks used commit `67e19c20`, Linux and Node **22.22.2**, and the exact `package-lock.json` dependency graph in `/home/user/github/workermill-qualification-cont`. The original evidence commit `7e08a94a` records this local result. Subsequent CI-only and test-harness corrections are documented in the remote continuation below; production code is unchanged.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed, exit 0 |
| `npm test` | **1,614 passed, 0 failed, 1 existing skip; 111 files**, exit 0, 32.69 seconds |
| `npm run build` | Passed, exit 0; bundled CLI 1.41 MB |
| `npm_config_cache=/tmp/workermill-qualification-npm-cache npm run test:package-os` | **4 passed**, exit 0, 10.79 seconds; actual installed artifact and PTY |

The existing skip is the obsolete `useCritic` configuration test in `orchestrator.test.ts`. Actual Linux OS-sandbox cases ran successfully. Docs consistency, hooks, command/schema checks, and 20 offline evaluation fixtures are included in the full suite. Final local Markdown path checks, JSON parsing and `git diff --check` also passed.

For resumption, use [HANDOFF.md](../../HANDOFF.md). [The retrospective](2026-09-06-retrospective.md) explains recovered work and failures; [the continuation inventory](2026-09-06-continuation.json) records commits, changed paths, documentation, recent tracked-file metadata and preserved worktrees at its stated snapshot.

## Remote qualification continuation

The user authorized pushing `reliability/core` and running the existing CI matrix. No merge or release is authorized.

- [Run 34066504739](https://github.com/jarod-rosenthal/workermill/actions/runs/34066504739), `7e08a94a`: all four jobs failed unit tests. On Node 22.22.2, Linux had four failures/1,604 passes/seven skips; macOS had eight failures/1,605 passes/two skips. Install, typecheck and build passed; package tests were blocked by unit failures.
- `55629f3c` corrects test temp-path canonicalization, shell fixture paths and adds a real Linux sandbox startup probe. Local unit tests passed: 1,614 passed/one existing skip, 111 files, 31.47 seconds; typecheck passed.
- [Run 34067913059](https://github.com/jarod-rosenthal/workermill/actions/runs/34067913059), `55629f3c`: macOS unit suites passed (1,613 passed/two skips); each package suite had three passes and one `posix_spawnp failed` error in the native PTY test driver. Linux stopped before tests at `bwrap: setting up uid map: Permission denied`.
- `e0c5e635` installs and loads Ubuntu's packaged `bwrap-userns-restrict` profile from `apparmor-profiles`. The profile allows bwrap's namespace setup while denying child capabilities; global namespace restrictions remain enabled. The earlier attempted `/etc/apparmor.d/bwrap` location was wrong. [Ubuntu's package maintainer explains this package split](https://bugs.launchpad.net/ubuntu/+source/apparmor/+bug/2064672).
- The same correction prepares the temporary test driver's macOS `spawn-helper` owner execute bit. Locked node-pty 1.1.0 ships it as 0644 ([upstream issue #850](https://github.com/microsoft/node-pty/issues/850)); the fix is merged upstream but the registry's latest stable remains 1.1.0 at this checkpoint. WorkerMill has no production node-pty caller; the installed CLI is unchanged. No dependency version change or relaxed assertions were needed.
- Local `e0c5e635` typecheck passed; installed-package tests passed four/four, 10.96 seconds. [Run 34069185187](https://github.com/jarod-rosenthal/workermill/actions/runs/34069185187) targets exact SHA `e0c5e6355feb8c539cf0cf752747596c9493b657`; failed: Linux Node22.22.2 had eight failures/1,606 passes/one skip because the runtime seccomp helper needs a nested namespace whose capabilities the Ubuntu24.04 profile denies. macOS units passed, but its PTY child inherited CI=true, suppressing interactive rendering. The next correction clears CI detection only for the interactive test child and pins the supported Linux matrix to Ubuntu22.04. Ubuntu24.04 remains unqualified; no host restrictions or assertions are disabled.

### Supported-host matrix

[Run 34069973409](https://github.com/jarod-rosenthal/workermill/actions/runs/34069973409) tests exact commit `b67160f8393370fc99019b3a5bcff305570e381f`. This explicitly qualifies Ubuntu22.04 and macOS26 arm64; it does **not** qualify Ubuntu24.04. The first macOS Node22.12 checkout failed because the runner could not resolve github.com; that job was retried on the same SHA. Other jobs were already successful. The retry passed and the overall run concluded **success** on 2026-09-07. Subsequent commits contain documentation/evidence only.

| Host | Node | Unit tests | Installed package / PTY | Typecheck / build |
| --- | --- | --- | --- | --- |
| Ubuntu22.04 | 22.12.0 | 1,614 passed, one skip | 4 passed | Passed |
| Ubuntu22.04 | 22.22.2 | 1,614 passed, one skip | 4 passed | Passed |
| macOS26 arm64 | 22.22.2 | 1,613 passed, two skips | 4 passed | Passed |
| macOS26 arm64 | 22.12.0 | 1,613 passed, two skips | 4 passed | Passed |

Each unit suite has 111 files. Linux's sole skip is the obsolete useCritic setting. macOS additionally skips the Linux-only Windows-Chrome symlink fixture. Actual OS containment tests are required with WM_REQUIRE_OS_SANDBOX=1; missing sandbox support is not counted as a pass. Local `b67160f8` typecheck and four package tests passed (10.55 seconds). One local package attempt omitted the documented cache and failed before tests with ENOTCACHED; the corrected invocation used the existing cache without dependency changes.

**Open platform follow-up:** qualify a runtime compatible with Ubuntu24.04's default user-namespace policy, including full registered-tool/child/Git/gate containment tests. Current failures are preserved above. A simple bwrap startup probe is insufficient because apply-seccomp starts a nested namespace. Do not disable global restrictions, add broad child capabilities, or remove containment assertions as a substitute for qualification.

## Reviewed contracts

| Contract | Production boundary reviewed | Deterministic evidence in `src/__tests__/` |
| --- | --- | --- |
| One permission decision, deny/read-only precedence, cancelled prompts | `engine/tool-policy.ts`, `engine/tool-executor.ts`; chat, headless, planner, worker, review/revision, and child call sites | `tool-policy`, `tool-executor`, `runtime-contracts`, `useAgent-runtime`, `headless-runtime`, `worker-runtime-policy`, `planner-runtime-policy`, `review-runtime-policy` |
| Canonical file scope and explicit grants | `engine/path-policy.ts`, registered file tools, child tool factory | `path-policy`, `sub-agent-runtime`, `sub-agent`, `git-tool` |
| Foreground process ownership and OS boundary | `engine/process-runner.ts`, `engine/scoped-process.ts`, `sandbox-mode.ts`, gate and shell adapters | `process-runner`, `scoped-process`, `sandbox-mode`, `root-shell-runtime`, `orchestrator-gates-cancellation`, `bash-background` |
| Child scope, cancellation, preserved work | `engine/tools/sub-agent.ts`, rebuilt tools and inherited context | `sub-agent-runtime`, `sub-agent`, `useAgent-runtime` |
| Required gates and fresh publication evidence | `orchestrator/gates.ts`, `candidate.ts`, `completion.ts`, repository fingerprint and orchestration finalizer | `orchestrator-gates`, `candidate-runtime`, `final-evidence-runtime`, `repository-fingerprint`, `publication-lifecycle` |
| Program cancellation | `ui/useOrchestrator.ts`, `program-bootstrap.ts`: parent signal, scoped gates, bounded issue requests | `program-cancellation`, `useOrchestrator-runtime` |
| Active/terminal records and typed outcomes | `run-manifest.ts`, `orchestrator.ts`, result consumers | `run-manifest`, `orchestration-manifest-runtime`, `useOrchestrator-runtime`, `runs-command` |
| Usage on failed/retried/child calls | `cost-tracker.ts`, `engine/model-usage.ts`, SDK invocation finalizers | `cost-tracker`, `headless-ledger`, `runtime-contracts`, `planner-runtime-policy`, `worker-runtime-policy`, `review-runtime-policy`, `useAgent-runtime`, `sub-agent` |
| Installed artifact and responsive cancellation | CI matrix, package lock and `package-os.test.ts` | `npm run test:package-os` packs/installs into a temporary project and exercises help/version, headless JSON, SIGINT, and active-model ESC under a real PTY |

Test basenames above mean `<name>.test.ts`. The [R16 coverage map](r16-coverage.md) distinguishes actual SDK scripted transports from mounted tests using mocked stream drivers. [R15](r15-acceptance.md) and [R23](r23-acceptance.md) retain the recovery and removed-test audits. The run-ledger agreement fixture uses mocked role adapters with a real tracker and manifest store; separate runtime tests exercise the real role adapters. It is not a live-model quality evaluation.

## Review findings addressed during continuation

- Strict active/terminal manifest storage had been integrated without its writer/finalizer contract; the recovery repaired all result exits rather than relaxing validation.
- Obsolete CostTracker doubles masked lifecycle cleanup errors after the per-call API changed. Tests now use the real tracker at those boundaries.
- Child usage still replaced observed positive step subtotals with an SDK zero placeholder. `4c7cbc05` adopts the shared normalization/settlement helper and tests both partial positive usage and genuinely reported zero.
- `/orchestrate` program gates and bootstrap requests were outside parent cancellation. `d85284de` threads the signal through ticket lookup, decomposition and issue creation/update, bounds issue HTTP requests, and uses the shared scoped gate runner; mounted cancellation prevents the next advisory gate.
- Session updates now deduplicate progress/replay observations. Root checks cover mounted forwarding, cumulative historical token preservation, and unknown-price qualifications in stats JSON.
- The expanded multi-role manifest fixture initially retained an old review token expectation. `0efe4934` aligns it with the actual scripted observation; the full suite passed afterward.

## Practical limits and deferred checks

- Local qualification uses Linux, Node 22.22.2 and the exact `package-lock.json` graph in the dedicated qualification worktree. Linux/macOS × Node 22.12.0/22.22.2 CI is configured; its subsequent runs are recorded above. Native Windows shell support is excluded; WSL depends on its Linux kernel/runtime capabilities.
- OS tests explicitly skip missing dependencies or an unsupported kernel. A skip is not containment evidence. The Linux checkpoint at `0efe4934` had only the pre-existing obsolete `useCritic` test skipped; the actual OS cases ran.
- Path mode checks explicit file-tool paths, not arbitrary shell behavior or races with hostile external filesystem mutation. OS mode limits writes and selected sensitive reads; it does not confine every host read. Worktrees separate changes and are not a security boundary. Explicit OS setup failure never executes the raw command as fallback.
- Process cleanup sends TERM/KILL to owned process groups with bounded waiting. It does not guarantee control of every process that deliberately escapes its group or becomes uninterruptible in the kernel.
- Ledgers estimate observed API usage. Missing/partial provider usage and unknown rates remain explicit; local API cost excludes hardware cost. Program decomposition in `program-bootstrap.ts` happens outside the build-run ledger; direct auxiliary planning helpers without a usage observer are also outside session accounting. These totals are not application-wide billing totals.
- The legacy `EngineAIClient` remains used by optional live E2E tests. It has no production CLI caller and is not a shipped public library entry point. Its raw-tool harness is not evidence for the governed CLI adapters. Default deterministic qualification does not run those live tests.
- Optional R19 estimated budgets and R21 comparison harness/live measurements are deferred. R20's 20 offline semantic fixtures exist; they do not establish comparative model quality or cost.
- Branch pushes and remote CI were subsequently authorized. No publication, tag, PR, remote merge, paid evaluation, or deletion of preserved worktrees is part of this qualification.


## Ubuntu24.04 diagnostic follow-up — candidate

Authorized after the supported-host qualification. Isolated branch reliability/ubuntu2404, base a2547299. A shared complete runtime probe now checks harmless command execution through the real scoped runner (five-second command timeout, cancellation propagation and owned cleanup), not just dependency installation. Headless/chat startup and build preflight use it; doctor reports failure instead of claiming dependency presence establishes runtime health. Explicit OS requests stop before model work. Only the existing optional build upgrade can fall back, visibly, to path mode. Cleanup failures propagate rather than authorize fallback.

The released0.0.75 README and wrapper retain the same nested-namespace requirement. The dependency remains pinned to0.0.46 pending evidence; the Ubuntu24.04 CI diagnostic compares0.0.75 in a separate installation. The added Ubuntu24.04 jobs qualify truthful startup rejection and usable path mode, not OS containment. They retain the host userns restriction and use Ubuntu's packaged bwrap policy.

Local candidate: typecheck/build passed; full suite1623 passed, zero failed, one existing skip,112 files,32.90 seconds. This local environment reports Ubuntu24.04 userspace but lacks the AppArmor userns restriction sysctl, so local success is not evidence for stock Ubuntu24.04. Remote and package results pending.
