# Command Reference

Every slash command, every subcommand, every flag. This is the lookup table — use `/help` for a shorter summary inside the CLI.

Commands chain: `/model anthropic/claude-opus-4-6 /as security_engineer audit auth` switches the model and immediately runs the persona task.

---

## Build

### `/build [task]` (aliases: `/ship`)

Full multi-expert orchestration: planner → workers → tech lead review → commit.

```
/build add dark mode to settings
/build ./specs/auth-redesign.md
/build GH-42
/build #42
/build PROJ-123
/build TEAM-42
```

Accepts inline text, a `.md` file path, or a ticket reference. Ticket references are resolved via the configured `ticketSystem` (GitHub Issues by default, Jira or Linear if configured).

**Behavior:**
- Plans on the current branch — nothing is committed during planning
- Asks for confirmation before creating a feature branch and running workers
- Stays on the feature branch when done so you can review, test, and push manually
- On failure, state is saved to disk — use `/retry` to resume

**The planner critic** (off by default) runs before workers start. Enable with `/settings review.critic true`. It scores the plan 1-10 and refines it up to 3 times before execution.

### `/as <persona> <task>`

Run a single expert with their system prompt, full tool access, and no planning or review loop.

```
/as backend_developer add pagination to /api/tasks
/as security_engineer audit the auth middleware
/as frontend_developer redesign the settings page with tabs
/as qa_engineer write integration tests for checkout
```

Personas are loaded from (in order of precedence): `.workermill/personas/` (project), `~/.workermill/personas/` (user), built-in `cli/personas/` (bundled).

Run `/personas` to see the active set.

### `/retry`

Resume the last incomplete `/build` run in the current repo.

Loads the existing plan from disk, skips planning, and picks up from the first story that didn't complete. Workers see their prior commits via `git log`, so no wasted tokens replanning work that's already done.

State is stored per repo in `~/.workermill/ship-state/`.

### `/review <target>`

Standalone tech lead review. No code is written — just analyzed and scored.

| Target | What it reviews |
|---|---|
| `/review branch` | Full diff of the current branch vs `main` |
| `/review diff` | Uncommitted changes only |
| `/review #42` | GitHub PR by number |

On a failing review, offers to create a GitHub issue from the findings and immediately kick off `/build` to fix them.

---

## Session

### `/model [role] <provider/model> [context]`

Hot-swap the active model mid-session. Autocomplete suggests models from the curated registry.

```
/model ollama/qwen3-coder:30b
/model anthropic/claude-sonnet-4-6
/model openai/gpt-5.4 256k
/model google/gemini-3.1-pro
/model xai/grok-code-fast-1

/model planner anthropic/claude-opus-4-6
/model reviewer openai/gpt-5.4
```

**Arguments:**

- **`role`** (optional) — `planner` or `reviewer` (aka `tech_lead`). Omit to change the worker model.
- **`provider/model`** — full provider/model string. The provider must exist in `providers` (add one with `/settings key <provider> <key>`).
- **`context`** (optional) — context window size: `64k`, `128k`, `256k`, `1m`, etc. For Ollama, this sets `num_ctx`.

**Persistence:** `/model` saves the change to `~/.workermill/cli.json` (both the model and the default provider), so the switch persists across sessions.

**Auto-compact:** if the new model has a smaller context window than the current conversation, compaction runs automatically before the next turn.

### `/compact [focus]`

Compress conversation history to free up context. Runs an LLM summarization pass on older messages while preserving recent ones.

```
/compact
/compact auth work in progress
```

With a focus string, the summarizer preserves messages related to that topic. Before compacting, the CLI scans for `::learning::` and `::remember::` markers and saves them as persistent memories.

**Micro-compaction** (free, no LLM call) runs automatically at ~60% context usage. Manual `/compact` is only needed if you want to force it earlier.

### `/clear`

Reset conversation history completely. Does not affect persistent memories (`/memories`).

### `/cost`

Show a per-role, per-provider breakdown of the current session's token usage and estimated cost.

### `/status`

One-line summary: current model, context used, cost, permission mode, message count, working directory.

### `/sessions`

List recent saved sessions with their IDs, names, message counts, and dates.

Sessions persist automatically after each turn. Resume the last one by launching with `wm --resume`.

### `/editor`

Open `$EDITOR` for multi-line input. The editor's contents are submitted when you save and quit. For quick multi-line input without leaving the terminal, use `Shift+Enter` or `Alt+Enter` instead.

### `/git`

Show `git status` and the current branch. Convenience command — equivalent to `!git status && git branch --show-current`.

### `/diff`

Show uncommitted changes in the working directory with syntax highlighting.

---

## Project

### `/init`

Analyze the codebase and generate an `AGENT.md` project instructions file. The agent reads this (or other supported instruction files) on every turn as part of its system prompt.

`AGENT.md` is WorkerMill's default, but the CLI also recognizes common formats like `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `.windsurfrules`, `.windsurf/rules/*`, `.clinerules`, and `.github/copilot-instructions.md`.

### `/remember <text>`

Save a persistent memory for the current project.

```
/remember This project uses Prisma, not Sequelize
/remember Always run migrations before running tests
/remember The staging API is at https://staging.example.com
```

Memories are stored in `~/.workermill/memories/<project-id>.json` and loaded into every session for that repo.

### `/forget <id or text>`

Remove a saved memory. Accepts either the memory ID (shown in `/memories`) or a substring match of the content.

### `/memories` (alias: `/memory`)

List all persistent memories for the current project.

Memories are also auto-extracted when the agent writes `::learning:: ...` or `::remember:: ...` markers in its output.

### `/personas`

List installed personas. Shows name, slug, source (project / user / built-in), and description.

Personas are loaded from (in precedence order):

1. `.workermill/personas/*.md` — project overrides
2. `~/.workermill/personas/*.md` — user-level overrides
3. `cli/personas/*.md` — bundled with the CLI

See the [Personas guide](personas.md) for the file format, tool restrictions, and how to write custom ones.

### `/skills`

List custom commands and skills loaded from:

1. `.workermill/commands/*.md` — project commands
2. `~/.workermill/commands/*.md` — user commands
3. `.workermill/skills/*.md` — project skills
4. `~/.workermill/skills/*.md` — user skills

Each file creates a new slash command. See the [Hooks & Custom Commands guide](hooks-and-skills.md) for the format.

---

## Safety

### `/permissions [action] [target]`

View or modify the permission rules that gate tool calls.

```
/permissions                          # Show current mode and saved rules
/permissions allow bash(git *)        # Add an allow rule
/permissions deny bash(rm -rf *)      # Add a deny rule
/permissions reset                    # Reset to default mode
/permissions trust                    # Shortcut for bypassPermissions mode
/permissions bypass                   # Same as trust
/permissions ask                      # Force prompt mode
/permissions default                  # Return to default mode
```

**Modes** cycle with `Shift+Tab`: `default` → `acceptEdits` → `plan` → `bypassPermissions`.

**Rule patterns:** `tool_name(argument_pattern)` where `*` is a wildcard. Deny rules always win over allow rules. See the [Configuration reference](configuration.md#permissions) for full syntax.

### `/trust`

Toggle full trust mode (`bypassPermissions`). Same as `/permissions trust` or cycling with `Shift+Tab`.

### `/undo [target]`

Revert file changes using per-file checkpoints taken before each edit.

```
/undo                     # Undo the last file edit
/undo 3                   # Undo the last 3 edits
/undo src/auth.ts         # Revert a specific file to its pre-edit state
/undo list                # Show all available checkpoints
/undo git                 # Git-level undo: stash uncommitted changes, or reset last commit
```

Checkpoints are stored per session. Clear them with `/clear` (resets conversation and checkpoints).

---

## Config

### `/settings [key] [value]`

View all settings or update a single key. Saves to `~/.workermill/cli.json`.

See the [Configuration reference](configuration.md) for every key and its behavior. Quick summary:

```
/settings                                    # Show all
/settings ollama.host <url>
/settings ollama.context <tokens>
/settings review.enabled <true|false>
/settings review.maxRevisions <n>
/settings review.threshold <n>
/settings review.critic <true|false>
/settings review.criticThreshold <n>
/settings review.autoRevise <true|false>
/settings sandbox <true|false|os>
/settings bell <true|false>
/settings tickets <github|jira|linear>
/settings jira.url <url>
/settings jira.email <email>
/settings jira.token <token>
/settings linear.key <key>
/settings route <persona> <provider>
/settings key <provider> <api-key>
```

### `/setup`

Re-run the first-run provider setup wizard. Useful if you want to add a new provider interactively or reconfigure routing.

### `/hooks`

Show currently configured pre/post tool hooks. Hooks are configured by editing `~/.workermill/cli.json` directly — there's no `/settings` for them. See the [Hooks guide](hooks-and-skills.md).

### `/mcp`

Show MCP (Model Context Protocol) server status and the tools each server exposes. Configure MCP servers in the `mcp` section of `~/.workermill/cli.json`. Docker Desktop's MCP gateway is auto-detected.

---

## Meta

| Command | Aliases | What it does |
|---|---|---|
| `/help` | `/h`, `/?` | List all commands |
| `/quit` | `/exit`, `/q` | Exit the CLI |
| `/log` | | Show recent log entries from `~/.workermill/logs/` |
| `/update` | | Check for a newer CLI version on npm |
| `/release-notes` | `/changelog` | Show the CHANGELOG for the current version |

---

## Experimental

These work but the UX is rough — expect sharp edges.

| Command | Aliases | What it does |
|---|---|---|
| `/voice` | | Voice input — speak your task (requires system audio tooling) |
| `/chrome` | `/browser` | Headless Chrome browser automation |
| `/schedule` | | Scheduled recurring tasks via cron |

---

## Input Shortcuts

### Prefixes

- **`!command`** — run a shell command directly without invoking the agent. `!git status`, `!npm test`, `!ls -la`.
- **`@path`** — inline reference. Resolved to content and prepended to your message:
  - `@src/auth.ts` — inline the file
  - `@src/` — inline the directory tree
  - `@https://example.com/api` — fetch the URL's content
  - `@screenshot.png` — send to vision-enabled models

### Keys

| Key | Action |
|---|---|
| `Enter` | Submit |
| `Shift+Enter` / `Alt+Enter` | Insert a newline (multiline input) |
| `↑` / `↓` | Navigate history (and move within lines in multiline input) |
| `Tab` | Accept the highlighted autocomplete |
| `ESC` | Cancel current operation |
| `ESC ESC` | Roll back the last exchange |
| `Shift+Tab` | Cycle permission modes |
| `Ctrl+C Ctrl+C` | Exit |

### Autocomplete

- Start with `/` — command autocomplete
- `/build ` — `.md` file autocomplete from the working directory
- `/model ` — provider/model autocomplete from the curated registry plus live Ollama / LM Studio models

---

## CLI Subcommands

These run outside the interactive session — from a normal terminal prompt.

### `wm run [prompt...]`

Headless (non-interactive) prompt execution. Runs a single prompt through the agent and exits.

```bash
wm run "list all TODO comments in the codebase"
wm run -p anthropic/claude-sonnet-4-6 "explain src/auth.ts"
wm run --json "what framework does this project use"
```

**Flags:**

| Flag | Description |
|---|---|
| `-p, --provider <provider/model>` | Override provider and model |
| `--json` | Emit structured JSON output instead of plain text |

Useful for scripting, CI pipelines, and automation. The agent has full tool access (subject to permissions) but no interactive prompts.

### `wm models [filter]`

List all available AI models across every configured provider. Combines the static model registry with live discovery of local providers (Ollama, LM Studio).

```bash
wm models                          # All models, grouped by provider
wm models sonnet                   # Filter by substring
wm models --provider anthropic     # Single provider
wm models --available              # Only reachable models (skips unreachable local providers)
wm models --json                   # Machine-readable JSON array
```

**Flags:**

| Flag | Description |
|---|---|
| `--provider <name>` | Restrict output to one provider |
| `--available` | Hide unreachable local providers |
| `--json` | Emit a JSON array instead of text |

**Model sources:**

- **Cloud models** — baked into the CLI from the provider registry (Anthropic, OpenAI, Google, xAI, Groq, DeepSeek, Mistral, etc.)
- **Local models** — discovered at runtime by querying configured Ollama and LM Studio hosts

**How it relates to `/model` autocomplete:** `wm models` probes only explicitly configured hosts (safe for scripting). The `/model` input autocomplete inside a session also probes the default Ollama (`localhost:11434`) and LM Studio (`localhost:1234`) ports even when they're not in config, so tab-completion works out of the box for users running local models without explicit configuration.

### `wm logs`

Stream or tail the CLI log file for the current project.

```bash
wm logs                        # Tail last 50 entries
wm logs --tail 100             # Tail last N entries
wm logs --follow               # Stream new entries as they arrive (like tail -f)
wm logs --level debug          # Filter by level
wm logs --json                 # One parsed JSON object per line (for jq, etc.)
wm logs --cwd /path/to/repo    # Read log for a specific project directory
```

**Note:** `/log` inside a session shows a quick tail of recent entries. `wm logs --follow` from a separate terminal gives a live stream while a session is running.

### `wm session <subcommand>`

Manage saved sessions from the command line.

```bash
wm session list                    # List all saved sessions
wm session show <id>               # Show a specific session's details
wm session last                    # Show the most recent session
wm session rename <id> <name>      # Rename a session
wm session delete <id>             # Delete a session
```

Session IDs accept prefix matching — `wm session show abc` matches a session starting with `abc`.

### `wm stats`

Show cross-session usage analytics: total tokens, estimated cost, messages, and sessions — aggregated from all saved session data.

```bash
wm stats                           # Human-readable summary
wm stats --json                    # Machine-readable JSON output
```

Token counts are broken down by input and output. Cost estimates use the pricing data from each session's provider.

### `wm schema`

Generate a JSON Schema for `~/.workermill/cli.json` based on the runtime Zod schema definition. See the [Configuration reference](configuration.md#generating-configuration-schema) for full usage and editor integration.

```bash
wm schema                          # Print schema to stdout
wm schema --out .workermill.schema.json  # Write to file
```

### `wm doctor`

Health check: Node version, git, config file validity, API key status, Ollama connectivity, project instructions, and saved learnings.

---

## CLI Launch Flags

Flags passed when starting the CLI from the shell.

```bash
wm                          # Interactive chat (default)
wm --resume                 # Resume the most recent session
wm --fork                   # Fork the resumed session (use with --resume)
wm --plan                   # Start in plan mode (read-only tools)
wm --provider <id>          # Override default provider for this session
wm --model <name>           # Override the active model for this session
wm --trust                  # Skip all tool permission prompts
wm --auto-revise            # Auto-revise after a failed review without prompting
wm --full-disk              # Allow tools to access files outside working directory
wm --max-tokens <n>         # Maximum output tokens per response
wm --live-view              # Enable live browser diff view
wm --no-live-view           # Disable live browser diff view
wm -p <prompt>              # Run a single prompt headlessly and exit
wm --version                # Print CLI version
wm --help                   # Show launch flags
```

`--provider`, `--model`, `--trust`, `--auto-revise`, `--full-disk`, `--max-tokens`, and `--live-view` apply only for the current launch and are not written to config.
