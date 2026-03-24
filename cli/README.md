# WorkerMill CLI

AI coding agent with multi-expert orchestration. Works with any LLM provider — Ollama, Anthropic, OpenAI, Google.

## Quick Start

```bash
npx workermill
```

First run walks you through provider setup (Ollama auto-detected). Then just describe what you want built.

## Install

```bash
# Run without installing
npx workermill

# Or install globally
npm install -g workermill
workermill
```

## Features

- **Multi-expert orchestration** — Complex tasks automatically decomposed into stories, each assigned to a specialist persona (backend, frontend, devops, security, etc.)
- **Any LLM provider** — Ollama (local), Anthropic, OpenAI, Google. Per-persona model routing.
- **13 built-in tools** — bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, git, web_search, todo, sub_agent
- **Plan mode** — Read-only research phase before making changes (`/plan` or `--plan`)
- **Session management** — Persistent conversations with resume (`--resume`, `/sessions`)
- **Cost tracking** — Per-model token pricing with `/cost` breakdown
- **Quality gates** — Dangerous command warnings, permission prompts, review cycles
- **Git integration** — Auto-init repos, branch awareness, commit after orchestration

## Usage

```bash
# Interactive mode
workermill

# Skip permission prompts
workermill --trust

# Start in read-only plan mode
workermill --plan

# Resume last conversation
workermill --resume

# Override provider/model
workermill --provider anthropic --model claude-sonnet-4-6

# Auto-revise on failed reviews
workermill --trust --auto-revise
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/plan` | Toggle read-only plan mode |
| `/git` | Show git branch and status |
| `/cost` | Token cost breakdown |
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

Config stored at `~/.workermill/cli.json` (global) and `.workermill/config.json` (per-project).

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
      "model": "gpt-5.4",
      "apiKey": "{env:OPENAI_API_KEY}"
    },
    "google": {
      "model": "gemini-3.1-pro",
      "apiKey": "{env:GOOGLE_API_KEY}"
    }
  },
  "default": "ollama",
  "routing": {
    "tech_lead": "anthropic",
    "planner": "anthropic"
  },
  "review": {
    "maxRevisions": 2,
    "autoRevise": false,
    "approvalThreshold": 80
  }
}
```

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
