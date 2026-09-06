# R15 acceptance evidence

Scope: finish the manifest caller/storage contract and outcome consumers following recovery commit `08077002`. The R18 ledger remains separate.

| Contract | Implementation and evidence |
| --- | --- |
| Active before planning, terminal after completion/cleanup | `src/orchestrator.ts` central finalizer; `orchestration-manifest-runtime.test.ts` reads real storage during planning and pending completion, and after failures/cancellation. |
| Atomic validated storage, legacy and corrupt input handling | `src/run-manifest.ts`; real temporary-storage cases in `run-manifest.test.ts`, plus runs/recovery reader tests. Validation remains enabled. |
| Required gate, review, permission and completion failures | Typed gates/review plus identity preflight in orchestration; manifest runtime tests cover blocks and no completion. Worker runtime tests record denied/pre-hook failure codes with zero mutation. Cancellation is separate from internal teardown aborts. |
| Actual attempts and retry lineage | Worker/revision callbacks record actual starts/ends; restored completed stories create no attempts. Manifest runtime tests cover lineage and partial progress; worker/review runtime policy tests exercise real adapter failure/cancel/timeout callbacks. |
| Final outcome agrees with UI and run reader | Orchestration returns the same finalized outcome/reason it persists. Mounted `useOrchestrator-runtime.test.ts` checks success/failure/cancellation/partial independently of story counts. Program completion uses this outcome too. `wm runs show` prints persisted outcome and terminal reason. |
| Credentials and raw payload exclusion | Storage allowlist and schema tests exclude provider config, keys, tool payloads, review feedback and gate output. |

The storage integration tests mock stage adapters; adapter policy tests separately exercise real execution boundaries. Full real SDK tool-dispatch coverage is R16. All-role usage accounting, missing usage and unknown pricing are R18. No live model evaluation or paid provider call is part of this qualification.

Combined qualification: 1,655 tests passed, zero failed, one existing skip; typecheck passed. Backward wall-clock regression preserves timestamp ordering at the writer while keeping validation strict.
