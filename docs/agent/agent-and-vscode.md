# Agent & VS Code Extension

## Overview

The WorkerMill agent is a standalone binary that runs on your machine. It has two operating modes:

| Mode | Storage | Cloud dependency | Setup |
|------|---------|-----------------|-------|
| **Standalone** (default) | Local SQLite (`~/.workermill/data.db`) | None — fully offline | `workermill-agent init --standalone` |
| **Cloud** | PostgreSQL via WorkerMill API | Requires WorkerMill account | `workermill-agent setup` |

The VS Code extension connects to the agent's local HTTP API in both modes. It never talks to any cloud API directly — all communication goes through the agent.

---

## Standalone Mode (Default — No Account Required)

The agent runs entirely on your machine. All state lives in a local SQLite database. Tasks are orchestrated by an event-driven local orchestrator (no polling). Workers are spawned as child processes (self-invocations of the same binary with `__WORKERMILL_MODE=worker`).

**How it works:**
1. Agent binary starts, initializes `LocalBackend` (SQLite at `~/.workermill/data.db`)
2. Starts a local HTTP + SSE server on `localhost`, writes port to `~/.workermill/agent.port`
3. VS Code extension discovers agent via port file, connects via HTTP + SSE
4. Tasks created from VS Code → agent orchestrator picks them up immediately (event-driven)
5. Agent spawns worker processes, streams logs back to VS Code in real time

**Install:**
```bash
curl -fsSL https://workermill.com/install.sh | bash   # Mac/Linux
irm https://workermill.com/install.ps1 | iex           # Windows (PowerShell)
```

**Setup:**
```bash
workermill-agent init --standalone
```

Zero-friction: auto-detects Anthropic API key (from `ANTHROPIC_API_KEY` env var or `~/.claude/.credentials.json`), GitHub token (from `gh auth token` or `GH_TOKEN`/`GITHUB_TOKEN`), and target repo (from `git remote` in CWD). Only prompts for what's missing.

**Config:** `~/.workermill/config.json` with `"mode": "standalone"`. Key fields:

```jsonc
{
  "mode": "standalone",
  "roles": {
    "planner":  { "provider": "anthropic", "model": "claude-opus-4-6" },
    "worker":   { "provider": "anthropic", "model": "claude-sonnet-4-6" },
    "techLead": { "provider": "anthropic", "model": "claude-opus-4-6" }
  },
  "scm": { "provider": "github", "token": "..." },
  "issueTracker": { "provider": "internal" },
  "defaultRepo": "https://github.com/org/repo",
  "sandbox": "docker",
  "settings": {
    "maxParallelExperts": 4,
    "maxStories": 8,
    "pushAfterCommit": true
  }
}
```

**API key resolution order:** explicit key in config → legacy `llm.apiKey` → env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) → Claude OAuth (`~/.claude/.credentials.json`).

**Standalone CLI commands:**
```bash
workermill-agent init --standalone             # One-time setup
workermill-agent start                          # Start agent (auto-detects mode)
workermill-agent run --task "Add login page"    # One-shot task execution
workermill-agent prd --file requirements.md     # Decompose PRD into board cards
workermill-agent status                         # Show agent status
workermill-agent logs [-n N]                    # Tail agent logs
workermill-agent stop                           # Stop the agent
```

---

## Cloud Mode (WorkerMill Account)

The agent connects to the WorkerMill cloud API (or a self-hosted instance), polls for tasks, and reports results back. Used for team-based workflows with Jira/Linear integration, dashboards, and multi-user coordination.

**How it works:**
1. Agent registers with cloud API at startup
2. Polls `/api/agent/poll` for tasks, sends heartbeats
3. Claims tasks via `/api/agent/claim` (atomic)
4. Runs planning (Claude CLI), posts plan back to API
5. Spawns native worker processes or Docker sandbox containers
6. Workers report logs + results to cloud API

**Setup:**
```bash
workermill-agent setup    # Prompts for API URL + API key (or use GitHub SSO via VS Code)
workermill-agent start    # Starts polling
workermill-agent update   # Self-updates from CDN
```

**Config:** `~/.workermill/config.json` with `"mode": "cloud"`, `apiUrl`, and `apiKey`.

**CDN distribution:** Agent binaries hosted at `https://workermill.com/agent/latest/`:
- `workermill-agent-linux-x64`, `workermill-agent-darwin-arm64`, `workermill-agent-darwin-x64`, `workermill-agent-win-x64.exe`
- Version manifest: `https://workermill.com/agent/latest.json`
- CI workflow (`agent-release.yml`) builds binaries on `agent-v*` tags

**Using with local WorkerMill API (development):**
```bash
# Terminal 1: Start local API + DB
./bin/local-workermill start

# Terminal 2: Run agent pointed at local API
workermill-agent setup   # API URL: http://localhost:3001, API key from local org settings
workermill-agent start
```

When pointed at localhost, the agent claims tasks from the local API. The local orchestrator's claim loop will race with the agent — you may need to stop the orchestrator (`GET /api/orchestrator/stop`) or set `EXECUTION_MODE=remote` to let the agent handle all claims.

**CRITICAL:** Planning (story decomposition + critic validation) runs ONLY in the agent (`agent/src/planner.ts`). Local WorkerMill Docker mode skips planning entirely. If you want planning during local development, use the agent pointed at localhost:3001.

---

## Backend Abstraction Layer

The agent uses a backend abstraction (`agent/src/backends/`) to support both modes:

```
backends/
  types.ts          — AgentBackend interface (27+ methods)
  selector.ts       — Reads config, returns CloudBackend or LocalBackend
  cloud/index.ts    — CloudBackend (wraps cloud API + poller)
  local/
    config.ts       — StandaloneConfig, resolveApiKey, isStandaloneReady, isCloudMode
    db.ts           — SQLite via better-sqlite3 (WAL mode)
    event-bus.ts    — In-process EventEmitter (replaces Redis pub/sub)
    orchestrator.ts — Event-driven task dispatch, worker process management
    index.ts        — LocalBackend (full AgentBackend implementation)
```

| Aspect | Standalone (LocalBackend) | Cloud (CloudBackend) |
|--------|--------------------------|---------------------|
| Storage | SQLite (`~/.workermill/data.db`) | PostgreSQL |
| Real-time events | In-process EventEmitter | Redis pub/sub |
| Task orchestration | Event-driven (immediate) | DB polling + atomic claim |
| Credentials | Config file / env / Claude OAuth | `org_credentials` DB table |
| Planning | Local (same process) | Cloud API |
| Web dashboard | Not available (VS Code only) | Available |
| Webhooks (Jira, GitHub) | Not available | Available |
| Codebase indexing (RAG) | Not available | Available |

---

## VS Code Extension

The extension (`packages/vscode-workermill/`) connects to the agent's local HTTP API via `~/.workermill/agent.port`. Works identically in both standalone and cloud modes.

**Architecture:**
- `src/extension.ts` — Activation, command registration, context key setup
- `src/team-tree.ts` — TreeDataProvider for sidebar (tasks, issues, onboarding)
- `src/agent-client.ts` — HTTP + SSE client to agent local API (reads `mode` from `/api/status`)
- `src/agent-installer.ts` — Binary download from CDN, start/stop, config check
- `src/github-onboard.ts` — Cloud onboarding flow (GitHub sign up/in, API key entry)
- `src/settings-panel.ts` — Full settings WebView with standalone/cloud-specific paths
- `src/secret-storage.ts` — API key migration to VS Code SecretStorage + OS keychain
- `src/feed-view.ts` — Activity webview
- `src/status-bar.ts` — Mode-aware status bar (shows "Standalone" suffix in standalone mode)
- `src/notifications.ts` — Task notifications
- `src/log-terminal.ts` — Pseudoterminal log tabs
- `src/live-diff-manager.ts` — Live code changes virtual document provider
- `src/task-detail-panel.ts` — Task detail webview

**Onboarding flow (fresh install, no `~/.workermill/config.json`):**

The `viewsWelcome` shows standalone mode first:

1. **"Get Started — Standalone Mode (BYOK)"** → Opens terminal, runs `workermill-agent init --standalone` → Polls for config file → Auto-starts agent → Connects
2. **"Sign in with GitHub"** (cloud) → VS Code GitHub auth → `POST /api/auth/github-onboard` → Creates account + returns API key → Downloads agent → Starts → Connects
3. **"Sign In with Email / Google"** (cloud) → Similar flows
4. **"Manual Setup (API key)"** → Manual input → Validates via `GET /api/agent/config`

All paths end with: `writeAgentConfig()` → download agent binary (if needed) → start agent → connect.

**Welcome view context keys:**
- `workermill.agentConfigured` — `~/.workermill/config.json` exists
- `workermill.agentConnected` — SSE connection to agent is active

**Settings panel:** In standalone mode, all settings read/write directly to `~/.workermill/config.json`. Supports per-role model configuration, SCM provider setup, issue tracker selection (internal boards, Jira, Linear, GitHub Issues), and worker behavior settings. Cloud-only features show "Not available in standalone mode".

**Mode switching:** The settings panel has a "Workspace Mode" toggle (Cloud ↔ Standalone) that rewrites the config file and restarts the agent.

**Build & release:**
```bash
cd packages/vscode-workermill
npm run build      # esbuild → dist/extension.js
npm run typecheck   # tsc --noEmit
npm run package     # → workermill-{version}.vsix
```
- **ALWAYS bump version** in package.json before packaging — VS Code caches extensions by version
- Marketplace publish: `git tag vscode-v{version}` → `git push origin vscode-v{version}` → CI publishes
- Manual install: `code --install-extension workermill-{version}.vsix`
- **Testing is done on a SEPARATE machine** — not the dev machine. Do not assume `~/.workermill/` exists on the test machine.

**Web login (cloud mode SSO):**
- Google (via Cognito), Microsoft (direct OAuth), GitHub (direct OAuth)
- GitHub OAuth: `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` env vars
- GitHub callback: `POST /api/auth/github/callback`
- VS Code onboard endpoints: `POST /api/auth/github-onboard` (sign up), `POST /api/auth/github-signin` (sign in)
