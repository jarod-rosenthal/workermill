# WorkerMill

An AI coding team in your terminal. Different models plan, build, and review — so bad code gets caught, not shipped.

```bash
npx workermill
```

Describe what you want to build. A planner breaks it down, assigns the right specialists automatically, and a reviewer catches what they missed. You get a feature branch with clean commits — reviewed before you ever look at it.

Works with **Ollama** (fully local), **Anthropic**, **OpenAI**, **Google**, **LM Studio**, and any OpenAI-compatible provider — Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, or your own endpoint.

## What You Can Do

### Ship a feature — one command, full team

Say you're building a task management app and you need user login:

```
> /ship add user authentication — email/password signup, login, logout, and a protected dashboard route

 planner  Reading codebase... 38 files analyzed
 planner  3 stories:
          [backend_developer] Auth service: password hashing, JWT tokens, login/signup/logout endpoints
          [backend_developer] Middleware: route protection, token verification, session handling
          [frontend_developer] UI: signup form, login form, redirect to dashboard on success

 backend_developer  Created src/services/auth.ts, src/routes/auth.ts
 backend_developer  Running quality gates... tsc ✓ vitest ✓
 frontend_developer Created src/pages/Login.tsx, src/pages/Signup.tsx
 frontend_developer Running quality gates... tsc ✓ vitest ✓

 tech_lead  Reviewing against original spec...
 tech_lead  Score: 9/10 — approved

 system  Branch: workermill/user-auth (6 commits, 9 files, +680 lines)
         Push and open PR? (y/n)
```

### Review didn't pass? `/retry` picks up where you left off

```
> /retry

 planner  Reading existing branch... 6 commits found
 planner  Previous review feedback: "JWT should be HttpOnly cookie, not response body."
 planner  1 revision story:
          [backend_developer] Move JWT to HttpOnly cookie, add token blacklist on logout

 backend_developer  Modified src/routes/auth.ts, src/middleware/requireAuth.ts
 backend_developer  Running quality gates... vitest ✓ (23 passed)

 tech_lead  Score: 9/10 — approved
```

### Target a single expert

```
/as security_engineer audit this repository — check for injection, broken auth, and data exposure
/as backend_developer add pagination to the /api/tasks endpoint
/as frontend_developer redesign the settings page to use tabs instead of a long form
/as devops_engineer set up a GitHub Actions CI pipeline with lint, test, and build steps
```

### Switch models on the fly

```
> /model google/gemini-3.1-pro
 Switched to google/gemini-3.1-pro (1M context)

> /model ollama/qwen3-coder:30b 256k
 Switched to ollama/qwen3-coder:30b (256k context)
```

## Why a Team, Not a Single Agent

One model doing everything writes bad code and approves its own bad code. WorkerMill separates planning, execution, and review — and lets you assign a different model to each role.

You pay flagship prices for judgment (2 API calls), not for every line of code. Run workers on Ollama for free while the planner and reviewer hold the quality bar.

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

**Requirements:** Node.js 20+, Git, and an LLM provider. [GitHub CLI](https://cli.github.com/) (`gh`) optional for automatic PR creation.

## Features

**Multi-expert orchestration** — `/ship` decomposes, assigns specialists, reviews diffs, revises until approved. Commits to a feature branch.

**Mix models per role** — planner on Claude, workers on Ollama, reviewer on GPT. Different models for different jobs.

**12 specialist personas** — backend, frontend, architect, DevOps, security, QA, data/ML, mobile, tech writer, plus planner, reviewer, and critic. Create your own in `.workermill/personas/`.

**15 built-in tools + MCP** — bash (sandboxed), file read/write/edit/patch, glob, grep, ls, git, web search, fetch, verify, LSP, sub-agent with worktree isolation, headless Chrome. MCP tools auto-detected and loaded on demand.

**Custom skills** — `.workermill/skills/*.md` with YAML frontmatter. Define reusable workflows the model can invoke mid-conversation.

**You stay in control** — four permission modes (Shift+Tab to cycle), granular allow/deny rules, dangerous command and file detection, OS-level sandboxing, blocking pre-hooks, `/undo` for instant rollback.

**Context that doesn't run out** — micro-compaction at 60%, LLM summarization at 80%, memory extraction before compaction. Rate limit retry. Loop detection. Read-only tools run in parallel.

**Persistent memory** — `::learning::` markers and `/remember` save knowledge across sessions.

**Project instructions** — reads `WORKERMILL.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## Configuration

Config lives at `~/.workermill/cli.json`. Project overrides in `.workermill/config.json`.

| File | Purpose |
|------|---------|
| `WORKERMILL.md` | Project instructions read by all agents |
| `~/.workermill/cli.json` | Global config — providers, routing, review, hooks, MCP |
| `.workermill/config.json` | Per-project config overrides |
| `.workermill/skills/*.md` | Custom skills with YAML frontmatter |
| `.workermill/personas/*.md` | Custom persona overrides |

Change settings at runtime:

```
/settings key anthropic sk-ant-...        # Add an API key
/settings route security_engineer anthropic   # Route a persona to a provider
/settings review.maxRevisions 5           # Adjust review cycles
/model ollama/qwen3-coder:30b 256k        # Switch model mid-session
```

## Full Command Reference

<details>
<summary>Expand</summary>

**Build**

| Command | What it does |
|---------|-------------|
| `/ship <task>` | Full team: plan, execute with experts, review, commit to branch |
| `/ship spec.md` | Same, but read the task from a file |
| `/as <persona> <task>` | One expert, full tools, no planning overhead |
| `/retry` | Resume last `/ship` — targets what's missing |
| `/review` | Tech lead review of current changes |

**Session**

| Command | What it does |
|---------|-------------|
| `/model provider/model [ctx]` | Hot-swap model (e.g. `/model google/gemini-3.1-pro`) |
| `/compact [focus]` | Compress conversation |
| `/cost` | Session cost estimate and token usage |
| `/sessions` | List, switch, or resume past conversations |
| `/clear` | Reset conversation |
| `/editor` | Open `$EDITOR` for longer input |

**Project**

| Command | What it does |
|---------|-------------|
| `/init` | Generate `WORKERMILL.md` from codebase analysis |
| `/remember <text>` | Save a persistent memory |
| `/forget <id>` | Remove a memory |
| `/memories` | View all saved project memories |
| `/personas` | List, view, or create expert personas |
| `/skills` | List custom skills |

**Safety**

| Command | What it does |
|---------|-------------|
| `/undo` | Revert file changes |
| `/diff` | Preview uncommitted changes |
| `/git` | Branch and status |
| `/permissions` | Manage tool allow/deny rules |
| `/trust` | Auto-approve all tools for this session |

**Config**

| Command | What it does |
|---------|-------------|
| `/settings` | View and change configuration inline |
| `/settings key <provider> <key>` | Add an API key |
| `/setup` | Re-run provider setup wizard |
| `/hooks` | View configured hooks |
| `/mcp` | MCP server status |

**Experimental**

| Command | What it does |
|---------|-------------|
| `/chrome` | Headless Chrome |
| `/voice` | Voice input |
| `/schedule` | Scheduled recurring tasks |

**Shortcuts:** `!command` runs shell · `ESC` cancels · `ESC ESC` rolls back · `Shift+Tab` cycles permission mode · `@file.ts` inlines code · `@dir/` inlines tree · `@url` fetches content · `@image.png` sends to vision models

</details>

## Links

- [GitHub Repository](https://github.com/jarod-rosenthal/workermill)
- [Documentation](https://workermill.com/docs)
- [Discussions](https://github.com/jarod-rosenthal/workermill/discussions)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=workermill.workermill)

## License

Apache-2.0
