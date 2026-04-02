<p align="center">
  <h1 align="center">WorkerMill</h1>
  <p align="center">Point at a ticket. Get a pull request.<br/>A single model writes bad code and approves its own bad code. WorkerMill separates planning, coding, and review — each with a different model, different strengths, different blind spots.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/workermill"><img src="https://img.shields.io/npm/v/workermill?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/workermill"><img src="https://img.shields.io/npm/dw/workermill?color=blue" alt="npm downloads"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/stargazers"><img src="https://img.shields.io/github/stars/jarod-rosenthal/workermill?style=social" alt="GitHub stars"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/blob/main/LICENSE"><img src="https://img.shields.io/github/license/jarod-rosenthal/workermill?color=blue" alt="License"></a>
</p>

<h3 align="center">
  <a href="https://workermill.com">Website</a> ·
  <a href="https://workermill.com/docs">Docs</a> ·
  <a href="https://github.com/jarod-rosenthal/workermill/discussions">Discussions</a> ·
  <a href="https://www.npmjs.com/package/workermill">npm</a>
</h3>

<p align="center">
  <a href="https://www.youtube.com/watch?v=ZXpksHXxQMQ">
    <img src=".github/assets/demo-preview.jpg" alt="WorkerMill Demo" width="100%" />
  </a>
</p>

## Get Started

```bash
npx workermill
```

No API key required — select Ollama during setup to run fully local. Or bring your own keys for **Anthropic**, **OpenAI**, **Google**, **LM Studio**, or [any OpenAI-compatible provider](#ai-provider-support). Setup takes 60 seconds.

---

## Point at a ticket. Get a pull request.

Point WorkerMill at your GitHub Issues, Jira, or Linear tickets. It plans the work, assigns specialist AI personas — backend, frontend, devops, security — writes the code, runs your tests, reviews with a separate model, and opens a PR.

```
> /ship #42

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

 tech_lead  Score: 8/10 — approved

 system  Branch: workermill/add-product-export (4 commits)
         Push and open PR? (y/n)
         Cost: ~$2.50 (planner + reviewer only — workers ran locally for free)
```

The reviewer caught a real N+1 database query. The workers fixed it. The re-review passed. No human intervention. That's the difference between one model approving its own work and a team with independent review.

Works with **GitHub Issues** (`/ship #42`), **Jira** (`/ship PROJ-123`), **Linear** (`/ship TEAM-42`), spec files (`/ship spec.md`), or just a description (`/ship add dark mode`).

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

`/review` runs a standalone Tech Lead review on your current work. If it finds issues, WorkerMill offers to create a GitHub issue with the findings and immediately kicks off `/ship` to fix them.

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
2. **Specialist workers** build one story at a time — a backend expert writes the API, a frontend expert wires the UI. Workers run locally via Ollama (free) or on any cloud provider.
3. **A reviewer** on a different model reads the actual diffs against the original spec. It rejects bad work with specific feedback — including real code examples — until the code meets the standard.

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

## AI Provider Support

Bring your own keys. Mix and match per role. WorkerMill uses the [Vercel AI SDK](https://sdk.vercel.ai) — any compatible provider works out of the box.

| Provider | Models | Notes |
|----------|--------|-------|
| **Ollama** | Any local model | Auto-detected, including WSL. Fully offline |
| **LM Studio** | Any local model | Auto-detected |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | |
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex | |
| **Google** | Gemini 3.1 Pro, Gemini 2.5 Flash | |

Any provider with an OpenAI-compatible API also works — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, Fireworks, or your own custom endpoint.

---

## Install

```bash
# Run without installing (recommended)
npx workermill

# Or install globally
npm install -g workermill

# Check your setup
wm doctor
```

No server, no Docker, no account. First run walks you through provider setup — pick a model, add a key (or point at Ollama), and you're building.

**Requirements:** Node.js 20+, Git, and an LLM provider (Ollama for local, or an API key). [GitHub CLI](https://cli.github.com/) (`gh`) is optional but needed for automatic PR creation.

---

<details>
<summary><strong>All Commands</strong></summary>

**Build**

| Command | What it does |
|---------|-------------|
| `/ship <task>` | Full team: plan, execute with experts, review, commit to branch |
| `/ship spec.md` | Same, but read the task from a file |
| `/ship GH-42` / `PROJ-123` / `TEAM-42` | Fetch a ticket from GitHub Issues, Jira, or Linear |
| `/as <persona> <task>` | One expert, full tools, no planning overhead |
| `/retry` | Resume last `/ship` — skips planning, picks up from the first incomplete story |
| `/review branch` | Tech lead review of feature branch diff vs main |
| `/review diff` | Review uncommitted changes only |
| `/review #42` | Review a GitHub PR by number |

**Session**

| Command | What it does |
|---------|-------------|
| `/model provider/model [ctx]` | Hot-swap model mid-session (e.g. `/model google/gemini-3.1-pro`) |
| `/compact [focus]` | Compress conversation — optionally preserve specific context |
| `/cost` | Session cost estimate and token usage |
| `/sessions` | List past conversations (resume with `--resume <id>` on next launch) |
| `/clear` | Reset the conversation |
| `/editor` | Open `$EDITOR` for longer input |

**Project**

| Command | What it does |
|---------|-------------|
| `/init` | Generate `WORKERMILL.md` from codebase analysis |
| `/remember <text>` | Save a persistent memory |
| `/forget <id>` | Remove a memory |
| `/memories` | View all saved project memories |
| `/personas` | List, view, or create expert personas |
| `/skills` | List custom skills from `.workermill/skills/` |

**Safety**

| Command | What it does |
|---------|-------------|
| `/undo` | Revert file changes — per-file, per-step, or everything |
| `/diff` | Preview uncommitted changes |
| `/git` | Branch and status |
| `/permissions` | Manage tool allow/deny rules |
| `/trust` | Auto-approve all tools for this session |

**Config**

| Command | What it does |
|---------|-------------|
| `/settings` | View and change configuration inline |
| `/settings key <provider> <key>` | Add an API key without leaving the session |
| `/setup` | Re-run the provider setup wizard |
| `/hooks` | View configured pre/post tool hooks |
| `/mcp` | MCP server connection status |

**Experimental**

| Command | What it does |
|---------|-------------|
| `/chrome` | Headless Chrome for testing and scraping |
| `/voice` | Voice input — speak your task |
| `/schedule` | Scheduled recurring tasks |

**Shortcuts:** `!command` runs shell directly · `ESC` cancels · `ESC ESC` rolls back last exchange · `Shift+Tab` cycles permission mode · `@file.ts` inlines code · `@dir/` inlines tree · `@url` fetches content · `@image.png` sends to vision models

</details>

---

<p>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml/badge.svg" alt="Semgrep"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml/badge.svg" alt="Gitleaks"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml/badge.svg" alt="Trivy"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml/badge.svg" alt="npm audit"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/security/dependabot"><img src="https://img.shields.io/badge/dependabot-enabled-brightgreen?logo=dependabot" alt="Dependabot"></a>
</p>

For teams that need a web dashboard, VS Code extension, and managed cloud workers, see the [WorkerMill Platform](PLATFORM.md).

Apache License 2.0 — see [LICENSE](LICENSE) for details.
