# Changelog

All notable changes to the WorkerMill CLI are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Reliability contracts** — required static gates now default to blocking, while planner verification and explicitly advisory gates remain advisory outside strict mode. Strict mode requires valid review approval when review is enabled and verifies gates, review, and completion against the same candidate fingerprint.
- **Run usage ledger** — records observed calls across roles, children, compaction, failed calls, and retries without double counting. Unknown pricing and incomplete usage are labelled; run totals are per-run and session totals are cumulative.
- **Explicit OS-sandbox behavior** — explicit `sandbox: "os"` fails closed when unavailable. `/build` may visibly continue with path mode only after its optional automatic upgrade fails. Worktrees remain change isolation, not a sandbox.
- **Planner critic** — `review.critic` (default off) scores the `/build` plan 1-10 on completeness, feasibility, dependencies, scope, and risk between planning and execution, refining it against the critic's issues until it reaches `review.criticThreshold` (default 8) or three rounds are spent. Routes via `routing.critic`; call records retain critic identity and aggregate into the reviewer cost bucket. Critic failure remains advisory outside strict mode. Under `review.strict` an unapproved plan aborts the run instead of falling through to the confirmation prompt. Configure with `/settings review.critic` and `/settings review.criticThreshold`.
- **Lifecycle hooks now fire for every documented event** — `session_start`, `session_end`, `compact`, `tool_error`, `permission_denied`, `story_complete`, and `memory_saved` were declared and documented but never emitted, so hooks configured for them silently never ran. All seven now fire, each with event-specific environment variables. A test fails the build if an event is ever declared without a call site again.
- **`/settings review.specCheck` and `/settings editor`** — both had config fields but no way to set them from inside the CLI.

### Changed
- **Headless permissions** — `wm run` enforces allow/ask/deny rules and returns non-success when a required permission cannot be obtained. `--full-disk` changes file scope, not tool permission. See [migration examples](docs/commands.md#wm-run).
- **Sandbox capabilities** — Docker socket access defaults off. The optional socket capability is unsupported by the Linux OS boundary; write grants and network allowances are explicit. See [configuration](docs/configuration.md#sandbox).
- **Qualification** — deterministic tests cover actual adapters, installed-package startup, headless JSON and PTY cancellation. Platform and live-evaluation limits are recorded in the [qualification report](docs/recovery/r24-qualification.md).

### Fixed
- **Interrupted work** — active/terminal run records, failed-call accounting and owned cleanup now agree across adapters. `/orchestrate` propagates cancellation into decomposition, issue requests and program gates.
- **Planner could assign stories to a persona that doesn't exist** — the JSON-extraction retry prompt listed `fullstack_developer`, which has no persona file. Replaced with the real persona list.
- **`editor` config setting had no effect** — `/edit` read only `$EDITOR`/`$VISUAL` and ignored the configured value. It now honors `editor` (`vim`/`nano`/`auto`), falling back to `$EDITOR`, `$VISUAL`, then `vi`.
- **`wm stats --cwd` returned nothing** — two separate bugs in the directory filter. The project-level match had an empty "it matches" branch that fell through to an unconditional `continue`, so a project was skipped even when its sessions matched; and paths were compared as raw strings, so a session recorded under a symlinked path (`/var` vs `/private/var` on macOS, or any symlinked project directory) never matched `process.cwd()`. Filtering is now per session rather than per project — one project directory can hold sessions from more than one working directory — and paths are resolved before comparison.
- **Documentation corrected against the code** — `/edit` was documented as `/editor`; `review.critic` and `review.criticThreshold` were documented but unimplemented (both now implemented); `tool_metadata` was listed as an agent-callable tool but is an internal registry; `/program` was referenced but does not exist; `review.verifyEnabled` was listed with the wrong default. Added missing documentation for the `patch` and `ticket` tools, the `wm model`, `wm models update`, and `wm runs` subcommands, `wm stats` flags, the `--strict` launch flag, the `/pause`, `/cancel`, `/orchestrate`, `/changed`, and `/projects` commands, and the `program` and `disableModelAutoUpdate` config fields.
- **`AGENTS.md` and `CONTRIBUTING.md` described a different project** — both referenced an `api/`/`frontend/` split, TypeORM migrations, ESLint, and files (`CLAUDE.md`, `PLATFORM.md`, `worker/AGENTS.md`, `bin/local-workermill`) that don't exist in this repo. Since `AGENTS.md` is loaded as live project context by every agent tool, this actively misled agents working here. Both rewritten to describe the actual CLI.
- **CodeQL findings** — hardened scheduled-task installation, HTML text extraction, exclusive persona creation, and filesystem tool file operations to reduce command-injection, HTML filtering, temporary-file, and TOCTOU risks.
- **CodeQL setup and security cleanup** — rely on GitHub's default CodeQL setup instead of a duplicate workflow, pinned third-party scanner actions to commit SHAs, replaced shell-built editor/git/curl execution with argument-based subprocess calls, moved editor temp files into `mkdtemp` directories, fixed grep wildcard stripping, and removed a no-op OpenAI model normalization.

## [1.1.0] - 2026-04-10

### Changed
- **Logs moved to `~/.workermill/logs/<project>/`** — human-readable project slugs with daily rotation (`YYYY-MM-DD.log`). One `logs/` directory, easy to find and grep.
- **Sandbox allowlists for workers** — package registries (pypi, npm), docker socket, localhost, and cache directories are now accessible inside the OS sandbox. Workers can install dependencies and run docker compose without permission errors.
- **Review loop receives gate failures** — quality gate failures now flow into the tech lead review instead of bailing out, so the reviewer can request fixes.
- **Reviewer requests all substantive fixes** — "if you mention it, request the fix" rule prevents the reviewer from labeling real issues as non-blocking and approving anyway. Pure cosmetic issues remain non-blocking.
- **Build report simplified** — removed redundant quality gates, review score, result count, cost, and run ID lines that the coordinator already reports inline. Footer is a compact one-liner with per-model cost breakdown.
- **Status bar tool labels shortened** — `bash_background` → `bash-bg`, `sub_agent` → `agent`, `multi_edit_file` → `multi-edit`, etc.
- **Status bar default model** — removed duplicate `default:` label; model only appears once in the header.
- **Sandbox setting simplified** — users set `true`/`false` only; OS sandbox upgrade is automatic internally.
- **Planner descriptions** — expanded example and added explicit instruction for detailed story descriptions to prevent truncation.
- **Ticket tool promoted** — agents now use the `ticket` tool instead of shelling out to `gh` CLI for issue operations.
- **Ticket key normalization** — Jira/Linear keys normalized to uppercase on input.
- **Docker port conflict guidance** — workers check if ports are in use before starting services.
- **Worker completion summaries** — all personas produce structured markdown summaries (what/files/verification) for ticket comments instead of raw action dumps.
- **Ticket examples updated** — generic `#123`/`GH-123` references replace hardcoded issue numbers.

### Added
- **Strict mode for `/build`** — `--strict` flag or `review.strict: true` config. All gate failures block (not just required ones), review approval required, out-of-scope file edits are blocking. For high-trust workflows.
- **Recovery mode** — CLI detects interrupted builds on startup and shows guided recovery: branch status, story progress, remaining work, options to `/retry`, `/undo`, or continue.
- **Memory provenance and auditability** — saved project memories now carry structured provenance (`source`, `confidence`, `runId`, `storyId`, `persona`) and `/memories` surfaces manual vs agent vs auto-extracted entries. `/remember` no longer creates duplicate sidecar files, and `/forget` also cleans up matching additional memory files.
- **Docs consistency tests** — 7 automated tests verify: persona count matches README, tool count matches README, documented CLI subcommands exist in code, config fields in docs match Zod schema, HELP_TEXT commands have case handlers.
- **`wm runs` commands** — inspect past `/build` runs: `wm runs list` (recent runs with outcome, cost, branch), `wm runs show <id>` (full details with stories, gates, reviews, tokens), `wm runs last` (most recent). All support `--json`.
- **`wm model` command** — set or show the default model without entering a session. `wm model ollama/qwen3-coder:30b` persists to config. `wm model` shows current default and routing.
- **`ticket` tool** — agents can fetch tickets, post comments, transition status, and list issues directly through GitHub Issues, Jira, or Linear. Uses configured `ticketSystem`. Added to all worker personas.
- **Provider capability registry** — centralized provider/model feature differences in `src/provider-capabilities.ts`. Queries capabilities instead of scattering `if (provider === "ollama")` conditionals.
- **Persistent `memory` tool** — agents now have a `memory` tool for file-based persistent memory across sessions. Works with every provider (Ollama, OpenAI, Google, xAI, etc.). Agents check memory at session start and save project patterns, corrections, and preferences as they work. Stored per-project under `~/.workermill/projects/<id>/memories/`.
- **Definition-of-done contracts** — planner emits `requiredFiles`, `requiredTests`, and `requiredCommands` per story. The orchestrator validates these after execution and blocks completion if artifacts are missing or commands fail. Machine-readable failure codes (`missing_required_file`, `missing_required_test`, `required_command_failed`, etc.) replace vague error messages.
- **QA participation control** — `qa.participation` now supports `"default"` (planner decides when QA is needed) or `"always"` (always add a dedicated QA story).
- **Per-story workspace rollback** — git snapshot taken before each story's revision loop. On retry, workspace is restored to pre-story state so each attempt starts clean instead of inheriting half-broken edits.
- **Story file ownership enforcement** — after story execution, touched files are compared against the story's declared scope (`targetFiles`, `requiredFiles`). Warns when >50% of edits are outside scope.
- **Run manifest** — every `/build` run persists a JSON manifest at `~/.workermill/projects/<id>/runs/<run-id>.json` with full run state: stories, outcomes, cost, tokens, branch. Foundation for `wm runs list` and `wm runs show`.
- **Post-build report** — `/build` now prints a structured report showing per-story status, quality gate results, review score and decision, branch, cost, and run ID.
- **Auto-persist learnings to memory tool** — extracted `::learning::` and `::remember::` markers during compaction are now also written to the file-based memory tool storage at `auto-learnings.md`.
- **Bracketed paste handling** — `usePaste()` from Ink 7 ensures pasted text arrives as a single string. Prevents the class of paste-scrambling bugs where individual characters were inserted at wrong cursor positions.
- **Deterministic aggregate E2E runner** — `npm run test:e2e` now runs each end-to-end test file sequentially through `scripts/run-e2e.mjs`, emits per-file progress and heartbeat logs, retries a failed file once, and always prints a final pass/fail summary.

### Changed
- **Ink upgraded to v7** — `useStdout()` replaced with `useWindowSize()` for reactive terminal dimensions across App, Input, and StatusBar. `usePaste()` added for bracketed paste. `key.delete` references removed (consolidated to `key.backspace`). Unused `ink-text-input` dependency removed.
- **Centralized state root** — all WorkerMill state paths now derive from `getStateRoot()` (`src/state-root.ts`). Set `WM_STATE_ROOT` to redirect all state into a temp directory for test isolation. 18 files updated.
- **Orchestrator decomposed into sub-modules** — `src/orchestrator.ts` reduced from 4,653 to 538 lines (88% reduction). Orchestration phases extracted into `src/orchestrator/` — planning, execution, review, gates, completion, types, and utils.
- **useAgent.ts decomposed** — utility functions and types extracted into `src/ui/agent/` (utils.ts, types.ts). Reduced from 1,900 to 1,560 lines.
- **Slash commands decomposed** — `src/ui/slash-commands.ts` reduced from 2,148 to 1,063 lines (50% reduction). Command handlers extracted into `src/ui/commands/` — settings, permissions, session, project.
- **OS sandbox auto-upgrade for /build** — `/build` automatically upgrades to OS-level sandbox (`@anthropic-ai/sandbox-runtime`) when the platform supports it. Falls back to path sandbox if dependencies are missing. Chat mode is unaffected.
- **MCP tools capped in orchestrator** — when MCP tools exceed 20 in `/build` workers, only the first 20 are kept. Prevents local models from being overwhelmed by Docker Desktop MCP gateway's 50+ tools.
- **Dependencies updated** — all in-range deps bumped (AI SDK, MCP SDK 1.29, vitest, react). 0 vulnerabilities.
- **Long-running E2E handling** — the aggregate E2E runner now gives each file a larger per-file timeout budget by default and kills timed-out child processes cleanly.
- **Ship workflow E2E scope** — `ship-workflow` coverage focused on ship/orchestration behavior.
- **Settings UX** — `/settings` output now has clearer spacing before the settings block and persona routing table, making the transcript easier to read.
- **Assistant response footer spacing** — turn receipts now render below a divider with a small gap, so the summary does not sit directly against the last paragraph of model output.

### Fixed
- **Rate limit retry in planner and reviewer** — planner retries up to 3 times on HTTP 429 with backoff. Reviewer retry loop now catches rate limits alongside timeouts and transient errors. Fixed `isRateLimitError` matching billing/quota errors (infinite retry bug).
- **Memory tool path traversal** — `executeMemoryCommand` now catches path traversal errors and returns error strings instead of throwing unhandled exceptions.
- **Standalone `/review` empty-output failures** — Tech Lead review now retries once when a provider returns empty or malformed review output.
- **Tool execution E2E flakiness** — tool execution end-to-end tests now assert stable tool outcomes and filesystem effects.
- **`wm runs show` prefix matching** — ambiguous run ID prefixes now fail explicitly instead of silently selecting the first match.

## [1.0.1] - 2026-04-08

### Added
- **`wm stats` command** — cross-session usage analytics showing total tokens (input/output), estimated cost, message count, and session count. Supports `--json` for machine-readable output. Usage data is persisted in session files and aggregated on demand.
- **`wm schema` command** — generates a JSON Schema for `~/.workermill/cli.json` from the runtime Zod definition. Supports `--out <file>` for writing to disk. Enables editor IntelliSense and CI config validation.
- **`wm session` CLI family** — manage sessions from the command line: `wm session list`, `wm session show <id>`, `wm session last`, `wm session rename <id> <name>`, `wm session delete <id>`. Session IDs accept prefix matching.
- **`wm run` headless execution** — run a single prompt non-interactively with full tool access and exit. Supports `--json` output and `--provider` override for scripting and CI.
- **`wm models update [source]`** — update the model catalog from a remote source or local file. Source-aware: detects and applies updates only when the catalog has changed.
- **Verification gates enabled by default** — `review.verifyEnabled` now defaults to `true`. The planner generates per-story verification commands that run before the tech lead review. Opt out with `review.verifyEnabled: false`.

### Changed
- **LSP diagnostics run before review, not after** — diagnostic results are now available to the reviewer as context, catching type errors and lint issues before the review score is assigned.
- **Persona routing consistency** — persona routing overrides and worker ticket labels now resolve correctly when using role-suffixed provider aliases.
- **Zod upgraded to v4** — schema generation uses Zod 4 API with compatibility shims. Added dependency downgrade protection to prevent accidental version regression.

### Fixed
- **Ollama not discovered in WSL** — model listing and model factory now detect the WSL gateway IP automatically, so Ollama running on the Windows host is reachable without an explicit `host` in config.
- **LSP directory diagnostics caused /review to hang** — directory scans processed files sequentially (5+ min) and returned 200KB of false-positive diagnostics from tsconfig-excluded test files. Now uses parallel batching (12s), respects tsconfig excludes, and tries workspace/diagnostic (LSP 3.17+) first.
- **Review failures not logged** — standalone `/review` and `/build` review catch blocks now log the actual provider error with stack trace, instead of silently returning 0 tokens.
- **CodeQL command injection alerts** — resolved security alerts flagged by GitHub CodeQL analysis.
- **3 Vite CVEs** — patched via override to vite 8.0.7.
- **GitHub CLI shell quoting** — avoided shell quoting issues in `gh` CLI calls.
- **Session list cap** — restored default session list cap that was accidentally removed.

## [0.16.0] - 2026-04-07

### Added
- **Project-scoped data registry + `/projects` command** — history, sessions, learnings, and logs now resolve through a shared project registry under `~/.workermill/projects/`, with migration from older global storage paths and a new `/projects` view for registered workspaces.
- **`download_file` tool** — agents can now fetch remote assets directly to disk with streamed writes, overwrite protection, SHA-256 reporting, HTTP status reporting, and workspace path bounds enforcement.
- **Inline edit preview toggle** — added `ui.inlineEditPreview` so the inline edited-file viewer used in chat and `/build` can be turned on or off from `/settings`.
- **`/program` full-spec orchestration + decomposition flow** — `/program #<parent>` can now decompose a parent issue into child cards, materialize child issues, and execute them in dependency order with persisted run-state for resume/recovery.
- **`/doctor` diagnosis workflow** — added repo/issue-scoped health diagnosis with structured prescriptions plus follow-up commands: `/doctor report`, `/doctor show`, and `/doctor apply`.
- **Multi-format project instructions ingestion** — instruction loading now supports additional sources and rule directories across common agent ecosystems (for example `AGENTS.md`, `.workermill/instructions.md`, `GEMINI.md`, `.cursor/rules/*`, `.windsurf/rules/*`).
- **Program epic prompt setting** — added `program.epicPrompt` (`ask` or `always`) with `/settings program.epicPrompt <ask|always>`. Epic boundary prompts support `y/n/a`, and choosing `a` persists globally.
- **PRD decomposition phase label lock** — added shared PRD decomposition phase labels plus a test lock to keep CLI wording aligned with the full platform decomposition phases.

### Changed
- **Native provider SDK coverage expanded** — xAI now uses the native `@ai-sdk/xai` provider and OpenRouter now uses `@openrouter/ai-sdk-provider` instead of generic OpenAI-compatible handling.
- **xAI setup model selection refreshed** — `/setup` now shows current xAI model choices from the provider registry and defaults xAI setup to newer Grok models instead of only `grok-3`.
- **Planner handoff strengthened** — planner output now carries richer implementation guidance such as primary patterns, integration points, assumptions, non-goals, and validation signals before work is handed to workers.
- **Worker verification is repo-aware** — build/review workers now prefer repo-native verification commands and avoid inventing generic `tsc` or LSP checks in repos that do not actually support them.
- **Settings surface simplified** — removed stale critic-facing settings, collapsed program controls into a clearer two-tier settings display, and filtered stale routing entries from `/settings show`.
- **`/doctor` UX polish** — diagnosis now reports clearer progress and formatted output so prescription selection and follow-up actions are easier to run.

### Fixed
- **Single-file CLI bundle output** — `dist` now builds as a single `index.js`, eliminating fragile hashed chunk import failures at the end of long-running `/build` runs.
- **Injected `(thinking)` terminal prefix removed from streamed reasoning** — when models expose reasoning text, the CLI no longer prepends `(thinking)` to the visible terminal transcript.
- **Reviewer hang handling** — `/build` and `/review` now apply bounded retry/timeout handling around Tech Lead review calls so stalled review passes fail cleanly instead of hanging indefinitely.
- **Worker prompt context-window enforcement** — orchestration now estimates worker prompt size before dispatch, trims lower-value sections first, and retries oversized prompts when providers report prompt-length violations.
- **Permission rule loading and persistence** — startup now loads merged local/project permission settings correctly, wildcard `bash(*)` style rules are honored, and “do not ask again” approvals persist for non-bash tools as well.
- **Setup provider key separation** — saved OpenAI-compatible provider keys are now isolated correctly, preventing xAI keys from being reused when configuring OpenAI.
- **Local model pseudo tool-call fallback** — local models that emit XML/tag-style pseudo tool calls now route through the normal tool execution path instead of stalling as plain text.
- **Provider alias resolution** — role-suffixed provider aliases such as `xai_tech_lead` now resolve to the correct base provider instead of failing as unsupported.
- **Startup banner cleanup** — removed experimental command hints from the welcome banner while leaving the commands themselves available where supported.
- **E2E config isolation** — end-to-end tests no longer write into the user’s real `~/.workermill` directory or leave behind test-generated provider settings.
- **GitHub workflow path drift** — the `npm audit` workflow now audits the actual repo layout instead of stale monorepo subdirectories.
- **Live view SSE reliability** — fixed SSE stream syntax/runtime issues, disabled Nagle buffering for SSE writes, and added polling fallback when streaming is unavailable.
- **`/ship` orchestration hardening** — improved session stability and failure handling in orchestration/live-view integration paths.
- **ESC cancel cost accounting** — preserved partial token accounting on aborted runs.
- **ESC abort crash regression** — fixed `ReferenceError: partialInputTokens is not defined` on cancel by keeping abort-cost counters in scope for the abort handler.
- **`gpt-5.4-pro` routing + model-factory alignment** — corrected provider routing/selection paths so model resolution remains consistent across CLI and engine.
- **Experimental feature gating** — `/doctor` and `/orchestrate` now consistently honor the `experimental` setting and provide explicit enablement guidance when disabled.

## [0.15.101] - 2026-04-05

### Fixed
- **Stale review-loop churn in `/ship` and `/review`** — review rounds now include a loop guard. When the reviewer repeats the same blockers across rounds, auto-revise pauses instead of burning more cycles. Reviewer instructions now require concrete blocking evidence and a minimal actionable fix when requesting revision.
- **Planner over-trusting stale tickets/issues** — planning guidance now explicitly tells the planner to verify whether the reported gap is already fixed in the current code before proposing duplicate production changes.
- **`/model` default persistence regression** — switching models now reliably persists the active default model/provider for future sessions, including coverage for local/project settings interactions.
- **Diverged branch push failure flow in `/ship`** — when `git push -u origin <branch>` is rejected as non-fast-forward, the CLI now detects divergence, explains why, and offers a safe `--force-with-lease` confirmation path instead of failing opaquely.
- **GitHub issue auto-close timing** — opening a PR from `/ship` no longer force-transitions GitHub tickets to done on PR creation. PRs still include close keywords so the issue closes at merge time in the normal GitHub flow.

## [0.15.100] - 2026-04-05

### Added
- **`wm models` command** — new CLI subcommand that lists all available AI models grouped by provider. Combines the static registry (Anthropic, OpenAI, Google, xAI, Groq, DeepSeek, Mistral, Ollama, LM Studio, OpenRouter, Bedrock, Azure) with live discovery of local providers. Flags: `--provider <name>` to restrict to one provider, `--available` to hide unreachable local providers, `--json` for scripting. The `/model` autocomplete inside a session also probes default Ollama (`localhost:11434`) and LM Studio (`localhost:1234`) ports so tab-completion works without explicit config.
- **Branch pre-flight check in `/ship`** — if the feature branch for a ticket already exists locally (e.g. from a previous aborted run), `/ship` now detects it before creating any files and prompts: **reset** (delete and start fresh from main) or **continue** (resume on the existing branch). Previously the branch was silently reused, which could sweep up uncommitted changes into the worker's first commit.
- **Phase 0 spec assessment in the planner** — the planner now reads the task description first and decides how much codebase analysis it actually needs before touching any tools. Well-specified tickets with explicit file paths and implementation constraints enter targeted mode (3–5 file reads). Vague tickets proceed with full codebase analysis. Eliminates the multi-million-token deep-read that well-specified tickets were triggering.

## [0.15.99] - 2026-04-04

### Fixed
- **Modified Enter key handling in supporting terminals (WezTerm/kitty/ghostty)** — the CLI now enables enhanced keyboard reporting for the session so `Shift+Enter` / `Alt+Enter` can be disambiguated when the terminal supports it, and disables it on exit.
- **Multiline compose reliability in flaky terminals** — improved fallback flow with `/multiline` mode plus explicit submit markers (`/submit` or `/send`) so users can always compose blank lines and submit reliably even when modifier keys collapse.

## [0.15.98] - 2026-04-04

### Fixed
- **Transcript spacing polish (chat + tool flow)** — tightened several rendering edge cases that caused inconsistent vertical rhythm:
  - always keeps one blank line between a user turn and the first assistant output line,
  - keeps `/ship`-style compact logs single-spaced after that first gap,
  - removes accidental wrapped-user artifacts like `word\n\n indented-continuation` in committed user messages.
- **Live tool-call line crowding** — added a dedicated blank spacer before the active tool-call row so tool activity does not appear visually attached to the preceding transcript line.
- **Permission prompt status-bar jump** — dismissing a tool permission prompt no longer causes the status bar to snap upward immediately. The prompt lane is temporarily reserved until the turn returns to idle, preventing layout jitter.
- **Retry/token waste in repeated failure loops** — orchestration retries now stop earlier when the same fixable/transient failure signature repeats, and oversized retry/review feedback is truncated before re-injection into prompts to reduce context bloat.
- **Pasted path scrambling in terminal input** — the CLI input box mixed functional `setValue(...)` updates with a stale `cursorPos` closure, so rapid pasted text could be inserted at the wrong position and appear garbled. Input editing now uses synchronized refs for value/cursor state so paste, typing, deletion, history restore, and completion acceptance all apply atomically.
- **Cost tracking accuracy** — normalized `openai/` model prefixes before pricing lookup so usage from OpenAI-compatible model names resolves to the correct price entry.
- **Bash dispatch latency** — reduced tool-call lag in interactive mode by fixing bash tool execution and preventing render-blocking tool dispatch paths.
- **System prompt / persona updates** — refreshed the CLI system prompt and fallback persona guidance to better match current behavior and available commands.
- **Setup / model filtering** — updated model selection behavior to keep older OpenAI families out of the current-model picker while preserving supported pricing and routing.
- **`/settings review.threshold` not taking effect** — changing the approval threshold via `/settings review.threshold <n>` saved to disk but the orchestrator still used the stale config snapshot from CLI startup, always falling back to the default of 8. `/ship` and `/review` now reload config fresh from disk on each run so settings changes take effect immediately without restarting.
- **Bash tool debug log below status bar** — the bash worker thread wrote `[bash-worker] received: ...` directly to `process.stderr`, bypassing Ink's terminal management and rendering text below the status bar. Removed the debug log.
- **API keys not passed to OpenAI-compatible providers** — xAI, Groq, DeepSeek, and Mistral all route through `createOpenAI()` which defaulted to `OPENAI_API_KEY`. Now reads provider-specific env vars (`XAI_API_KEY`, `GROQ_API_KEY`, etc.) and passes the key from config directly.
- **Cost tracking wrong after `/model` switch** — cost tracker read the startup provider/model instead of the active one, so switching mid-session tracked costs against the wrong pricing tier.
- **Sub-penny costs shown as `~$0.00`** — status bar now shows `<$0.01` for small amounts so you can tell costs are being tracked.
- **Git tool auto-allowed in acceptEdits mode** — git now prompts for permission in auto-edit mode instead of silently allowing.
- **4 typecheck errors** — fixed nullable guards in `/model` switch and orchestrator error handler, plus `toolChoice` type mismatch.

- **MCP tool schemas breaking Anthropic API** — Docker Desktop MCP gateway returns tools without `input_schema.type`, which Anthropic rejects with `tools.5.custom.input_schema.type: Field required`. Now forces `type: "object"` on all MCP tool schemas. MCP tools also removed from planner tool set (planner only needs codebase read tools).
- **Planner producing text instead of JSON** — when the planner outputs analysis text without a JSON stories block, a single cheap follow-up call now extracts the plan as JSON instead of failing outright.
- **o4-mini pricing was 7x too high** — had $4/$16 per M, corrected to $0.55/$2.20. Also fixed o3 (added caching support) and gemini-2.5-pro input ($1.25 → $1.00).
- **xAI reasoning not surfacing** — `reasoningSummary: "detailed"` was not being sent for xAI provider in either single-agent or orchestrator paths.

### Added
- **Multiline input** — `Shift+Enter` or `Alt+Enter` inserts a newline in the input box instead of submitting. Alt+Enter works in all terminals; Shift+Enter requires enhanced keyboard protocols (kitty, WezTerm, modern Windows Terminal). Up/Down arrows navigate within lines first, falling back to history at the top/bottom.
- **Planning critic loop** — ported from the platform (`api/src/services/critic-agent-local.ts`). After the planner produces stories, a critic pass scores the plan 1-10 on completeness, feasibility, dependencies, scope, and risk management. Plans scoring below threshold (default 8, configurable via `/settings review.criticThreshold`) are sent back for refinement, up to 3 iterations. Off by default; enable with `/settings review.critic true`.
- **Grok Code Fast model** — added `grok-code-fast-1` to xAI registry ($0.20/$1.50 per M, 256K context, purpose-built for agentic coding).

### Changed
- **Model registries updated to April 2026** — removed deprecated/ancient models from `/model` autocomplete. Updated: Anthropic (3 current models), Google (2.5 + 3.x only), xAI (Grok 4.x with 2M context + Grok Code Fast), DeepSeek (+V4), Mistral (Large 3, Small 3.1, Codestral, Devstral 2), Groq (+Qwen3), OpenRouter, Bedrock, Azure.
- **Prebuild cleanup** — `npm run build` now auto-deletes orphan `.js` files from `api/src/` and `packages/engine/src/` that shadow `.ts` sources during bundling.
- **Status bar context label** — removed the word "context" from the model display (e.g. `(2M)` instead of `(2M context)`).

## [0.15.97] - 2026-04-03

### Fixed
- **`/model` not persisting across sessions** — switching the worker model via `/model <provider>/<model>` updated the provider's model entry but never set `config.default` to the new provider. On restart, the CLI loaded the old default provider, ignoring the switch. Now persists both the model and the default provider to `~/.workermill/cli.json`.

---

## [0.15.96] - 2026-04-03

### Fixed
- **Bash tool hang** — tool calls would hang for 30+ seconds (or indefinitely) in interactive mode. Root cause: Ink's Legacy mode `flushSyncWork()` blocks the Node.js event loop on every `setState`, preventing async child process callbacks from firing. Bash tool now runs `spawnSync` in a worker thread with `SharedArrayBuffer` + `Atomics.wait` for synchronous cross-thread communication — executes in ~5ms with zero event loop dependency.
- **Tool dispatch blocked by render** — `onStepFinish` was calling `setStreamingText()` between AI SDK steps, triggering a synchronous Ink render that blocked tool execution for ~30 seconds when message history was accumulated. Now skips the render when the step contains tool calls.
- **Git branch display lag** — branch name in the status bar took up to 5 seconds to update after `git checkout`. Now refreshes immediately after every bash tool call via `onBashComplete` callback.
- **Ollama KV cache invalidation** — system prompt was rebuilt from disk on every turn, changing its content and invalidating Ollama's prompt cache. Now cached per session.

### Changed
- **Tool visual updates deferred** — `setState` calls for tool status ("pending", "running", "done") are batched after tool completion instead of before, preventing synchronous renders from blocking tool execution.

---

## [0.15.95] - 2026-04-02

### Added
- **LM Studio provider** — full native support for LM Studio as a local model provider. Setup wizard detects LM Studio at `localhost:1234` (or Windows host IP from WSL), lists available models, and saves config. `/model lmstudio/<model>` switches mid-session with autocomplete.
- **LM Studio context management** — when switching to an LM Studio model with a specified context size (e.g. `/model lmstudio/gemma4:26b 128k`), the CLI automatically unloads and reloads the model via LM Studio's `/api/v1/models/unload` + `/api/v1/models/load` endpoints to match the requested context. Reports actual `loaded_context_length` from LM Studio's `/api/v0/models` endpoint — no more silent mismatches.
- **Local model context hints** — switching to Ollama or LM Studio without specifying a context size now shows the active context window and a tip to set it explicitly (e.g. `/model ollama/qwen3-coder:30b 64k`). Defaults to 128k.
- **Issue tracker optional** — setup wizard now offers "Skip (no issue tracker)" as option 1. Users without GitHub/Jira/Linear can complete setup without configuring a ticket system.
- **LM Studio model autocomplete** — `/model` tab completion now fetches and lists LM Studio models live alongside Ollama models.

### Changed
- **Message spacing** — blank line added between all messages (user and assistant) for visual separation, matching Claude Code's layout.
- **System prompt** — model no longer refuses non-coding requests. Explicitly instructed to help with any task the user asks.
- **`/model` help text** — documents context window syntax for local models.
- **`/model` supported providers list** — added `lmstudio`.

### Fixed
- **Terminal text wrapping** — assistant messages now render at the correct terminal width by passing `stdout.columns` explicitly into the Markdown renderer at commit time. Responses no longer wrap too early on wide terminals.
- **LM Studio API key error** — LM Studio was being routed through the OpenAI provider without a dummy API key, causing `AI_LoadAPIKeyError` on every request. Now uses `createOpenAI({ apiKey: "lm-studio" })` with the correct `baseURL`.
- **`lmstudio` provider not recognized** — `getProviderForPersona()` was remapping `lmstudio` to `openai` (losing the host). Added to `knownProviders` set so it routes correctly through the dedicated `lmstudio` case in `createModel()`.
- **Local model context fallback** — `/model` switch logic only checked `ollama` provider when loading saved context length. Now checks both `ollama` and `lmstudio`.

---

## [0.15.94] - 2026-04-02

### Changed
- **LSP tool hardened** — crash recovery (auto-restarts on server exit), push diagnostics capture, file version tracking (`didChange` instead of re-opening), init failure recovery, dual symbol format support. No longer experimental.
- **LSP conditionally loaded** — tool schema only sent to the model when the project has language markers (`tsconfig.json`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`). Deferred otherwise — saves ~200 tokens/turn. Still loadable via `tool_search`.
- **Compaction overhauled** — thresholds lowered (micro: 50%, soft: 70%, hard: 90%). Three-tier micro-compaction: recent messages untouched, middle messages pattern-compressed, old messages aggressively compressed. Soft compaction summarizer sends 2000 chars per message (up from 500) and preserves file paths and decisions.
- **Planning critic marked experimental** — the critic pass (`review.useCritic`) is scaffolded but not yet functional. Settings show *(experimental)* label. Full implementation will port the platform's battle-tested Planner-Critic loop from `critic-agent-local.ts`.

### Fixed
- **Context windows corrected across all providers** — OpenAI GPT-5.x models were showing 128K instead of 400K–1.05M. Claude Opus 4.6 and Sonnet 4.6 compaction limits were 200K instead of 1M. All values verified against provider pricing pages. Removed deprecated models (<256K context) from OpenAI registry. Added missing models (o3, o3-mini, o3-pro, o4-mini, gpt-5-codex, gpt-5-pro, gpt-5.1, gpt-5.1-codex-mini). Unknown model fallback raised from 128K to 256K.
- **Context estimation accurate** — `shouldCompact()` now uses actual message content size instead of the Vercel AI SDK's inflated multi-step totals. Status bar token count matches.
- **Rate limit detection rewritten** — fresh `isRateLimitError()` in both orchestrator and agent loop.
- **Ticket detection** — `GH#1`, `GH #11`, `GH 11` all recognized. Project-level ticket config (`ticketSystem`, `jira`, `linear`) merges correctly from `.workermill/cli.json`.
- **Review threshold from config** — review prompts use configured `approvalThreshold` instead of hardcoded `8`.
- **Status bar flicker** — throttled to 2s intervals in orchestrator mode.
- **Regex backtracking safety** — tool output patterns replaced with bounded alternatives.
- **Session resume compacted** — `--resume` now runs micro-compaction on the loaded session before the first prompt, trimming stale tool output that would otherwise fill the context window.
- **Dead `MEMORY_INSTRUCTIONS` removed** — unused 190-token constant was defined in the orchestrator but never referenced.
- **`IGNORE_WORKERMILL` removed from orchestrator** — sandbox/directory confinement rules are a cloud worker concern, not CLI. Saves ~110 tokens per worker story.
- **`VERSION_TRUST` removed** — obsolete workaround for older models that downgraded dependency versions. Current models don't need this. Saves ~70 tokens per story.
- **`DOCKER_INSTRUCTIONS` conditional** — only injected when the story mentions databases, Docker, migrations, or services. Saves ~240 tokens on frontend/refactoring/docs stories.
- **npm audit** — regenerated `package-lock.json` for CI compatibility.
- **Documentation audit** — fixed `/retry` example, persona/tool counts, `/sessions` description, `/as` example, permission mode descriptions.

## [0.15.88] - 2026-03-31

### Added
- **LSP tool** *(experimental)* — code intelligence via language servers. Diagnostics, go-to-definition, find-references, hover, and symbols. Auto-detects TypeScript, Python, Go, Rust. Falls back to grep/bash when no language server is available.
- **Granular permission rules** — three-tier permission rules: `deny` > `ask` > `allow` with glob patterns. Example: `"allow": ["bash(npm run *)"]`, `"deny": ["bash(rm *)"]`, `"ask": ["bash(npm publish *)"]`. "Yes, don't ask again" saves permanent `bash(<command>)` rules to config (session-only for file edits). Compound commands (`&&`, `;`) split into separate rules.
- **Isolated sub-agents** — `sub_agent({ isolated: true })` runs in a git worktree with full write tools. Changes stay on a separate branch for the parent agent to review. Worktrees auto-cleaned on exit.
- **OS-level sandboxing** — `"sandbox": "os"` in config wraps bash commands in bubblewrap (`bwrap`) on Linux. Read-only system dirs, read-write working directory. Falls back to JS-level sandboxing if bwrap unavailable.
- **File-level checkpoints** — every write/edit is snapshotted before execution. `/undo` reverts the last edit, `/undo N` reverts last N, `/undo <file>` reverts a specific file, `/undo list` shows all checkpoints. Old git-based undo moved to `/undo git`.
- **Session fork** — `--resume --fork` continues from the last session with a new ID, leaving the original untouched.
- **Lifecycle hooks** — `hooks.on` config for events: `session_start`, `session_end`, `ship_start`, `ship_complete`, `review_complete`, `compact`. Supports `"type": "http"` for webhook POSTs.
- **Bell setting** — `/settings bell true` plays a beep when `/ship` finishes. Off by default.
- **`/setup` inline config** — shows current providers, roles, and routing with commands to change each part. No longer deletes the config. `/setup reset` for full wipe.

### Changed
- **Permission modes renamed** — `ask` → `default`, `auto-edit` → `acceptEdits`, `trust all` → `bypassPermissions`. `plan` added to shift+tab cycle. New `dontAsk` mode (CLI flag only) auto-denies everything not in allow rules.
- **Permission prompt simplified** — "Yes" / "Yes, don't ask again" / "Deny". Removed "Always allow this tool" and "Trust all tools" options. Trust-all is now a mode (shift+tab), not a prompt choice.
- **`/permissions` shows saved rules** — displays persistent allow/ask/deny rules from config alongside the current mode.
- **`/setup` no longer destructive** — shows current config and how to change it inline. Only `/setup reset` deletes the config file.
- **`/undo` default is file-level** — reverts individual file edits from checkpoints. `/undo git` for the old git stash/reset behavior.
- **`/compact [focus]` documented** — added to `/help` command list. Focus instructions were already supported but not discoverable.
- **`lsp` added to all personas** — available to all developer, architect, tech lead, and writer personas.

### Changed (cont.)
- **`/ship` stays on feature branch** — no longer auto-checkouts main after completion. Developer stays on the feature branch to review, test, and push.
- **`/help` expanded** — added `/as`, `/remember`, `/forget`, `/memories`, `/setup`, `/clear`, `/settings key`. Added keyboard shortcuts (arrow keys, Ctrl+A/E, Shift+Tab, Tab).
- **`/settings` display** — added API keys row with `/settings key` command.
- **Custom command shadow warning** — `/skills` warns when a custom command name conflicts with a built-in.

### Fixed
- **Trust-all permission bug** — selecting "trust all" in `/ship` mode only added 7 hardcoded tool names to the allow set. Tools like `verify`, `todo`, `lsp`, and MCP tools would prompt again. Now uses a `*` wildcard — one trust-all click covers everything.
- **Shift+tab mode applies mid-run** — changing permission mode during `/ship` or `/retry` now takes effect immediately. Previously the mode was captured at launch and never rechecked.
- **Unified permission prompt** — chat mode and `/ship` mode now use the same `PermissionPrompt` component. Previously two separate implementations with different options and behavior.
- **Status bar visible during prompts** — permission prompts no longer hide the status bar. ESC key denies in all prompt types.
- **`/permissions allow` and `deny` save permanently** — rules saved to `~/.workermill/cli.json`, not just the session. `/permissions allow bash` permanently allows all bash commands.
- **Setup preserves API keys** — re-running setup reuses saved keys from existing config instead of forcing re-entry.
- **Shorter permission prompt text** — tool display shows file path or command only, not verbose key dumps.
- **Setup stdin handoff** — `rl.close()` destroyed stdin, preventing Ink from setting raw mode after first-run setup. Fixed with `rl.close()` + `process.stdin.resume()`.
- **`/setup reset` routing** — `case "setup reset"` was a dead branch that never matched. Now handled as `arg === "reset"` inside the setup case.
- **Stale `/retry` state** — `getRetryableRun` now verifies the branch still exists. Deleted branches are auto-cleared instead of showing "incomplete run" notes forever.
- **`/log` crash** — replaced `require("crypto")` with ESM import (dynamic require not supported in ESM bundle).

## [0.15.87] - 2026-03-30

### Added
- **Live model switching** — `/model provider/model [context]` hot-swaps mid-session. No restart. Status bar, context window, and tok/s all update immediately.
- **Model autocomplete** — `/model ` shows all available models from all providers (cloud from pricing registry, Ollama from live API). Tab to accept.
- **Context window in status bar** — displays `[provider/model (256k context)]` like Claude Code. Resolved from pricing registry for cloud, config for Ollama.
- **Auto-compact on model switch** — switching to a smaller context model auto-compacts conversation if tokens exceed 80% of new limit.
- **`/model` command chaining** — `/model openai/gpt-5.4 /as backend_developer fix auth` switches model then dispatches the trailing command.
- **`/compact [focus]`** — runs compaction immediately with optional focus instructions (e.g. `/compact focus on API changes`). No longer defers to automatic.
- **`/settings key <provider> <api-key>`** — add API keys inline without leaving the session. Saved to config and active immediately.
- **API key validation on `/model` switch** — blocks switch if no key found, prompts user with `/settings key` command.
- **Cursor movement** — left/right arrows, Ctrl+Left/Right (word jump), Ctrl+A/E (home/end) in the input field.
- **OpenAI-compatible providers** — xAI, Groq, DeepSeek, Mistral work via `/model` with known base URLs.
- **Google model alias resolution** — `gemini-3.1-pro` auto-resolves to `gemini-3.1-pro-preview` at the API level.

### Changed
- **Removed `/plan` command** — redundant with status bar permissions. Removed from help text, autocomplete, and tests.
- **`/init` re-run prompt** — stability-first. Validates existing WORKERMILL.md, lists concrete issues, asks before writing. No longer auto-edits.
- **Splash screen simplified** — removed role model display, context line, persona count. Shows a random tip and `/help` pointer.
- **Browser tools use Zod** — converted from raw JSON schema `parameters` to Zod `inputSchema` for cross-provider compatibility (fixes OpenAI Responses API crash).
- **Review model color** — lilac (`#C586C0` label, `#A066A0` model) instead of raw magenta. Easier on the eyes.
- **Permission escalation consistent** — "Always allow this tool" now escalates status bar to `auto-edit`. Previously only "Trust all" updated the display.
- **Completed tool calls hidden** — no longer shows vertical list of completed tools after each turn. Status bar tracks counts, in-progress indicator still shows.
- **`/model` doesn't change planner/reviewer** — only switches the active worker model. Use `/setup` to change role assignments.
- **Welcome message** — removed "12" from "AI experts ready to work" to avoid going stale.

### Changed (cont.)
- **Session summary** — exit summary shows git diffstat (files, +insertions, -deletions) instead of meaningless message count.
- **`/compact` reports tokens** — shows before/after token count instead of message count. Status bar percentage updates after compaction.
- **Orchestrator permission prompt** — removed spurious `[🤖 system] Tool: write_file` line. Permission details now inline in the confirm prompt.

### Fixed
- **Anthropic context windows** — Opus 4.6 and Sonnet 4.6 correctly show 1M context (was 200k).
- **OpenAI pricing** — gpt-5.4 (1M/$2.50/$15), gpt-5.4-mini (400k/$0.75/$4.50), gpt-5.4-pro (1.05M/$30/$180), gpt-5.4-nano (400k/$0.20/$1.25). All verified from openai.com/api/pricing.
- **Google pricing** — gemini-3.1-pro-preview ($2/$12), gemini-3-flash-preview ($0.50/$3), gemini-2.5-pro ($1.25/$10). All verified from ai.google.dev/pricing.
- **Google model names** — use actual API names (`gemini-3.1-pro-preview`, not `gemini-3.1-pro`).
- **Context display math** — power-of-2 values (Ollama) use 1024 divisor, cloud values use 1000.
- **Stale tsc build artifacts** — vitest was resolving `.js` files over `.ts` sources. Cleaned `cli/src/` and `packages/engine/src/`.
- **Status bar not updating on `/model` switch** — provider, model, and context now use reactive state.
- **Tok/s tracking after `/model` switch** — was keyed to startup model, now uses active model refs.
- **Ollama context switching** — `ensureOllamaContext` now unloads model when context doesn't match (was only unloading when too small, not when switching down).
- **`buildOllamaOptions` uses active context** — was passing startup context length instead of the value set by `/model`.
- **`/compact` on high-token short conversations** — now summarizes even with few messages when token count is high (e.g. 192k tokens in 2 messages from tool calls).

## [0.15.85] - 2026-03-30

### Added
- **MCP tools in orchestrator and headless mode** — MCP servers now start and stop with `/ship` orchestration and headless (`-p`) mode, not just interactive single-agent mode. All MCP tools available to planner and story workers.
- **MCP-aware system prompts** — when MCP servers are active, the system prompt tells the model which servers are connected and that `mcp__*` prefixed tools are real and working. Applied to interactive and headless modes.
- **Docker Desktop MCP gateway auto-detection** — the CLI automatically discovers Docker Desktop's MCP gateway when available (WSL and native). No manual config needed — if Docker Desktop has MCP servers enabled, they're connected automatically across all three modes.
- **External tool instructions** — agents now receive `EXTERNAL_TOOLS` guidance in story system prompts covering `gh` CLI, `web_search`, `fetch`, `curl`, and package managers.

## [0.15.81] - 2026-03-28

### Added
- **Sandbox setting** — `/settings sandbox true/false` to toggle file directory restriction. On by default. CLI flag `--full-disk` also overrides. Persists to `cli.json`.
- **Branch-aware `/diff`** — on a feature branch, `/diff` shows committed changes vs main instead of empty uncommitted diff.
- **Status bar branch updates** — branch name updates immediately when `/ship` creates a feature branch (was stale until next prompt).
- **Cost logging** — every `addUsage` call now logs persona, provider, model, token counts, cost, and running total to CLI logs. Review rounds also log input/output token counts.
- **Review horizontal rules** — reviewer output framed with `────` lines above and below the decision/score for visual separation.
- **Unit tests** — added tests for safety, config, memory, session, git-ops, permissions, commands, cost-tracker, and orchestrator.
- **E2E tests** — Ollama integration tests for tool calling and streaming.

### Changed
- **Status bar layout** — all rows left-aligned with `│` separators (matches Claude Code). Previously project info and plan/review were right-aligned.
- **Status bar colors** — plan (cyan) and review (magenta) colors now match terminal output exactly. Uses Ink named colors instead of hex approximations.
- **Tool counts row dimmed** — gray text creates visual separation without extra line spacing.
- **Worker model color** — orange in terminal output (ANSI 256-color `208`) to match status bar brand color. Was yellow.
- **Completion summary** — shows branch + commit count only. Removed verbose diffstat file list.
- **Banner** — "AI coding team" instead of "AI coding agent".
- **README** — new value prop sections ("The Problem Isn't the Model" / "What WorkerMill Does Differently"), trimmed repetition, split badges into two rows, added npm weekly downloads badge.
- **Demo video** replaced with new CLI walkthrough.

### Fixed
- **Score threshold as hard gate** — reviewer's `REVIEW_DECISION` marker alone doesn't approve; score must meet threshold (default 8).
- **Reviewer re-blocks on real issues** — functional bugs across revision rounds properly trigger `needs_revision` even if the model marker says approved.
- **`review.critic` setting** — was not persisting to config or being read by orchestrator.
- **Project config** — orchestrator now reads per-project `.workermill/config.json` overrides.

## [0.15.8] - 2026-03-26

### Added
- `/as <persona> <task>` command — run a single task with a specific expert persona (e.g. `/as security_engineer review the auth middleware`).
- Splash screen shows expert count and discovery: `12 experts available (/build auto-assigns, /as to pick one, /personas to list)`.
- Orchestrator tool calls now tracked in the status bar during `/build` and `/retry`.
- `build.sh` script — verified builds with `--bump patch|minor|major`. Checks version sync, browser tools, tool definitions, synchronized output, and status bar presence.
- Synchronized terminal output (DEC mode 2026) — wraps Ink renders in begin/end synchronized update sequences for atomic frame rendering. Eliminates tearing during rapid redraws.

### Changed
- **Workers receive the full original spec** as `## Ticket Requirements — THIS IS YOUR SPEC`, matching the WorkerMill platform pattern from `prompt-builder.ts`. Workers no longer rely on the planner's interpretation.
- **Planner creates scope labels, not rewritten specs.** Story descriptions are file scope identifiers — workers read the full spec themselves.
- **Three-tier review system** matching the WorkerMill platform: `REVIEW_DECISION: approved | revision_needed | rejected`. Score (1-10) is informational with a guide (7+ = approve). Replaces the harsh 0-100 numeric threshold.
- **Review bias toward approval** — cosmetic issues don't block, only functional/security bugs trigger revision. Copied criteria directly from `worker/epic/inline-reviewer.ts`.
- **Revision prompt includes per-story feedback** — workers get their specific `AFFECTED_REASONS` instead of the full review dump for all stories.
- Splash screen simplified: `/build orchestrates experts  /help for all commands`.
- `workers:` label (plural) in splash screen.
- Plan/review model labels moved to status bar row 3 (with permission mode) — row 2 is tools only.
- Status bar timer shows minutes only (`<1m`, `1m`, `2m`) to reduce unnecessary re-renders.
- Natural greeting — agent doesn't introduce itself as WorkerMill unless asked.

### Fixed
- **Restored browser tools** — their presence in the tool set is required for Ollama tool calling. Removing them broke ALL tool serialization (model output XML instead of structured calls). Documented in CLAUDE.md as load-bearing.
- Compaction summary emitted as `user` + `assistant` pair instead of bare `assistant` — prevents API 400 error on next prompt.
- Trust-all from permission prompt updates `trustAllRef` immediately — subsequent tool calls in the same turn no longer re-prompt.
- `rm -f <file>` no longer triggers dangerous-command warning — only `-r`/`--recursive`/`--force` flagged.
- Input history shows most recent entry first on Up arrow.
- CDP timer leak — `clearTimeout` on successful browser commands.
- Status bar mode icons use single-width Unicode (▸ ◆ ◈) instead of emojis that caused line wrapping on Windows Terminal.
- Long plan/review model names truncated at 25 chars to prevent row overflow.
- Removed artificial 100K character limit on review content — no truncation.
- `patchConsole: false` removed (was interfering with Ink rendering).

### Removed
- `approvalThreshold` config setting — review approval now driven by `REVIEW_DECISION` marker, not a numeric score gate.

## [0.13.3] - 2026-03-26

### Fixed
- Auto-update no longer attempts `npm install -g` which fails without sudo. Shows `npx workermill@X.Y.Z` instead.
- Browser tools removed from agent tool set — raw JSON schemas broke ALL tool definitions, causing models to fake tool calls in text output.
- Update check cache stale after user upgrades — now re-fetches from npm when cached version is older than current.
- Removed all content truncation from user-facing output (file contents, diffs, changelogs, persona prompts).
- 68 silent `catch {}` blocks replaced with proper error logging.
- Git branch detection works on repos with no commits (symbolic-ref fallback).
- `/personas show` displays full prompt without truncation.
- Status bar rows 2 and 3 no longer render giant black background blocks.

### Added
- Three-row status bar: model/context/project, tool usage stats, permission mode with shift+tab hint.
- `/chrome` command to open/close headless Chrome browser.
- `/schedule` command — create recurring tasks with cron schedules.
- Headless mode (`-p` flag) — run single prompt without TUI, streams to stdout.
- `/voice` listens until silence (no arbitrary time limit).
- Auto-revise option: press (a)lways at revision prompt, `--auto-revise` flag, or `/settings review.autoRevise true`.
- Distinct permission mode icons: ▶ ask, ✏️ auto-edit, ⚡ trust all.
- Agent identity includes "created by Jarod Rosenthal" (answers if asked).
- Dynamic model selection for OpenAI and Google — fetches available models from API after key entry.
- 7 additional providers via OpenAI-compatible API (Groq, DeepSeek, Mistral, OpenRouter, Together, xAI, Fireworks).
- Ollama model list deduplicated by base name, sorted by coding relevance.
- Google model list filtered to coding-capable Gemini models only.
- Build output accumulates in dynamic area during build, commits to Static on completion.
- `/init` uses the AI agent to explore codebase and generate WORKERMILL.md (not static scanning).
- `/init` on existing file reviews and suggests improvements instead of overwriting.

### Changed
- `WORKERMILL.md` in repo root is now the primary instructions file (was `.workermill/instructions.md`).
- `/clear` actually resets the session (was showing "not supported").
- Update check interval reduced from 24h to 4h.

## [0.10.6] - 2026-03-25

### Added
- `/voice` command — speak instead of type. Uses platform-native speech recognition (Mac: `hear`, Windows: PowerShell, Linux: whisper). Listens until silence, no arbitrary time limit.
- `/update` command — pulls latest version via `npm install -g workermill@latest`
- `/skills`, `/personas`, `/mcp` commands — manage custom commands, personas, and MCP servers
- `/release-notes` command — shows changelog
- Built-in browser automation via Chrome DevTools Protocol — `browser_open`, `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_evaluate`, `browser_console`, `browser_close`

### Fixed
- Dangerous command detection too aggressive — `rm -rf prisma` (relative path) no longer triggers. Only flags root/home paths.
- Reviewer confirm shows `(y/n)` not `(y)es (a)lways (t)rust all (n)o` for revision/plan/commit prompts
- Reviewer gets actual code via `git ls-files` fallback when `::file_created::` markers missing
- Story parser normalizes field names (`index`→`id`, `steps`→`stories`, `depends_on`→`dependsOn`)
- Unique story IDs enforced before topological sort
- Planner output streams line-by-line in real time

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
