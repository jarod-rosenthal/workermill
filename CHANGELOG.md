# Changelog

All notable user-facing changes to WorkerMill are documented in this file.

This changelog covers the last 10 agent releases and last 5 VS Code extension releases. Older releases can be found in the git history via `git tag -l 'agent-v*'` and `git tag -l 'vscode-v*'`.

---

## Agent Releases

### agent-v0.10.275 (2026-03-19)

#### Features
- Add Local Development option to VS Code onboarding flow
- Add Get Started walkthrough to VS Code extension
- Default local dev to auto-login (no Cognito required)
- Auto-detect local auth mode when connecting to local instance
- Add Sign in with Email option for local dev connections
- Linear status sync support
- Add rich GitHub markdown comment formatters to TicketOps

#### Fixes
- Accept any API key in local mode; rename "Cancel Task" to "Stop Task"
- Connect to Local Instance uses self-hosted key directly without SSO
- Bitbucket mergeable returns null instead of hardcoded true
- Bitbucket merge conflict detection via diffstat status field
- Local dev auto-login uses admin@localhost, not random admin
- Warn users about setup before connecting to local instance
- Warn before overwriting existing config when connecting to local instance
- Integration audit for SCM providers, webhooks, and worker decisions
- GitLab merge_status deprecation fix
- Source ~/.profile instead of ~/.workermill/env for infra vars

#### Other
- Split coordinator.ts into focused modules
- Extract shared API client factory for worker modules
- Replace `any` with proper types in API services and routes
- Split MainDashboard.tsx into hooks and components
- Plan-gating removal, auth fix, pricing cleanup
- Comprehensive documentation audit and correction

### agent-v0.10.274 (2026-03-18)

#### Fixes
- Resolve TypeScript errors in worker Docker build
- Reduce Docker image pull interval from 4h to 30m

### agent-v0.10.273 (2026-03-18)

#### Fixes
- Store githubParentIssueNumber in /run-file jiraFields

### agent-v0.10.272 (2026-03-18)

#### Features
- Add "View in GitHub" link on board page for github-issues orgs
- Wire GitHubCommentFormat into coordinator milestone comments

#### Other
- Clean up post-standalone removal tech debt

### agent-v0.10.271 (2026-03-18)

#### Features
- GitHub Issues integration: create parent issues from PRDs, child issues at dispatch time
- GitHub Issues creation service with sub-issues support
- Add `Closes #issue` to PR body for GitHub Issues tasks
- /run-file creates GitHub Issue when org uses github-issues tracker

#### Fixes
- Open GitHub Issue URL instead of broken board link for github-issues orgs
- Replace KbCard-based PRD dedup with WorkerTask-based dedup in GitHub webhook
- Normalize TICKET_SYSTEM env var for workers (map github-issues to github)
- Strip GH- prefix in ticket-ops GitHub API calls
- Align board-execution tests with serial execution + boardExecutionId guard

#### Other
- Remove standalone mode entirely (docker-compose, VS Code extension, API auth bypass, config, types, and bootstrap scripts)

### agent-v0.10.270 (2026-03-18)

#### Fixes
- Abstract Jira labels; skip GitHub PR review for Bitbucket

### agent-v0.10.269 (2026-03-18)

#### Fixes
- Send email field when saving Bitbucket credentials (cloud mode)

### agent-v0.10.268 (2026-03-18)

#### Fixes
- Unify Bitbucket REST API auth to always use Basic email:token

### agent-v0.10.267 (2026-03-18)

#### Fixes
- Replace all x-token-auth with x-bitbucket-api-token-auth for Bitbucket git operations

### agent-v0.10.266 (2026-03-18)

#### Fixes
- Simplify Bitbucket auth to always use x-bitbucket-api-token-auth for git
- Use email (not username) for Bitbucket API auth

---

## VS Code Extension Releases

### vscode-v0.2.133 (2026-03-19)

#### Features
- Linear status sync support

#### Fixes
- Accept any API key in local mode; rename "Cancel Task" to "Stop Task"
- Self-hosted key bypass for local dev API key authentication

#### Other
- Extract shared API client factory for worker modules
- Plan-gating removal, auth fix, pricing cleanup

### vscode-v0.2.132 (2026-03-18)

#### Fixes
- Connect to Local Instance uses self-hosted key directly, no SSO required

### vscode-v0.2.131 (2026-03-18)

#### Features
- Auto-detect local auth mode when connecting to local instance

#### Fixes
- Bitbucket mergeable returns null instead of hardcoded true

### vscode-v0.2.130 (2026-03-18)

#### Fixes
- Warn before overwriting existing config when connecting to local instance

### vscode-v0.2.129 (2026-03-18)

#### Features
- Local dev connect writes config automatically
- Add Sign in with Email option
- Default local dev to auto-login (no Cognito required)

#### Fixes
- Bitbucket merge conflict detection via diffstat status field
- Local dev auto-login uses admin@localhost, not random admin
