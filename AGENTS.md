# AGENTS.md

Guidance for AI coding agents working in the **WorkerMill CLI** repository.

**Restart entry point:** Read [HANDOFF.md](HANDOFF.md) before resuming the reliability project. It records current authorization, saved branches, failed checks, and the next bounded task. Do not infer current readiness from older passing test counts in the backlog.

This file is loaded automatically as project context by WorkerMill, Claude Code, Cursor, and other agent tools. Keep it accurate — a wrong statement here misleads every agent that reads it.

## What This Repository Is

A single-package **TypeScript CLI**, published to npm as `workermill`. It is a terminal-native AI coding agent: you run `wm` in a project and it plans, writes, and reviews code using whatever LLM providers you configure.

There is **no server, no database, no frontend, and no API package**. Everything is one Node process. If you find yourself looking for `api/`, `frontend/`, or a migrations directory, you are thinking of a different project.

| | |
|---|---|
| Language | TypeScript, ESM only |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| LLM layer | [Vercel AI SDK](https://sdk.vercel.ai) v6 |
| CLI framework | Commander.js |
| Tests | Vitest |
| Runtime | Node 22.12+ |

For the source map and architecture, read [docs/contributing.md](docs/contributing.md) and [docs/architecture.md](docs/architecture.md).

## Commands

```bash
npm run dev          # Run from source via tsx, no build step
npm run typecheck    # tsc --noEmit
npm run lint         # Alias for typecheck — there is no ESLint in this repo
npm test             # vitest run
npx vitest run src/__tests__/foo.test.ts    # Single test file
npm run build        # tsup → dist/
./build.sh           # Clean build + invariant checks (version sync, bundle contents)
```

Run `npm run typecheck` and `npm test` before declaring work finished. `npm run lint` is an alias for typecheck, so do not count it as an independent check. The configured CI matrix covers Ubuntu 22.04/macOS and Node 22.12.0/22.22.2; Ubuntu 24.04 has an open nested-namespace compatibility limitation; see the qualification record for runs actually completed.

## Non-Negotiables

**ESM import paths need `.js` extensions.** `import { foo } from "./bar.js"` even though the file is `bar.ts`. This is not optional — the build breaks without it.

**`src/version.ts` must match `package.json`.** `build.sh` fails the build if they diverge. Use `./build.sh --bump patch` to change both at once.

**No `any` without a comment explaining the SDK type gap it works around.** TypeScript runs in strict mode.

**Never touch the model defaults, provider routing, or the default provider** without being asked. These are deliberate choices, not accidents.

## Docs Are Enforced by Tests

`src/__tests__/docs-consistency.test.ts` and `src/__tests__/hooks.test.ts` fail the build when code and documentation drift apart:

- Every command in `HELP_TEXT` must have a handler
- Every `wm` subcommand documented in `docs/commands.md` must be registered in `src/index.ts`
- Every `##` config heading in `docs/configuration.md` must be a real field in `src/config.ts`
- The tool count and persona count in `README.md` must match reality
- Every declared `LifecycleEvent` must actually be emitted somewhere

So documentation is part of the change, not follow-up work. [docs/contributing.md](docs/contributing.md#adding-features) lists exactly which files to touch when adding a command, tool, setting, or lifecycle event.

## Conventions

**Slash commands** dispatch from `src/ui/slash-commands.ts` but are implemented in `src/ui/commands/{session,settings,permissions,project}.ts`. Put new logic in the right module rather than growing the dispatcher.

**New settings keys** need four things in `src/ui/commands/settings.ts`: a `keyAliases` entry, a `case` in the switch, a row in the display table, and the key in the persist allowlist at the bottom. Miss the allowlist and the setting silently fails to save.

**Tests** live in `src/__tests__/`. Use `createTempWorkerMillHome()` from `src/__tests__/helpers/` instead of hardcoding paths — tests that write to a real `~/.workermill` will corrupt the developer's config. Mock `streamText`/`generateText` via `vi.mocked()`; assert on observable behavior, not internals.

**Prefer editing existing files.** Don't create new README, docs, or config files unless asked.

## Working Style

**Read before changing.** Find the existing pattern — this codebase is internally consistent, and matching it matters more than any individual preference.

**Small, focused changes.** No speculative abstractions, no backwards-compatibility shims nobody asked for, no scope creep.

**Narrate as you go.** Say what you're about to do, what you found, and what you changed.

**Ask first when:** changing model defaults or provider routing, altering the orchestration flow, or touching anything security-related. **Proceed when:** the task is clearly specified and follows an established pattern.

## Reporting

When something fails, say so plainly and include the output. A test suite with three pre-existing failures is worth reporting as three pre-existing failures — don't paper over it, and don't claim a fix you haven't verified.

## Continuity and integration discipline

These instructions reduce lost context and uncontrolled work; they cannot prevent a host outage, safety block, or forced session termination.

- **Establish scope from evidence.** At startup read the handoff, current user direction, applicable task specification, queue, branch, and working-tree status. Record the authorized objective and excluded work in the handoff. Earlier authorization persists unless the user changes it; do not repeatedly ask for it. If the user switches to audit/preservation, finish that work before resuming implementation.
- **Checkpoint before expanding.** Update `HANDOFF.md` before a batch, after integration or a failed check, before delegating a successor, and at least every 15 minutes during long work. Record UTC time, exact base/HEAD, changed and uncommitted files, worker/worktree ownership, commands with exit codes, unresolved failures, and one concrete next action. Save the checkpoint before beginning the next batch; a promise in chat is not a checkpoint.
- **Keep communication current.** During active work, give a meaningful progress update at least every 60 seconds when tool execution permits. State the finding, uncertainty, and next check. Do not repeatedly announce work without saving a reviewable result.
- **Keep batches bounded.** Use one objective and explicit file ownership per dispatch. Follow the reliability plan's dependency/lock rules and limit of two implementation workers when delegation is authorized. If a package materially exceeds the plan's size/scope trigger, split and record it before proceeding. After one implementation attempt and one focused correction, return unresolved blockers to the coordinator; do not loop indefinitely or expand the task silently.
- **Integrate complete contracts.** A storage/schema/API change must include or be qualified with every affected production caller before the integration branch is considered usable. Independent worker tests do not qualify a combined tree. If an incompatible intermediate commit is necessary, label it explicitly as broken in the handoff and do not dispatch downstream features until it is repaired and checked.
- **Stop expansion on failure.** A failed integrated check blocks unrelated feature integration. Diagnose the failure, preserve the exact output and revision, and fix only the bounded blocker or report it. Never suppress validation, remove useful tests, loosen assertions, or count timeouts as passes to manufacture a green result.
- **Bind claims to evidence.** Record command, environment, tested commit (or base plus dirty diff), exit code, pass/fail/skip counts, and limitations. Historical green runs do not apply to later commits. Typecheck/build success does not override failed runtime tests. Deleted tests require a coverage mapping to their replacements or a documented reason they are obsolete.
- **Reconcile workers before closing a batch.** Record worker commits even if they finish after coordinator interruption. Compare actual trees as well as patch IDs after conflict-resolved cherry-picks. Preserve unintegrated commits and user changes; do not blindly replay, reset, or delete worktrees. On restart, inspect available local history before asking the user to reconstruct it.
- **Respect host blocks.** Record the exact visible error and known action, distinguish confirmed cause from inference, and use normal approval/support paths. Do not bypass safety controls or claim that these instructions guarantee uninterrupted operation.
- **Leave portable evidence.** Keep the current handoff and concise validation evidence in the repository, separate from user-facing reference docs. Raw transcripts, credentials, private tool payloads, and hidden reasoning do not belong in repository documentation. `/tmp` logs and host session databases are supplemental evidence, not the only record.
