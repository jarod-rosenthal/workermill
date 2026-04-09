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
ticket/spec → planner → (optional critic loop) → specialist workers → tech lead reviewer → commit
```

- **Planner** reads the codebase and decomposes the task into scoped stories with specific files and acceptance criteria
- **Critic** (optional, off by default) scores the plan 1-10 on completeness, feasibility, dependencies, scope, and risk — refines up to 3 times
- **Workers** execute stories one at a time using their persona's system prompt
- **Reviewer** reads the diffs against the original spec and scores the code; a failing score sends work back for revision

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
- **Shell:** `bash` (sandboxed via worker thread), `bash_background`, `bash_output`, `bash_kill`
- **Git:** `git` (branch, commit, diff, log — blocks destructive ops)
- **Code:** `lsp` (Language Server Protocol integration), `verify` (run build/test commands)
- **Web:** `fetch` (HTTP), `web_search` (provider-specific)
- **Agentic:** `sub_agent` (spawn a child agent with worktree isolation), `todo` (task tracking)
- **Meta:** `tool_metadata` (query tool capabilities and permissions)

Each tool has metadata (`isReadOnly`, `isDestructive`, `concurrencySafe`) used by the permission system and concurrency scheduler.

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

Rules are evaluated in deny → allow → ask order. Deny always wins.

## Context Management

Long conversations hit context window limits. Three layers of compaction run automatically:

1. **Micro-compaction** (free) — truncates old tool output when context exceeds ~60%
2. **LLM summarization** — summarizes older messages when micro-compaction isn't enough
3. **Hard truncation** — drops oldest messages if summarization fails

Before any compaction, the CLI scans message history for `::learning::` and `::remember::` markers and persists them to `~/.workermill/memories/<project>.json` so the agent's discoveries aren't lost.

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
