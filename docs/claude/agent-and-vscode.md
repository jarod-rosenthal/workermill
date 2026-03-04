# Remote Agent & VS Code Extension

## Remote Agent Mode (PRIMARY — Used by VS Code Extension)

The remote agent is the **primary execution path** for both cloud and local development. The VS Code extension ONLY works through the remote agent — it cannot talk to the local WorkerMill API directly.

**How it works:**
1. Agent binary runs on the user's machine as a background process
2. Agent exposes a local HTTP API on a random port, writes port to `~/.workermill/agent.port`
3. VS Code extension discovers the agent via the port file, connects via HTTP + SSE
4. Agent polls the cloud API (or local API) for tasks, runs planning, spawns workers as native processes
5. Workers are self-invocations of the same binary with `__WORKERMILL_MODE=worker`

**Install (CDN — no GitHub auth needed, repo is private):**
```bash
curl -fsSL https://workermill.com/install.sh | bash   # Mac/Linux
irm https://workermill.com/install.ps1 | iex           # Windows (PowerShell)
```

**Setup and start:**
```bash
workermill-agent setup    # prompts for API URL + API key (or use GitHub SSO via VS Code)
workermill-agent start    # starts polling, exposes local API for VS Code
workermill-agent update   # self-updates from CDN
```

**Config:** `~/.workermill/config.json` — contains `apiUrl` (cloud or localhost) and `apiKey`.

**CDN distribution:** Agent binaries are hosted on S3/CloudFront at `https://workermill.com/agent/latest/`:
- `workermill-agent-linux-x64`, `workermill-agent-darwin-arm64`, `workermill-agent-darwin-x64`, `workermill-agent-win-x64.exe`
- Version manifest: `https://workermill.com/agent/latest.json` (e.g. `{"version":"0.10.24","tag":"agent-v0.10.24"}`)
- CI workflow (`agent-release.yml`) builds binaries on `agent-v*` tags, uploads to S3, invalidates CloudFront

**Using with local WorkerMill (development):**
```bash
# Terminal 1: Start local API + DB
./bin/local-workermill start

# Terminal 2: Run agent pointed at local API
workermill-agent setup   # API URL: http://localhost:3001, API key from local org settings
workermill-agent start
```
When pointed at localhost, the agent claims tasks from the local API. **The local orchestrator's claim loop will race with the agent** — you may need to stop the orchestrator (`GET /api/orchestrator/stop`) or set `EXECUTION_MODE=remote` to let the agent handle all claims.

**CRITICAL:** Planning (story decomposition + critic validation) runs ONLY in the remote agent (`agent/src/planner.ts`). Local WorkerMill Docker mode skips planning entirely. If you want planning during local development, use the remote agent pointed at localhost:3001.

---

## VS Code Extension (IDE Companion)

The VS Code extension (`packages/vscode-workermill/`) connects to the remote agent's local API via `~/.workermill/agent.port` (HTTP + SSE). Provides sidebar tree (Active/Backlog/Recent), activity feed, and pseudoterminal log tabs.

**CRITICAL: The extension REQUIRES the remote agent.** It cannot connect to the local WorkerMill API directly. All task operations go: VS Code → Agent Local API → Cloud/Local API.

**Architecture:**
- `src/extension.ts` — activation, command registration, context key setup
- `src/team-tree.ts` — TreeDataProvider for sidebar (tasks, issues, onboarding)
- `src/agent-client.ts` — HTTP + SSE client to agent local API
- `src/agent-installer.ts` — binary download from CDN, start/stop, config check
- `src/github-onboard.ts` — onboarding flow (GitHub sign up/in, API key entry)
- `src/feed-view.ts` — activity webview, `src/status-bar.ts`, `src/notifications.ts`
- `src/log-terminal.ts` — pseudoterminal log tabs
- `src/live-diff-panel.ts` — live code changes panel
- `src/task-detail-panel.ts` — task detail webview

**Onboarding flow (fresh install, no `~/.workermill/config.json`):**
1. User installs extension from Marketplace (or `.vsix`), opens WorkerMill sidebar
2. `viewsWelcome` shows: "Create Account" / "I have an API key" / "Sign In"
3. "Create Account" → VS Code built-in GitHub auth → `POST /api/auth/github-onboard` → creates account + org + returns API key
4. "Sign In" → VS Code built-in GitHub auth → `POST /api/auth/github-signin` → returns API key for existing account
5. "I have an API key" → manual input → `GET /api/agent/config` to validate
6. All paths → `writeAgentConfig()` → download agent binary from CDN → start agent → connect

**Welcome view implementation:**
- Uses VS Code `viewsWelcome` in `package.json` with two entries: unconfigured (sign up/in) and configured-but-disconnected (start/install agent)
- `when` clauses use context keys: `workermill.agentConfigured` and `workermill.agentConnected`
- `getChildren()` in `team-tree.ts` returns `[]` (empty array) when `!this.connected` — this triggers viewsWelcome
- `isAgentConfigured()` checks `~/.workermill/config.json` exists (Windows: `%USERPROFILE%\.workermill\config.json`)

**Build & release:**
```bash
cd packages/vscode-workermill
npm run build      # esbuild → dist/extension.js
npm run typecheck   # tsc --noEmit
npm run package     # → workermill-{version}.vsix
```
- **ALWAYS bump version** in package.json before packaging — VS Code caches extensions by version
- Marketplace publish: `git tag vscode-v{version}` → `git push origin vscode-v{version}` → CI publishes to Marketplace
- Manual install: `code --install-extension workermill-{version}.vsix`
- **Testing is done on a SEPARATE machine** — not the dev machine. Do not assume `~/.workermill/` exists on the test machine.

**Web login (SSO providers):**
- Google (via Cognito), Microsoft (direct OAuth), GitHub (direct OAuth) — all three available on workermill.com login/signup
- GitHub OAuth: `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` env vars in ECS task definition (via Secrets Manager + Terraform)
- GitHub callback: `POST /api/auth/github/callback` — exchanges code, creates Cognito user, stores GitHub PAT
- SSO config: `GET /api/auth/sso-config` returns enabled providers
- VS Code extension onboard endpoints: `POST /api/auth/github-onboard` (sign up), `POST /api/auth/github-signin` (sign in)
