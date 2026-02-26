/**
 * GitHub App — Installation token generation and caching.
 *
 * Generates short-lived installation access tokens (1hr) from the GitHub App
 * private key. Tokens are cached in memory and refreshed 5 minutes before expiry.
 *
 * Required secrets (stored in the platform org's org_credentials):
 * - github-app-id: The App ID from GitHub
 * - github-app-private-key: PEM private key for JWT signing
 */

import jwt from "jsonwebtoken";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { getOrgSecretFromDb } from "../utils/org-secret-store.js";
import { Organization } from "../models/Organization.js";

// In-memory token cache: installationId → { token, expiresAt }
const tokenCache = new Map<number, { token: string; expiresAt: Date }>();

// Platform org ID for fetching app credentials (cached)
let platformOrgId: string | null = null;

async function getPlatformOrgId(): Promise<string> {
  if (platformOrgId) return platformOrgId;
  const platformOrg = await Organization.getPlatformOrg();
  if (!platformOrg)
    throw new Error(
      "Platform org not found — cannot load GitHub App credentials",
    );
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
    throw new Error(
      "GitHub App credentials not configured (github-app-id / github-app-private-key)",
    );
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
export async function getInstallationToken(
  installationId: number,
): Promise<string> {
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
