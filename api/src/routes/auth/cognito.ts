import { Router, Request, Response } from "express";
import {
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  AdminSetUserMFAPreferenceCommand,
  AuthFlowType as AdminAuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, OrgInvite } from "../../models/index.js";
import { TOS_VERSION } from "../../constants/tos.js";
import bcrypt from "bcryptjs";
import { cognitoClient, decodeJwtPayload } from "./helpers.js";

const router = Router();

/**
 * POST /api/auth/login
 * Login with email and password via Cognito
 * Returns MFA challenge info if MFA is enabled
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const command = new InitiateAuthCommand({
      AuthFlow: AdminAuthFlowType.USER_PASSWORD_AUTH,
      ClientId: config.cognito.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

    // Check if MFA challenge is required
    if (response.ChallengeName === "SOFTWARE_TOKEN_MFA") {
      logger.info("MFA challenge required for login", { email });
      return res.json({
        challengeRequired: true,
        challengeName: response.ChallengeName,
        session: response.Session,
        email,
      });
    }

    if (!response.AuthenticationResult) {
      return res.status(401).json({ error: "Authentication failed" });
    }

    const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
      response.AuthenticationResult;

    // Auto-provision user if not exists (without org - they'll complete setup on first visit)
    if (IdToken) {
      try {
        const idPayload = decodeJwtPayload(IdToken);
        const cognitoId = idPayload.sub;
        const userEmail = idPayload.email;

        const userRepo = AppDataSource.getRepository(User);

        let user = await userRepo.findOne({ where: { cognitoId } });

        if (!user) {
          // Check for pending invite before auto-provisioning
          const inviteRepo = AppDataSource.getRepository(OrgInvite);
          const pendingInvite = await inviteRepo.findOne({
            where: { email: userEmail.toLowerCase(), accepted: false },
          });
          const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

          logger.info("Auto-provisioning new user (pending setup)", {
            email: userEmail,
            cognitoId,
            hasValidInvite,
            inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
          });

          // Create user WITHOUT org - they'll complete setup via invite acceptance or onboarding
          user = userRepo.create({
            cognitoId,
            email: userEmail.toLowerCase(), // Normalize email
            fullName: userEmail.split("@")[0],
            role: hasValidInvite ? "member" : "admin", // Member if invited, admin if creating own org
            status: "active",
            orgId: null, // No org yet - requires invite acceptance or onboarding
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("User provisioned (pending org setup)", { userId: user.id, hasValidInvite });
        }
      } catch (provisionError) {
        logger.error("Failed to auto-provision user", { error: provisionError });
        // Continue anyway - login succeeded, provisioning is best-effort
      }
    }

    res.json({
      tokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        idToken: IdToken,
        expiresIn: ExpiresIn,
      },
    });
  } catch (error: any) {
    logger.error("Login error", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (error.name === "UserNotFoundException") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (error.name === "UserNotConfirmedException") {
      return res.status(401).json({ error: "Please confirm your email first" });
    }

    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/mfa-challenge
 * Complete MFA login challenge with TOTP code
 */
router.post("/mfa-challenge", async (req: Request, res: Response) => {
  try {
    const { email, session, code } = req.body;

    if (!email || !session || !code) {
      return res.status(400).json({ error: "Email, session, and verification code are required" });
    }

    if (typeof code !== "string" || code.length !== 6) {
      return res.status(400).json({ error: "Verification code must be 6 digits" });
    }

    const command = new RespondToAuthChallengeCommand({
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      ClientId: config.cognito.clientId,
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    });

    const response = await cognitoClient.send(command);

    if (!response.AuthenticationResult) {
      return res.status(401).json({ error: "MFA verification failed" });
    }

    const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
      response.AuthenticationResult;

    // Auto-provision user if not exists (without org - they'll complete setup on first visit)
    if (IdToken) {
      try {
        const idPayload = decodeJwtPayload(IdToken);
        const cognitoId = idPayload.sub;
        const userEmail = idPayload.email;

        const userRepo = AppDataSource.getRepository(User);

        let user = await userRepo.findOne({ where: { cognitoId } });

        if (!user) {
          // Check for pending invite before auto-provisioning
          const inviteRepo = AppDataSource.getRepository(OrgInvite);
          const pendingInvite = await inviteRepo.findOne({
            where: { email: userEmail.toLowerCase(), accepted: false },
          });
          const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

          logger.info("Auto-provisioning new user (pending setup)", {
            email: userEmail,
            cognitoId,
            hasValidInvite,
            inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
          });

          // Create user WITHOUT org - they'll complete setup via invite acceptance or onboarding
          user = userRepo.create({
            cognitoId,
            email: userEmail.toLowerCase(), // Normalize email
            fullName: userEmail.split("@")[0],
            role: hasValidInvite ? "member" : "admin", // Member if invited, admin if creating own org
            status: "active",
            orgId: null, // No org yet - requires invite acceptance or onboarding
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("User provisioned (pending org setup)", { userId: user.id, hasValidInvite });
        }
      } catch (provisionError) {
        logger.error("Failed to auto-provision user", { error: provisionError });
      }
    }

    logger.info("MFA challenge completed successfully", { email });

    res.json({
      tokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        idToken: IdToken,
        expiresIn: ExpiresIn,
      },
    });
  } catch (error: any) {
    logger.error("MFA challenge error", { error: error.message });

    if (error.name === "CodeMismatchException") {
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    if (error.name === "ExpiredCodeException" || error.name === "NotAuthorizedException") {
      return res.status(400).json({ error: "Session expired. Please start the login process again." });
    }

    res.status(500).json({ error: "MFA verification failed" });
  }
});

/**
 * POST /api/auth/mfa/recover
 * Recover account using a backup code when MFA device is lost.
 * Accepts { email, backupCode }, verifies against stored hashed codes,
 * disables MFA on the Cognito account, and removes the used code.
 * User can then log in normally and re-setup MFA if desired.
 */
router.post("/mfa/recover", async (req: Request, res: Response) => {
  try {
    const { email, backupCode } = req.body;

    if (!email || !backupCode) {
      return res.status(400).json({ error: "Email and backup code are required" });
    }

    if (typeof backupCode !== "string" || backupCode.length !== 8) {
      return res.status(400).json({ error: "Backup code must be an 8-character string" });
    }

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      // Return generic error to prevent email enumeration
      return res.status(400).json({ error: "Invalid email or backup code" });
    }

    if (!user.mfaBackupCodes || user.mfaBackupCodes.length === 0) {
      return res.status(400).json({ error: "No backup codes available for this account" });
    }

    // Check each hashed backup code
    let matchedIndex = -1;
    for (let i = 0; i < user.mfaBackupCodes.length; i++) {
      const isMatch = await bcrypt.compare(backupCode, user.mfaBackupCodes[i]);
      if (isMatch) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      return res.status(400).json({ error: "Invalid email or backup code" });
    }

    // Remove the used backup code
    const updatedCodes = [...user.mfaBackupCodes];
    updatedCodes.splice(matchedIndex, 1);

    // Disable MFA on Cognito using admin API (no access token needed)
    try {
      const disableMfaCommand = new AdminSetUserMFAPreferenceCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: user.email,
        SoftwareTokenMfaSettings: {
          Enabled: false,
          PreferredMfa: false,
        },
      });

      await cognitoClient.send(disableMfaCommand);
    } catch (cognitoError: any) {
      logger.error("Failed to disable MFA in Cognito during recovery", {
        userId: user.id,
        error: cognitoError.message,
      });
      return res.status(500).json({ error: "Failed to disable MFA. Please contact support." });
    }

    // Update user: clear backup codes array with used code removed
    await userRepo.update({ id: user.id }, { mfaBackupCodes: updatedCodes });

    logger.info("MFA recovered via backup code", {
      userId: user.id,
      remainingCodes: updatedCodes.length,
    });

    res.json({
      success: true,
      message: "MFA has been disabled. You can now log in with your email and password. You may re-enable MFA from your profile settings.",
      remainingBackupCodes: updatedCodes.length,
    });
  } catch (error) {
    logger.error("Error during MFA recovery", { error });
    res.status(500).json({ error: "MFA recovery failed" });
  }
});

/**
 * POST /api/auth/logout
 * Logout endpoint (client-side token invalidation)
 * Note: Actual token invalidation happens client-side with Cognito
 */
router.post("/logout", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Logout successful. Please clear tokens client-side.",
  });
});

export default router;
