# WorkerMill CLI

AI coding agent with multi-expert orchestration. Works with any LLM provider.

The lightweight, zero-setup version of [WorkerMill](https://workermill.com) — the open-source orchestration platform for AI coding agents. Same multi-expert engine, directly in your terminal. No server, no Docker, no account.

Works with **Ollama** (fully local), **Anthropic**, **OpenAI**, **Google**, **LM Studio**, and any OpenAI-compatible provider — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, or your own endpoint.

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

# Resume last conversation
workermill --resume

# Override provider/model
workermill --provider anthropic --model claude-sonnet-4-6

# Cap output tokens
workermill --max-tokens 4096

# Then use /ship inside the CLI for multi-expert orchestration
# /ship spec.md
# /ship REST API with auth, React dashboard, Docker
```

## Features

- **Multi-expert orchestration** — `/ship` decomposes tasks into stories, each assigned to a specialist persona
- **Per-persona model routing** — Map any persona to any provider. Run security reviews on Claude, frontend on GPT, workers on Ollama. Use `/settings route <persona> <provider>` or edit `cli.json`
- **Built-in tools** — bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, git, web_search, todo, verify, sub_agent, plus 8 browser tools
- **WORKERMILL.md** — Project instructions file read by all agents. Also supports CLAUDE.md, .cursorrules
- **MCP servers** — Connect external tools via Model Context Protocol
- **Hooks** — Pre/post tool execution hooks for linting, formatting, etc.
- **Custom commands** — Drop `.md` files in `.workermill/commands/` for custom slash commands
- **Persistent learnings** — `::learning::` markers saved across sessions
- **@mentions** — `@file.ts` inlines code, `@dir/` inlines tree, `@https://url` fetches content, `@image.png` sends multimodal
- **Code review** — Tech lead reads actual code diffs, with configurable revision cycles
- **Bash guardrails** — Blocks destructive commands and writes outside the project directory
- **Permissions** — Shift+Tab to cycle: Ask → Auto-edit → Trust all. Per-tool always-allow from prompt.
- **Session management** — Persistent conversations with resume
- **Cost tracking** — Live in status bar with per-model pricing
- **Live model switching** — `/model` hot-swaps provider and model mid-session with autocomplete, context validation, and auto-compaction
- **Status bar** — Shows active model, context window, usage percentage, cost, git branch, and tokens/sec
- **Auto-update** — Notifies when a newer version is available

## Commands

| Command | Description |
|---------|-------------|
| `/ship <task>` | Multi-expert orchestration — plans, executes, reviews (alias: `/build`) |
| `/review [task]` | Code review using the tech lead (defaults to reviewing recent changes) |
| `/as <persona> <task>` | Run a task with a specific expert (e.g. `/as security_engineer review auth`) |
| `/retry` | Re-run the last ship task |
| `/personas` | List all available experts, view/create custom personas |
| `/init` | Generate `WORKERMILL.md` for this project |
| `/settings` | View/change settings (review, ollama, etc.) |
| `/permissions` | Manage tool permissions (trust/ask/allow/deny) |
| `/undo` | Revert last ship's changes (git stash or reset) |
| `/diff` | Preview uncommitted changes |
| `/model [provider/model] [context]` | Switch model mid-session with autocomplete. Context: `/model ollama/qwen3-coder:30b 256k`. Chain: `/model openai/gpt-5.4 /as backend_developer fix auth` |
| `/compact [focus]` | Compact conversation history (optional focus: `/compact focus on API changes`) |
| `/trust` | Auto-approve all tools for this session |
| `/hooks` | View configured pre/post tool hooks |
| `/skills` | Custom slash commands from `.workermill/commands/` |
| `/chrome` | Open/close headless Chrome *(experimental)* |
| `/voice` | Voice input *(experimental)* |
| `/schedule` | Scheduled recurring tasks *(experimental)* |
| `/update` | Check for updates |
| `/release-notes` | Show changelog |
| `/cost` | Session cost and token usage |
| `/status` | Session info |
| `/log` | Show recent CLI log entries |
| `/git` | Git branch and status |
| `/sessions` | List/switch sessions |
| `/editor` | Open $EDITOR for longer input |
| `/clear` | Reset conversation |
| `/quit` | Exit |

**Shortcuts:** `!command` runs shell directly, `ESC` cancels, `ESC ESC` rolls back last exchange, `Shift+Tab` cycles permission mode, `Ctrl+C Ctrl+C` exits, `←/→` cursor movement, `Ctrl+←/→` word jump, `Ctrl+A/E` home/end, `Tab` autocomplete.

## Multi-Expert Orchestration

`/ship` triggers multi-expert mode (alias: `/build`):

1. **Plans** — Explores the codebase, designs stories as scope labels with dependencies and persona assignments. Workers receive the full original spec — the planner scopes, not rewrites.
2. **Executes** — Each story assigned to a specialist persona. Workers see `## Ticket Requirements — THIS IS YOUR SPEC` with your full task, plus their file scope.
3. **Reviews** — Tech lead reviews actual code with a 3-tier decision: `approved`, `revision_needed`, or `rejected`. Bias toward approval — cosmetic issues don't block. Quality score (1-10) is informational.
4. **Revises** — If revision needed, only affected stories re-run with per-story feedback from the reviewer.
5. **Commits** — Stages changes and commits (with your approval).

For single-expert tasks, use `/as <persona> <task>` — runs one expert with the full tool set and their specialized prompt.

Use `/retry` to re-plan the same task — the planner sees existing code and fills gaps.

## Configuration

### Files

| File | Purpose |
|------|---------|
| `WORKERMILL.md` | Project instructions — read by all agents (committed to repo) |
| `~/.workermill/cli.json` | Global config (providers, routing, review, hooks, MCP) |
| `~/.workermill/sessions/` | Conversation sessions |
| `~/.workermill/logs/` | Debug logs (per-project) |
| `~/.workermill/memory/` | Project memory — learnings, preferences, context (per-project) |
| `.workermill/config.json` | Per-project config overrides |
| `.workermill/commands/*.md` | Custom slash commands |
| `.workermill/personas/*.md` | Custom persona overrides |

### Example Config

```json
{
  "providers": {
    "ollama": {
      "model": "qwen3-coder:30b",
      "host": "http://localhost:11434",
      "contextLength": 262144
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
    "tech_lead": "anthropic",
    "security_engineer": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3
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
| Ollama context | chosen during setup | `/settings ollama.context <n>` |
| Review enabled | true | `/settings review.enabled true/false` |
| Max revisions | 3 | `/settings review.maxRevisions <n>` |
| Auto-revise | false | `/settings review.autoRevise true/false` |
| API key | — | `/settings key <provider> <api-key>` |

### Per-Persona Model Routing

By default, all worker personas use the same model. The planner and reviewer can be routed to different models during setup. You can also route any individual persona to any configured provider:

```bash
/settings route backend_developer anthropic
/settings route frontend_developer google
/settings route security_engineer anthropic
```

This lets you mix providers — e.g., local Ollama for most workers, but route security reviews to a cloud model. Routing is stored in `cli.json` under the `routing` key. Unrouted personas use the default provider.

## Expert Personas

| Persona | Role |
|---------|------|
| `architect` | System design and architecture |
| `backend_developer` | APIs, databases, server logic |
| `frontend_developer` | React, UI components, styling |
| `devops_engineer` | Docker, CI/CD, infrastructure |
| `qa_engineer` | Testing, quality gates |
| `security_engineer` | Auth, vulnerabilities, hardening |
| `data_ml_engineer` | Data pipelines, ML integration |
| `mobile_developer` | Mobile apps and responsive design |
| `tech_writer` | Documentation and API docs |
| `tech_lead` | Code review (used automatically) |
| `planner` | Task decomposition (used automatically) |

Use `/personas` to list all available personas. Use `/as <persona> <task>` to run a task with a specific expert.

Custom personas: add `.workermill/personas/my_persona.md` to your project or `~/.workermill/personas/` globally. Project personas override built-ins with the same name.

## Requirements

- Node.js 20+
- Git
- An LLM provider (Ollama for local, or an API key for cloud providers)
- [GitHub CLI](https://cli.github.com/) (`gh`) — optional, needed for automatic PR creation

## License

Apache-2.0
