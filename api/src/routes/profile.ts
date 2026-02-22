import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  ChangePasswordCommand,
  GlobalSignOutCommand,
  AdminDeleteUserCommand,
  GetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import {
  User,
  UserApiKey,
  UserOrganization,
  WorkerTask,
  WorkerTaskLog,
  AuditLog,
  type UserPreferences,
} from "../models/index.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);
router.use(requireCurrentTos);

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
 * GET /api/profile/export-data
 * Export all user data as JSON (GDPR Right of Access / Data Portability)
 */
router.get("/export-data", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const userOrgRepo = AppDataSource.getRepository(UserOrganization);
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const taskLogRepo = AppDataSource.getRepository(WorkerTaskLog);
    const auditLogRepo = AppDataSource.getRepository(AuditLog);
    const apiKeyRepo = AppDataSource.getRepository(UserApiKey);

    // Gather all user data
    const organizations = await userOrgRepo.find({
      where: { userId: user.id },
    });

    const orgIds = organizations.map((o) => o.orgId);

    // Get tasks from all user's organizations
    const tasks = orgIds.length
      ? await taskRepo
          .createQueryBuilder("task")
          .where("task.org_id IN (:...orgIds)", { orgIds })
          .orderBy("task.created_at", "DESC")
          .getMany()
      : [];

    const taskIds = tasks.map((t) => t.id);

    // Get task logs for user's tasks
    const taskLogs = taskIds.length
      ? await taskLogRepo
          .createQueryBuilder("log")
          .where("log.task_id IN (:...taskIds)", { taskIds })
          .orderBy("log.created_at", "DESC")
          .limit(10000) // Cap to prevent enormous exports
          .getMany()
      : [];

    // Get audit logs for the user
    const auditLogs = await auditLogRepo.find({
      where: { userId: user.id },
      order: { createdAt: "DESC" },
      take: 10000,
    });

    // Get API keys (metadata only, no hashes)
    const apiKeys = await apiKeyRepo.find({
      where: { userId: user.id },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        preferences: user.preferences,
        referralCode: user.referralCode,
        referredByCode: user.referredByCode,
        tosAcceptedAt: user.tosAcceptedAt,
        tosVersion: user.tosVersion,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      organizations: organizations.map((o) => ({
        orgId: o.orgId,
        role: o.role,
        isDefault: o.isDefault,
        joinedAt: o.joinedAt,
      })),
      apiKeys: apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        summary: t.summary,
        description: t.description,
        status: t.status,
        workerPersona: t.workerPersona,
        workerModel: t.workerModel,
        githubRepo: t.githubRepo,
        githubBranch: t.githubBranch,
        githubPrUrl: t.githubPrUrl,
        estimatedCostUsd: t.estimatedCostUsd,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      taskLogs: taskLogs.map((l) => ({
        id: l.id,
        taskId: l.taskId,
        type: l.type,
        message: l.message,
        severity: l.severity,
        createdAt: l.createdAt,
      })),
      auditLogs: auditLogs.map((a) => ({
        id: a.id,
        action: a.action,
        resourceType: a.resourceType,
        resourceId: a.resourceId,
        description: a.description,
        createdAt: a.createdAt,
      })),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="workermill-data-export-${user.id}.json"`);
    res.json(exportData);
  } catch (error) {
    logger.error("Error exporting user data", { error });
    res.status(500).json({ error: "Failed to export user data" });
  }
});

/**
 * POST /api/profile/delete-account
 * Hard delete user account and all associated data (GDPR Right to Erasure)
 * Uses a database transaction for atomicity.
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

    const userId = user.id;
    const userEmail = user.email;

    // Use a transaction to ensure atomicity
    await AppDataSource.transaction(async (manager) => {
      // 1. Find all tasks belonging to user's organizations
      const userOrgs = await manager.getRepository(UserOrganization).find({
        where: { userId },
      });
      const orgIds = userOrgs.map((o) => o.orgId);

      // 2. Delete task logs for tasks in user's organizations
      if (orgIds.length > 0) {
        const taskIds = await manager
          .getRepository(WorkerTask)
          .createQueryBuilder("task")
          .select("task.id")
          .where("task.org_id IN (:...orgIds)", { orgIds })
          .getMany();

        const ids = taskIds.map((t) => t.id);

        if (ids.length > 0) {
          await manager
            .createQueryBuilder()
            .delete()
            .from(WorkerTaskLog)
            .where("task_id IN (:...ids)", { ids })
            .execute();

          // 3. Delete tasks
          await manager
            .createQueryBuilder()
            .delete()
            .from(WorkerTask)
            .where("org_id IN (:...orgIds)", { orgIds })
            .execute();
        }
      }

      // 4. Delete audit logs for the user
      await manager
        .createQueryBuilder()
        .delete()
        .from(AuditLog)
        .where("user_id = :userId", { userId })
        .execute();

      // 5. Delete API keys
      await manager
        .createQueryBuilder()
        .delete()
        .from(UserApiKey)
        .where("user_id = :userId", { userId })
        .execute();

      // 6. Delete user-organization memberships
      await manager
        .createQueryBuilder()
        .delete()
        .from(UserOrganization)
        .where("user_id = :userId", { userId })
        .execute();

      // 7. Delete the user record
      await manager
        .createQueryBuilder()
        .delete()
        .from(User)
        .where("id = :userId", { userId })
        .execute();
    });

    // Delete user from Cognito (outside transaction - best effort)
    try {
      const command = new AdminDeleteUserCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: userEmail,
      });

      await cognitoClient.send(command);
      logger.info("User deleted from Cognito", { userId, email: userEmail });
    } catch (cognitoError: any) {
      // Log but don't fail - the DB deletion is the important part
      logger.warn("Failed to delete user from Cognito", {
        userId,
        error: cognitoError.message,
      });
    }

    logger.info("Account hard-deleted (GDPR erasure)", { userId, email: userEmail });

    res.json({
      success: true,
      message: "Your account and all associated data have been permanently deleted. You will be logged out.",
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

    // Generate 10 backup recovery codes
    const plainBackupCodes: string[] = [];
    const hashedBackupCodes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const backupCode = crypto.randomBytes(4).toString("hex"); // 8-character alphanumeric
      plainBackupCodes.push(backupCode);
      const hashed = await bcrypt.hash(backupCode, 10);
      hashedBackupCodes.push(hashed);
    }

    // Store hashed backup codes on the user
    const userRepo = AppDataSource.getRepository(User);
    await userRepo.update({ id: user.id }, { mfaBackupCodes: hashedBackupCodes });

    logger.info("MFA enabled successfully with backup codes", { userId: user.id });

    res.json({
      success: true,
      message: "MFA has been enabled successfully. Save your backup codes in a safe place.",
      backupCodes: plainBackupCodes,
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
