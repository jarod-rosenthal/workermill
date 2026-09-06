# Architecture

A technical overview of how WorkerMill CLI works.

## Stack

- **Language:** TypeScript, ESM
- **Terminal UI:** React + [Ink](https://github.com/vadimdemedes/ink)
- **AI:** [Vercel AI SDK](https://sdk.vercel.ai) v6 — provider-agnostic streaming and tool calling
- **CLI framework:** Commander.js
- **Test runner:** Vitest

The CLI talks directly to each provider — no WorkerMill server, no account, no cloud proxy. Your API keys stay in `~/.workermill/cli.json` or environment variables.

## Two Execution Modes

### Single-agent chat (`useAgent.ts`)

Default mode. You type, one model responds, tools run, response streams. Used for conversation, one-off fixes, exploration, and the `/as` command (single expert).

Flow:
```
user input → AI SDK streamText → tool calls → permission check → tool execution → response stream → UI render
```

### Multi-expert orchestration (`useOrchestrator.ts` + `orchestrator.ts`)

Triggered by `/build`. A team of specialized models works together.

Flow:
```
ticket/spec → [spec check] → planner → [plan critic] → specialist workers
  → definition-of-done check → quality gates → tech lead reviewer → commit
```

Bracketed stages are off by default (`review.specCheck`, `review.critic`).

- **Planner** reads the codebase and decomposes the task into scoped stories with specific files, acceptance criteria, and definition-of-done contracts (`requiredFiles`, `requiredTests`, `requiredCommands`)
- **Plan critic** (optional) scores the plan 1-10 on completeness, feasibility, dependencies, scope, and risk before any worker starts, refining it until it passes or 3 rounds are spent. Catching a bad plan here is far cheaper than catching it at review.
- **Workers** execute stories one at a time using their persona's system prompt
- **Definition-of-done** — after each story, the orchestrator validates that required files and tests exist and required commands pass. Missing artifacts block completion with machine-readable failure codes
- **Quality gates** — static gates from config plus planner-generated verification commands run before review
- **Reviewer** reads the diffs against the original spec and scores the code; a failing score sends work back for revision

#### Orchestrator module structure

The orchestrator is decomposed into focused modules under `src/orchestrator/`:

| Module | Responsibility |
|--------|---------------|
| `types.ts` | Interfaces: Story, OrchestrationOutput, OrchestrationResult, etc. |
| `utils.ts` | Error classification, rate limiting, prompt helpers, abort signals |
| `planning.ts` | Spec check, planner prompt, plan critic, story parsing/normalization, QA participation, topological sort |
| `execution.ts` | Story execution loop, tool setup, contract validation, retry/revision |
| `review.ts` | Tech lead review, revision passes, must-fix tracking, standalone review |
| `gates.ts` | Quality gates, LSP diagnostics |
| `completion.ts` | Push, PR creation, ticket transitions, cleanup |

`orchestrator.ts` is the coordinator — setup, sequencing, and public API re-exports.

Each role can use a different model via `/settings route <persona> <provider>`.

## Configuration

Config lives at `~/.workermill/cli.json`:

```json
{
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6", "apiKey": "{env:ANTHROPIC_API_KEY}" },
    "ollama":    { "model": "qwen3-coder:30b", "host": "http://localhost:11434" }
  },
  "default": "ollama",
  "routing": {
    "planner":   "anthropic",
    "tech_lead": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3,
    "approvalThreshold": 9
  },
  "permissions": {
    "allow": ["bash(git *)", "read_file(*)"],
    "deny":  ["bash(rm *)"]
  }
}
```

Project overrides can live in `.workermill/config.json` at the repo root.

## Tools

Tools live in `src/engine/tools/`.

Built-in tools:

- **File:** `read_file`, `write_file`, `edit_file`, `multi_edit_file`, `patch`, `glob`, `grep`, `ls`, `view_image`, `download_file`
- **Shell:** `bash` (asynchronous foreground process), `bash_background`, `bash_output`, `bash_kill`
- **Git:** `git` (branch, commit, diff, log — blocks destructive ops)
- **Code:** `lsp` (Language Server Protocol integration), `verify` (run build/test commands)
- **Web:** `fetch` (HTTP), `web_search` (provider-specific)
- **Agentic:** `sub_agent` (spawn a child agent with worktree isolation), `todo` (task tracking), `memory` (persistent cross-session memory)
- **Tickets:** `ticket` (fetch, list/search, comment, and transition GitHub/Jira/Linear issues)

### Memory tool

The `memory` tool gives agents persistent, file-based memory across sessions. Agents check their memory directory at conversation start and save project patterns, corrections, and preferences as they work. Memory is stored per-project under `~/.workermill/projects/<id>/memories/` as plain markdown files. Works with every provider.

Each tool has metadata in `src/engine/tools/tool-metadata.ts` — `isReadOnly`, `isDestructive`, `acceptEditsApproved`, `concurrencySafe` — from which the permission system derives its read-only and accept-edits tool sets, and the concurrency scheduler decides what can run in parallel. It is an internal registry, not a tool agents can call.

### Filesystem scope and foreground processes

`src/engine/path-policy.ts` canonicalizes explicit file-tool paths, following existing symlinks and resolving the nearest existing parent of new files. Multi-file patches validate every target before writing. Additional file or directory access must be supplied explicitly through `createToolDefinitions` options as `extraPathGrants`, with `read` or `read_write` access; an absolute image path is not itself a grant. Full-disk mode disables containment checks, not canonicalization. Application memory uses a separate state-directory scope.

These path checks are not an OS sandbox: they do not contain arbitrary shell code or eliminate filesystem races. Git worktrees separate changes, not permissions.

`src/engine/process-runner.ts` owns foreground shell processes by run ID. It accepts an abort signal, timeout, and output bound; on cancellation it sends TERM followed by KILL to the Unix process group. Output truncation is reported explicitly. Native Windows execution requires WSL. Adapters must pass their own run ID and signal to get run-scoped cancellation; an omitted ID uses the legacy foreground-bash cancellation scope.

## MCP (Model Context Protocol)

The CLI auto-detects MCP servers from:

- `mcp` section in `~/.workermill/cli.json`
- Docker Desktop's MCP gateway (if installed and running)

MCP tools are namespaced as `mcp__<server>__<tool>` and appear alongside built-in tools. Tool schemas are sanitized on registration — the CLI forces `type: "object"` on any schema that omits it (required by Anthropic's API).

## Permission System

Four modes, cycled with `Shift+Tab`:

| Mode | Behavior |
|------|----------|
| `default` | Prompt before every tool use |
| `acceptEdits` | Auto-approve file edits, prompt for dangerous commands |
| `plan` | Read-only — write tools removed from the schema entirely |
| `bypassPermissions` | No prompts |

On top of modes, **rule-based permissions** accept pattern matching:

- `bash(git *)` — allow any git subcommand
- `write_file(*.env)` — deny writes to env files
- `read_file(.ssh/*)` — deny reads from ssh directory

Rule matching evaluates deny → ask → allow. An ask rule takes precedence over an allow rule.

### Adding a tool execution entry point

Use `decideToolPermission` from `src/engine/tool-policy.ts` for decisions and `executeToolCall` from `src/engine/tool-executor.ts` to execute an authorized call. Supply a per-run context with a canonical `PathScope`, abort signal, current permission-state getter, and optional prompt/hook/checkpoint callbacks. Keep UI and model-stream concerns in the caller; shared policy must not import React at runtime.

The executor checks permission and cancellation before callbacks. Authorized calls run the pre-hook before checkpointing and mutation, then post-hook and completion callbacks, releasing the workspace mutation lock even on errors. A denied call invokes none of those callbacks. Without a prompt callback, an ask decision throws `ToolExecutionError` with code `permission_required`; it never assumes approval. Tool closures must propagate the same signal to subprocesses and other cancellable operations.

Do not copy the decision table into new adapters or wrap already-governed tools repeatedly. Deferred and MCP tools need the same boundary as built-ins; unknown tools are not assumed read-only. See `tool-policy.test.ts` and `tool-executor.test.ts` for executable contract examples.

## Context Management

Long conversations hit context window limits. Three layers of compaction run automatically:

1. **Micro-compaction** (free) — truncates old tool output when context exceeds ~60%
2. **LLM summarization** — summarizes older messages when micro-compaction isn't enough
3. **Hard truncation** — drops oldest messages if summarization fails

Before any compaction, the CLI scans message history for `::learning::` and `::remember::` markers and persists them to the current project's memory directory under `~/.workermill/projects/<project-id>/memories/` so the agent's discoveries aren't lost.

## Safety

- **Dangerous command detection** — blocks destructive patterns (`rm -rf /`, `git push --force`, etc.) unless in `bypassPermissions`
- **Dangerous file detection** — blocks writes to `.env`, `.ssh/`, `.git/config`, lock files, etc.
- **Rate limit handling** — detects HTTP 429 from any provider, extracts `retry-after`, retries up to 3 times with a visible countdown
- **Tool call loop detection** — aborts the model early if it repeats the same tool call 4+ times in a 6-call window

## Session Persistence

Sessions save to `~/.workermill/projects/<project-id>/sessions/<id>.json` after every turn. Resume with `wm --resume`. The CLI tracks the working directory, model state, and full message history. Manage sessions from the command line with `wm session list`, `wm session show <id>`, and `wm session delete <id>`.

## Hooks

Pre- and post-tool hooks run shell commands or HTTP requests around tool execution. Configured in `~/.workermill/cli.json` under `hooks`. Pre-hooks can block tool execution by returning a non-zero exit code. Post-hooks can add feedback to the conversation.

## Costs & Tokens

`CostTracker` accumulates usage across every model call and reports per-role costs via `/cost` and the status bar. Pricing data lives in `src/providers/*/pricing.ts`.

## What the CLI Is Not

- Not a server — nothing runs in the background
- Not a SaaS — no account, no cloud sync, no telemetry
- Not an IDE plugin — it's a terminal-native tool
