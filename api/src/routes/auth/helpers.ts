import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AuthFlowType as AdminAuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomBytes } from "crypto";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { redis } from "../../services/redis-client.js";

// Cognito client
export const cognitoClient = new CognitoIdentityProviderClient({
  region: config.cognito.region,
});

/**
 * Decode JWT payload without verification (for extracting claims)
 */
export function decodeJwtPayload(token: string): Record<string, any> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

// =============================================================================
// Microsoft OAuth state management
// =============================================================================

// OAuth PKCE state stored in Redis with 10-minute TTL.
// Falls back to in-memory Map for local dev without Redis.
export const microsoftOAuthStatesFallback = new Map<
  string,
  { codeVerifier: string; expiresAt: number; inviteToken?: string }
>();

export async function setMicrosoftOAuthState(
  state: string,
  data: { codeVerifier: string; expiresAt: number; inviteToken?: string },
): Promise<void> {
  const stored = await redis.set(`oauth:microsoft:${state}`, JSON.stringify(data), 600);
  if (!stored) microsoftOAuthStatesFallback.set(state, data);
}

export async function getMicrosoftOAuthState(
  state: string,
): Promise<{ codeVerifier: string; expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:microsoft:${state}`);
  if (raw) {
    await redis.del(`oauth:microsoft:${state}`);
    return JSON.parse(raw);
  }
  const fallback = microsoftOAuthStatesFallback.get(state);
  if (fallback) microsoftOAuthStatesFallback.delete(state);
  return fallback;
}

// =============================================================================
// GitHub OAuth state management
// =============================================================================

// OAuth state stored in Redis with 10-minute TTL.
// Falls back to in-memory Map for local dev without Redis.
export const githubOAuthStatesFallback = new Map<string, { expiresAt: number; inviteToken?: string }>();

export async function setGithubOAuthState(
  state: string,
  data: { expiresAt: number; inviteToken?: string },
): Promise<void> {
  const stored = await redis.set(`oauth:github:${state}`, JSON.stringify(data), 600);
  if (!stored) githubOAuthStatesFallback.set(state, data);
}

export async function getGithubOAuthState(
  state: string,
): Promise<{ expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:github:${state}`);
  if (raw) {
    await redis.del(`oauth:github:${state}`);
    return JSON.parse(raw);
  }
  const fallback = githubOAuthStatesFallback.get(state);
  if (fallback) githubOAuthStatesFallback.delete(state);
  return fallback;
}

// =============================================================================
// Cognito user management helpers (used by Microsoft & GitHub OAuth)
// =============================================================================

/**
 * Create a Cognito user for Microsoft-authenticated user
 * This creates a user that can be managed in Cognito without requiring password login
 */
export async function createCognitoUserForMicrosoft(email: string, name: string, tempPassword: string): Promise<string> {
  try {
    // Create user in Cognito
    const createCommand = new AdminCreateUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: name },
      ],
      TemporaryPassword: tempPassword,
      MessageAction: "SUPPRESS", // Don't send welcome email
    });

    const createResponse = await cognitoClient.send(createCommand);
    const cognitoId = createResponse.User?.Username;

    if (!cognitoId) {
      throw new Error("Failed to create Cognito user - no username returned");
    }

    // Set a permanent password immediately
    const permanentPassword = randomBytes(32).toString("base64") + "!A1";
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      Password: permanentPassword,
      Permanent: true,
    });
    await cognitoClient.send(setPasswordCommand);

    // Get the actual Cognito sub (user ID) from the attributes
    const subAttr = createResponse.User?.Attributes?.find(a => a.Name === "sub");
    return subAttr?.Value || cognitoId;
  } catch (error: any) {
    // If user already exists, that's fine - return their info
    if (error.name === "UsernameExistsException") {
      logger.info("Cognito user already exists for Microsoft user", { email });
      // The user exists, so we need to look them up to get the sub
      // For now, just return the email as identifier - it will match
      return email;
    }
    throw error;
  }
}

/**
 * Get Cognito tokens for a user (for Microsoft SSO users who are in Cognito)
 * Uses admin auth flow since we don't have the user's password
 */
export async function getCognitoTokensForUser(
  cognitoId: string,
  email: string
): Promise<{ accessToken: string; refreshToken: string; idToken: string; expiresIn: number }> {
  try {
    // Use admin-initiated auth with a custom auth flow
    // Since Microsoft users don't have a Cognito password, we use ADMIN_NO_SRP_AUTH
    // with a system-generated password

    // First, generate a new secure password for this auth
    const authPassword = randomBytes(32).toString("base64") + "!A1";

    // Set the password
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      Password: authPassword,
      Permanent: true,
    });
    await cognitoClient.send(setPasswordCommand);

    // Now authenticate with that password
    const authCommand = new AdminInitiateAuthCommand({
      UserPoolId: config.cognito.userPoolId,
      ClientId: config.cognito.clientId,
      AuthFlow: AdminAuthFlowType.ADMIN_USER_PASSWORD_AUTH,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: authPassword,
      },
    });

    const authResponse = await cognitoClient.send(authCommand);

    if (!authResponse.AuthenticationResult) {
      throw new Error("Failed to get Cognito tokens");
    }

    return {
      accessToken: authResponse.AuthenticationResult.AccessToken!,
      refreshToken: authResponse.AuthenticationResult.RefreshToken!,
      idToken: authResponse.AuthenticationResult.IdToken!,
      expiresIn: authResponse.AuthenticationResult.ExpiresIn || 3600,
    };
  } catch (error) {
    logger.error("Failed to get Cognito tokens for Microsoft user", { cognitoId, error });
    throw error;
  }
}
