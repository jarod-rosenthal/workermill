***REMOVED*** CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

***REMOVED******REMOVED*** ⛔ Critical Rules - READ FIRST

***REMOVED******REMOVED******REMOVED*** DO NOT CHANGE Working Patterns

**These working solutions must NOT be changed without explicit user request:**

| Pattern | Implementation | Why It's Sacred |
|---------|----------------|-----------------|
| **Log streaming** | PostgreSQL + SSE, NOT CloudWatch | Took a week to get working. Worker posts to `/api/tasks/:taskId/logs`, SSE streams from database every 500ms. |
| **Task orchestration** | Database polling with atomic claim | Polls for queued tasks, claims via UPDATE...WHERE, spawns ECS |
| **Worker entrypoint** | `post_log()` shell function | Posts terminal output to API in real-time |
| **LLM Models** | NEVER change without approval | No default model changes, no provider switches, no model name changes in code/env/config |

**If you think something could be "better" (CloudWatch, WebSockets, etc.), ASK FIRST.**

***REMOVED******REMOVED******REMOVED*** DO NOT Touch the Local Database

**On 2026-02-16, Claude dropped the local PostgreSQL database (`DROP DATABASE workermill`) without permission while debugging a "loading logs" issue. The data only existed locally and was permanently destroyed. This must NEVER happen again.**

- **NEVER** run `DROP DATABASE`, `DROP SCHEMA`, or `TRUNCATE` on any database without explicit user approval
- **NEVER** run destructive SQL commands as a "debugging step" — read-only queries only
- **NEVER** assume a database is empty or broken just because a query returns no results — verify from multiple angles first
- **NEVER** recreate, reset, or wipe a database to "fix" a migration issue — ask the user first
- If the database appears empty or broken, **STOP and ask the user** before taking any action
- The local Docker PostgreSQL (`workermill-local-db` on port 5433) may contain data that does NOT exist anywhere else — treat it as production-critical

***REMOVED******REMOVED******REMOVED*** DO NOT Relax Security

**NEVER, under ANY circumstances, relax, bypass, or weaken security checks:**

- **NEVER** change auth middleware to skip validation
- **NEVER** relax role checks (e.g., `supportAdmin` → `admin || supportAdmin`)
- **NEVER** add "temporary" security bypasses - they WILL ship to production
- **NEVER** disable authentication on endpoints, even for testing

**If you need elevated access:** Set the proper flag/role via migration, not by weakening checks.

**Forbidden patterns:**
- `NODE_TLS_REJECT_UNAUTHORIZED=0`
- Hardcoded credentials
- `Resource: "*"` with destructive IAM actions
- 0.0.0.0/0 security groups for non-public services

***REMOVED******REMOVED******REMOVED*** DO NOT Expose Authenticated Features on Public Pages

**The landing/home page (`LandingV0.tsx`, `Home/v0/Header.tsx`) is PUBLIC — visible to unauthenticated users.** NEVER add links to authenticated features (Docs, Dashboard, Settings, etc.) on public pages.

- **Docs** (`/docs`) are public — accessible without authentication. Linked from landing page nav.
- **Landing page nav** should only contain: Showcase, How It Works, Pricing, Docs, Sign in, Get Started
- If a feature requires login, its link belongs behind auth (sidebar, profile dropdown, dashboard)

***REMOVED******REMOVED******REMOVED*** DO NOT Modify Infrastructure Outside Terraform

**Terraform is the ONLY source of truth. NEVER:**
- Create AWS resources via console
- Manually modify ECS task definitions
- Push Docker images without using `deploy.sh`
- Change security groups, IAM roles, or networking outside Terraform

***REMOVED******REMOVED******REMOVED*** DO NOT Add Labels When Creating Jira Tickets

**Create tickets with NO LABELS.** The `workermill` label triggers automatic AI worker deployment. Adding labels without explicit permission has caused production incidents.

**Only add labels AFTER ticket creation, with explicit user approval.**

***REMOVED******REMOVED******REMOVED*** DO NOT Auto-Process Stale Tasks

When fixing orchestrator bugs:
- Do NOT add code that bulk-processes stuck tasks
- Add staleness checks (skip tasks older than 1 hour)
- Fix the bug for future tasks, leave existing stuck tasks alone
- User controls task execution via dashboard UI

***REMOVED******REMOVED******REMOVED*** DO NOT Use Outdated Bitbucket Auth

**Bitbucket uses Repository Access Tokens, NOT app passwords (deprecated).**

| Use Case | Correct Method |
|----------|----------------|
| REST API | `Authorization: Bearer <token>` |
| Git URLs | `https://x-token-auth:<token>@bitbucket.org/...` |

**WRONG:** `Basic auth with username:app_password` - this is deprecated
**RIGHT:** `Bearer token` for API, `x-token-auth` for git

***REMOVED******REMOVED******REMOVED*** DO NOT Make Changes Without Communicating

- **Before any code change**: Explain what you're about to modify
- **When instructions are unclear**: Ask, don't assume
- **Before deploying**: Wait for explicit approval ("go", "yes", "deploy")
- **Keep changes minimal**: Only do what was asked, nothing extra
- **No silent deployments**: Always state what's being deployed

***REMOVED******REMOVED******REMOVED*** DO NOT Deploy to Dev Environment

**The dev environment (dev.workermill.com) is NOT RUNNING.** Always deploy to prod:
- Use `./deploy.sh --api` (NOT `--env dev`)
- Use `./deploy.sh --frontend` (NOT `--env dev`)
- Use `./deploy.sh --worker` (NOT `--env dev`)

***REMOVED******REMOVED******REMOVED*** DO NOT Release Agent Without Bumping Version

**Always bump `agent/package.json` version before releasing.** The version is embedded at compile time via esbuild `define`. To release: bump version → `git tag agent-v<version>` → `git push --tags` → GitHub Actions builds binaries. npm publish is still supported as a fallback: `cd agent && npm run build && npm publish --access public`.

***REMOVED******REMOVED******REMOVED*** Rebuild After worker/ Changes

Worker code (`worker/epic/*.ts`) is used in TWO places — the Docker image AND the agent binary. Changes to worker code require rebuilding the right artifact depending on which execution path you use.

| Execution path | Where worker code lives | How to rebuild |
|----------------|------------------------|----------------|
| **Remote agent** (production) | Bundled into agent binary at build time (esbuild) | Release new agent binary: bump version → `git tag agent-v<version>` → push |
| **Local WorkerMill Docker** | Docker image compiled by `tsc` | `./bin/local-workermill build-worker` |
| **Cloud ECS** | ECR Docker image | `./deploy.sh --worker` |

| What you want to change | Where to edit | Then what |
|--------------------------|---------------|-----------|
| Worker runtime code | `worker/epic/*.ts` | Rebuild agent binary AND/OR Docker image (see above) |
| Container env vars (local mode) | `api/src/services/local-epic-spawner.ts` (`buildEnvArgs`) | Restart API |
| API-side orchestration | `api/src/services/orchestrator.ts` and modules | Restart API |

---

***REMOVED******REMOVED*** Quick Reference

**Ports:** API: 3001, Frontend: 5173, Local DB: 5433

| Task | Command |
|------|---------|
| Type check API | `cd api && npm run typecheck` |
| Type check frontend | `cd frontend && npx tsc -b` |
| Deploy all (prod) | `./deploy.sh --all` |
| Deploy API (prod) | `./deploy.sh --api` |
| Deploy frontend | `./deploy.sh --frontend` |
| Deploy worker | `./deploy.sh --worker` |
| Create migration | `cd api && npm run migrate:create NAME` |
| Tail API logs | `MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1` |
| Build worker scripts | `cd worker/execution && npm run build` |
| Build workermill-mcp | `cd packages/workermill-mcp && npm run build` |
| Build oncallshift-mcp | `cd packages/oncallshift-mcp && npm run build` |
| Lint API | `cd api && npm run lint` |
| Fix lint (API) | `cd api && npm run lint -- --fix` |
| Lint frontend | `cd frontend && npm run lint` |
| Fix lint (frontend) | `cd frontend && npm run lint -- --fix` |
| Run API tests (Vitest) | `cd api && npm run test` |
| Run single API test | `cd api && npx vitest run src/routes/tasks.test.ts` |
| Run API tests (watch) | `cd api && npm run test:watch` |
| Run API tests (coverage) | `cd api && npm run test:coverage` |
| Run integration tests | `cd api && npm run test:integration` |
| Run E2E tests (Playwright) | `cd frontend && npm run test:e2e` |
| Run E2E tests (headed) | `cd frontend && npm run test:e2e:headed` |
| Run E2E tests (UI mode) | `cd frontend && npm run test:e2e:ui` |
| Seed database | `cd api && npm run seed` |
| Run frontend dev | `cd frontend && npm run dev` |
| Run API dev | `cd api && npm run dev` |
| Install API deps | `cd api && npm install` |
| Install frontend deps | `cd frontend && npm install` |
| Type check agent | `cd agent && npm run typecheck` |
| Agent watch mode | `cd agent && npm run dev` |
| Seed personas only | `cd api && npm run seed:personas` |
| Integration tests (watch) | `cd api && npm run test:integration:watch` |
| **Validated implementation** | `/val-imp [plan-file]` |
| **Start remote agent** | `workermill-agent start` |
| **Install remote agent** | `curl -fsSL https://workermill.com/install.sh \| bash` |
| **Build agent binary** | `cd agent && npm run build && bun build --compile dist/entry.js --outfile dist/bin/workermill-agent` |
| **Release agent binary** | Bump version → `git tag agent-v<version>` → `git push --tags` |
| **Publish agent to npm** | `cd agent && npm run build && npm publish --access public` (fallback) |
| Build VS Code extension | `cd packages/vscode-workermill && npm run build` |
| Watch VS Code extension | `cd packages/vscode-workermill && npm run watch` |
| Package VS Code extension | `cd packages/vscode-workermill && npm run package` |
| Type check VS Code extension | `cd packages/vscode-workermill && npm run typecheck` |

---

***REMOVED******REMOVED*** Project Overview

WorkerMill is mission control for autonomous AI coding agents - a real-time monitoring and orchestration system for AI workers that execute coding tasks ("htop for AI workers"). Deployed at https://workermill.com.

**Stack:**
- **Backend API**: Express + TypeScript + TypeORM + PostgreSQL (`api/`)
- **Frontend**: React 19 + Vite + TailwindCSS + Zustand (`frontend/`)
- **Remote Agent**: Standalone binary CLI + local HTTP API (`agent/`)
- **VS Code Extension**: IDE companion — sidebar tree, activity feed, log terminals (`packages/vscode-workermill/`)
- **Infrastructure**: Terraform → AWS (ECS Fargate, RDS, S3, CloudFront) in us-east-1
- **Worker Containers**: Docker images with Claude Code for task execution (`worker/`)
- **Testing**: Vitest (API unit/integration), Playwright (E2E)

**Requirements:** Node.js >= 20.0.0 (for API/frontend development; the remote agent binary has no Node.js dependency)

**Current Development Phase:** Production deployment testing with **oncallshift** repositories (Bitbucket). Jira tickets from the **OCS** project trigger AI worker tasks against the split repos: `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile`.

***REMOVED******REMOVED******REMOVED*** WorkerMill vs Target Repositories

| Component | Repository | Platform | Purpose |
|-----------|------------|----------|---------|
| **WorkerMill** | `workermill/` (this repo) | GitHub | Orchestration platform - API, dashboard, worker containers |
| **oncallshift-api** | `oncallshift/oncallshift-api` | Bitbucket | Backend API, infrastructure, packages, e2e tests |
| **oncallshift-web** | `oncallshift/oncallshift-web` | Bitbucket | React frontend |
| **oncallshift-mobile** | `oncallshift/oncallshift-mobile` | Bitbucket | React Native mobile app |

- **WorkerMill** is the control plane that spawns and monitors AI workers
- **oncallshift** repos are the applications being built by AI workers
- AI workers execute tasks on oncallshift repos, NOT on WorkerMill itself
- Jira project **OCS** = oncallshift development, **WM** = WorkerMill platform

Workers clone oncallshift repos, make changes, create PRs, and report status back. Cross-repo OCS tickets create separate PRs per repo.

***REMOVED******REMOVED******REMOVED*** Codebase Structure

Focus on these directories (production services):
- `api/` - Backend API deployed to ECS
- `frontend/` - React dashboard deployed to CloudFront
- `worker/` - Worker container images
- `agent/` - Remote agent CLI (standalone binary, published to npm as fallback)
- `packages/vscode-workermill/` - VS Code extension (IDE companion for remote agent)
- `packages/workermill-mcp/` - WorkerMill MCP server (published to npm)
- `packages/oncallshift-mcp/` - OncallShift MCP server (published to npm)

Ignore other `packages/*` directories - original modular architecture, not actively deployed.

User-facing documentation is at https://workermill.com/docs (overview, quick start, integrations, task lifecycle, personas, epics, analytics, MCP, advanced).

---

***REMOVED******REMOVED*** Local Development

Local development uses an SSH bastion to tunnel to the production RDS database. The bastion is a t4g.nano Spot instance (~$0.001/hr) that starts on-demand.

***REMOVED******REMOVED******REMOVED*** Starting Local Dev Environment

```bash
***REMOVED*** 1. Start the bastion (auto-detects and whitelists your IP)
./bin/bastion start

***REMOVED*** 2. Wait ~60 seconds for instance to boot, then check status
./bin/bastion status

***REMOVED*** 3. Create SSH tunnel to RDS (keeps running in foreground)
./bin/bastion ssh

***REMOVED*** 4. In another terminal, get the DB password
aws secretsmanager get-secret-value --secret-id workermill/dev/database-url --query 'SecretString' --output text

***REMOVED*** 5. Run the API locally with tunnel
cd api
DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill npm run dev
```

**Bastion commands:** `start`, `stop`, `status`, `ssh` (port forwarding 5432→RDS), `whitelist`. SSH key: `~/.ssh/workermill-bastion`.

Once tunnel is running, connect via `psql -h localhost -p 5432 -U workermill -d workermill` or `psql-workermill` from the bastion SSH session.

---

***REMOVED******REMOVED*** Local WorkerMill Mode (Docker — Dashboard Only, No VS Code Extension)

Run WorkerMill entirely locally with workers as Docker containers. Uses Claude Max subscription OAuth token for authentication. Tasks are managed via the web dashboard at `localhost:5173` — **the VS Code extension does NOT connect to local WorkerMill** (it requires the remote agent).

**To use VS Code with local development**, run the remote agent pointed at `http://localhost:3001` instead — see "Remote Agent Mode" above.

***REMOVED******REMOVED******REMOVED*** Prerequisites

- Docker (for PostgreSQL)
- Claude CLI: `curl -fsSL https://claude.ai/install.sh | bash` (or `winget install Anthropic.ClaudeCode` on Windows)
- Claude Max subscription

***REMOVED******REMOVED******REMOVED*** Setup

```bash
***REMOVED*** 1. Authenticate with Claude (stores token in ~/.claude/.credentials.json)
claude auth login

***REMOVED*** 2. Create .env.local (token is auto-synced from credentials.json)
cat >> .env.local << EOF
DATABASE_URL=postgresql://workermill:localdev@localhost:5433/workermill
EXECUTION_MODE=local
TARGET_REPO_PATH=../oncallshift-api
EOF

***REMOVED*** 3. Build the worker Docker image (first time only)
./bin/local-workermill build-worker

***REMOVED*** 4. Start local WorkerMill
./bin/local-workermill start
```

**OAuth Token Handling:** The OAuth token is automatically synced from `~/.claude/.credentials.json` at API startup. No need to manually copy tokens. If authentication expires, just run `claude auth login` again.

***REMOVED******REMOVED******REMOVED*** Local WorkerMill Commands

| Command | Description |
|---------|-------------|
| `./bin/local-workermill start` | Start PostgreSQL, API, and frontend |
| `./bin/local-workermill stop` | Stop all services |
| `./bin/local-workermill status` | Show status of all services |
| `./bin/local-workermill create-task "title"` | Create a test task |
| `./bin/local-workermill logs` | Tail logs from all services |
| `./bin/local-workermill sync-data` | Sync data from production (requires bastion) |
| `./bin/local-workermill build-worker` | Build the worker Docker image |

***REMOVED******REMOVED******REMOVED*** Start Options

| Option | Default | Description |
|--------|---------|-------------|
| `--workers N` | 4 | Max concurrent workers |
| `--experts N` | 4 | Max parallel experts per task |
| `--skip-db` | false | Don't start PostgreSQL (use existing) |
| `--skip-fe` | false | Don't start frontend |
| `--no-critic` | false | Disable critic agent review |
| `--no-tech-lead` | false | Disable tech lead review |

***REMOVED******REMOVED******REMOVED*** Local Development Filesystem (CRITICAL — READ THIS)

**Always clone and run WorkerMill from the WSL2 native filesystem (`~/github/workermill`), NOT from `/mnt/c/`.**

The Windows mount (`/mnt/c/`) breaks Linux filesystem watchers (inotify), which means Vite HMR and `tsx watch` cannot detect file changes. Running from the WSL2 native filesystem fixes this — **hot module reload works automatically** with no restart needed.

```bash
***REMOVED*** Correct: WSL2 native filesystem (HMR works)
cd ~/github/workermill
./bin/local-workermill start --skip-db

***REMOVED*** Wrong: Windows mount (HMR broken, requires manual restart)
cd /mnt/c/Users/jarod/github/workermill
```

**After cloning, make scripts executable:** `chmod +x bin/local-workermill bin/bastion`

**Use VS Code Remote - WSL:** Open folders with `code .` from the WSL terminal, or `Ctrl+Shift+P` → "WSL: Open Folder in WSL" in VS Code.

***REMOVED******REMOVED******REMOVED*** Restarting API Without Killing Workers

If you need to restart the API (e.g., after changing env vars or config that `tsx watch` doesn't pick up), **do NOT use `./bin/local-workermill stop`** — it kills the database and any running worker containers.

```bash
***REMOVED*** Kill only API and frontend processes
lsof -ti :3001 2>/dev/null | xargs -r kill -9
lsof -ti :5173 -ti :5174 2>/dev/null | xargs -r kill -9

***REMOVED*** Restart with existing database
./bin/local-workermill start --skip-db
```

**Rules:**
- NEVER change ports (5173 for frontend, 3001 for API)
- NEVER restart the API while a worker container is running a task (it will lose its connection and die)
- After restart, verify frontend is on port 5173: `cat .local-workermill/frontend.log`

***REMOVED******REMOVED******REMOVED*** Remote Agent Mode (PRIMARY — Used by VS Code Extension)

The remote agent is the **primary execution path** for both cloud and local development. The VS Code extension ONLY works through the remote agent — it cannot talk to the local WorkerMill API directly.

**How it works:**
1. Agent binary runs on the user's machine as a background process
2. Agent exposes a local HTTP API on a random port, writes port to `~/.workermill/agent.port`
3. VS Code extension discovers the agent via the port file, connects via HTTP + SSE
4. Agent polls the cloud API (or local API) for tasks, runs planning, spawns workers as native processes
5. Workers are self-invocations of the same binary with `__WORKERMILL_MODE=worker`

**Install (CDN — no GitHub auth needed, repo is private):**
```bash
curl -fsSL https://workermill.com/install.sh | bash   ***REMOVED*** Mac/Linux
irm https://workermill.com/install.ps1 | iex           ***REMOVED*** Windows (PowerShell)
```

**Setup and start:**
```bash
workermill-agent setup    ***REMOVED*** prompts for API URL + API key (or use GitHub SSO via VS Code)
workermill-agent start    ***REMOVED*** starts polling, exposes local API for VS Code
workermill-agent update   ***REMOVED*** self-updates from CDN
```

**Config:** `~/.workermill/config.json` — contains `apiUrl` (cloud or localhost) and `apiKey`.

**CDN distribution:** Agent binaries are hosted on S3/CloudFront at `https://workermill.com/agent/latest/`:
- `workermill-agent-linux-x64`, `workermill-agent-darwin-arm64`, `workermill-agent-darwin-x64`, `workermill-agent-win-x64.exe`
- Version manifest: `https://workermill.com/agent/latest.json` (e.g. `{"version":"0.10.8","tag":"agent-v0.10.8"}`)
- CI workflow (`agent-release.yml`) builds binaries on `agent-v*` tags, uploads to S3, invalidates CloudFront

**Using with local WorkerMill (development):**
```bash
***REMOVED*** Terminal 1: Start local API + DB
./bin/local-workermill start

***REMOVED*** Terminal 2: Run agent pointed at local API
workermill-agent setup   ***REMOVED*** API URL: http://localhost:3001, API key from local org settings
workermill-agent start
```
When pointed at localhost, the agent claims tasks from the local API. **The local orchestrator's claim loop will race with the agent** — you may need to stop the orchestrator (`GET /api/orchestrator/stop`) or set `EXECUTION_MODE=remote` to let the agent handle all claims.

**CRITICAL:** Planning (story decomposition + critic validation) runs ONLY in the remote agent (`agent/src/planner.ts`). Local WorkerMill Docker mode skips planning entirely. If you want planning during local development, use the remote agent pointed at localhost:3001.

***REMOVED******REMOVED******REMOVED*** VS Code Extension (IDE Companion)

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
npm run build      ***REMOVED*** esbuild → dist/extension.js
npm run typecheck   ***REMOVED*** tsc --noEmit
npm run package     ***REMOVED*** → workermill-{version}.vsix
```
- **ALWAYS bump version** in package.json before packaging — VS Code caches extensions by version
- Marketplace publish: `git tag vscode-v{version}` → push to `jarod-rosenthal/workermill` → CI publishes to Marketplace
- Manual install: `code --install-extension workermill-{version}.vsix`
- **Testing is done on a SEPARATE machine** — not the dev machine. Do not assume `~/.workermill/` exists on the test machine.

**Web login (SSO providers):**
- Google (via Cognito), Microsoft (direct OAuth), GitHub (direct OAuth) — all three available on workermill.com login/signup
- GitHub OAuth: `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` env vars in ECS task definition (via Secrets Manager + Terraform)
- GitHub callback: `POST /api/auth/github/callback` — exchanges code, creates Cognito user, stores GitHub PAT
- SSO config: `GET /api/auth/sso-config` returns enabled providers
- VS Code extension onboard endpoints: `POST /api/auth/github-onboard` (sign up), `POST /api/auth/github-signin` (sign in)

***REMOVED******REMOVED******REMOVED*** Local Architecture

API (`tsx watch`) and Frontend (Vite) auto-reload. PostgreSQL and Worker run as Docker containers — **Worker does NOT auto-reload** (see "Rebuild Worker Image" in Critical Rules).

---

***REMOVED******REMOVED*** Deployment

**ALWAYS use `deploy.sh` for ALL deployments.** Never manually build/push Docker images. Commands are in the Quick Reference table above. Run `./deploy.sh --frontend` after UI changes.

***REMOVED******REMOVED******REMOVED*** Worker Image Registry

Worker Docker images are used ONLY by **cloud ECS tasks** and **local WorkerMill Docker mode**. The **remote agent does NOT use Docker** — worker code is bundled into the agent binary at build time.

| Registry | URL | Consumer |
|----------|-----|----------|
| **Private ECR** | `AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/workermill-dev/worker:latest` | Cloud ECS tasks |
| **Local image** | `workermill-worker:local` | Local WorkerMill Docker mode |

- `--worker` pushes to private ECR and updates the ECS task definition
- To update **remote agent** workers: release a new agent binary (the worker code is compiled into it)
- To update **local WorkerMill** workers: `./bin/local-workermill build-worker`

***REMOVED******REMOVED******REMOVED*** Database Migrations

**Migrations run automatically on API startup.**

1. `cd api && npm run migrate:create AddMyNewColumn`
2. Edit the generated file in `api/src/db/migrations/`
3. **CRITICAL:** Register in `api/src/db/connection.ts` (import + add to `migrations` array)
4. Deploy: `./deploy.sh --api`

**Rules:**
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Deploy script validates all migrations are registered

***REMOVED******REMOVED******REMOVED*** Worker Execution Scripts

Worker scripts in `worker/execution/` (TypeScript) compile to `worker/execution-compiled/` (JavaScript).

```bash
cd worker/execution && npm run build   ***REMOVED*** Rebuild and commit compiled output
```

---

***REMOVED******REMOVED*** Git Workflow

**Always work directly on `main` branch.** Do NOT create feature branches.

**Why:** Multiple Claude Code terminals may work simultaneously. Working on `main` ensures all agents see changes immediately.

| Change Type | Visibility |
|-------------|------------|
| Uncommitted file edits | Instant (shared filesystem) |
| Committed changes | Requires `git pull` in other terminals |

**Before changes:** `git pull`
**After changes:** Commit and push promptly

---

***REMOVED******REMOVED*** Jira Integration

***REMOVED******REMOVED******REMOVED*** Triggering AI Workers

Add the `workermill` label to a Jira or GitHub Issue to trigger an AI worker task. **Linear does NOT support label-change webhooks** — Linear's webhook API does not fire events when labels are added/removed from issues. Linear tasks are created via the dashboard **Run Task** button (`POST /api/tasks` in `api/src/routes/tasks/crud.ts`), not via webhooks. The Linear webhook handlers in `linear.ts` exist for status-change events but are rarely the task creation path in practice.

| Label | Purpose |
|-------|---------|
| `workermill` | **Required** - Triggers WorkerMill processing |
| `haiku` / `sonnet` / `opus` | Model override (default: org's `defaultWorkerModel`) |
| `deploy` | Auto-merge PR and deploy without human approval |
| `review` | Require manager review before merge |
| `sdk` | Standard SDK Mode (single-task, no story decomposition) |
| `critic` | Enable Planner-Critic validation |

***REMOVED******REMOVED******REMOVED*** Jira Projects

| Project | Key | Purpose | Target Repos |
|---------|-----|---------|--------------|
| oncallshift | OCS | Primary project for AI worker tasks | `oncallshift-api`, `oncallshift-web`, `oncallshift-mobile` (Bitbucket) |
| WorkerMill | WM | Internal platform tracking | `workermill` (GitHub) |

***REMOVED******REMOVED******REMOVED*** Worker Deployment Workflow

**Standard:** Worker creates PR → outputs `::result::review_requested` → human approves → webhook re-triggers → worker merges & deploys.

**Auto-deploy (with `deploy` label):** Worker creates PR → immediately merges → deploys → outputs `::result::deployed`.

**Webhooks:** All at `https://workermill.com/api/webhooks/{jira,linear,github-issues,github,gitlab,bitbucket}`. Route files in `api/src/routes/webhooks/`.

---

***REMOVED******REMOVED*** Architecture

***REMOVED******REMOVED******REMOVED*** Key Models (`api/src/models/`)

| Model | Purpose |
|-------|---------|
| `WorkerTask` | Task state, cost tracking, git info |
| `WorkerTaskLog` | Terminal log storage for SSE streaming |
| `Organization` | Multi-tenant org support (settings, API keys, billing) |
| `User` | User accounts linked to Cognito |
| `AuditLog` | Security and compliance audit trail |
| `WorkerFileLock` | Multi-worker file locking |
| `WorkerCheckIn` | Worker heartbeat and health tracking |
| `CoordinationFeedItem` | Expert collaboration messages |
| `RemoteAgent` | Remote agent registration and heartbeat tracking |
| `KbBoard`, `KbColumn`, `KbCard` | Kanban board system (Trello-like boards visible on dashboard) |
| `KbComment`, `KbChecklist`, `KbActivity` | Board card details — comments, checklists, activity log |
| `ShowcaseProject` | Public showcase projects on landing page |

***REMOVED******REMOVED******REMOVED*** Key API Routes (`api/src/routes/`)

| Route | Purpose |
|-------|---------|
| `webhooks.ts` | Jira, GitHub, GitLab, BitBucket, Linear receivers |
| `control-center.ts` | Task management and log streaming SSE |
| `tasks.ts` | Worker log ingestion |
| `orchestrator.ts` | Poll loop, system control (start/stop/status) |
| `settings.ts` | Organization settings CRUD |
| `billing.ts` | Stripe billing (Free/Pro/Enterprise plans) |
| `coordination.ts` | Multi-worker file locking |
| `issues.ts` | Jira issue search and project listing (used by VS Code extension) |
| `boards.ts` | Kanban boards CRUD — cards, columns, labels, checklists |
| `remote-agent.ts` | Remote agent registration, heartbeat, task claim/result |
| `worker-decisions.ts` | Worker decision engine API (error classification, quality gates) |
| `prd.ts` | PRD decomposition into board cards |
| `showcase.ts` | Public showcase projects |

***REMOVED******REMOVED******REMOVED*** Task Flow (Three Execution Paths)

**Path 1 — Remote Agent (production + VS Code):**
```
Jira/GitHub webhook ──────┐
VS Code (Run Issue) ──────┤→ Cloud API creates task (status: planning)
Dashboard (Run Task) ─────┘       ↓
                           Remote agent polls /api/agent/poll
                                  ↓
                           Agent claims task → runs planner (Claude CLI)
                                  ↓
                           Critic validates plan (score >= 85/100, max 3 iterations)
                                  ↓
                           Agent posts plan → API sets status: queued
                                  ↓
                           Agent claims queued task → spawns native worker process
                           (__WORKERMILL_MODE=worker, self-invocation of agent binary)
                                  ↓
                           Worker runs Epic Coordinator → experts in parallel
                                  ↓
                           Worker posts ::result:: marker → API updates status
```

**Path 2 — Local WorkerMill Docker (development, NO planning):**
```
Dashboard (localhost:5173) → Local API creates task (status: queued, skips planning)
                                  ↓
                           Local orchestrator polls DB → claims task
                                  ↓
                           local-epic-spawner.ts → Docker container
                           (workermill-worker:local image)
                                  ↓
                           Container runs Epic Coordinator → experts
                                  ↓
                           Worker posts ::result:: → API updates status
```

**Path 3 — Cloud ECS (legacy, requires remote agent for planning):**
```
Task created (status: planning) → Remote agent plans → status: queued
                                  ↓
                           Cloud orchestrator claims → ECS Fargate task
                                  ↓
                           Container runs Epic Coordinator
```

**CRITICAL:** VS Code extension ONLY works with Path 1 (remote agent). It does NOT connect to the local API directly. If you want VS Code + local dev, run the remote agent pointed at `http://localhost:3001`.

***REMOVED******REMOVED******REMOVED*** Worker System

Directives in `worker/directives/` define role-specific behavior:
- `backend_developer/`, `frontend_developer/`, `devops_engineer/`
- `security_engineer/`, `qa_engineer/`, `tech_writer/`, `project_manager/`

See `worker/AGENTS.md` for comprehensive worker instructions.

> **IMPORTANT:** `worker/AGENTS.md` contains instructions for AI workers that execute tasks on **target repositories** (e.g., oncallshift). These workers run inside ECS containers and use execution scripts in `/app/execution-compiled/`. This is **NOT** relevant when Claude Code is working on the WorkerMill codebase itself - those instructions are for the spawned worker containers, not for development work on this repository.

***REMOVED******REMOVED******REMOVED*** Worker Decision Service (IP Protection)

Worker decision logic (error classification, quality gates, review parsing, question routing, provider routing) is served by the API at `/api/worker-decisions/`. All IP lives in `api/src/services/worker-decision-engine.ts`. Workers call via `DecisionClient` (`worker/epic/decision-client.ts`) with 5-retry, circuit breaker, and safe fallbacks.

***REMOVED******REMOVED******REMOVED*** Frontend Architecture

React 19 + Vite + TailwindCSS + Zustand. Routing via React Router v7 (`App.tsx`). Auth via Cognito (token in localStorage). Forms via React Hook Form + Zod.

***REMOVED******REMOVED******REMOVED*** Multi-Provider Support

**AI Providers:** `anthropic` (default), `openai`, `google`, `ollama` — all production. Models discoverable in org settings.

**SCM Providers:** `github` (Bearer token), `gitlab` (PRIVATE-TOKEN), `bitbucket` (Repository Access Token). Each needs credentials in Settings > Integrations. **oncallshift uses Bitbucket.** See Critical Rules for Bitbucket auth details.

---

***REMOVED******REMOVED*** Execution Modes

There are three ways tasks are executed, depending on where the worker runs:

| Environment | Worker runs as | Planning | Docker needed? |
|-------------|---------------|----------|----------------|
| **Remote Agent** (production) | Native process (self-invocation of agent binary) | Yes (agent planner) | **No** |
| **Local WorkerMill** (development) | Docker container (`workermill-worker:local`) | No (skipped) | **Yes** |
| **Cloud ECS** (legacy) | ECS Fargate task | Yes (agent planner, separate step) | Yes (ECR image) |

***REMOVED******REMOVED******REMOVED*** Epic Mode (Anthropic provider)

Planning Agent decomposes task → Epic Coordinator runs → Claude CLI expert subprocesses work in parallel via git worktrees → Coordination feed for collaboration → Consolidated PR.

**Components:** `worker/epic/coordinator.ts`, `executor.ts`, `experts.ts`, `coordination-client.ts`
- In remote agent: compiled into the agent binary at build time (esbuild bundles from TS source)
- In Docker/ECS: compiled by `tsc` during Docker build

***REMOVED******REMOVED******REMOVED*** Multi-Provider Mode (non-Anthropic)

Planning Agent decomposes task → Multi-Expert Coordinator → Vercel AI SDK expert calls work in parallel, each persona routed to configured provider → Coordination feed → Consolidated PR.

**Components:** `worker/multi-expert/index.ts`, `coordination-client.ts`, `worker/agents/ai-sdk-executor.js`

***REMOVED******REMOVED******REMOVED*** Standard SDK Mode (add `sdk` label)

Single-task execution via Claude Agent SDK (no story decomposition).

***REMOVED******REMOVED******REMOVED*** Blocker Handling & Task Communication

Errors auto-retry (up to `blockerMaxAutoRetries`), then escalate to the dashboard (`BlockerAlert` component) with retry/skip/abort options. Key files: `worker/epic/blocker-manager.ts`, `worker/epic/error-classifier.ts`, `api/src/routes/coordination.ts`.

**Task-Scoped Communication:** Talk button sends messages via `POST /api/coordination/commands`. Worker polls `/api/coordination/commands/:taskId/pending`.

---

***REMOVED******REMOVED*** RAG / Codebase Indexing

Vector-based code search using Ollama embeddings (`nomic-embed-text`, 768 dims) + pgvector. Must be enabled per org (`codebase_indexing_enabled`). Key files in `api/src/services/`: `embedding.ts`, `code-chunker.ts`, `codebase-indexer.ts`, `codebase-retriever.ts`, `skill-injector.ts`. Ollama URL: org setting `ollamaBaseUrl` → env `OLLAMA_HOST` → `http://localhost:11434`.

---

***REMOVED******REMOVED*** Common Pitfalls

***REMOVED******REMOVED******REMOVED*** TypeORM `.save()` Clobbers Concurrent Changes

TypeORM `.save(entity)` writes ALL columns, not just changed ones. If you read an entity, do async work, then `.save()`, you'll overwrite any changes made by other processes during that async work. **Use atomic `UPDATE...WHERE` for status transitions after async work:**

```typescript
// WRONG — clobbers concurrent changes
const task = await repo.findOneBy({ id });
task.status = "running";
await repo.save(task); // writes ALL columns from stale read

// RIGHT — atomic update
await repo.update({ id, status: "queued" }, { status: "running" });
```

***REMOVED******REMOVED******REMOVED*** Express Route Ordering with Middleware

`router.use(middleware)` runs for ALL routes defined AFTER it, not just routes in the same file section. If you add a global `router.use(authenticateApiKey)` in a route file, any route defined below it will require API key auth — even if you intended it for JWT/dashboard auth. **Always check route ordering when mixing auth strategies.**

***REMOVED******REMOVED******REMOVED*** Agent Pitfalls

- **Editing `agent/src/` locally does NOTHING to remote agents** — release a new binary. For local development: `cd agent && npm run build && npm link` then restart the agent.
- **Polyglot binary:** Single binary serves CLI/worker/manager via `__WORKERMILL_MODE` env var
- **Remote agent does NOT use Docker** — workers are native process self-invocations of the agent binary
- **Three spawners:** `agent/src/spawner.ts` (remote agent), `api/src/services/local-epic-spawner.ts` (local Docker), ECS (cloud) — always ask which environment before changes
- **VS Code extension REQUIRES the remote agent** — it cannot connect to the local WorkerMill API directly
- **Planning runs ONLY in the remote agent** — local WorkerMill Docker mode and cloud ECS skip planning
- **`dotenv/config` type error is intentional** — optional dependency, do not "fix" by removing or adding to deps

***REMOVED******REMOVED******REMOVED*** Orchestrator Module Architecture

The orchestrator is decomposed into focused modules in `api/src/services/`: `orchestrator.ts` (entry point — poll loop + lifecycle), `task-claimer.ts`, `worker-spawner.ts`, `task-dispatch.ts`, `task-monitor.ts`, `task-cleanup.ts`, `planning-workflow.ts`, `manager-workflow.ts`, `orchestrator-utils.ts`. Edit the relevant module — `orchestrator.ts` is just the coordination hub.

***REMOVED******REMOVED******REMOVED*** Planner Architecture (v0.8.0)

The remote agent (`agent/src/planner.ts`) clones the target repo and runs a single Claude CLI planner with `cwd` pointed at the clone. Critic validates the plan (max 3 iterations). Dynamic file cap per story: **5**/**6**/**8** files based on description length.

**Key constraints — do NOT change without asking:**
- Critic approval threshold: **85**/100
- Prompts go via **stdin** (same as `runClaudeCli`), NOT via `-p` CLI arg
- CLI spawn must include `--verbose` flag (required for `--output-format stream-json`)

***REMOVED******REMOVED******REMOVED*** Heartbeat Must Always Update

The agent heartbeat endpoint must ALWAYS update `remote_agents.last_heartbeat_at` even when there are 0 active tasks. Otherwise the orchestrator thinks the agent is offline and starts claiming tasks itself.

---

***REMOVED******REMOVED*** Infrastructure

***REMOVED******REMOVED******REMOVED*** Environment Configuration

**Production** (`environments/prod/`) - workermill.com — AWS account AWS_ACCOUNT_ID, us-east-1. ECS cluster is `workermill-dev` (historical naming).

***REMOVED******REMOVED******REMOVED*** Terraform Commands

```bash
cd infrastructure/terraform/environments/prod
terraform init -backend-config="bucket=workermill-terraform-state-AWS_ACCOUNT_ID"
terraform plan && terraform apply
```

No `-var` flags needed — defaults in `variables.tf`. **Dev environment is NOT running** (see Critical Rules).

***REMOVED******REMOVED******REMOVED*** SES Email Configuration

**Cross-region:** Outbound email uses **us-east-2** SES (production sending access). Inbound uses us-east-1. Do not change this. Templates in `api/src/services/email.ts`.

---

***REMOVED******REMOVED*** Troubleshooting

```bash
***REMOVED*** View ECS service status
aws ecs describe-services --cluster workermill-dev --services workermill-dev-api --region us-east-1

***REMOVED*** Tail API logs (use MSYS_NO_PATHCONV=1 in Git Bash)
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/api" --follow --region us-east-1

***REMOVED*** Tail worker logs
MSYS_NO_PATHCONV=1 aws logs tail "/ecs/workermill-dev/worker" --follow --region us-east-1

***REMOVED*** Database access via bastion (preferred)
./bin/bastion start && sleep 60 && ./bin/bastion ssh
***REMOVED*** Then in SSH session: psql-workermill

***REMOVED*** Alternative: Database access via ECS exec
MSYS_NO_PATHCONV=1 aws ecs list-tasks --cluster workermill-dev --region us-east-1
***REMOVED*** Then: aws ecs execute-command --container api
```

***REMOVED******REMOVED******REMOVED*** Common Issues

| Problem | Check |
|---------|-------|
| Task stuck "running" | `aws ecs list-tasks`, CloudWatch for exit 137 (Spot) or exit 1 |
| Worker not posting logs | Verify org `apiKey` set, check worker logs for POST errors |
| Task not claimed | `GET /api/orchestrator/status`, verify task status is `queued` |
| PR not created | Branch conflicts, token permissions, rate limits |
| Epic not progressing | `GET /api/coordination/feed/:taskId`, verify planning agent completed |
| Bastion SSH timeout | Run `./bin/bastion whitelist` to update SG with current IP |
| Bastion can't reach RDS | Check RDS SG includes bastion SG: `aws ec2 describe-security-groups --group-ids sg-0c7c9a0e3e60d8cab` |
| psql not found on bastion | User data may have failed; run `sudo dnf install -y postgresql16` |

***REMOVED******REMOVED******REMOVED*** Windows/Git Bash

| Issue | Solution |
|-------|----------|
| AWS CLI path conversion | Prefix with `MSYS_NO_PATHCONV=1` |
| AWS CLI Unicode errors | Set `PYTHONIOENCODING=utf-8` |
| Shell parsing errors with `$(...)` | Spawn a Task agent instead of debugging |
| Docker layer caching | deploy.sh uses `--no-cache` - NEVER build with cache |

---

***REMOVED******REMOVED*** Testing

***REMOVED******REMOVED******REMOVED*** E2E Tests (Playwright)

E2E tests run on ephemeral ECS Fargate Spot runners. Location: `frontend/e2e/`. Triggered via GitHub Actions → CI/CD Pipeline → Run workflow (manual checkbox).

***REMOVED******REMOVED******REMOVED*** Integration Tests (Vitest)

Location: `api/src/__tests__/integration/`. Each test runs in a transaction that rolls back after completion. Triggered via GitHub Actions (manual checkbox).

***REMOVED******REMOVED******REMOVED*** CI/CD Workflows

| Workflow | Trigger | Repo | Purpose |
|----------|---------|------|---------|
| `ci-cd.yml` | Manual (workflow_dispatch) | both | Main pipeline — lint, test, deploy |
| `agent-release.yml` | `agent-v*` tags | `workermill/workermill` | Build 4 platform binaries → upload to S3 CDN + GitHub Release |
| `vscode-release.yml` | `vscode-v*` tags | `jarod-rosenthal/workermill` | Package → publish to VS Code Marketplace |

No automatic triggers on push/PR.

***REMOVED******REMOVED******REMOVED*** GitHub Repositories

| Repo | Purpose | Secrets |
|------|---------|---------|
| `jarod-rosenthal/workermill` | Development (public) | `VSCE_PAT` (Marketplace publish) |
| `workermill/workermill` | Production (private) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (S3 CDN upload) |

Both repos share the same code. Push to both: `git push origin main && git push upstream main`.
Git remote `origin` = `jarod-rosenthal/workermill`, `upstream` = `workermill/workermill`.

---

***REMOVED******REMOVED*** Hooks & Skills

**Auto-formatting:** Prettier runs automatically after Write/Edit to `.ts`/`.tsx`/`.js`/`.jsx` files.

***REMOVED******REMOVED******REMOVED*** /val-imp

Enforces strict plan adherence: extracts requirements, implements one at a time, spawns independent validator agent after each.

**Usage:** `/val-imp docs/my-feature-plan.md`

---

***REMOVED******REMOVED*** MCP Tools Available

MCP servers: `workermill` (task management, orchestrator, codebase RAG), `github`, `jira`, `ollama`, `oncallshift`. Tools are auto-discoverable.

**Codebase RAG** (WorkerMill MCP): `workermill_codebase_search` (semantic search, use `multiQuery: true` for broader recall), `workermill_codebase_symbol`, `workermill_codebase_file`, `workermill_codebase_index`, `workermill_codebase_status`. Requires Ollama + `nomic-embed-text` + `codebaseIndexingEnabled: true` in org settings.
