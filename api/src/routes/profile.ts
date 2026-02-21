import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  ChangePasswordCommand,
  GlobalSignOutCommand,
  AdminDisableUserCommand,
  GetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { authenticateUser } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { User, UserApiKey, type UserPreferences } from "../models/index.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

// Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: config.cognito.region,
});

/**
 * GET /api/profile
 * Get current user profile with preferences
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: req.orgRole, // Role in current organization
        status: user.status,
        createdAt: user.createdAt,
      },
      preferences: user.preferences || {},
    });
  } catch (error) {
    logger.error("Error getting profile", { error });
    res.status(500).json({ error: "Failed to get profile" });
  }
});

/**
 * PATCH /api/profile
 * Update display name and/or preferences
 */
router.patch("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { fullName, preferences } = req.body;

    const userRepo = AppDataSource.getRepository(User);

    // Validate fullName if provided
    if (fullName !== undefined) {
      if (typeof fullName !== "string" || fullName.length < 1 || fullName.length > 255) {
        return res.status(400).json({ error: "Full name must be between 1 and 255 characters" });
      }
      user.fullName = fullName.trim();
    }

    // Validate and merge preferences if provided
    if (preferences !== undefined) {
      if (typeof preferences !== "object" || preferences === null) {
        return res.status(400).json({ error: "Preferences must be an object" });
      }

      // Validate theme
      if (preferences.theme !== undefined) {
        if (!["system", "dark", "light"].includes(preferences.theme)) {
          return res.status(400).json({ error: "Invalid theme value" });
        }
      }

      // Validate notifications
      if (preferences.notifications !== undefined) {
        if (typeof preferences.notifications !== "object") {
          return res.status(400).json({ error: "Notifications must be an object" });
        }
      }

      // Validate dashboard
      if (preferences.dashboard !== undefined) {
        if (typeof preferences.dashboard !== "object") {
          return res.status(400).json({ error: "Dashboard preferences must be an object" });
        }
      }

      // Validate email preferences
      if (preferences.email !== undefined) {
        if (typeof preferences.email !== "object") {
          return res.status(400).json({ error: "Email preferences must be an object" });
        }
        // Validate frequency if provided
        if (preferences.email.frequency !== undefined) {
          if (!["immediate", "daily", "weekly", "never"].includes(preferences.email.frequency)) {
            return res.status(400).json({ error: "Invalid email frequency value" });
          }
        }
      }

      // Merge with existing preferences
      user.preferences = {
        ...user.preferences,
        ...preferences,
        notifications: {
          ...(user.preferences?.notifications || {}),
          ...(preferences.notifications || {}),
        },
        dashboard: {
          ...(user.preferences?.dashboard || {}),
          ...(preferences.dashboard || {}),
        },
        email: {
          ...(user.preferences?.email || {}),
          ...(preferences.email || {}),
        },
      } as UserPreferences;
    }

    await userRepo.save(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: req.orgRole, // Role in current organization
        status: user.status,
      },
      preferences: user.preferences,
    });
  } catch (error) {
    logger.error("Error updating profile", { error });
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * POST /api/profile/change-password
 * Change password via Cognito
 */
router.post("/change-password", async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ error: "New password must contain at least one uppercase letter" });
    }

    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ error: "New password must contain at least one lowercase letter" });
    }

    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "New password must contain at least one number" });
    }

    // Get access token from the request
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    const command = new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: currentPassword,
      ProposedPassword: newPassword,
    });

    await cognitoClient.send(command);

    logger.info("Password changed successfully", { userId: req.user!.id });

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error: any) {
    logger.error("Error changing password", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    if (error.name === "InvalidPasswordException") {
      return res.status(400).json({ error: "New password does not meet requirements" });
    }

    if (error.name === "LimitExceededException") {
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }

    res.status(500).json({ error: "Failed to change password" });
  }
});

/**
 * GET /api/profile/api-keys
 * List all API keys for current user (never returns full key or hash)
 */
router.get("/api-keys", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const org = req.organization;
    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    // Filter by both user AND org for multi-tenancy isolation
    const keys = await apiKeyRepo.find({
      where: { userId: user.id, orgId: org?.id },
      order: { createdAt: "DESC" },
    });

    res.json({
      apiKeys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing API keys", { error });
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

/**
 * POST /api/profile/api-keys
 * Create a new API key (returns token only once)
 */
router.post("/api-keys", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { name, scopes, expiresAt } = req.body;

    // User must belong to an organization to create API keys
    const org = req.organization;
    if (!org) {
      return res.status(400).json({ error: "You must belong to an organization to create API keys" });
    }

    if (!name || typeof name !== "string" || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: "Name is required and must be between 1 and 255 characters" });
    }

    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    // Check for duplicate name
    const existing = await apiKeyRepo.findOne({
      where: { userId: user.id, name: name.trim() },
    });

    if (existing) {
      return res.status(400).json({ error: "An API key with this name already exists" });
    }

    // Generate token: usr_{uuid}
    const token = `usr_${uuidv4().replace(/-/g, "")}`;
    const keyPrefix = token.substring(0, 12);

    // Hash the token
    const keyHash = await bcrypt.hash(token, 10);

    // Validate scopes if provided
    let validScopes = ["*"];
    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.length === 0) {
        return res.status(400).json({ error: "Scopes must be a non-empty array" });
      }
      validScopes = scopes;
    }

    // Validate expiresAt if provided
    let expirationDate: Date | null = null;
    if (expiresAt) {
      expirationDate = new Date(expiresAt);
      if (isNaN(expirationDate.getTime())) {
        return res.status(400).json({ error: "Invalid expiration date" });
      }
      if (expirationDate <= new Date()) {
        return res.status(400).json({ error: "Expiration date must be in the future" });
      }
    }

    const apiKey = apiKeyRepo.create({
      userId: user.id,
      orgId: org.id,
      name: name.trim(),
      keyHash,
      keyPrefix,
      scopes: validScopes,
      expiresAt: expirationDate,
    });

    await apiKeyRepo.save(apiKey);

    logger.info("API key created", { userId: user.id, keyId: apiKey.id, keyPrefix });

    // Return the token ONLY on creation
    res.status(201).json({
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      },
      token, // Only returned on creation!
    });
  } catch (error) {
    logger.error("Error creating API key", { error });
    res.status(500).json({ error: "Failed to create API key" });
  }
});

/**
 * DELETE /api/profile/api-keys/:id
 * Revoke an API key
 */
router.delete("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;

    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    const key = await apiKeyRepo.findOne({
      where: { id, userId: user.id },
    });

    if (!key) {
      return res.status(404).json({ error: "API key not found" });
    }

    await apiKeyRepo.remove(key);

    logger.info("API key revoked", { userId: user.id, keyId: id });

    res.status(204).send();
  } catch (error) {
    logger.error("Error revoking API key", { error });
    res.status(500).json({ error: "Failed to revoke API key" });
  }
});

/**
 * POST /api/profile/api-keys/:id/rotate
 * Rotate an API key (generate new token)
 */
router.post("/api-keys/:id/rotate", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;

    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    const key = await apiKeyRepo.findOne({
      where: { id, userId: user.id },
    });

    if (!key) {
      return res.status(404).json({ error: "API key not found" });
    }

    // Generate new token
    const token = `usr_${uuidv4().replace(/-/g, "")}`;
    const keyPrefix = token.substring(0, 12);
    const keyHash = await bcrypt.hash(token, 10);

    key.keyHash = keyHash;
    key.keyPrefix = keyPrefix;

    await apiKeyRepo.save(key);

    logger.info("API key rotated", { userId: user.id, keyId: id, newKeyPrefix: keyPrefix });

    res.json({
      apiKey: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      },
      token, // Only returned on rotation!
    });
  } catch (error) {
    logger.error("Error rotating API key", { error });
    res.status(500).json({ error: "Failed to rotate API key" });
  }
});

/**
 * POST /api/profile/sign-out-all
 * Sign out of all devices using Cognito GlobalSignOut
 */
router.post("/sign-out-all", async (req: Request, res: Response) => {
  try {
    // Get access token from the request
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    const command = new GlobalSignOutCommand({
      AccessToken: accessToken,
    });

    await cognitoClient.send(command);

    logger.info("Global sign out completed", { userId: req.user!.id });

    res.json({
      success: true,
      message: "All other sessions have been signed out. You may need to log in again on other devices.",
    });
  } catch (error: any) {
    logger.error("Error signing out all sessions", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    res.status(500).json({ error: "Failed to sign out all sessions" });
  }
});

/**
 * POST /api/profile/delete-account
 * Delete user account (soft delete + Cognito disable)
 */
router.post("/delete-account", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { password, confirmText } = req.body;

    // Accept either password (legacy) or confirmText="DELETE" (works for SSO users)
    const hasValidConfirmation = password || confirmText?.toUpperCase() === "DELETE";

    if (!hasValidConfirmation) {
      return res.status(400).json({ error: "Please type DELETE to confirm account deletion" });
    }

    // Note: We don't verify the password - user is already authenticated
    // The confirmation is just to prevent accidental deletion

    const userRepo = AppDataSource.getRepository(User);
    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    // Delete all API keys for this user
    await apiKeyRepo.delete({ userId: user.id });

    // Soft delete: set status to inactive
    user.status = "inactive";
    await userRepo.save(user);

    // Disable user in Cognito
    try {
      const command = new AdminDisableUserCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: user.email,
      });

      await cognitoClient.send(command);
      logger.info("User disabled in Cognito", { userId: user.id, email: user.email });
    } catch (cognitoError: any) {
      // Log but don't fail - the DB soft delete is the important part
      logger.warn("Failed to disable user in Cognito", {
        userId: user.id,
        error: cognitoError.message,
      });
    }

    logger.info("Account deleted", { userId: user.id });

    res.json({
      success: true,
      message: "Your account has been deleted. You will be logged out.",
    });
  } catch (error) {
    logger.error("Error deleting account", { error });
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// =============================================================================
// MFA (Multi-Factor Authentication) Endpoints
// =============================================================================

/**
 * GET /api/profile/mfa/status
 * Check if MFA is enabled for the current user
 */
router.get("/mfa/status", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    const command = new GetUserCommand({
      AccessToken: accessToken,
    });

    const response = await cognitoClient.send(command);

    // Check if TOTP MFA is enabled
    const mfaEnabled = response.UserMFASettingList?.includes("SOFTWARE_TOKEN_MFA") || false;

    res.json({
      mfaEnabled,
      mfaType: mfaEnabled ? "totp" : null,
    });
  } catch (error: any) {
    logger.error("Error getting MFA status", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    res.status(500).json({ error: "Failed to get MFA status" });
  }
});

/**
 * POST /api/profile/mfa/setup
 * Generate TOTP secret and return URI for QR code
 */
router.post("/mfa/setup", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    // Associate a software token with the user
    const command = new AssociateSoftwareTokenCommand({
      AccessToken: accessToken,
    });

    const response = await cognitoClient.send(command);

    if (!response.SecretCode) {
      return res.status(500).json({ error: "Failed to generate MFA secret" });
    }

    // Build the TOTP URI for authenticator apps
    // Format: otpauth://totp/LABEL?secret=SECRET&issuer=ISSUER
    const issuer = "WorkerMill";
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    const totpUri = `otpauth://totp/${label}?secret=${response.SecretCode}&issuer=${encodeURIComponent(issuer)}`;

    logger.info("MFA setup initiated", { userId: user.id });

    res.json({
      secretCode: response.SecretCode,
      totpUri,
      issuer,
      accountName: user.email,
    });
  } catch (error: any) {
    logger.error("Error setting up MFA", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    res.status(500).json({ error: "Failed to setup MFA" });
  }
});

/**
 * POST /api/profile/mfa/verify
 * Verify TOTP code and enable MFA
 */
router.post("/mfa/verify", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { code } = req.body;

    if (!code || typeof code !== "string" || code.length !== 6) {
      return res.status(400).json({ error: "A 6-digit verification code is required" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    // Verify the TOTP code
    const verifyCommand = new VerifySoftwareTokenCommand({
      AccessToken: accessToken,
      UserCode: code,
      FriendlyDeviceName: "Authenticator App",
    });

    const verifyResponse = await cognitoClient.send(verifyCommand);

    if (verifyResponse.Status !== "SUCCESS") {
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    // Enable MFA for the user
    const setMfaCommand = new SetUserMFAPreferenceCommand({
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    });

    await cognitoClient.send(setMfaCommand);

    logger.info("MFA enabled successfully", { userId: user.id });

    res.json({
      success: true,
      message: "MFA has been enabled successfully.",
    });
  } catch (error: any) {
    logger.error("Error verifying MFA", { error: error.message });

    if (error.name === "CodeMismatchException") {
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    if (error.name === "EnableSoftwareTokenMFAException") {
      return res.status(400).json({ error: "Failed to enable MFA. Please try again." });
    }

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    res.status(500).json({ error: "Failed to verify MFA code" });
  }
});

/**
 * POST /api/profile/mfa/disable
 * Disable MFA (requires password confirmation + current TOTP code)
 */
router.post("/mfa/disable", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { password, code } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required to disable MFA" });
    }

    if (!code || typeof code !== "string" || code.length !== 6) {
      return res.status(400).json({ error: "A 6-digit verification code is required" });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Access token required" });
    }
    const accessToken = authHeader.substring(7);

    // First, verify the password by attempting to get new tokens
    // We use InitiateAuth with user password to verify the password is correct
    const { InitiateAuthCommand, AuthFlowType } = await import(
      "@aws-sdk/client-cognito-identity-provider"
    );

    try {
      const authCommand = new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: config.cognito.clientId,
        AuthParameters: {
          USERNAME: user.email,
          PASSWORD: password,
        },
      });

      const authResponse = await cognitoClient.send(authCommand);

      // If MFA is enabled, Cognito will return a challenge instead of tokens
      // We need to verify the TOTP code
      if (authResponse.ChallengeName === "SOFTWARE_TOKEN_MFA") {
        const { RespondToAuthChallengeCommand } = await import(
          "@aws-sdk/client-cognito-identity-provider"
        );

        const challengeCommand = new RespondToAuthChallengeCommand({
          ChallengeName: "SOFTWARE_TOKEN_MFA",
          ClientId: config.cognito.clientId,
          Session: authResponse.Session,
          ChallengeResponses: {
            USERNAME: user.email,
            SOFTWARE_TOKEN_MFA_CODE: code,
          },
        });

        await cognitoClient.send(challengeCommand);
      }
    } catch (authError: any) {
      if (authError.name === "NotAuthorizedException") {
        return res.status(401).json({ error: "Incorrect password." });
      }
      if (authError.name === "CodeMismatchException") {
        return res.status(400).json({ error: "Invalid verification code. Please try again." });
      }
      throw authError;
    }

    // Password and TOTP verified - now disable MFA
    const setMfaCommand = new SetUserMFAPreferenceCommand({
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: {
        Enabled: false,
        PreferredMfa: false,
      },
    });

    await cognitoClient.send(setMfaCommand);

    logger.info("MFA disabled successfully", { userId: user.id });

    res.json({
      success: true,
      message: "MFA has been disabled.",
    });
  } catch (error: any) {
    logger.error("Error disabling MFA", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    res.status(500).json({ error: "Failed to disable MFA" });
  }
});

export default router;
