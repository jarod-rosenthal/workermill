# SCM Token Onboarding Design

**Date:** 2026-02-25
**Status:** Approved
**Goal:** Users never leave VS Code to become productive. SCM access is configured during onboarding, not as a separate web dashboard step.

---

## Problem

1. **GitHub SSO overwrites PATs:** When a user signs in via GitHub SSO (VS Code or web), the OAuth token is saved to `github-token` in org secrets, overwriting any manually-configured PAT. The OAuth token doesn't reliably clone repos, breaking the planning agent.
2. **SCM setup is disconnected from onboarding:** Users sign up, then must separately navigate to the web dashboard (Settings > Integrations) to paste a GitHub PAT. Many users don't do this and hit clone failures on their first task.
3. **No GitHub App option:** Users must manage PATs manually. GitHub Apps provide zero-friction repo access with auto-rotating tokens.

## Design

### Phase 0: Bug Fix — Stop Overwriting PATs

Remove `saveOrgSecret(org.id, "github-token", githubToken, ...)` from all sign-in endpoints in `api/src/routes/auth.ts`:

| Line | Endpoint | Action |
|------|----------|--------|
| 2264 | `POST /api/auth/github-sso-callback` (web signup) | Remove — transition to SCM setup instead |
| 2286 | `POST /api/auth/github-sso-callback` (web signin) | Remove entirely |
| 2469 | `POST /api/auth/github-onboard` (VS Code signup) | Remove — transition to SCM setup instead |
| 2603 | `POST /api/auth/github-signin` (VS Code signin) | Remove entirely |

The OAuth token from GitHub SSO is used **only** for identity verification (fetching user profile/email). It is never saved as `github-token`.

### Phase 1: Pre-filled PAT URL (immediate fix)

After GitHub SSO completes in VS Code, prompt the user for SCM access before finishing setup.

#### VS Code Extension Flow (`github-onboard.ts`)

After SSO succeeds (both `signUpWithGitHub` and `signInWithGitHub`), before calling `finishSetup()`:

```
QuickPick: "WorkerMill needs access to your repositories"

Options:
  1. "Install GitHub App (Recommended)" — one-click, no tokens to manage
  2. "Use a Personal Access Token" — classic PAT with repo scope
  3. "Skip for now" — configure later in Settings
```

**PAT path:**
1. `vscode.env.openExternal()` → `https://github.com/settings/tokens/new?scopes=repo,workflow&description=WorkerMill%20Agent`
2. `vscode.window.showInputBox()` → "Paste your GitHub Personal Access Token"
3. `POST /api/agent/configure-scm { token, provider: "github" }` → API validates token via `GET https://api.github.com/user` with it, then saves to org secrets as `github-token`
4. Show success notification

**Skip path:**
1. Continue without SCM. Agent starts normally.
2. When agent encounters a clone failure, surface VS Code notification: "Repository access not configured — run 'WorkerMill: Configure Repository Access' to fix"
3. Register a VS Code command `workermill.configureScm` that re-opens the QuickPick above

#### New API Endpoint: `POST /api/agent/configure-scm`

- Auth: `authenticateApiKey`
- Body: `{ token: string, provider: "github" | "bitbucket" | "gitlab" }`
- Validates the token against the provider's API (e.g., `GET /user` for GitHub)
- Saves to org secrets as `github-token` (or `scm-credentials` for bitbucket/gitlab)
- Returns `{ configured: true, username: "..." }`

#### New API Endpoint: `GET /api/agent/scm-status`

- Auth: `authenticateApiKey`
- Returns `{ configured: boolean, provider: string | null, username: string | null }`
- Checks if `github-token` exists in secrets (or `githubAppInstallationId` is set)

### Phase 2: GitHub App (zero friction)

#### GitHub App Configuration

Create a GitHub App on `github.com/organizations/workermill/settings/apps`:

- **Name:** WorkerMill Agent
- **Permissions:**
  - Repository: `contents: read/write`, `pull_requests: read/write`, `metadata: read`
  - Organization: `members: read` (optional, for team features)
- **Webhook URL:** `https://workermill.com/api/webhooks/github-app`
- **Callback URL:** `https://workermill.com/api/auth/github-app-callback`
- **Setup URL:** `https://workermill.com/api/auth/github-app-callback` (with "Redirect on update" enabled)
- **User authorization:** Not required (we use SSO separately)

#### Database Changes

**Migration: `AddGithubAppInstallationId`**

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS github_app_installation_id INTEGER;
```

#### New Service: `api/src/services/github-app.ts`

```typescript
// Cache installation tokens (1hr expiry, refresh 5min before expiry)
const tokenCache = new Map<number, { token: string; expiresAt: Date }>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return cached.token;
  }

  // Generate JWT from App private key, call GitHub API
  // POST /app/installations/{installation_id}/access_tokens
  // Returns { token, expires_at, permissions, repositories }
  const { token, expires_at } = await githubApi.createInstallationToken(installationId);
  tokenCache.set(installationId, { token, expiresAt: new Date(expires_at) });
  return token;
}
```

**App credentials** stored in AWS Secrets Manager:
- `workermill/{env}/github-app-id` — App ID
- `workermill/{env}/github-app-private-key` — PEM private key for JWT signing

#### New API Endpoints

**`GET /api/auth/github-app-callback`**

- Receives `installation_id` and `setup_action` from GitHub after App install
- Matches the installing user to a WorkerMill org (via GitHub username from the installation event)
- Saves `installation_id` to `organizations.github_app_installation_id`
- Redirects to `vscode://workermill.workermill/scm-configured?method=github-app`

**`POST /api/webhooks/github-app`**

- Handles `installation.deleted` → clear `github_app_installation_id` from org
- Handles `installation.suspend` → same
- Validates webhook signature using App webhook secret

#### VS Code Extension — GitHub App Path

1. User selects "Install GitHub App" from QuickPick
2. `vscode.env.openExternal()` → `https://github.com/apps/workermill-agent/installations/new`
3. User selects repos on GitHub → GitHub redirects to callback → callback redirects to `vscode://` URI
4. VS Code URI handler receives `scm-configured` → shows success notification
5. Fallback: if URI handler doesn't fire within 60s, poll `GET /api/agent/scm-status` every 5s until `configured: true`

#### Integration with `getOrgCredentials()`

Update `api/src/services/org-credentials.ts` to use installation tokens:

```typescript
// Credential priority:
// 1. GitHub App installation token (auto-rotating, zero-maintenance)
// 2. Manually configured PAT from secrets (github-token)
// 3. null → actionable error

if (org.githubAppInstallationId) {
  scmToken = await getInstallationToken(org.githubAppInstallationId);
} else {
  const githubToken = await getOrgIntegrationSecret("github-token");
  if (!githubToken) {
    throw new Error(
      "GitHub token not configured. Run 'WorkerMill: Configure Repository Access' in VS Code " +
      "or visit Settings > Integrations on the dashboard."
    );
  }
  scmToken = githubToken;
}
```

### Non-Goals

- **Bitbucket/GitLab App equivalents** — PAT-only for now, App support can be added later
- **Per-repo token scoping** — GitHub App handles this natively; PATs are org-wide
- **Token rotation reminders** — GitHub App tokens auto-rotate; PATs are the user's responsibility

### Files Modified

| File | Changes |
|------|---------|
| `api/src/routes/auth.ts` | Remove 4x `saveOrgSecret` calls for `github-token` on SSO sign-in |
| `api/src/routes/remote-agent.ts` | Add `POST /agent/configure-scm`, `GET /agent/scm-status` |
| `api/src/routes/auth.ts` | Add `GET /auth/github-app-callback` |
| `api/src/routes/webhooks.ts` (new) | Add `POST /webhooks/github-app` |
| `api/src/services/github-app.ts` (new) | Installation token generation + caching |
| `api/src/services/org-credentials.ts` | Add GitHub App token as priority 1 in credential lookup |
| `api/src/db/migrations/` | Add `github_app_installation_id` column to organizations |
| `api/src/models/Organization.ts` | Add `githubAppInstallationId` field |
| `packages/vscode-workermill/src/github-onboard.ts` | Post-SSO SCM setup QuickPick, PAT input, App install flow |
| `packages/vscode-workermill/src/extension.ts` | Register `workermill.configureScm` command, handle `scm-configured` URI |

### Credential Flow Summary

```
GitHub SSO (identity only)
  │
  ├─ OAuth token → verify user identity → discard
  │
  └─ Prompt: "How do you want to grant repo access?"
       │
       ├─ GitHub App → installation_id on org → auto-rotating tokens
       │
       ├─ PAT → saved to github-token secret → manual management
       │
       └─ Skip → agent starts → fails on clone → nag notification
```
