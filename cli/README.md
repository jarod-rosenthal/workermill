# WorkerMill CLI

AI coding agent with multi-expert orchestration. Works with any LLM provider.

The lightweight, zero-setup version of [WorkerMill](https://workermill.com) — the open-source orchestration platform for AI coding agents. Same multi-expert engine, directly in your terminal. No server, no Docker, no account.

Works with **Ollama** (fully local), **Anthropic**, **OpenAI**, **Google**.

## Quick Start

```bash
npx workermill
```

First run launches a setup wizard — pick providers for workers, planner, and reviewer independently. Ollama is auto-detected (including WSL). Config saved to `~/.workermill/cli.json`.

## Install

```bash
# Run without installing
npx workermill

# Or install globally
npm install -g workermill
workermill

# Check your setup
wm doctor
```

## Usage

```bash
# Interactive chat
workermill

# Skip permission prompts
workermill --trust

# Read-only research mode
workermill --plan

# Resume last conversation
workermill --resume

# Override provider/model
workermill --provider anthropic --model claude-sonnet-4-6

# Cap output tokens
workermill --max-tokens 4096

# Then use /build inside the CLI for multi-expert orchestration
# /build spec.md
# /build REST API with auth, React dashboard, Docker
```

## Features

- **Multi-expert orchestration** — `/build` decomposes tasks into stories, each assigned to a specialist persona
- **Role-based model routing** — Different models for workers, planner, and reviewer (e.g., Ollama for workers, Gemini for planning, Claude for review)
- **13 built-in tools** — bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, git, web_search, todo, sub_agent
- **WORKERMILL.md** — Project instructions file read by all agents. Also supports CLAUDE.md, .cursorrules
- **MCP servers** — Connect external tools via Model Context Protocol
- **Hooks** — Pre/post tool execution hooks for linting, formatting, etc.
- **Custom commands** — Drop `.md` files in `.workermill/commands/` for custom slash commands
- **Persistent learnings** — `::learning::` markers saved across sessions
- **@mentions** — `@file.ts` inlines code, `@dir/` inlines tree, `@https://url` fetches content, `@image.png` sends multimodal
- **Code review** — Tech lead reads actual code diffs, with configurable revision cycles
- **Bash guardrails** — Blocks destructive commands and writes outside the project directory
- **Permissions** — Tab to cycle: Allow → Deny → Always allow → Trust all
- **Session management** — Persistent conversations with resume
- **Cost tracking** — Live in status bar with per-model pricing
- **Auto-update** — Notifies when a newer version is available

## Commands

| Command | Description |
|---------|-------------|
| `/build <task>` | Multi-expert orchestration — plans, executes, reviews |
| `/retry` | Re-plan and re-run the last build task |
| `/init` | Generate `WORKERMILL.md` for this project |
| `/settings` | View/change settings (review, ollama, etc.) |
| `/permissions` | Manage tool permissions (trust/ask/allow/deny) |
| `/undo` | Revert last build's changes (git stash or reset) |
| `/diff` | Preview uncommitted changes |
| `/model` | Show or switch model (`/model provider/model`) |
| `/plan` | Toggle read-only plan mode |
| `/trust` | Auto-approve all tools for this session |
| `/hooks` | View configured pre/post tool hooks |
| `/cost` | Session cost and token usage |
| `/status` | Session info |
| `/log` | Show recent CLI log entries |
| `/git` | Git branch and status |
| `/sessions` | List/switch sessions |
| `/editor` | Open $EDITOR for longer input |
| `/clear` | Reset conversation |
| `/quit` | Exit |

**Shortcuts:** `!command` runs shell directly, `ESC` cancels, `ESC ESC` rolls back last exchange, `Ctrl+C Ctrl+C` exits.

## Multi-Expert Orchestration

`/build` triggers multi-expert mode:

1. **Plans** — Explores the codebase, designs stories with dependencies and persona assignments
2. **Executes** — Each story assigned to a specialist with the full original spec
3. **Reviews** — Tech lead reads actual code diffs, scores quality, requests revisions
4. **Commits** — Stages changes and commits (with your approval)

Use `/retry` to re-plan the same task — the planner sees existing code and fills gaps.

## Configuration

### Files

| File | Purpose |
|------|---------|
| `WORKERMILL.md` | Project instructions — read by all agents (committed to repo) |
| `~/.workermill/cli.json` | Global config (providers, routing, review, hooks, MCP) |
| `.workermill/config.json` | Per-project config overrides |
| `.workermill/commands/*.md` | Custom slash commands |
| `.workermill/personas/*.md` | Custom persona overrides |
| `.workermill/learnings.json` | Persistent learnings from builds |
| `.workermill/sessions/` | Conversation sessions |
| `.workermill/cli.log` | Debug log |

### Example Config

```json
{
  "providers": {
    "ollama": {
      "model": "qwen3-coder:30b",
      "host": "http://localhost:11434",
      "contextLength": 65536
    },
    "anthropic": {
      "model": "claude-sonnet-4-6",
      "apiKey": "{env:ANTHROPIC_API_KEY}"
    },
    "google": {
      "model": "gemini-3.1-pro-preview",
      "apiKey": "{env:GOOGLE_API_KEY}"
    }
  },
  "default": "ollama",
  "routing": {
    "planner": "google",
    "tech_lead": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3,
    "approvalThreshold": 80
  },
  "hooks": {
    "post": [
      { "command": "npx eslint --fix", "tools": ["write_file", "edit_file"] }
    ]
  },
  "mcp": {
    "my-server": { "command": "npx", "args": ["-y", "my-mcp-server"] }
  }
}
```

### Settings

Change settings at runtime with `/settings`:

| Setting | Default | Command |
|---------|---------|---------|
| Ollama host | auto-detected | `/settings ollama.host <url>` |
| Ollama context | 65536 | `/settings ollama.context <n>` |
| Review enabled | true | `/settings review.enabled true/false` |
| Max revisions | 3 | `/settings review.maxRevisions <n>` |
| Approval threshold | 80 | `/settings review.threshold <n>` |

## 12 Built-in Personas

backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, architect, tech_lead, planner, critic

Custom personas: add `.workermill/personas/my_persona.md` to your project or `~/.workermill/personas/` globally.

## Requirements

- Node.js 20+
- An LLM provider (Ollama for local, or an API key for cloud providers)

## License

MIT
