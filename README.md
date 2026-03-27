<p align="center">
  <h1 align="center">WorkerMill</h1>
</p>

<p align="center">
  AI coding agent with multi-expert orchestration. In your terminal. Under 60 seconds.<br/>
  Say what you want built — WorkerMill plans it, assigns specialist experts, executes in parallel, reviews the code, and commits.
</p>

<h3 align="center">
  <a href="https://workermill.com">Website</a> ·
  <a href="https://workermill.com/docs">Docs</a> ·
  <a href="https://github.com/jarod-rosenthal/workermill/discussions">Discussions</a> ·
  <a href="https://www.npmjs.com/package/workermill">npm</a> ·
  <a href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill">VS Code Extension</a>
</h3>

<p align="center">
  <a href="https://github.com/jarod-rosenthal/workermill/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="https://www.npmjs.com/package/workermill"><img src="https://img.shields.io/npm/v/workermill?color=blue" alt="npm version"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml/badge.svg" alt="Semgrep"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml/badge.svg" alt="Gitleaks"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml/badge.svg" alt="Trivy"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml/badge.svg" alt="npm audit"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/discussions"><img src="https://img.shields.io/github/discussions/jarod-rosenthal/workermill?logo=github&color=blue" alt="GitHub Discussions"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/stargazers"><img src="https://img.shields.io/github/stars/jarod-rosenthal/workermill?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <video src="workermill-demo.mp4" width="100%" autoplay loop muted playsinline></video>
</p>

## Get Started

```bash
npx workermill
```

That's it. No server. No Docker. No account. First run walks you through provider setup.

Works with **Ollama**, **Anthropic**, **OpenAI**, **Google**, and [any OpenAI-compatible provider](#ai-provider-support) — pick different models for workers, planner, and reviewer independently.

## What It Does

You talk to WorkerMill like any AI coding tool. The difference is `/ship`:

```bash
# Inside the CLI, tell it what to build:
/ship REST API with JWT auth, rate limiting, and Postgres

# Or point it at a spec file:
/ship spec.md

# Or target a specific expert:
/as security_engineer audit the auth middleware
```

`/ship` triggers **multi-expert orchestration** — not one model doing everything, but a coordinated team:

1. **Planner** reads your codebase, decomposes work into scoped stories with file targets and dependencies
2. **Specialist experts** execute each story in parallel — backend, frontend, devops, security, etc.
3. **Tech Lead** reviews actual code diffs with a 3-tier verdict: approved, revision needed, or rejected
4. **Revision cycles** re-run only affected stories with targeted feedback until the review passes
5. **Commits and pushes** with your approval — feature branch, one commit per story

The planner doesn't just split your prompt into parts. It reads the codebase first, understands existing patterns, identifies target files, and gives each expert a scoped ticket with context. Workers receive your **full original spec** — the planner scopes their work, it doesn't rewrite your intent.

## Why Not Just Use Claude/Cursor/Copilot?

Those tools are great for single-file, single-agent work. WorkerMill is for when you need:

- **Multiple concerns handled simultaneously** — a backend expert building the API while a frontend expert wires the UI and a devops expert writes the Dockerfile, all seeing each other's work
- **Real code review, not just generation** — the tech lead reads actual diffs against your spec, not just the final output
- **Revision cycles that learn** — failed reviews don't restart from scratch; only the affected stories re-run with specific feedback from the reviewer
- **Provider mixing** — use a cheap fast model for workers, a smart one for planning, and a different one for review. Run workers on Ollama locally while the planner uses Gemini and the reviewer uses Claude

It's not a replacement for those tools. It's what you reach for when the task is bigger than a single agent can handle well.

## 12 Expert Personas

| Persona | What They Do |
|---------|--------------|
| `architect` | System design, architecture decisions |
| `backend_developer` | APIs, databases, server logic |
| `frontend_developer` | React, UI components, styling |
| `devops_engineer` | Docker, CI/CD, infrastructure |
| `qa_engineer` | Testing, quality gates |
| `security_engineer` | Auth, vulnerabilities, hardening |
| `data_ml_engineer` | Data pipelines, ML integration |
| `mobile_developer` | Mobile apps and responsive design |
| `tech_writer` | Documentation and API docs |
| `tech_lead` | Code review (automatic after `/ship`) |
| `planner` | Task decomposition (automatic on `/ship`) |
| `critic` | Plan quality review (automatic) |

Use `/personas` to list all. Use `/as <persona> <task>` to target one directly. Create custom personas in `.workermill/personas/`.

## AI Provider Support

Bring your own keys. Mix and match per role. WorkerMill uses the [Vercel AI SDK](https://sdk.vercel.ai) — any compatible provider works out of the box.

| Provider | Models | Notes |
|----------|--------|-------|
| **Ollama** | Any local model | Auto-detected, including WSL. Fully offline |
| **LM Studio** | Any local model | Auto-detected |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex | |
| **Google** | Gemini 3.1 Pro, Gemini 2.5 Flash | |

Any provider with an OpenAI-compatible API also works — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, Fireworks, or your own custom endpoint. These are included in the setup wizard but are community-tested, not officially verified by us. If it speaks the OpenAI API, WorkerMill can use it.

```json
{
  "providers": {
    "ollama": { "model": "qwen3-coder:30b" },
    "anthropic": { "model": "claude-sonnet-4-6", "apiKey": "{env:ANTHROPIC_API_KEY}" },
    "google": { "model": "gemini-3.1-pro-preview", "apiKey": "{env:GOOGLE_API_KEY}" }
  },
  "default": "ollama",
  "routing": {
    "planner": "google",
    "tech_lead": "anthropic"
  }
}
```

## Features

**Tools:** 13 built-in (bash, read/write/edit files, glob, grep, ls, fetch, git, web search, sub-agent, todo, think) + MCP server support for anything else.

**Project instructions:** `WORKERMILL.md` (also reads `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) — your coding standards, applied to every agent.

**Mentions:** `@file.ts` inlines code, `@dir/` inlines tree, `@https://url` fetches content, `@image.png` sends multimodal.

**Hooks:** Pre/post tool execution — auto-lint on write, auto-format on edit, whatever you need.

**Custom commands:** Drop `.md` files in `.workermill/commands/` for team-specific slash commands.

**Persistent learnings:** `::learning::` markers saved across sessions so agents don't repeat mistakes.

**Browser:** `/chrome` opens headless Chrome for testing, scraping, or debugging.

**Voice:** `/voice` — speak your task, WorkerMill transcribes and executes.

**Scheduling:** `/schedule` for recurring tasks.

**Session management:** Persistent conversations, `/resume` to pick up where you left off.

**Cost tracking:** Live in the status bar, per-model pricing.

**Safety:** Bash guardrails block destructive commands. Permission system with Shift+Tab cycling (Allow/Deny/Always/Trust). ESC ESC rolls back the last exchange.

## Commands

| Command | Description |
|---------|-------------|
| `/ship <task>` | Multi-expert orchestration — plans, executes, reviews |
| `/as <persona> <task>` | Run a task with a specific expert |
| `/retry` | Re-plan the same task (planner sees existing code) |
| `/personas` | List all experts, view/create custom personas |
| `/init` | Generate `WORKERMILL.md` for this project |
| `/settings` | View/change settings |
| `/permissions` | Manage tool permissions |
| `/undo` | Revert last build's changes |
| `/diff` | Preview uncommitted changes |
| `/model` | Show or switch model |
| `/plan` | Toggle read-only research mode |
| `/trust` | Auto-approve all tools for this session |
| `/hooks` | View configured hooks |
| `/skills` | Custom slash commands |
| `/chrome` | Open/close headless Chrome |
| `/voice` | Voice input |
| `/schedule` | Scheduled recurring tasks |
| `/cost` | Session cost and token usage |
| `/sessions` | List/switch sessions |
| `/editor` | Open $EDITOR for longer input |
| `/clear` | Reset conversation |
| `/quit` | Exit |

**Shortcuts:** `!command` runs shell directly, `ESC` cancels, `ESC ESC` rolls back, `Shift+Tab` cycles permission mode, `Ctrl+C Ctrl+C` exits.

## Install

```bash
# Run without installing (recommended)
npx workermill

# Or install globally
npm install -g workermill

# Or via Homebrew
brew install workermill

# Check your setup
wm doctor
```

**Requirements:** Node.js 20+ and an LLM provider (Ollama for local, or an API key).

[Full CLI documentation →](cli/README.md)

---

## WorkerMill Platform

The CLI is the fastest way to use WorkerMill. When you're ready for a web dashboard, Kanban boards, Jira/Slack/Linear integrations, managed worker infrastructure, and a VS Code extension — the full platform runs on the same engine.

**[WorkerMill Platform →](PLATFORM.md)** — setup, architecture, contributing, and deployment.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
