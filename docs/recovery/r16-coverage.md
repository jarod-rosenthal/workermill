# R16 runtime-contract coverage

R16 uses the installed AI SDK's `MockLanguageModelV3` scripted fixture where an
adapter needs SDK tool-loop behavior. The fixture gives every invocation a
stable call ID, accepts `streamText` and `generateText`, records the next prompt,
and fails a test on an unexpected or unconsumed scripted call.

| Runtime surface | Production-path evidence | Contract exercised |
| --- | --- | --- |
| Chat | `src/__tests__/useAgent-runtime.test.ts` | Mounted Ink hook with a mocked `streamText` driver; denied writes leave no file/checkpoint/hooks, visible permission cancellation ignores a stale approval, startup and active streams abort, owned process cleanup settles, and the first resumed turn receives the persisted conversation. |
| Headless | `src/__tests__/runtime-contracts.test.ts`, `headless-runtime.test.ts` | Real `runCommand`, registered SDK tools, denial/ask non-success behavior, and the following SDK prompt receives the actual tool result. |
| Workers and revisions | `src/__tests__/runtime-contracts.test.ts`, `worker-runtime-policy.test.ts` | Real execution/review adapters consume scripted tool calls; denied writes have no side effect and failed attempts remain failed. |
| Planner and reviewer read-only roles | `src/__tests__/runtime-contracts.test.ts`, `planner-runtime-policy.test.ts`, `review-runtime-policy.test.ts` | Production read-only adapter tool maps reject writes even when the configured policy would otherwise allow them. |
| Orchestration UI/final state | `src/__tests__/useOrchestrator-runtime.test.ts`, `orchestration-lifecycle-runtime.test.ts` | Mounted hook claims a run synchronously, owns cancellation through finalization, aborts on unmount, rejects stale confirmations, and reports finalized outcomes. |
| Children | `src/__tests__/sub-agent-runtime.test.ts` | A mocked `streamText` driver invokes registered child tools in the child context; parent paths and symlink escapes are rejected; cancellation terminates only the marked child process; each started child model call emits one frozen usage record after finalization. |

The copied emoji/output adapter in `useOrchestrator.test.ts` was removed. It
reimplemented hook formatting in the test and could pass while the mounted hook
failed. Its lifecycle/error ownership is covered by `useOrchestrator-runtime.test.ts`;
the independently exported session-divider helper remains directly tested.

The mirrored `useAgent.test.ts` state helpers were removed: private model-switch
and API-key environment setup, compaction bookkeeping, approval escalation,
rollback reduction, allow/deny set mutation, permission-mode cycling, message
shape creation, tool-count batching, and plan-tool filtering. The UI formatting
and persona map copies in `useOrchestrator.test.ts` were removed as
presentation-only mirrors. The mounted hook now covers message/rollback and
permission-mode transitions; compaction behavior is covered by
`useAgent-runtime.test.ts` cancellation and `compaction.test.ts`. Permission
policy is covered by the production tool-executor and runtime policy suites.
Model persistence and slash-command tests cover the supported configuration
entry points formerly approximated by the private model-switch tests.

Limits: mounted chat and child tests replace the `streamText` transport with a
deterministic driver, while retaining production hooks, tool definitions, and
cleanup. The installed-SDK model fixture exercises real SDK dispatch for
headless, worker, planner, reviewer, and revision adapters. Child worktree/OS
boundary tests require a host that permits local Git/process creation. R18 owns
end-to-end ledger summation; R16 asserts the frozen child callback metadata once
per child invocation.
