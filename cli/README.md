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
      "host": "http://localhost:11434"
    },
    "anthropic": {
      "model": "claude-sonnet-4-6",
      "apiKey": "{env:ANTHROPIC_API_KEY}"
    }
  },
  "default": "ollama",
  "routing": {
    "architect": "anthropic",
    "reviewer": "anthropic"
  },
  "review": {
    "maxRevisions": 2,
    "autoRevise": false,
    "approvalThreshold": 80
  }
}
```

## 15 Built-in Personas

architect, backend_developer, frontend_developer, fullstack_developer, devops_engineer, qa_engineer, security_engineer, database_engineer, mobile_developer, data_engineer, ml_engineer, tech_writer, tech_lead, planner, critic

## Requirements

- Node.js 20+
- An LLM provider (Ollama for local, or an API key for cloud providers)

## License

MIT
