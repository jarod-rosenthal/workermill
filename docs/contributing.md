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
| `npm test` | Run all unit tests via `vitest run` |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | E2E tests via `vitest.e2e.config.ts` |
| `npm run test:coverage` | Tests with coverage report |

## Source Layout

```
workermill/
├── src/
│   ├── index.ts               # Commander CLI entry + chat default command
│   ├── orchestrator.ts        # /build pipeline: planner → workers → reviewer
│   ├── config.ts              # Load/save ~/.workermill/cli.json
│   ├── setup.ts               # First-run provider wizard
│   ├── personas.ts            # Load persona markdown files
│   ├── cost-tracker.ts        # Token usage and cost aggregation
│   ├── permissions.ts         # Permission rule matching
│   ├── safety.ts              # Dangerous command/file detection
│   ├── compaction.ts          # Context window management
│   ├── hooks.ts               # Pre/post tool hook execution
│   ├── mcp-client.ts          # MCP server discovery and tool registration
│   ├── memory.ts              # ::learning:: / ::remember:: extraction
│   ├── checkpoints.ts         # /undo file checkpoints
│   ├── git-ops.ts             # Git operations (branch, commit, push)
│   ├── ticket-ops.ts          # GitHub/Jira/Linear ticket fetching
│   ├── run-command.ts         # Headless wm run execution
│   ├── session.ts             # Session persistence and management
│   ├── session-command.ts     # wm session CLI subcommands
│   ├── models-command.ts      # wm models CLI subcommands
│   ├── stats-command.ts       # wm stats CLI subcommand
│   ├── schema-command.ts      # wm schema CLI subcommand
│   ├── project-data.ts        # Project registry and scoped data paths
│   ├── provider-registry.ts   # Model discovery and provider info
│   ├── live-view-server.ts    # Browser diff preview SSE server
│   ├── gate-runner.ts         # Quality gate execution
│   ├── engine/                # AI model factory, tools, types
│   ├── providers/             # Provider registry and pricing engines
│   ├── ui/                    # React + Ink UI components
│   │   ├── Root.tsx           # App shell
│   │   ├── App.tsx            # Message list + input + status bar
│   │   ├── Input.tsx          # Multi-line input with history and autocomplete
│   │   ├── StatusBar.tsx      # Bottom status bar
│   │   ├── useAgent.ts        # Single-agent state + tool loop
│   │   ├── useOrchestrator.ts # /build state + orchestrator coordination
│   │   └── slash-commands.ts  # All slash command handlers
│   └── __tests__/             # Vitest unit tests
├── personas/                  # Built-in persona markdown files
├── docs/                      # Documentation
└── CHANGELOG.md
```

Tools (`bash`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `ls`, `patch`, `verify`, `todo`, `fetch`, `web_search`, `lsp`, `sub_agent`) live in `src/engine/tools/`.

## Adding Features

### New slash command

1. Add a `case "yourcommand":` block in `src/ui/slash-commands.ts`
2. Add the command name to the `BUILTIN_COMMANDS` set at the top of the file (so it shows in autocomplete and isn't shadowed)
3. Update the `/help` output if the command is user-facing
4. Add a test in `src/__tests__/slash-commands.test.ts`

### New tool

1. Create the tool in `src/engine/tools/<name>.ts` using the `tool()` helper from the AI SDK
2. Export from `src/engine/tools/index.ts`
3. Add tool metadata to `src/engine/tools/tool-metadata.ts` — mark `isReadOnly`, `isDestructive`, `concurrencySafe` appropriately
4. Add tests in `src/__tests__/`

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

1. Add the field to the relevant interface in `src/config.ts` (`ReviewConfig`, `CliConfig`, etc.)
2. Add a `case "your.key":` in the `/settings` handler in `src/ui/slash-commands.ts`
3. Update the settings table output in the same file so users see the current value

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
