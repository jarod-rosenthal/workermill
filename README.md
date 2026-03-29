<p align="center">
  <h1 align="center">WorkerMill</h1>
</p>

<p align="center">
  AI-generated code has 1.7x more major issues than human-written code.<br/>
  The industry's answer: add guardrails around a single model.<br/>
  WorkerMill takes a different approach — separate the roles, use different models, and make them check each other's work.
</p>

<p align="center">
  <em>This README covers the <strong>WorkerMill CLI</strong> — the fastest way to get started.<br/>
  WorkerMill is also a <a href="PLATFORM.md">full platform</a> with a web dashboard, VS Code extension, Kanban boards, and managed infrastructure.</em>
</p>

<h3 align="center">
  <a href="https://workermill.com">Website</a> ·
  <a href="https://workermill.com/docs">Docs</a> ·
  <a href="https://github.com/jarod-rosenthal/workermill/discussions">Discussions</a> ·
  <a href="https://www.npmjs.com/package/workermill">npm</a> ·
  <a href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill">VS Code Extension</a>
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/workermill"><img src="https://img.shields.io/npm/v/workermill?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/workermill"><img src="https://img.shields.io/npm/dw/workermill?color=blue" alt="npm downloads"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/stargazers"><img src="https://img.shields.io/github/stars/jarod-rosenthal/workermill?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jarod-rosenthal/workermill?color=blue" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml/badge.svg" alt="Semgrep"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml/badge.svg" alt="Gitleaks"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml/badge.svg" alt="Trivy"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml/badge.svg" alt="npm audit"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/security/dependabot"><img src="https://img.shields.io/badge/dependabot-enabled-brightgreen?logo=dependabot" alt="Dependabot"></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=3V_GdFAPm7o">
    <img src="https://img.youtube.com/vi/3V_GdFAPm7o/maxresdefault.jpg" alt="WorkerMill Demo" width="100%" />
  </a>
</p>

## The Problem Isn't the Model. It's the Architecture.

Every major AI coding tool — Cursor, Claude Code, Codex, Kiro, Aider — runs one model
doing everything: reading the codebase, planning the work, writing the code, and judging
its own output. When that model hallucinates a package, loses context across files, or
makes inconsistent decisions between the backend and frontend, nothing catches it.

The industry response has been to add guardrails — sandboxing, permission prompts,
confirmation dialogs. Those help prevent destructive commands, but they don't fix the
code quality problem. A model that writes bad code and reviews its own bad code will
approve its own bad code, regardless of how many "are you sure?" prompts you put in front of it.

## What WorkerMill Does Differently

WorkerMill separates planning, execution, and review into governed roles — and lets you
assign a different model to each one:

1. **A planner** reads your codebase and decomposes the task into tight, scoped tickets.
   No vague instructions. Each worker gets a precise assignment with specific files and
   clear acceptance criteria. This is the "no garbage in" gate — a flagship model does the
   thinking so workers don't have to improvise.

2. **Specialist workers** execute one ticket at a time. A backend expert builds the API.
   A frontend expert wires the UI. They don't context-switch between 15 files. They don't
   make architectural decisions. They follow the plan.

3. **A reviewer** reads the actual diffs against your original spec. Different model,
   different provider, different blind spots. It rejects bad work with specific feedback.
   Failed stories re-run with the reviewer's notes until the code meets the standard.

The revision loop is the key mechanism. A cheap model writing code to a tight spec,
reviewed by a strong model that catches mistakes and demands fixes, converges on quality
that neither model produces alone.

You pay flagship prices for judgment (2 API calls), not for every line of code (200 tool
calls). Run workers on Ollama for free while the planner and reviewer hold the quality bar.

```json
{
  "providers": {
    "ollama": { "model": "qwen3-coder:30b" },
    "anthropic": { "model": "claude-sonnet-4-6", "apiKey": "{env:ANTHROPIC_API_KEY}" }
  },
  "default": "ollama",
  "routing": {
    "planner": "anthropic",
    "tech_lead": "anthropic"
  }
}
```

## Here's What Happens

You give WorkerMill a feature spec. Say: "add scheduled rollouts — flag scheduling with cron, a countdown timer UI, and audit logging."

```
$ npx workermill
> /ship scheduled-rollouts.md

 planner  Reading codebase... 47 files analyzed
 planner  Decomposed into 2 stories:
          Story 1: [backend_developer] Backend: scheduled rollouts model, handlers, and background scheduler
          Story 2: [frontend_developer] Frontend: scheduled rollouts tab, countdown timers, and create/cancel forms

 backend_developer  Starting — reading existing patterns, models, routes...
 frontend_developer Starting — reading component structure, existing UI patterns...

 backend_developer  Created api/internal/models/schedule.go
 backend_developer  Created api/internal/handlers/schedules.go
 backend_developer  Created api/internal/services/scheduler.go
 frontend_developer Created web/src/components/ScheduledRollouts.svelte
 frontend_developer Created web/src/routes/flags/[id]/+page.svelte (modified)
 backend_developer  Running quality gates... go build ✓ go vet ✓ go test ✓

 tech_lead  Reviewing diffs against original spec...
 tech_lead  Assessment: The fixes are targeted and correct.
 tech_lead  :code_quality_score: 8/10
 tech_lead  :review_decision: approved

 coordinator  Review approved (8/10)
 system       Branch: workermill/scheduled-rollouts (8 commits)
              16 files changed, 1419 insertions(+)
              Push branch and open a pull request? (y/n)
```

Two specialists worked sequentially, each scoped to their own files. A tech lead reviewed the actual diffs — not just the output, but whether it matched your spec. 16 files, committed to a branch, ready for PR. You approve or reject at every step.

**That's the difference.** Every other AI coding tool is one agent trying to do everything. WorkerMill gives you a team.

## Get Started

```bash
npx workermill
```

No server. No Docker. No account. First run walks you through setup in 60 seconds.

Works with **Ollama** (fully local), **Anthropic**, **OpenAI**, **Google**, **LM Studio**, and [any OpenAI-compatible provider](#ai-provider-support) — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, or your own endpoint.

## How `/ship` Works

```bash
/ship REST API with JWT auth, rate limiting, and Postgres   # describe it
/ship spec.md                                                # or point at a file
/as security_engineer audit the auth middleware               # or target one expert
```

`/ship` triggers the full orchestration pipeline:

1. **Planner** reads your codebase and decomposes the work into scoped stories
2. **Specialist experts** execute stories sequentially, each with their full original spec
3. **Tech Lead** reviews the actual code diffs — approved, revision needed, or rejected
4. **Revision cycles** re-run only the stories that failed review with specific feedback
5. **You approve** the commit and push — feature branch, one commit per story

## AI Provider Support

Bring your own keys. Mix and match per role. WorkerMill uses the [Vercel AI SDK](https://sdk.vercel.ai) — any compatible provider works out of the box.

| Provider | Models | Notes |
|----------|--------|-------|
| **Ollama** | Any local model | Auto-detected, including WSL. Fully offline |
| **LM Studio** | Any local model | Auto-detected |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex | |
| **Google** | Gemini 3.1 Pro, Gemini 2.5 Flash | |

Any provider with an OpenAI-compatible API also works — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, Fireworks, or your own custom endpoint. If it speaks the OpenAI API, WorkerMill can use it.

## Commands

| Command | Description |
|---------|-------------|
| `/ship <task>` | Plan, execute with experts, review, commit |
| `/as <persona> <task>` | Run a task with a specific expert |
| `/retry` | Re-plan the same task (planner sees existing code) |
| `/personas` | List all 12 experts, view/create custom ones |
| `/init` | Generate `WORKERMILL.md` project instructions |
| `/undo` | Revert last build's changes |
| `/diff` | Preview uncommitted changes |
| `/model` | Show or switch model |
| `/chrome` | Headless Chrome for testing and scraping |
| `/voice` | Voice input — speak your task |
| `/schedule` | Scheduled recurring tasks |
| `/cost` | Session cost and token usage |

**Shortcuts:** `!command` runs shell directly, `ESC` cancels, `ESC ESC` rolls back, `Shift+Tab` cycles permission mode.

<details>
<summary><strong>12 Expert Personas</strong></summary>

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

Use `/as <persona> <task>` to target one directly. Create custom personas in `.workermill/personas/`.

</details>

<details>
<summary><strong>All Features</strong></summary>

**Tools:** 13 built-in (bash, read/write/edit files, glob, grep, ls, fetch, git, web search, sub-agent, todo, think) + MCP server support for anything else.

**Project instructions:** `WORKERMILL.md` (also reads `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) — your coding standards, applied to every agent.

**Mentions:** `@file.ts` inlines code, `@dir/` inlines tree, `@https://url` fetches content, `@image.png` sends multimodal.

**Hooks:** Pre/post tool execution — auto-lint on write, auto-format on edit, whatever you need.

**Custom commands:** Drop `.md` files in `.workermill/commands/` for team-specific slash commands.

**Persistent learnings:** `::learning::` markers saved across sessions so agents don't repeat mistakes.

**Session management:** Persistent conversations, `/resume` to pick up where you left off.

**Safety:** Bash guardrails block destructive commands. Permission system with Shift+Tab cycling (Allow/Deny/Always/Trust). ESC ESC rolls back the last exchange.

</details>

## Install

```bash
# Run without installing (recommended)
npx workermill

# Or install globally
npm install -g workermill

# Check your setup
wm doctor
```

**Requirements:** Node.js 20+ and an LLM provider (Ollama for local, or an API key).

[Full CLI documentation →](cli/README.md)

---

## Beyond the CLI: WorkerMill Platform

The CLI runs the same engine that powers the full WorkerMill platform. When you outgrow the terminal, everything scales up:

- **Web Dashboard** — manage epics, monitor workers, view coordination feeds in real time
- **VS Code Extension** — backlog, live diffs, worker logs, and settings without leaving your editor
- **Kanban Boards** — drag-and-drop task management wired directly to agent execution
- **Managed Infrastructure** — workers run in cloud containers so your laptop isn't the bottleneck
- **Integrations** — Jira, Slack, Linear, GitHub/GitLab/Bitbucket — agents work inside your existing workflow

Same experts. Same review pipeline. Same quality gates. Just more surface area.

**[WorkerMill Platform →](PLATFORM.md)** — setup, architecture, contributing, and deployment.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
