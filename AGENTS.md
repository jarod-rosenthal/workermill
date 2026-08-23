# AGENTS.md

Guidance for AI coding agents working in the **WorkerMill CLI** repository.

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
| Runtime | Node 20+ |

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

Run `npm run typecheck` and `npm test` before declaring work finished. CI runs typecheck, lint, build, and the unit suite on every PR.

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
