# WorkerMill CLI

The lightweight, zero-setup version of [WorkerMill](https://github.com/jarod-rosenthal/workermill) — the open-source orchestration platform for AI coding agents.

The full WorkerMill platform includes a web dashboard, Kanban boards, VS Code extension, CI/CD integration, and managed worker infrastructure. The CLI gives you the same multi-expert orchestration engine directly in your terminal — no server, no Docker, no account. Just `npx workermill` and you're coding.

Works with any LLM provider: Ollama (fully local), Anthropic, OpenAI, Google.

## Quick Start

```bash
npx workermill
```

First run launches a setup wizard — pick your providers, models, and API keys. Ollama is auto-detected for fully local use. Config is saved to `~/.workermill/cli.json` so you only do this once.

Then just describe what you want built.

## Install

```bash
npm install -g workermill
```

Or run without installing: `npx workermill`

## Usage

```bash
# Interactive mode
workermill

# Skip permission prompts
workermill --trust

# Start in read-only research mode
workermill --plan

# Resume last conversation
workermill --resume

# Override the default provider/model for this session
workermill --provider anthropic --model claude-sonnet-4-6
```

## Features

- **Multi-expert orchestration** — Complex tasks automatically decomposed into stories, each assigned to a specialist persona (backend, frontend, devops, security, etc.)
- **Any LLM provider** — Ollama (local), Anthropic, OpenAI, Google. The setup wizard configures per-role model routing (e.g. Ollama for workers, Claude for planning, GPT for review).
- **13 built-in tools** — bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, git, web_search, todo, sub_agent
- **Plan mode** — Read-only research phase before making changes (`/plan` or `--plan`)
- **Session management** — Persistent conversations with resume (`--resume`, `/sessions`)
- **Cost tracking** — Estimated per-model token costs with `/cost` breakdown
- **Quality gates** — Dangerous command warnings, permission prompts, review cycles
- **Git integration** — Auto-init repos, branch awareness, commit after orchestration

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/plan` | Toggle read-only plan mode |
| `/git` | Show git branch and status |
| `/cost` | Estimated token cost breakdown |
| `/sessions` | List, switch, or delete sessions |
| `/editor` | Open $EDITOR for multiline input |
| `/compact` | Compress conversation history |
| `/model` | Show current model |
| `/status` | Session stats |
| `/quit` | Exit |

Prefix `!` for direct bash: `!git status`, `!npm test`

## Multi-Expert Orchestration

For complex tasks, WorkerMill automatically:

1. **Classifies** — Detects if the task needs multiple specialists
2. **Plans** — Explores the codebase, designs stories with dependencies
3. **Executes** — Each story assigned to a persona (backend_developer, frontend_developer, devops_engineer, etc.)
4. **Reviews** — Tech lead reviews all changes, with optional revision cycles
5. **Commits** — Stages changes and commits (with your approval)

## Configuration

First-run setup wizard configures everything interactively. Config saved to `~/.workermill/cli.json`.

You can configure separate providers and models for each role — for example, use a fast local model for workers, a stronger cloud model for planning, and a different one for code review:

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
    "openai": {
      "model": "gpt-5.3-codex",
      "apiKey": "{env:OPENAI_API_KEY}"
    },
    "google": {
      "model": "gemini-2.5-pro",
      "apiKey": "{env:GOOGLE_API_KEY}"
    }
  },
  "default": "ollama",
  "routing": {
    "planner": "google",
    "tech_lead": "openai"
  }
}
```

Per-project overrides can be placed in `.workermill/config.json` in any repo.

## 12 Built-in Personas

backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, architect, tech_lead, planner, critic

All worker personas include production-hardened rules:
- **Real services, not mocks** — Docker containers for databases, caches, queues. Tests run against real services.
- **Version trust** — Never downgrades language/runtime versions (training data is outdated)
- **Learning markers** — Reports codebase discoveries with `::learning::` markers for team visibility
- **Right-sized plans** — Planner matches plan complexity to task complexity (1 step for simple, 3-5 for complex)
- **Approval bias** — Tech lead only blocks on real functional/security issues, not cosmetic preferences
- **File overlap detection** — Critic catches parallel merge conflicts before they happen

Custom personas can be added per-project in `.workermill/personas/` or globally in `~/.workermill/personas/`.

## Requirements

- Node.js 20+
- An LLM provider (Ollama for local, or an API key for cloud providers)

## License

MIT
