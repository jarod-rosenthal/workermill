<p align="center">
  <h1 align="center">WorkerMill</h1>
  <p align="center">An AI coding team in your terminal. Different models plan, build, and review — so bad code gets caught, not shipped.</p>
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
  <a href="https://www.npmjs.com/package/workermill">npm</a> ·
  <a href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill">VS Code Extension</a>
</h3>

<p align="center">
  <a href="https://www.youtube.com/watch?v=3V_GdFAPm7o">
    <img src=".github/assets/demo-preview.jpg" alt="WorkerMill Demo" width="100%" />
  </a>
</p>

## Get Started

```bash
npx workermill
```

Describe what you want to build. A planner breaks it down, assigns the right specialists automatically, and a reviewer catches what they missed. You get a feature branch with clean commits — reviewed before you ever look at it.

Works with **Ollama** (fully local), **Anthropic**, **OpenAI**, **Google**, **LM Studio**, and [any OpenAI-compatible provider](#ai-provider-support).

---

## What You Can Do

### Ship a feature — one command, full team

Say you're building a task management app and you need user login. You describe what you want, and WorkerMill figures out the rest — who builds what, in what order, and whether it's any good.

```
> /ship add user authentication — email/password signup, login, logout, and a protected dashboard route

 planner  Reading codebase... 38 files analyzed
 planner  3 stories:
          [backend_developer] Auth service: password hashing, JWT tokens, login/signup/logout endpoints
          [backend_developer] Middleware: route protection, token verification, session handling
          [frontend_developer] UI: signup form, login form, redirect to dashboard on success

 backend_developer  Created src/services/auth.ts, src/routes/auth.ts
 backend_developer  Created src/middleware/requireAuth.ts
 backend_developer  Running quality gates... tsc ✓ vitest ✓
 frontend_developer Created src/pages/Login.tsx, src/pages/Signup.tsx
 frontend_developer Modified src/App.tsx — added protected route wrapper
 frontend_developer Running quality gates... tsc ✓ vitest ✓

 tech_lead  Reviewing against original spec...
 tech_lead  Score: 9/10 — approved

 system  Branch: workermill/user-auth (6 commits, 9 files, +680 lines)
         Push and open PR? (y/n)
```

A planner broke the work into scoped stories. A backend expert built the API. A frontend expert wired the UI. A tech lead reviewed the actual diffs against your spec — different model, different blind spots. Everything lands on a feature branch. You approve at every step.

### Review didn't pass? `/retry` picks up where you left off

The tech lead scored it 6/10 — the login endpoint returns a raw JWT in the response body instead of setting it as an HttpOnly cookie, and there's no logout invalidation. You want it fixed, not rebuilt.

```
> /retry

 planner  Reading existing branch... 6 commits found
 planner  Previous review feedback: "JWT should be HttpOnly cookie, not response body. Logout must invalidate."
 planner  1 revision story:
          [backend_developer] Move JWT to HttpOnly cookie, add token blacklist on logout

 backend_developer  Modified src/routes/auth.ts — cookie-based token, blacklist on /logout
 backend_developer  Modified src/middleware/requireAuth.ts — read token from cookie
 backend_developer  Running quality gates... vitest ✓ (23 passed)

 tech_lead  Score: 9/10 — approved
```

`/retry` doesn't start over. The planner sees everything already built, reads the previous review feedback, and plans only what needs fixing. Workers see their own prior commits via git log. No wasted tokens rebuilding what already works.

### Target a single expert for focused work

You don't always need the full team. `/as` sends one specialist with full tool access — no planning step, no review loop. Just an expert doing what they're best at.

```
> /as security_engineer audit this repository — check for injection, broken auth, and data exposure

 security_engineer  Reading routes, middleware, database queries...
 security_engineer  Found 3 issues:
   1. SQL injection in src/routes/search.ts:47 — user input concatenated into query string
   2. No rate limiting on /api/login — brute force attacks possible
   3. Session cookie missing Secure and HttpOnly flags
 security_engineer  Fixing all three...
 security_engineer  Running quality gates... tsc ✓ vitest ✓
```

Other examples:
```
/as backend_developer add pagination to the /api/tasks endpoint
/as frontend_developer redesign the settings page to use tabs instead of a long form
/as devops_engineer set up a GitHub Actions CI pipeline with lint, test, and build steps
/as qa_engineer write integration tests for the checkout flow
```

### Switch models on the fly

```
> /model google/gemini-3.1-pro

 Switched to google/gemini-3.1-pro (1M context)
 Previous context auto-compacted to fit.

> /model ollama/qwen3-coder:30b 256k

 Switched to ollama/qwen3-coder:30b (256k context)
```

`/model` hot-swaps mid-session. Autocomplete helps with provider and model names. If the new model has a smaller context window, conversation history compacts automatically. Mix and match: start exploring with a big-context model, switch to a fast local model for execution.

---

## Why a Team, Not a Single Agent

> One model doing everything writes bad code and approves its own bad code.

WorkerMill separates planning, execution, and review into governed roles — and lets you assign a different model to each one.

1. **A planner** reads your codebase and decomposes the task into tight, scoped tickets with specific files and clear acceptance criteria.
2. **Specialist workers** execute one ticket at a time. A backend expert builds the API. A frontend expert wires the UI. They follow the plan.
3. **A reviewer** reads the actual diffs against your original spec. Different model, different provider, different blind spots. It rejects bad work with specific feedback until the code meets the standard.

You pay flagship prices for judgment (2 API calls), not for every line of code (200 tool calls). Run workers on Ollama for free while the planner and reviewer hold the quality bar.

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

---

## Features

### Multi-expert orchestration

Hand off a feature with `/ship` and a team assembles: a planner decomposes the work, specialist personas execute scoped stories, a tech lead reviews the diffs. Revisions loop until the code passes. Commits land on a feature branch, ready for PR.

### Mix models per role

Route your planner through Claude Opus while workers run free on Ollama locally. Different models for different jobs — flagship for judgment, open-weight for volume.

### 12 specialist personas

Backend developer, frontend developer, architect, DevOps, security, QA, data/ML, mobile, tech writer — plus planner, reviewer, and critic. Use `/as security_engineer audit the auth layer` to target one directly. Create your own in `.workermill/personas/`.

### Works with everything you already have

Reads `WORKERMILL.md`, `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md` as project instructions. Connects to MCP servers. Runs your linters and tests as quality gates. Hooks into your existing workflow, not the other way around.

### 15 built-in tools + MCP

File read/write/edit/patch, glob, grep, ls, bash (sandboxed), git, web search, fetch, verify, LSP, sub-agent with worktree isolation, and headless Chrome. Connect any additional tool via [MCP servers](https://modelcontextprotocol.io) — WorkerMill auto-detects Docker Desktop MCP and loads schemas on demand.

### Runs anywhere, no account required

Ollama for fully local and offline. Anthropic, OpenAI, Google, LM Studio, or any OpenAI-compatible endpoint — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, Fireworks. Bring your keys, run `npx workermill`, start building.

### You stay in control

Permission prompts before every write. Four permission modes you cycle with `Shift+Tab`. Granular allow/deny rules per tool. Dangerous command detection that flags `rm -rf`, force push, `drop table` even in trust mode. Sensitive file protection for `.env`, `.ssh/`, `.git/config`. OS-level sandboxing via bubblewrap. Pre-execution hooks that can block any tool call. `/undo` reverts changes instantly.

### Context that doesn't run out

Three-tier compaction keeps long sessions productive — free micro-compaction trims old tool output at 60%, LLM summarization preserves decisions at 80%, and memory extraction saves your `::learning::` markers before they're compacted away. Rate limit retry with backoff. Loop detection kills runaway tool calls. Read-only tools run in parallel.

### Custom skills and persistent memory

Drop `.md` files in `.workermill/skills/` with YAML frontmatter to create reusable workflows — deploy scripts, migration playbooks, review checklists. `::learning::` markers and `/remember` save knowledge across sessions so your team doesn't repeat mistakes.

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

No server, no Docker, no account. First run walks you through provider setup in 60 seconds — pick a model, add a key (or point at Ollama), and you're building.

**Requirements:** Node.js 20+, Git, and an LLM provider (Ollama for local, or an API key). [GitHub CLI](https://cli.github.com/) (`gh`) is optional but needed for automatic PR creation.

---

<details>
<summary><strong>All Commands</strong></summary>

**Build**

| Command | What it does |
|---------|-------------|
| `/ship <task>` | Full team: plan, execute with experts, review, commit to branch |
| `/ship spec.md` | Same, but read the task from a file |
| `/as <persona> <task>` | One expert, full tools, no planning overhead |
| `/retry` | Resume last `/ship` — planner sees what's built, targets what's missing |
| `/review` | Tech lead review of current changes |

**Session**

| Command | What it does |
|---------|-------------|
| `/model provider/model [ctx]` | Hot-swap model mid-session (e.g. `/model google/gemini-3.1-pro`) |
| `/compact [focus]` | Compress conversation — optionally preserve specific context |
| `/cost` | Session cost estimate and token usage |
| `/sessions` | List, switch, or resume past conversations |
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

## Beyond the CLI

The CLI runs the same engine that powers the full [WorkerMill platform](PLATFORM.md) — web dashboard, VS Code extension, Kanban boards, and managed cloud infrastructure. Same experts, same review pipeline, same quality gates.

## Security

<p>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/semgrep.yml/badge.svg" alt="Semgrep"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/gitleaks.yml/badge.svg" alt="Gitleaks"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/trivy.yml/badge.svg" alt="Trivy"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml"><img src="https://github.com/jarod-rosenthal/workermill/actions/workflows/npm-audit.yml/badge.svg" alt="npm audit"></a>
  <a href="https://github.com/jarod-rosenthal/workermill/security/dependabot"><img src="https://img.shields.io/badge/dependabot-enabled-brightgreen?logo=dependabot" alt="Dependabot"></a>
</p>

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
