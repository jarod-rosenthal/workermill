# Changelog

All notable changes to the WorkerMill CLI are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.9.3] - 2026-03-25

### Fixed
- **Ollama context length never applied** — `num_ctx` was at the wrong nesting level in `providerOptions`. Ollama always loaded at 32K default regardless of config. Now correctly sends `providerOptions.ollama.options.num_ctx`.

## [0.9.2] - 2026-03-25

### Fixed
- `/model` message correctly says "restart CLI" (model can't hot-swap mid-session)
- `/status` reads live permission mode instead of stale launch props
- `/personas` works for npm users (was only scanning monorepo path)
- Bell doesn't ring on cancelled builds
- MCP client version string updated

## [0.9.1] - 2026-03-25

### Added
- `/release-notes` command (also `/changelog`) — shows CHANGELOG.md or links to GitHub

## [0.9.0] - 2026-03-25

### Added
- `/skills` command — lists custom commands with setup instructions
- `/personas` command — list all personas, show prompt details, create custom personas
- `/mcp` command — shows configured MCP servers with setup instructions
- All three added to `/help` and autocomplete

## [0.8.9] - 2026-03-25

### Changed
- Planner output streams line-by-line in real time instead of dumping on step finish

## [0.8.8] - 2026-03-25

### Fixed
- Normalize planner output field names (`index`→`id`, `steps`→`stories`, `depends_on`→`dependsOn`) for cross-model compatibility

## [0.8.7] - 2026-03-25

### Fixed
- Ensure unique story IDs before topological sort (planners without IDs collapsed all stories into one)

## [0.8.6] - 2026-03-25

### Changed
- Build permission prompts support `(y)es (a)lways (t)rust all (n)o`
- `/build` and `/retry` read current permission mode from Shift+Tab cycling

## [0.8.5] - 2026-03-25

### Fixed
- Google model names: `gemini-3.1-pro-preview` (was `gemini-3.1-flash-lite` which doesn't exist in API)

## [0.8.4] - 2026-03-25

### Removed
- `wm build` subcommand — use `/build` inside the CLI instead

## [0.8.3] - 2026-03-25

### Fixed
- Semver comparison for update check (was string compare, told users to downgrade)

## [0.8.2] - 2026-03-25

### Added
- Shift+Tab cycles permission modes: ask → auto-edit → trust all
- Auto-edit mode: auto-approves file tools, prompts only for bash

## [0.8.1] - 2026-03-25

### Added
- Slash command autocomplete — type `/` to see filtered list, arrows to navigate, Tab to accept

## [0.8.0] - 2026-03-25

### Added
- `/init` creates `WORKERMILL.md` in repo root (visible, committable) with project detection
- `/clear` resets conversation (clears messages and tokens)
- `/permissions` command with granular per-tool allow/deny
- Tab/Shift+Tab cycling in permission prompts
- Instructions loader checks `WORKERMILL.md` first

## [0.7.2] - 2026-03-25

### Fixed
- Dangerous commands always prompt even in trust mode (was auto-approving rm -rf, force push during builds)
- Dead `planText`/`allText` variables removed
- MCP client version updated

### Added
- CHANGELOG.md

## [0.7.1] - 2026-03-25

### Added
- Auto-update check: notifies when a newer version is available on npm (checks once per 24h)
- `wm doctor` command: checks Node.js version, git, config, Ollama connectivity, project instructions, learnings, and custom commands
- `/log` command: shows the last 20 entries from `.workermill/cli.log`
- Pre/post tool hooks: configure shell commands to run before/after specific tools via `cli.json`
- `/init` command: auto-generates `.workermill/instructions.md` from project metadata (package.json, requirements.txt, Dockerfile, git remote, directory structure)
- `/model` command: switch provider/model at runtime (persisted to config)
- `@folder/` mentions: inline directory tree listings (max depth 2) into prompts
- `@url` mentions: fetch URL content via curl and inline into prompts
- Terminal bell on long operations (>10s for chat, always for builds)
- `--max-tokens` flag: cap output tokens per response
- Double-ESC to roll back the last user+assistant conversation exchange
- `/undo` command: stash uncommitted changes or soft-reset the last commit
- `/diff` command: preview uncommitted changes with diff stat and content
- `@file` mentions: inline text file contents into prompts with syntax highlighting
- Project instructions: auto-loads `.workermill/instructions.md`, `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md`
- MCP (Model Context Protocol) server support: configure external tool servers in `cli.json`
- Persistent learnings: `::learning::` markers extracted and saved across sessions
- Custom slash commands: drop `.md` files in `.workermill/commands/` or `~/.workermill/commands/`
- `@image` mentions: inline image files (png, jpg, gif, webp, bmp) as multimodal content
- `/settings` command: view and modify review settings, Ollama host/context at runtime
- `/retry` command: re-plan and re-run the last `/build` task
- Inject original task spec into every worker's system prompt for full context
- Animated braille spinner on activity indicator
- Live status line showing persona activity during `/build`
- Tool-specific status labels (e.g., "Reading src/index.ts...", "Running npm test...")
- Bash guardrails: block dangerous commands (rm -rf, force push, drop table, etc.) with confirmation
- Author credit in welcome header
- Provider/model display when workers and reviewer start
- Cost estimates shown with `~` prefix, rounded to cents

### Fixed
- Show status during revision and review tool execution
- 1-based review round numbering (was 0-based)
- ESC handler always active with `isActive: true`
- Simplified build status to "persona: working..." instead of verbose output
- Compact welcome commands into single line
- Inject actual code diff into review prompt instead of summary
- Unlimited review rounds with y/n prompt (configurable via settings)
- Workers instructed to stay within working directory
- Suppress `MaxListenersExceededWarning` during builds (raised default to 30)
- Force `process.exit` on `/quit` and double Ctrl+C to prevent dangling listeners
- Auto-fix Ollama context length mismatch at startup via `ensureOllamaContext`
- Remove empty line spam, compact message spacing
- Skip classification step for `/build` (go straight to multi-expert)
- Stop filtering planner output lines
- All agents ignore `.workermill/` directory
- Replace verbose file listing with compact change summary after build
- Properly mask API keys during setup by closing readline before raw input
- Remove cost summary dump after build (status bar shows running total)
- Resolve routed provider names for accurate cost tracking
- ESC cancels build in progress
- Move context bar next to worker model in status bar
- Fix API key plaintext echo during setup
- Show all role models in status bar

## [0.5.4] - 2026-03-22

### Fixed
- Lockfile update for dependency resolution

## [0.5.0] - 2026-03-21

### Added
- Role-based setup wizard: configure separate providers/models for workers, planner, and reviewer
- Live cost tracking in status bar during all operations
- Status bar improvements: git branch, token context usage, mode indicator

### Fixed
- Use API pricing engine for accurate cost calculation
- Fix review score extraction from model output
- Add structured logging throughout the CLI

## [0.4.1] - 2026-03-20

### Added
- Bump OpenAI models to current generation (GPT-5.4 family)
- Orchestrator logging for debugging build runs

### Fixed
- Fix API key handling for routed providers
- Correct status bar layout for multi-provider setups

## [0.4.0] - 2026-03-19

### Added
- Ink-based terminal UI replacing the scroll-region TUI
- ESC to cancel running agent operations
- React component architecture (App, Root, StatusBar, Input, Markdown, ToolCall, PermissionPrompt)

### Changed
- Migrated from raw readline + ANSI escape codes to Ink (React for terminals)
- Messages rendered via `<Static>` for proper scrollback
- Permission system integrated into React state management

## [0.3.0] - 2026-03-18

### Added
- Battle-tested WorkerMill production prompts ported to CLI personas
- Enriched all worker personas with WorkerMill production rules (Docker, version trust, communication style)
- 13 persona files matching `worker/epic/experts.ts`

### Changed
- Persona system aligned with WorkerMill worker to ensure CLI IS WorkerMill

## [0.2.0] - 2026-03-17

### Added
- Multi-expert orchestration (`/build` command)
- Planner agent with codebase exploration
- Tech Lead reviewer with score-based approval
- Selective revision (only re-run affected stories)
- Topological story sorting by dependencies
- Inline review with revision loop
- Context sharing between stories (files, decisions, learnings)
- Automatic git commit after successful builds

### Fixed
- Context bar shows actual window usage, not cumulative spend
- Ollama `num_ctx` passthrough with 64K default context
- Single-agent WorkerMill format output
- Bash error visibility and PATH fix

## [0.1.3] - 2026-03-15

### Added
- Initial public release on npm as `workermill`
- Single-agent interactive chat mode
- Multi-expert orchestration (alpha)
- 13 shared tools from `packages/engine/`
- Ollama, Anthropic, OpenAI, and Google provider support
- Scroll region TUI with pinned status bar
- Session persistence and resume (`--resume`)
- Auto-compaction when context usage exceeds 80%
- Cost tracking with per-provider pricing
