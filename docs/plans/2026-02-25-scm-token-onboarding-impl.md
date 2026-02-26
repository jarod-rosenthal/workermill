# SCM Token Onboarding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop GitHub SSO from overwriting PATs, add post-SSO SCM setup (PAT or GitHub App) so users never leave VS Code.

**Architecture:** Phase 0 removes 4 `saveOrgSecret` calls in auth.ts. Phase 1 adds a PAT-paste flow in the VS Code extension + `POST /api/agent/configure-scm` endpoint. Phase 2 adds a GitHub App integration with installation token caching and a DB migration for `github_app_installation_id`.

**Tech Stack:** TypeScript, Express, TypeORM, VS Code Extension API, GitHub REST API, jsonwebtoken (for GitHub App JWT)

---

### Task 1: Remove OAuth token overwrite from sign-in endpoints

**Files:**
- Modify: `api/src/routes/auth.ts:2262-2264` (web SSO signup)
- Modify: `api/src/routes/auth.ts:2283-2287` (web SSO signin)
- Modify: `api/src/routes/auth.ts:2467-2469` (extension onboard)
- Modify: `api/src/routes/auth.ts:2601-2603` (extension signin)

**Step 1: Remove the 4 `saveOrgSecret` calls**

In `api/src/routes/auth.ts`, delete/comment-out these lines:

**Line 2262-2264** (web SSO signup — new user):
```typescript
// REMOVED: OAuth token is for identity only, not repo access
// const secretPrefix = `workermill/${config.environment}`;
// await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via web SSO)");
```

**Line 2283-2287** (web SSO signin — existing user):
```typescript
// REMOVED: OAuth token overwrites manually-configured PAT
// if (org) {
//   const secretPrefix = `workermill/${config.environment}`;
//   await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via web SSO signin)");
// }
```

**Line 2467-2469** (extension onboard — new user):
```typescript
// REMOVED: OAuth token is for identity only — user will configure SCM separately
// const secretPrefix = `workermill/${config.environment}`;
// await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via extension onboarding)");
```

**Line 2601-2603** (extension signin — existing user):
```typescript
// REMOVED: OAuth token overwrites manually-configured PAT
// const secretPrefix = `workermill/${config.environment}`;
// await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via extension signin)");
```

**Step 2: Verify `saveOrgSecret` import is still needed**

`saveOrgSecret` is imported at line 33. Other code in auth.ts may still use it (check for other calls). If no other calls exist, remove the import. If other calls exist, leave it.

Run: `cd api && grep -n "saveOrgSecret" src/routes/auth.ts`

**Step 3: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add api/src/routes/auth.ts
git commit -m "fix: stop GitHub SSO from overwriting PAT in org secrets"
```

---

### Task 2: Add `POST /api/agent/configure-scm` endpoint

**Files:**
- Modify: `api/src/routes/remote-agent.ts` (add endpoint at end, before `export`)

**Step 1: Add the endpoint**

Add before the final `export default router;` in `api/src/routes/remote-agent.ts`:

```typescript
// ─── POST /configure-scm ──────────────────────────────────────────────────
// Save an SCM token from the VS Code extension.
// Validates the token against the provider's API before saving.
router.post(
  "/configure-scm",
  asyncHandler(async (req: Request, res: Response) => {
    const { token, provider } = req.body;
    const org = req.organization!;

    if (!token || !provider) {
      res.status(400).json({ error: "token and provider are required" });
      return;
    }

    if (!["github", "bitbucket", "gitlab"].includes(provider)) {
      res.status(400).json({ error: "provider must be github, bitbucket, or gitlab" });
      return;
    }

    // Validate the token against the provider's API
    let username: string | null = null;
    try {
      if (provider === "github") {
        const axios = (await import("axios")).default;
        const userResponse = await axios.get("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
          timeout: 10000,
        });
        username = userResponse.data.login;
      } else if (provider === "gitlab") {
        const axios = (await import("axios")).default;
        const baseUrl = org.scmBaseUrl || "https://gitlab.com";
        const userResponse = await axios.get(`${baseUrl}/api/v4/user`, {
          headers: { "PRIVATE-TOKEN": token },
          timeout: 10000,
        });
        username = userResponse.data.username;
      }
      // Bitbucket validation can be added later
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("SCM token validation failed", { orgId: org.id, provider, error: msg });
      res.status(401).json({ error: "Token validation failed. Check that your token has repo access." });
      return;
    }

    // Save to org secrets
    const { saveOrgSecret } = await import("./settings/helpers.js");
    const secretName = provider === "github" ? "github-token" : `${provider}-token`;
    await saveOrgSecret(org.id, secretName, token);

    // Update org scmProvider if not already set to this provider
    if (org.scmProvider !== provider) {
      const orgRepo = AppDataSource.getRepository((await import("../models/index.js")).Organization);
      await orgRepo.update({ id: org.id }, { scmProvider: provider });
    }

    logger.info("SCM token configured via remote agent", {
      orgId: org.id,
      provider,
      username,
    });

    res.json({ configured: true, username, provider });
  }),
);
```

**Step 2: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/routes/remote-agent.ts
git commit -m "feat: add POST /api/agent/configure-scm for VS Code SCM setup"
```

---

### Task 3: Add `GET /api/agent/scm-status` endpoint

**Files:**
- Modify: `api/src/routes/remote-agent.ts` (add endpoint after configure-scm)

**Step 1: Add the endpoint**

Add after the `configure-scm` route:

```typescript
// ─── GET /scm-status ────────────────────────────────────────────────────────
// Check if SCM is configured for the org. Used by VS Code to poll after
// GitHub App installation or to show "not configured" warnings.
router.get(
  "/scm-status",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const provider = org.scmProvider || "github";

    let configured = false;
    let username: string | null = null;

    try {
      // Check for GitHub App installation first
      if (provider === "github" && org.githubAppInstallationId) {
        configured = true;
        username = "(GitHub App)";
      } else {
        // Check for PAT in secrets
        const { getOrgSecret } = await import("./settings/helpers.js");
        const secretName = provider === "github" ? "github-token" : `${provider}-token`;
        const token = await getOrgSecret(org.id, secretName);
        configured = !!token;
      }
    } catch {
      // Secrets fetch failed — treat as not configured
    }

    res.json({ configured, provider, username });
  }),
);
```

**Step 2: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/routes/remote-agent.ts
git commit -m "feat: add GET /api/agent/scm-status for SCM config check"
```

---

### Task 4: Add SCM setup prompt to VS Code extension onboarding

**Files:**
- Modify: `packages/vscode-workermill/src/github-onboard.ts` (add `promptScmSetup()` function, call from signup/signin flows)

**Step 1: Add the `promptScmSetup()` function**

Add after the `httpsPostJsonWithBearer` function (around line 193) in `github-onboard.ts`:

```typescript
/**
 * Prompt the user to configure SCM access after SSO sign-in.
 * Offers GitHub App install, PAT paste, or skip.
 * Returns true if SCM was configured, false if skipped.
 */
async function promptScmSetup(
  apiKey: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Use a Personal Access Token",
        description: "Create a GitHub PAT with repo access",
        action: "pat" as const,
      },
      {
        label: "$(github) Install GitHub App (coming soon)",
        description: "One-click, no tokens to manage",
        action: "app" as const,
      },
      {
        label: "$(debug-step-over) Skip for now",
        description: "You can configure this later in Settings",
        action: "skip" as const,
      },
    ],
    {
      placeHolder: "WorkerMill needs access to your repositories to clone and push code",
      title: "Configure Repository Access",
      ignoreFocusOut: true,
    },
  );

  if (!choice || choice.action === "skip") {
    log("SCM setup skipped — user can configure later");
    return false;
  }

  if (choice.action === "app") {
    // GitHub App not yet available — fall through to PAT
    vscode.window.showInformationMessage(
      "GitHub App integration is coming soon. Please use a Personal Access Token for now.",
    );
    // Re-prompt with PAT flow
    return promptPatSetup(apiKey, log);
  }

  return promptPatSetup(apiKey, log);
}

/**
 * Guide the user through creating and pasting a GitHub PAT.
 */
async function promptPatSetup(
  apiKey: string,
  log: (msg: string) => void,
): Promise<boolean> {
  // Open GitHub PAT creation page with pre-filled scopes
  const createAction = await vscode.window.showInformationMessage(
    "Create a Personal Access Token on GitHub with 'repo' scope, then paste it here.",
    { modal: false },
    "Create Token on GitHub",
    "I already have one",
  );

  if (createAction === "Create Token on GitHub") {
    vscode.env.openExternal(
      vscode.Uri.parse(
        "https://github.com/settings/tokens/new?scopes=repo,workflow&description=WorkerMill%20Agent",
      ),
    );
  } else if (!createAction) {
    // Dismissed — skip
    return false;
  }

  // Prompt for the token
  const token = await vscode.window.showInputBox({
    prompt: "Paste your GitHub Personal Access Token (starts with ghp_ or github_pat_)",
    placeHolder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) return "Token is required";
      if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
        return "Token should start with ghp_ (classic) or github_pat_ (fine-grained)";
      }
      return null;
    },
  });

  if (!token) return false;

  // Send to API for validation and storage
  log("Validating GitHub token...");
  try {
    const { status, data } = await httpsPostJson<{ configured: boolean; username: string }>(
      `${API_BASE}/api/agent/configure-scm`,
      { token: token.trim(), provider: "github" },
    );

    if (status === 401) {
      vscode.window.showErrorMessage(
        "Token validation failed. Make sure your PAT has 'repo' scope and hasn't expired.",
      );
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(`Failed to save token (HTTP ${status}).`);
      return false;
    }

    log(`GitHub token validated — authenticated as ${data.username}`);
    vscode.window.showInformationMessage(
      `Repository access configured as ${data.username}. You're all set!`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`SCM token setup failed: ${msg}`);
    vscode.window.showErrorMessage(`Failed to configure repository access: ${msg}`);
    return false;
  }
}
```

**Step 2: Wait — `httpsPostJson` sends to the API base URL but `configure-scm` needs the API key header, not a body token**

The `httpsPostJson` function doesn't send an `x-api-key` header. We need a variant that does. Add a helper or modify the call to use the API key. The simplest approach: add a new helper that sends with `x-api-key`:

```typescript
/** POST JSON with API key authentication. */
function httpsPostJsonWithApiKey<T>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": apiKey,
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(data) as T });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} as T });
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(payload);
    req.end();
  });
}
```

Update `promptPatSetup` to accept `apiKey` and use `httpsPostJsonWithApiKey` instead of `httpsPostJson`.

**Step 3: Call `promptScmSetup()` from `signUpWithGitHub()` and `signInWithGitHub()`**

In `signUpWithGitHub()` (around line 508, after the API call succeeds, before `finishSetup()`):

```typescript
    log("Sign-up successful");

    // Prompt for SCM access before finishing setup
    await promptScmSetup(data.apiKey, log);

    const success = await finishSetup(data.apiKey, log, {
```

In `signInWithGitHub()` (around line 647, after data is finalized, before `finishSetup()`):

```typescript
    log("Sign-in successful");

    // Prompt for SCM access before finishing setup (skip if already configured)
    try {
      const scmCheck = await httpsGetJson<{ configured: boolean }>(
        `${API_BASE}/api/agent/scm-status`,
        data.apiKey,
      );
      if (!scmCheck.data.configured) {
        await promptScmSetup(data.apiKey, log);
      }
    } catch {
      // SCM status check failed — prompt anyway
      await promptScmSetup(data.apiKey, log);
    }

    const success = await finishSetup(data.apiKey, log, {
```

**Step 4: Type-check extension**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vscode-workermill/src/github-onboard.ts
git commit -m "feat: add post-SSO SCM setup prompt in VS Code extension"
```

---

### Task 5: Register `workermill.configureScm` command for later setup

**Files:**
- Modify: `packages/vscode-workermill/src/extension.ts` (register command)
- Modify: `packages/vscode-workermill/package.json` (add command declaration)

**Step 1: Add command to `extension.ts`**

Add after the existing `workermill.manualSetup` command registration (around line 1049):

```typescript
    vscode.commands.registerCommand("workermill.configureScm", async () => {
      // Read API key from config to authenticate the SCM setup call
      const configPath = path.join(os.homedir(), ".workermill", "config.json");
      let apiKey: string | undefined;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        apiKey = config.apiKey;
      } catch { /* no config */ }

      // Try keychain if not in config
      if (!apiKey) {
        try {
          apiKey = (await import("./secret-storage")).getApiKey?.() || undefined;
        } catch { /* no keychain */ }
      }

      if (!apiKey) {
        vscode.window.showErrorMessage(
          "Not signed in. Please sign in first, then configure repository access.",
        );
        return;
      }

      const { promptScmSetup } = await import("./github-onboard");
      await promptScmSetup(apiKey, log);
    }),
```

**Step 2: Export `promptScmSetup` from `github-onboard.ts`**

Change `async function promptScmSetup(` to `export async function promptScmSetup(`.

**Step 3: Add command to `package.json`**

In `packages/vscode-workermill/package.json`, find the `contributes.commands` array and add:

```json
{
  "command": "workermill.configureScm",
  "title": "Configure Repository Access",
  "category": "WorkerMill"
}
```

**Step 4: Type-check**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/vscode-workermill/src/extension.ts packages/vscode-workermill/src/github-onboard.ts packages/vscode-workermill/package.json
git commit -m "feat: add workermill.configureScm command for manual SCM setup"
```

---

### Task 6: Add `githubAppInstallationId` to Organization model + migration

**Files:**
- Modify: `api/src/models/Organization.ts` (add column)
- Create: `api/src/db/migrations/1741400000000-AddGithubAppInstallationId.ts`
- Modify: `api/src/db/connection.ts` (register migration)

**Step 1: Add column to Organization model**

In `api/src/models/Organization.ts`, add after `scmBaseUrl` (around line 192):

```typescript
  // GitHub App — installation ID for auto-rotating tokens
  @Column({ name: "github_app_installation_id", type: "int", nullable: true })
  githubAppInstallationId: number | null;
```

**Step 2: Create migration**

Create `api/src/db/migrations/1741400000000-AddGithubAppInstallationId.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGithubAppInstallationId1741400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS github_app_installation_id INTEGER
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS github_app_installation_id
    `);
  }
}
```

**Step 3: Register migration in `connection.ts`**

Add import at the end of the migration imports (after line 263):

```typescript
import { AddGithubAppInstallationId1741400000000 } from "./migrations/1741400000000-AddGithubAppInstallationId.js";
```

Add to the `migrations` array (after `BlockOnTestFailuresDefault1741300000000` at line 563):

```typescript
    AddGithubAppInstallationId1741400000000,
```

**Step 4: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/models/Organization.ts api/src/db/migrations/1741400000000-AddGithubAppInstallationId.ts api/src/db/connection.ts
git commit -m "feat: add github_app_installation_id column to organizations"
```

---

### Task 7: Create GitHub App token service

**Files:**
- Create: `api/src/services/github-app.ts`

**Step 1: Create the service**

Create `api/src/services/github-app.ts`:

```typescript
/**
 * GitHub App — Installation token generation and caching.
 *
 * Generates short-lived installation access tokens (1hr) from the GitHub App
 * private key. Tokens are cached in memory and refreshed 5 minutes before expiry.
 *
 * Required secrets in org_credentials (platform org):
 * - github-app-id: The App ID from GitHub
 * - github-app-private-key: PEM private key for JWT signing
 */

import jwt from "jsonwebtoken";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { getOrgSecretFromDb } from "../utils/org-secret-store.js";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";

// In-memory token cache: installationId → { token, expiresAt }
const tokenCache = new Map<number, { token: string; expiresAt: Date }>();

// Platform org ID for fetching app credentials (cached)
let platformOrgId: string | null = null;

async function getPlatformOrgId(): Promise<string> {
  if (platformOrgId) return platformOrgId;
  const orgRepo = AppDataSource.getRepository(Organization);
  const platformOrg = await orgRepo.findOne({ where: { slug: "platform" } });
  if (!platformOrg) throw new Error("Platform org not found — cannot load GitHub App credentials");
  platformOrgId = platformOrg.id;
  return platformOrgId;
}

/**
 * Generate a JWT for authenticating as the GitHub App.
 * JWTs are valid for 10 minutes max per GitHub docs.
 */
async function generateAppJwt(): Promise<string> {
  const orgId = await getPlatformOrgId();
  const [appIdStr, privateKey] = await Promise.all([
    getOrgSecretFromDb(orgId, "github-app-id"),
    getOrgSecretFromDb(orgId, "github-app-private-key"),
  ]);

  if (!appIdStr || !privateKey) {
    throw new Error("GitHub App credentials not configured (github-app-id / github-app-private-key)");
  }

  const appId = parseInt(appIdStr, 10);
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60, // 60 seconds in the past for clock drift
      exp: now + 10 * 60, // 10 minutes
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" },
  );
}

/**
 * Get a short-lived installation access token for a GitHub App installation.
 * Cached in memory, refreshed 5 minutes before expiry.
 */
export async function getInstallationToken(installationId: number): Promise<string> {
  // Check cache — return if valid and not about to expire
  const cached = tokenCache.get(installationId);
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (cached && cached.expiresAt > fiveMinFromNow) {
    return cached.token;
  }

  // Generate new token
  const appJwt = await generateAppJwt();

  const response = await axios.post(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {},
    {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      timeout: 10000,
    },
  );

  const { token, expires_at } = response.data;
  const expiresAt = new Date(expires_at);

  tokenCache.set(installationId, { token, expiresAt });

  logger.info("Generated GitHub App installation token", {
    installationId,
    expiresAt: expiresAt.toISOString(),
  });

  return token;
}

/**
 * Clear a cached installation token (e.g., when the App is uninstalled).
 */
export function clearInstallationToken(installationId: number): void {
  tokenCache.delete(installationId);
}
```

**Step 2: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS (jsonwebtoken is already a dependency — verify with `grep jsonwebtoken api/package.json`)

If `jsonwebtoken` is not installed:
Run: `cd api && npm install jsonwebtoken && npm install -D @types/jsonwebtoken`

**Step 3: Commit**

```bash
git add api/src/services/github-app.ts
git commit -m "feat: add GitHub App installation token service with caching"
```

---

### Task 8: Integrate GitHub App tokens into `getOrgCredentials()`

**Files:**
- Modify: `api/src/services/org-credentials.ts:263-272` (GitHub token lookup)

**Step 1: Add GitHub App as priority 1**

Replace the GitHub token section (around lines 263-272) in `getOrgCredentials()`:

```typescript
    } else {
      // GitHub SCM provider — try GitHub App first, then PAT
      let githubToken: string | null = null;

      if (org.githubAppInstallationId) {
        try {
          const { getInstallationToken } = await import("./github-app.js");
          githubToken = await getInstallationToken(org.githubAppInstallationId);
        } catch (appErr) {
          logger.warn("GitHub App token generation failed, falling back to PAT", {
            orgId,
            installationId: org.githubAppInstallationId,
            error: appErr instanceof Error ? appErr.message : String(appErr),
          });
        }
      }

      if (!githubToken) {
        githubToken = await getOrgIntegrationSecret("github-token");
      }

      if (!githubToken) {
        throw new Error(
          `GitHub token not configured for organization '${org.name}'. ` +
            `Run 'WorkerMill: Configure Repository Access' in VS Code or visit Settings > Integrations.`,
        );
      }
      scmToken = githubToken;
    }
```

**Step 2: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/services/org-credentials.ts
git commit -m "feat: use GitHub App installation token as priority 1 in credential lookup"
```

---

### Task 9: Add GitHub App callback and webhook endpoints

**Files:**
- Modify: `api/src/routes/auth.ts` (add `GET /github-app-callback`)
- Create: `api/src/routes/github-app-webhook.ts` (webhook handler)
- Modify: `api/src/routes/index.ts` or wherever routes are mounted (mount webhook)

**Step 1: Add the callback endpoint in `auth.ts`**

Add after the existing GitHub SSO endpoints (end of file or appropriate section):

```typescript
// ─── GET /github-app-callback ──────────────────────────────────────────────
// Called by GitHub after a user installs the WorkerMill GitHub App.
// Receives installation_id, maps it to the org, and redirects to VS Code.
router.get(
  "/github-app-callback",
  asyncHandler(async (req: Request, res: Response) => {
    const installationId = parseInt(req.query.installation_id as string, 10);
    const setupAction = req.query.setup_action as string;

    if (!installationId || isNaN(installationId)) {
      res.status(400).send("Missing installation_id");
      return;
    }

    // Fetch the installation to get the account (org/user) that installed it
    try {
      const { getInstallationToken } = await import("../services/github-app.js");
      // Validate by generating a token (will fail if credentials are wrong)
      await getInstallationToken(installationId);
    } catch (err) {
      logger.error("GitHub App callback: failed to validate installation", {
        installationId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send("Failed to validate GitHub App installation. Check server logs.");
      return;
    }

    // For now, we need the user to be identified to map installation → org.
    // The state param can carry the org ID if we include it in the install URL.
    const orgId = req.query.state as string;
    if (orgId) {
      const orgRepo = AppDataSource.getRepository(Organization);
      await orgRepo.update({ id: orgId }, { githubAppInstallationId: installationId });
      logger.info("GitHub App installed", { orgId, installationId, setupAction });
    }

    // Redirect to VS Code URI handler
    res.redirect(
      `vscode://workermill.workermill/auth-callback?scmConfigured=true&method=github-app` +
        (orgId ? `&orgId=${orgId}` : ""),
    );
  }),
);
```

**Step 2: Create webhook handler**

Create `api/src/routes/github-app-webhook.ts`:

```typescript
/**
 * GitHub App Webhook — handles installation lifecycle events.
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";
import { clearInstallationToken } from "../services/github-app.js";
import { getOrgSecretFromDb } from "../utils/org-secret-store.js";

const router = Router();

/** Verify GitHub webhook signature (HMAC SHA-256). */
async function verifyWebhookSignature(
  req: Request,
): Promise<boolean> {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature) return false;

  // Fetch webhook secret from platform org
  const orgRepo = AppDataSource.getRepository(Organization);
  const platformOrg = await orgRepo.findOne({ where: { slug: "platform" } });
  if (!platformOrg) return false;

  const secret = await getOrgSecretFromDb(platformOrg.id, "github-app-webhook-secret");
  if (!secret) return false;

  const body = JSON.stringify(req.body);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

router.post("/github-app", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;

  if (!await verifyWebhookSignature(req)) {
    logger.warn("GitHub App webhook: invalid signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const { action, installation } = req.body;
  const installationId = installation?.id;

  if (!installationId) {
    res.status(200).json({ ok: true });
    return;
  }

  if (event === "installation" && (action === "deleted" || action === "suspend")) {
    // Clear installation from org
    const orgRepo = AppDataSource.getRepository(Organization);
    const result = await orgRepo.update(
      { githubAppInstallationId: installationId },
      { githubAppInstallationId: null },
    );

    clearInstallationToken(installationId);

    logger.info("GitHub App uninstalled/suspended", {
      installationId,
      action,
      orgsCleared: result.affected,
    });
  }

  res.status(200).json({ ok: true });
});

export default router;
```

**Step 3: Mount the webhook router**

Find where routes are mounted (likely `api/src/routes/index.ts` or `api/src/app.ts`). Add:

```typescript
import githubAppWebhook from "./routes/github-app-webhook.js";
app.use("/api/webhooks", githubAppWebhook);
```

**Step 4: Type-check**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/src/routes/github-app-webhook.ts api/src/app.ts
git commit -m "feat: add GitHub App callback and webhook endpoints"
```

---

### Task 10: Update VS Code URI handler for `scmConfigured` callback

**Files:**
- Modify: `packages/vscode-workermill/src/extension.ts:250-254` (URI handler)

**Step 1: Extend the URI handler**

In `extension.ts`, the existing URI handler (line 250) checks `uri.path === "/auth-callback"`. Update it to also handle the `scmConfigured` query param:

```typescript
      handleUri: async (uri: vscode.Uri) => {
        if (uri.path === "/auth-callback") {
          log(`URI callback received: ${uri.path}`);

          // Check if this is a SCM configuration callback (from GitHub App install)
          const params = new URLSearchParams(uri.query);
          if (params.get("scmConfigured") === "true") {
            const method = params.get("method") || "unknown";
            log(`SCM configured via ${method}`);
            vscode.window.showInformationMessage(
              `Repository access configured via ${method === "github-app" ? "GitHub App" : method}. You're all set!`,
            );
            return;
          }

          const success = await handleAuthCallback(uri, log);
          if (success) {
```

**Step 2: Type-check**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/vscode-workermill/src/extension.ts
git commit -m "feat: handle scmConfigured callback in VS Code URI handler"
```

---

### Task 11: Update VS Code extension GitHub App path in QuickPick

**Files:**
- Modify: `packages/vscode-workermill/src/github-onboard.ts` (update `promptScmSetup` to wire GitHub App install URL)

**Step 1: Update the GitHub App option**

Once the GitHub App is created on github.com, update the `promptScmSetup()` function to use the real install URL. Replace the "coming soon" placeholder:

```typescript
  if (choice.action === "app") {
    // Open GitHub App installation page with state=orgId for callback mapping
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let orgId = "";
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      orgId = config.orgId || "";
    } catch { /* no config */ }

    const installUrl = `https://github.com/apps/workermill-agent/installations/new` +
      (orgId ? `?state=${orgId}` : "");
    vscode.env.openExternal(vscode.Uri.parse(installUrl));

    // Poll scm-status until configured or timeout (60s)
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for GitHub App installation..." },
      async () => {
        const start = Date.now();
        while (Date.now() - start < 60_000) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const check = await httpsGetJson<{ configured: boolean }>(
              `${API_BASE}/api/agent/scm-status`,
              apiKey,
            );
            if (check.data.configured) {
              vscode.window.showInformationMessage("GitHub App installed! Repository access configured.");
              return true;
            }
          } catch { /* retry */ }
        }
        vscode.window.showWarningMessage(
          "GitHub App installation not detected. You can check Settings > Integrations later.",
        );
        return false;
      },
    );
    return true;
  }
```

**Note:** This step depends on the GitHub App being created first on github.com. The PAT flow works immediately without this step.

**Step 2: Type-check**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/vscode-workermill/src/github-onboard.ts
git commit -m "feat: wire GitHub App install flow with polling in VS Code"
```

---

### Task 12: Deploy and test

**Step 1: Deploy API**

Run: `./deploy.sh --api`

This runs the migration automatically on startup.

**Step 2: Build + release VS Code extension**

Bump version in `packages/vscode-workermill/package.json`, then:

```bash
cd packages/vscode-workermill && npm run build
git add -A && git commit -m "chore: bump vscode extension version for SCM onboarding"
git tag vscode-v<new-version>
git push origin vscode-v<new-version>
```

CI publishes to VS Code Marketplace.

**Step 3: Manual test checklist**

1. Uninstall VS Code extension, reinstall from Marketplace
2. Sign in with GitHub SSO → SCM setup prompt should appear
3. Select "Use a Personal Access Token" → opens GitHub in browser
4. Paste PAT → should validate and save
5. Sign out and sign in again → SCM prompt should NOT appear (already configured)
6. In web dashboard, verify Settings > Integrations > GitHub shows the PAT (not overwritten)
7. Run a task → planning agent should clone successfully
