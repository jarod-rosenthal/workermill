# Contributing

Thanks for considering a contribution. WorkerMill CLI is Apache 2.0 licensed.

## Development Setup

**Prerequisites:** Node.js 20+, Git, an LLM provider (Ollama for fully local, or an API key for a cloud provider).

```bash
git clone https://github.com/jarod-rosenthal/workermill.git
cd workermill
npm install
```

## Scripts

From `package.json`:

| Script | What it does |
|--------|-------------|
| `npm run dev` | Run from TypeScript source via `tsx` (no build step) |
| `npm run build` | Build with `tsup` to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Alias for `typecheck` — there is no separate linter |
| `npm test` | Run all unit tests via `vitest run` |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | E2E tests via `vitest.e2e.config.ts` |
| `npm run test:coverage` | Tests with coverage report |

## Source Layout

```
workermill/
├── src/
│   ├── index.ts               # Commander CLI entry + chat default command
│   ├── orchestrator.ts        # /build coordinator — sequencing and public API
│   ├── orchestrator/          # Orchestration sub-modules
│   │   ├── types.ts           # Story, OrchestrationOutput, OrchestrationResult
│   │   ├── utils.ts           # Error classification, rate limiting, prompt helpers
│   │   ├── planning.ts        # Spec check, planner prompt, plan critic, story parsing
│   │   ├── execution.ts       # Story execution loop, tool setup, validation
│   │   ├── review.ts          # Tech lead review, revision passes, must-fix tracking
│   │   ├── gates.ts           # Quality gates, LSP diagnostics
│   │   └── completion.ts      # Push, PR creation, ticket transitions, cleanup
│   ├── config.ts              # Load/save ~/.workermill/cli.json
│   ├── setup.ts               # First-run provider wizard
│   ├── personas.ts            # Load persona markdown files
│   ├── cost-tracker.ts        # Token usage and cost aggregation
│   ├── permissions.ts         # Permission rule matching
│   ├── safety.ts              # Dangerous command/file detection
│   ├── compaction.ts          # Context window management
│   ├── hooks.ts               # Pre/post tool hook execution
│   ├── mcp-client.ts          # MCP server discovery and tool registration
│   ├── memory.ts              # Project-scoped memory storage and marker extraction
│   ├── checkpoints.ts         # /undo file checkpoints
│   ├── git-ops.ts             # Git operations (branch, commit, push)
│   ├── ticket-ops.ts          # GitHub/Jira/Linear ticket fetching
│   ├── run-command.ts         # Headless wm run execution
│   ├── session.ts             # Session persistence and management
│   ├── session-command.ts     # wm session CLI subcommands
│   ├── models-command.ts      # wm models / wm models update subcommands
│   ├── stats-command.ts       # wm stats CLI subcommand
│   ├── schema-command.ts      # wm schema CLI subcommand
│   ├── logs-command.ts        # wm logs CLI subcommand
│   ├── runs-command.ts        # wm runs CLI subcommands
│   ├── run-manifest.ts        # Per-/build JSON manifests that wm runs reads
│   ├── ship-state.ts          # Resumable /build state for /retry
│   ├── recovery.ts            # Interrupted-build detection on startup
│   ├── program-bootstrap.ts   # /orchestrate issue decomposition
│   ├── program-queue.ts       # /orchestrate epic parsing and queueing
│   ├── program-state.ts       # /orchestrate run state
│   ├── prd-decomposition-phases.ts # Status labels for planning phases
│   ├── prompts/               # Standalone prompt templates
│   ├── project-data.ts        # Project registry and scoped data paths
│   ├── project-context.ts     # Repo summary injected into prompts
│   ├── instructions.ts        # AGENT.md / CLAUDE.md / .cursorrules discovery
│   ├── learnings.ts           # Legacy learnings migration
│   ├── provider-registry.ts   # Model discovery and provider info
│   ├── provider-capabilities.ts # Per-provider feature and env-var lookup
│   ├── remote-models.ts       # Remote model catalog fetch and cache
│   ├── config/pricing.ts      # Shared pricing tables
│   ├── live-view-server.ts    # Browser diff preview SSE server
│   ├── live-view-url.ts       # Live view URL construction
│   ├── gate-runner.ts         # Quality gate execution
│   ├── sandbox-mode.ts        # Sandbox mode resolution (true/false/"os")
│   ├── tool-concurrency.ts    # Parallel tool-call scheduling
│   ├── deferred-tools.ts      # Lazy tool-schema loading for small models
│   ├── custom-commands.ts     # .workermill/skills and commands loading
│   ├── image-support.ts       # @file / @dir / @url / @image resolution
│   ├── notify.ts              # Terminal bell and desktop notifications
│   ├── update-check.ts        # npm version check
│   ├── state-root.ts          # ~/.workermill path resolution
│   ├── version.ts             # VERSION constant (keep in sync with package.json)
│   ├── logger.ts              # File logging
│   ├── commands.ts            # Shared command handlers for headless mode
│   ├── browser.ts             # /chrome headless browser control
│   ├── voice.ts               # /voice input
│   ├── schedule.ts            # /schedule cron tasks
│   ├── engine/                # AI model factory, tools, types
│   │   ├── model-factory.ts   # Provider → LanguageModel construction
│   │   └── tools/             # All agent tools + tool-metadata.ts
│   ├── providers/             # Provider registry and pricing engines
│   ├── ui/                    # React + Ink UI components
│   │   ├── Root.tsx           # App shell — owns useAgent + useOrchestrator
│   │   ├── App.tsx            # Message list + input + status bar
│   │   ├── Input.tsx          # Multi-line input with history and autocomplete
│   │   ├── StatusBar.tsx      # Bottom status bar
│   │   ├── useAgent.ts        # Single-agent state + tool loop
│   │   ├── useOrchestrator.ts # /build state + orchestrator coordination
│   │   ├── slash-commands.ts  # Command dispatch, HELP_TEXT, BUILTIN_COMMANDS
│   │   ├── commands/          # Slash command handler implementations
│   │   │   ├── session.ts     # /model, /cost, /status, /compact, /clear, /edit, /git, /diff, /changed, /sessions
│   │   │   ├── settings.ts    # /settings and every settings key
│   │   │   ├── permissions.ts # /permissions, /trust
│   │   │   └── project.ts     # /init, /remember, /forget, /memories, /personas, /skills, /mcp, /projects
│   │   ├── system-prompt.ts   # Single-agent system prompt assembly
│   │   └── agent/             # useAgent helper types and utilities
│   └── __tests__/             # Vitest unit tests
├── personas/                  # Built-in persona markdown files
├── docs/                      # Documentation
├── AGENTS.md                  # Behavioral guidance for agents working in this repo
└── CHANGELOG.md
```

All agent tools live in `src/engine/tools/`, registered in `src/engine/tools/index.ts`. `tool-metadata.ts` in that directory is an internal registry, not a tool.

## Adding Features

### New slash command

1. Add a `case "yourcommand":` block to the dispatcher in `src/ui/slash-commands.ts`
2. Put the implementation in the matching `src/ui/commands/` module — `session.ts`, `settings.ts`, `permissions.ts`, or `project.ts` — and call it from the case. Only trivial handlers stay inline in the dispatcher.
3. Add the command name to the `BUILTIN_COMMANDS` set in `slash-commands.ts` (so it shows in autocomplete and isn't shadowed by a custom command)
4. Add it to `HELP_TEXT` in the same file if the command is user-facing
5. Document it in `docs/commands.md`
6. Add a test in `src/__tests__/slash-commands.test.ts`

`src/__tests__/docs-consistency.test.ts` checks that every command in `HELP_TEXT` has a handler, so step 3 without step 1 fails CI.

### New tool

1. Create the tool in `src/engine/tools/<name>.ts` using the `tool()` helper from the AI SDK
2. Register it in `createToolDefinitions` in `src/engine/tools/index.ts`
3. Add tool metadata to `src/engine/tools/tool-metadata.ts` — mark `isReadOnly`, `isDestructive`, `acceptEditsApproved`, and `concurrencySafe` appropriately
4. Add it to the personas that should have it, in `personas/*.md` frontmatter
5. Update the tools table and count in `README.md`, plus the tool lists in `docs/architecture.md` and `docs/personas.md`
6. Add tests in `src/__tests__/`

The docs-consistency test asserts the README's tool count matches the number of registered tools, so step 5 is enforced.

### New lifecycle hook event

1. Add the event name to the `LifecycleEvent` union in `src/hooks.ts`
2. Call `runLifecycleHooks("your_event", config.hooks, workingDir, { ...env })` from wherever it fires
3. Document the event and its environment variables in `docs/hooks-and-skills.md`

`src/__tests__/hooks.test.ts` fails if an event is declared but never emitted, or emitted but not declared — a hook users can configure must actually fire.

### New persona

1. Create `personas/<name>.md` with YAML frontmatter:

```markdown
---
name: Data ML Engineer
slug: data_ml_engineer
description: Data pipelines, ML model training, feature engineering
---

System prompt content here...
```

2. Personas are auto-discovered from `personas/`, `~/.workermill/personas/`, and `.workermill/personas/` (project override takes precedence).

### New settings key

1. Add the field to the relevant interface in `src/config.ts` (`ReviewConfig`, `ProgramConfig`, `CliConfig`, etc.) **and** to the matching Zod schema in the same file — the schema is what `wm schema` emits and what validates loaded config
2. In `src/ui/commands/settings.ts`: add a lowercase entry to `keyAliases`, a `case "your.key":` to the switch, and the key to the persist list at the bottom of the function
3. Add a row to the settings table at the top of the same file so `/settings` shows the current value
4. Document the field in `docs/configuration.md` under its own `## \`fieldName\`` heading

The docs-consistency test checks that every `##` heading in `configuration.md` corresponds to a real field in `config.ts`.

## Testing

- **Unit tests** live in `src/__tests__/` and run against mocked AI SDK calls
- **E2E tests** run the full stack against real AI providers — require API keys in env
- Use `createTestConfig()` and `createMockOutput()` from test helpers for consistency
- Mock `streamText` and `generateText` via `vi.mocked()` for deterministic tests

Run a single test file:

```bash
npx vitest run src/__tests__/orchestrator.test.ts
```

## Style

- TypeScript strict mode — no `any` unless you're working around an SDK type gap (comment why)
- ESM imports only (`.js` extensions in import paths are required for ESM)
- Prefer small, focused functions over large methods
- Tool calls, model calls, and file I/O are the performance-sensitive paths — don't add synchronous work that blocks the Ink event loop

## Commits

Follow Conventional Commits: `fix:`, `feat:`, `docs:`, `chore:`, `test:`, `refactor:`. Include a short body explaining the why.

## Pull Requests

1. Fork, branch, commit, push
2. Open a PR with:
   - Clear summary of what changed and why
   - Test plan (how you verified the change)
   - Screenshots for UI changes
3. CI runs typecheck, tests, and lint. Fix any failures before requesting review.
4. For significant changes, open a discussion or issue first to align on approach.

## Release Process

The CLI is published to npm as `workermill`.

1. Bump `version` in `package.json` **and** `src/version.ts` (they must match)
2. Update `CHANGELOG.md` with the new version header and entries
3. `npm publish --access public`
4. Verify the new version on [npmjs.com/package/workermill](https://www.npmjs.com/package/workermill)

## Reporting Issues

- Run `wm doctor` and include the output
- Include OS, Node version, CLI version (`wm --version`)
- Reproduction steps and relevant log excerpt from `~/.workermill/logs/`

## Questions

Open a [GitHub Discussion](https://github.com/jarod-rosenthal/workermill/discussions) for design questions, or a [GitHub Issue](https://github.com/jarod-rosenthal/workermill/issues) for bugs.
