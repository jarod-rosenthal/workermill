<div align="center">

# WorkerMill

### Free local models write the code. Smart models plan and review. You pay pennies instead of dollars.

<br>

Most AI coding tools run every token through an expensive cloud model. WorkerMill flips that. A team of specialist AI personas — each routable to a different provider — handles the heavy lifting on local models or affordable cloud APIs. You only burn premium tokens on planning and review. Same quality, fraction of the cost.

Point it at a ticket. Get a pull request — planned, built by experts, and independently reviewed.

<br>

[![npm version](https://img.shields.io/npm/v/workermill?color=blue)](https://www.npmjs.com/package/workermill)
[![npm downloads](https://img.shields.io/npm/dw/workermill?color=blue)](https://www.npmjs.com/package/workermill)
![Node.js](https://img.shields.io/badge/Node.js_20+-339933?style=flat&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
[![GitHub stars](https://img.shields.io/github/stars/jarod-rosenthal/workermill?style=social)](https://github.com/jarod-rosenthal/workermill/stargazers)
[![License](https://img.shields.io/github/license/jarod-rosenthal/workermill?color=blue)](https://github.com/jarod-rosenthal/workermill/blob/main/LICENSE)

<br>

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Commands](#commands) · [Providers](#ai-provider-support) · [Docs](https://workermill.com/docs)

<br>

<a href="https://www.youtube.com/watch?v=ZXpksHXxQMQ">
  <img src=".github/assets/demo-preview.jpg" alt="WorkerMill Demo" width="100%" />
</a>

</div>

---

## Quick Start

```bash
npx workermill
```

No API key required — select Ollama during setup to run fully local. Or bring your own keys for Anthropic, OpenAI, Google, xAI, or [any OpenAI-compatible provider](#ai-provider-support). Setup takes 60 seconds.

```bash
# Or install globally
npm install -g workermill

# Check your setup
wm doctor
```

No server, no Docker, no account. First run walks you through provider setup — pick a model, add a key (or point at Ollama), and you're building.

**Requirements:** Node.js 20+, Git, and an LLM provider (Ollama for local, or an API key). [GitHub CLI](https://cli.github.com/) (`gh`) is optional but needed for automatic PR creation.

---

## What It Does

### Point at a ticket. Get a pull request.

Point WorkerMill at your GitHub Issues, Jira, or Linear tickets. It plans the work, assigns specialist AI personas — backend, frontend, devops, security — writes the code, runs your tests, reviews with a separate model, and opens a PR.

```
> /build #42

 coordinator  Fetched #42: Add product export to CSV

 planner  Reading codebase... 38 files analyzed
 planner  2 stories:
          [backend_developer] CSV export endpoint with filters, auth, tests
          [frontend_developer] Export button on Products page

 backend_developer  Created src/routers/products.py export endpoint
 backend_developer  Created tests/test_products.py — 4 new tests
 frontend_developer Created frontend/src/pages/ProductsPage.tsx — Export CSV button

 tech_lead  Reviewing against original spec...
 tech_lead  Score: 5/10 — N+1 database query, JSX parsing error
 tech_lead  Revision needed

 backend_developer  Fixed N+1 with selectinload, updated tests
 frontend_developer Fixed JSX structure, verified build

 tech_lead  Score: 9/10 — approved

 system  Branch: workermill/add-product-export (4 commits)
         Push and open PR? (y/n)
         Cost: ~$2.50 (planner + reviewer only — workers ran locally for free)
```

The reviewer caught a real N+1 database query. The workers fixed it. The re-review passed. No human intervention. That's the difference between one model approving its own work and a team with independent review.

Works with **GitHub Issues** (`/build #42`), **Jira** (`/build PROJ-123`), **Linear** (`/build TEAM-42`), spec files (`/build spec.md`), or just a description (`/build add dark mode`).

### Review didn't pass? `/retry` picks up where you left off

```
> /retry

 coordinator  Retrying on branch: workermill/user-auth — 2 done, 1 remaining
 coordinator  Story 1/1: [backend_developer] Auth service

 backend_developer  Modified src/routes/auth.ts — cookie-based token, blacklist on /logout
 backend_developer  Modified src/middleware/requireAuth.ts — read token from cookie
 backend_developer  Running quality gates... vitest ✓ (23 passed)

 tech_lead  Score: 9/10 — approved
```

`/retry` doesn't start over. It loads the existing plan from disk, skips planning entirely, and resumes from the first incomplete story. No wasted tokens replanning or rebuilding what already works.

### Review your code. Fix what it finds.

`/review` runs a standalone Tech Lead review on your current work. If it finds issues, WorkerMill offers to create a GitHub issue with the findings and immediately kicks off `/build` to fix them.

```
> /review branch

 tech_lead  Reading diff against main... 14 files changed
 tech_lead  Score: 6/10
 tech_lead  Issues:
   1. API key passed as query parameter — use headers
   2. No input validation on POST /api/webhooks
   3. Error responses leak stack traces in production

 Create a GitHub issue with these findings and fix them? (y/n) y

 coordinator  Created issue #18 — starting fix...
```

Works with `branch` (full diff vs main), `diff` (uncommitted changes), or a PR number (`/review #42`).

### Target a single expert

`/as` sends one specialist with full tool access — no planning step, no review loop.

```
/as security_engineer audit this repository for injection and broken auth
/as backend_developer add pagination to the /api/tasks endpoint
/as devops_engineer set up a GitHub Actions CI pipeline
/as qa_engineer write integration tests for the checkout flow
```

### Or just chat

Ask it to fix a bug, explain a function, or refactor a module. It reads your code, makes changes, runs your tests.

---

## How It Works

Unlike single-model tools, WorkerMill never lets the same model review its own code.

1. **A planner** reads your codebase and decomposes the task into scoped stories with specific files and implementation guidance.
2. **A critic** (optional) scores the plan 1-10 on completeness, feasibility, and risk — refining it up to 3 times until it passes. Bad plans get caught before a single line of code is written.
3. **Specialist workers** build one story at a time — a backend expert writes the API, a frontend expert wires the UI. Workers run on local models, affordable cloud APIs, or any provider you choose.
4. **Quality gates** run after each story — your tests, linter, LSP diagnostics. Failures get injected into the reviewer's context.
5. **A reviewer** on a different model reads the actual diffs against the original spec. It rejects bad work with specific feedback — including real code examples — until the code meets the standard.

```json
{
  "providers": {
    "ollama": { "model": "qwen3-coder:30b" },
    "openai": { "apiKey": "{env:OPENAI_API_KEY}" },
    "google": { "apiKey": "{env:GOOGLE_API_KEY}" }
  },
  "default": "ollama",
  "routing": {
    "planner": "openai",
    "tech_lead": "google"
  }
}
```

Use expensive models for judgment. Free local models for volume.

---

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Expert Orchestration** | `/build` decomposes tasks into stories and assigns specialist personas — backend, frontend, devops, security, QA |
| **Independent Code Review** | Reviewer runs on a separate model. Never approves its own code. Rejects with specific feedback and code examples |
| **11 Built-in Personas** | architect, backend, frontend, mobile, devops, security, QA, data/ML, tech writer, planner, tech lead |
| **Definition of Done** | Planner emits required files, tests, and commands per story — orchestrator enforces them before review |
| **Quality Gates** | Tests, linter, and LSP diagnostics run after each story — failures block review |
| **LSP Integration** | Language server diagnostics, go-to-definition, find-references, hover info, workspace symbols — semantic code intelligence |
| **Ticket Integration** | GitHub Issues, Jira, Linear — fetch specs, post comments, transition status |
| **Model Routing** | Different provider per role — expensive models for planning/review, free local models for coding |
| **12 Providers** | Anthropic, OpenAI, Google, xAI, Ollama, LM Studio, OpenRouter, Groq, DeepSeek, Mistral, AWS Bedrock, Azure |
| **Hot-Swap Models** | `/model provider/model [context]` mid-session — e.g. `/model ollama/qwen3-coder:30b 256k` |
| **MCP Support** | Connect external tools via Model Context Protocol — auto-detects Docker Desktop |
| **Hooks** | Pre/post tool hooks with blocking, lifecycle events, HTTP webhooks |
| **Custom Personas** | Drop `.md` files in `.workermill/personas/` — project-level or global |
| **Custom Commands** | `.workermill/skills/` for project-specific slash commands |
| **Agent Memory** | Persistent `memory` tool — agents save and recall project patterns, corrections, preferences across sessions. Works with all providers |
| **Project Memory** | `/remember` saves user-facing context — corrections, preferences, learnings |
| **Session History** | Per-project session storage, resume with `--resume`, `/sessions` to browse |
| **Checkpoint Undo** | `/undo` rolls back per-file, per-step, or everything — tracked independently from git |
| **Run Manifests** | Every `/build` saves a JSON manifest with full run state — stories, outcomes, cost, review. Inspectable after the fact |
| **Retry Rollback** | Failed story retries start from a clean workspace snapshot, not half-broken state |
| **Sub-Agents** | Spawn isolated workers in git worktrees for parallel research or implementation |
| **Permission System** | Granular tool allow/deny rules, `/trust` for session-wide approval |

---

## AI Provider Support

Bring your own keys. Mix and match per role. WorkerMill uses the [Vercel AI SDK](https://sdk.vercel.ai) — any compatible provider works out of the box.

| Provider | Models | Notes |
|----------|--------|-------|
| **Ollama** | Any local model | Auto-detected, including WSL. Fully offline |
| **LM Studio** | Any local model | Auto-detected on localhost:1234 |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Pro, Codex | |
| **Google** | Gemini 3.1 Pro, Gemini 3.1 Flash Lite, Gemini 2.5 Pro/Flash | |
| **xAI** | Grok 4.20, Grok 4.1 Fast, Grok Code Fast | 2M context, reasoning models |
| **AWS Bedrock** | Claude Sonnet 4.6, Haiku 4.5, Amazon Nova | Enterprise cross-region |
| **Azure** | GPT-5.4, GPT-5.4 Mini, o4-mini | Azure AI Foundry deployments |
| **OpenRouter** | Any model on OpenRouter | Aggregator — access all providers |
| **Groq** | Llama 3.3 70B, Qwen3 32B | Ultra-fast inference |
| **DeepSeek** | DeepSeek Chat, Reasoner, V4 | Up to 1M context |
| **Mistral** | Mistral Large, Codestral, Devstral | |

Any provider with an OpenAI-compatible API also works — just add a `host` field in your config.

---

## Commands

<details>
<summary><strong>Build</strong></summary>

| Command | What it does |
|---------|-------------|
| `/build <task>` | Full team: plan, execute with experts, review, commit to branch |
| `/build spec.md` | Same, but read the task from a file |
| `/build #42` / `PROJ-123` / `TEAM-42` | Fetch a ticket from GitHub Issues, Jira, or Linear |
| `/as <persona> <task>` | One expert, full tools, no planning overhead |
| `/retry` | Resume last `/build` — skips planning, picks up from the first incomplete story |
| `/review branch` | Tech lead review of feature branch diff vs main |
| `/review diff` | Review uncommitted changes only |
| `/review #42` | Review a GitHub PR by number |

</details>

<details>
<summary><strong>Session</strong></summary>

| Command | What it does |
|---------|-------------|
| `/model provider/model [context]` | Hot-swap model mid-session (e.g. `/model ollama/qwen3-coder:30b 256k`) |
| `/model planner` / `/model reviewer` | Switch planner or reviewer model specifically |
| `/compact [focus]` | Compress conversation — optionally preserve specific context |
| `/cost` | Session cost estimate and token usage |
| `/sessions` | List past conversations (resume with `--resume <id>` on next launch) |
| `/status` | Current session info |
| `/clear` | Reset the conversation |
| `/edit` | Open `$EDITOR` for longer input |
| `/log` | View CLI log entries |

</details>

<details>
<summary><strong>Project</strong></summary>

| Command | What it does |
|---------|-------------|
| `/init` | Generate `AGENT.md` from codebase analysis |
| `/remember <text>` | Save a persistent memory |
| `/forget <id>` | Remove a memory |
| `/memories` | View all saved project memories |
| `/personas` | List, view, or create expert personas |
| `/skills` | List custom commands from `.workermill/skills/` |
| `/projects` | List known projects |

</details>

<details>
<summary><strong>Safety</strong></summary>

| Command | What it does |
|---------|-------------|
| `/undo` | Revert file changes — per-file, per-step, or everything |
| `/diff` | Preview uncommitted changes |
| `/changed` | Show files changed in this session |
| `/git` | Branch and status |
| `/permissions` | Manage tool allow/deny rules |
| `/trust` | Auto-approve all tools for this session |

</details>

<details>
<summary><strong>Config</strong></summary>

| Command | What it does |
|---------|-------------|
| `/settings` | View and change configuration inline |
| `/settings key <provider> <key>` | Add an API key without leaving the session |
| `/setup` | Re-run the provider setup wizard |
| `/hooks` | View configured pre/post tool hooks |
| `/mcp` | MCP server connection status |

</details>

<details>
<summary><strong>Experimental</strong></summary>

Requires `"experimental": true` in your config.

| Command | What it does |
|---------|-------------|
| `/chrome` | Headless Chrome for testing and scraping |
| `/voice` | Voice input — speak your task |
| `/schedule` | Scheduled recurring tasks |
| `/orchestrate` | Epic decomposition — break parent issues into child issues and execute |

</details>

<details>
<summary><strong>CLI Subcommands</strong></summary>

Run outside the interactive session from a normal terminal prompt.

| Command | What it does |
|---------|-------------|
| `wm run <prompt>` | Headless prompt execution — runs a single prompt and exits |
| `wm models [filter]` | List available AI models with live provider discovery |
| `wm session list` | List saved sessions |
| `wm session show <id>` | Show a specific session's details |
| `wm stats` | Cross-session usage analytics and cost summary |
| `wm schema` | Generate JSON Schema for config validation |
| `wm logs` | Stream or tail CLI log entries |
| `wm model <provider/model>` | Set default model without entering a session |
| `wm runs list` | List recent /build runs with outcomes |
| `wm runs show <id>` | Full details of a past build run |
| `wm doctor` | Health check: Node, git, config, providers |

</details>

**Shortcuts:** `!command` runs shell directly · `ESC` cancels · `ESC ESC` rolls back last exchange · `Shift+Tab` cycles permission mode · `@file.ts` inlines code · `@dir/` inlines tree · `@url` fetches content · `@image.png` sends to vision models

---

## Context Windows

WorkerMill supports a shorthand context argument on `/model` commands for local providers. You do not pass a separate flag. Just append the context size after the model:

```bash
/model ollama/qwen3-coder:30b 32k
/model ollama/qwen3-coder:30b 256k
/model lmstudio/deepseek-coder-v2 64k
```

Accepted formats include values like `32k`, `128k`, `256k`, and `1m`.

For local providers like Ollama and LM Studio, this is the easiest way to raise or lower the working context without editing config by hand. If you prefer to set it in config, use the numeric `contextLength` field:

```json
{
  "providers": {
    "ollama": {
      "model": "qwen3-coder:30b",
      "contextLength": 131072
    }
  }
}
```

The slash command shorthand and the config value represent the same setting for local providers; the command just lets you express it in a human-friendly form.

---

## Built-in Personas

WorkerMill ships with 11 specialist personas. Each has its own system prompt, tool restrictions, and domain expertise — and each can be routed to a different provider via the `routing` config — run workers on Ollama for free, on affordable cloud models like Groq or DeepSeek, or on any provider you prefer.

| Persona | Role |
|---------|------|
| `planner` | Reads your codebase, decomposes tasks into scoped stories |
| `tech_lead` | Reviews code against specs, scores quality, rejects or approves |
| `architect` | System design, architecture decisions, technical strategy |
| `backend_developer` | APIs, databases, server-side logic |
| `frontend_developer` | UI components, state management, styling |
| `mobile_developer` | React Native, mobile platform specifics |
| `devops_engineer` | CI/CD, Docker, infrastructure, deployment |
| `security_engineer` | Vulnerability audits, auth, injection, OWASP |
| `qa_engineer` | Test strategy, integration tests, coverage |
| `data_ml_engineer` | Data pipelines, ML models, analytics |
| `tech_writer` | Documentation, API docs, READMEs |

Create your own by dropping a `.md` file in `.workermill/personas/` (project) or `~/.workermill/personas/` (global). See all available personas with `/personas`.

---

## Tools

WorkerMill gives its agents 23 tools — file operations, shell, search, git, web, code intelligence, memory, and tickets:

| Tool | What it does |
|------|-------------|
| `read_file` | Read files with line ranges |
| `write_file` | Create new files |
| `edit_file` / `multi_edit_file` | Surgical edits with diff-based patching |
| `glob` | Find files by pattern |
| `grep` | Search file contents with regex |
| `ls` | Directory listing |
| `bash` | Shell command execution (sandboxed) |
| `bash_background` / `bash_output` / `bash_kill` | Long-running processes |
| `git` | Branch, commit, diff, log operations |
| `lsp` | Language server — diagnostics, definitions, references, hover, symbols |
| `web_search` | Search the web |
| `fetch` | HTTP requests |
| `download_file` | Download files with checksum verification |
| `sub_agent` | Spawn isolated workers in git worktrees |
| `view_image` | Send images to vision models |
| `todo` | Track tasks within a session |
| `verify` | Run quality gate commands |
| `memory` | Persistent cross-session agent memory |
| `ticket` | Fetch, list/search, comment, and transition issues (GitHub/Jira/Linear) |

Plus any tools connected via [MCP servers](#mcp-support).

---

## MCP Support

Connect external tools via the [Model Context Protocol](https://modelcontextprotocol.io). WorkerMill supports stdio, HTTP, and SSE transports with lazy initialization — servers only spawn when their tools are first used.

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-server"]
      }
    }
  }
}
```

Auto-detects Docker Desktop MCP tools when available. Check status with `/mcp`.

---

## Configuration

WorkerMill stores config at `~/.workermill/cli.json` with project-level overrides in `.workermill/config.json`.

```json
{
  "providers": {
    "anthropic": {
      "model": "claude-sonnet-4-6",
      "apiKey": "{env:ANTHROPIC_API_KEY}"
    },
    "ollama": {
      "model": "qwen3-coder:30b",
      "host": "http://localhost:11434",
      "contextLength": 65536
    }
  },
  "default": "ollama",
  "routing": {
    "planner": "anthropic",
    "tech_lead": "anthropic",
    "backend_developer": "ollama",
    "frontend_developer": "ollama"
  }
}
```

API keys support `{env:VAR_NAME}` syntax to read from environment variables. See [Configuration docs](docs/configuration.md) for every field.

---

## Documentation

- **[Commands](docs/commands.md)** — every slash command, subcommand, and flag
- **[Configuration](docs/configuration.md)** — every field in `~/.workermill/cli.json` with examples
- **[Personas](docs/personas.md)** — writing custom expert roles, tool restrictions, per-project overrides, provider routing
- **[Hooks & Custom Commands](docs/hooks-and-skills.md)** — shell hooks around tool calls, lifecycle events, custom slash commands
- **[Quality Gates](docs/quality-gates.md)** — how verification commands, LSP diagnostics, and spec checks work
- **[Recipes](docs/recipes.md)** — concrete workflows: mixed-provider teams, quality gates, local-only setups
- **[Troubleshooting](docs/troubleshooting.md)** — common issues, diagnostics, and fixes
- **[Architecture](docs/architecture.md)** — how the CLI is put together
- **[Contributing](docs/contributing.md)** — dev setup and PR guidelines

---

## Contributing

PRs welcome. See [Contributing](docs/contributing.md) for dev setup and guidelines.

Join the conversation in [Discussions](https://github.com/jarod-rosenthal/workermill/discussions).

---

<p>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml/badge.svg" alt="Semgrep"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml/badge.svg" alt="Gitleaks"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml/badge.svg" alt="Trivy"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml/badge.svg" alt="npm audit"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/security/dependabot"><img src="https://img.shields.io/badge/dependabot-enabled-brightgreen?logo=dependabot" alt="Dependabot"></a>
</p>

Apache License 2.0 — see [LICENSE](LICENSE) for details.
