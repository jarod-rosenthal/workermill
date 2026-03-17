/**
 * Self-Hosted Credential Bootstrap
 *
 * Bridges credentials from ~/.workermill/config.json (where `init --standalone`
 * saves them) into the API's org_credentials database table (where the API reads
 * them when claiming tasks and spawning workers).
 *
 * Runs once at agent startup in self-hosted mode, after Docker Compose is healthy
 * and the API client is initialized. Idempotent — safe to run on every startup.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { api } from "./api.js";
import { loadStandaloneConfig, resolveApiKey, getRoleConfig } from "./backends/local/config.js";

const FLAG_FILE = path.join(os.homedir(), ".workermill", ".bootstrap-done");

/**
 * Push credentials from config.json into the API so workers can receive them
 * via the standard claim flow (GET /api/agent/claim → credentials in response).
 */
export async function bootstrapSelfHostedCredentials(
  log?: (msg: string) => void,
): Promise<void> {
  if (fs.existsSync(FLAG_FILE)) {
    log?.("Credentials already bootstrapped — skipping");
    return;
  }

  const sc = loadStandaloneConfig();

  // Bootstrap AI provider credentials — check all three roles for keys,
  // deduplicate by provider so we only save each provider's key once.
  const seenProviders = new Set<string>();
  for (const role of ["worker", "planner", "techLead"] as const) {
    const rc = getRoleConfig(sc, role);
    if (seenProviders.has(rc.provider)) continue;
    seenProviders.add(rc.provider);

    const apiKey = resolveApiKey(sc, role);
    if (!apiKey) continue;

    // Skip OAuth tokens — the worker container mounts ~/.claude directly
    // and docker-spawner handles OAuth file mounting.
    // Only bootstrap explicit API keys (sk-ant-api03-...).
    // OAuth tokens come in multiple formats: sk-ant-oat01-..., eyJ... (JWT)
    if (rc.provider === "anthropic" && !apiKey.startsWith("sk-ant-api")) continue;

    try {
      await api.put(`/api/settings/providers/${rc.provider}/credentials`, {
        apiKey,
      });
      log?.(`Synced ${rc.provider} credentials`);
    } catch (err) {
      log?.(`Warning: failed to sync ${rc.provider} credentials: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bootstrap SCM (GitHub/GitLab/Bitbucket) token
  if (sc.scm?.token) {
    const provider = sc.scm.provider || "github";
    try {
      if (provider === "github") {
        await api.put("/api/settings/integrations/github", {
          token: sc.scm.token,
          ...(sc.defaultRepo ? { defaultRepo: sc.defaultRepo } : {}),
        });
      } else if (provider === "gitlab") {
        await api.put("/api/settings/integrations/gitlab", {
          token: sc.scm.token,
        });
      } else if (provider === "bitbucket") {
        await api.put("/api/settings/integrations/bitbucket", {
          token: sc.scm.token,
        });
      }
      log?.(`Synced ${provider} credentials`);
    } catch (err) {
      log?.(`Warning: failed to sync ${provider} credentials: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bootstrap default repo on the organization (even if SCM token was already set)
  if (sc.defaultRepo) {
    try {
      await api.put("/api/settings/integrations/github", {
        defaultRepo: sc.defaultRepo,
      });
    } catch {
      // Best effort — may have already been set above
    }
  }

  // Bootstrap issue tracker credentials (Jira, Linear)
  if (sc.issueTracker?.jira) {
    try {
      await api.put("/api/settings/integrations/jira", {
        baseUrl: sc.issueTracker.jira.baseUrl,
        email: sc.issueTracker.jira.email,
        apiToken: sc.issueTracker.jira.apiToken,
      });
      log?.("Synced Jira credentials");
    } catch (err) {
      log?.(`Warning: failed to sync Jira credentials: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (sc.issueTracker?.linear) {
    try {
      await api.put("/api/settings/integrations/linear", {
        apiKey: sc.issueTracker.linear.apiKey,
      });
      log?.("Synced Linear credentials");
    } catch (err) {
      log?.(`Warning: failed to sync Linear credentials: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark bootstrap as done so user changes in the UI are never overwritten
  try { fs.writeFileSync(FLAG_FILE, new Date().toISOString()); } catch {}
}
