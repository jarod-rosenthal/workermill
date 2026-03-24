import { Router, Request, Response } from "express";
import { ListIdentityProvidersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { body, validationResult } from "express-validator";
import axios from "axios";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, OrgInvite } from "../../models/index.js";
import { TOS_VERSION } from "../../constants/tos.js";
import { cognitoClient, decodeJwtPayload } from "./helpers.js";

const router = Router();

/**
 * GET /api/auth/sso-config
 * Get SSO configuration for the frontend
 * Returns available identity providers and OAuth URLs
 */
router.get("/sso-config", async (_req: Request, res: Response) => {
  try {
    // Get list of identity providers from Cognito
    const command = new ListIdentityProvidersCommand({
      UserPoolId: config.cognito.userPoolId,
      MaxResults: 10,
    });

    const response = await cognitoClient.send(command);
    const providers = response.Providers || [];

    // Build list of enabled providers
    const enabledProviders: { name: string; displayName: string }[] = [];

    for (const provider of providers) {
      if (provider.ProviderName === "Google") {
        enabledProviders.push({ name: "Google", displayName: "Google" });
      } else if (provider.ProviderName === "Microsoft") {
        enabledProviders.push({ name: "Microsoft", displayName: "Microsoft" });
      } else if (provider.ProviderName === "Facebook") {
        enabledProviders.push({ name: "Facebook", displayName: "Facebook" });
      } else if (provider.ProviderName === "SignInWithApple") {
        enabledProviders.push({ name: "SignInWithApple", displayName: "Apple" });
      }
    }

    // Also add Microsoft if direct OAuth is configured (independent of Cognito)
    // This supports the work account SSO flow at /api/auth/microsoft/authorize
    const hasMicrosoftDirect = process.env.MICROSOFT_CLIENT_ID && !enabledProviders.some(p => p.name === "Microsoft");
    if (hasMicrosoftDirect) {
      enabledProviders.push({ name: "Microsoft", displayName: "Microsoft" });
    }

    // Also add GitHub if direct OAuth is configured
    const hasGitHubDirect = process.env.GITHUB_CLIENT_ID && !enabledProviders.some(p => p.name === "GitHub");
    if (hasGitHubDirect) {
      enabledProviders.push({ name: "GitHub", displayName: "GitHub" });
    }

    // Build Cognito hosted UI base URL
    // Custom domains (auth.workermill.com) contain dots, prefix domains don't
    const cognitoDomain = config.cognito.domain;
    const region = config.cognito.region;
    const isCustomDomain = cognitoDomain.includes(".");
    const hostedUiBaseUrl = isCustomDomain
      ? `https://${cognitoDomain}`
      : `https://${cognitoDomain}.auth.${region}.amazoncognito.com`;

    res.json({
      enabled: enabledProviders.length > 0,
      providers: enabledProviders,
      clientId: config.cognito.clientId,
      hostedUiBaseUrl,
      // Frontend uses this to build the OAuth authorize URL
      // e.g., {hostedUiBaseUrl}/oauth2/authorize?identity_provider=Google&...
    });
  } catch (error) {
    logger.error("Error fetching SSO config", { error });
    res.status(500).json({ error: "Failed to get SSO configuration" });
  }
});

/**
 * POST /api/auth/sso-callback
 * Exchange OAuth authorization code for tokens
 * Called by frontend after user returns from SSO provider
 */
router.post(
  "/sso-callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { code, redirectUri } = req.body;

      // Exchange authorization code for tokens via Cognito token endpoint
      // Custom domains (auth.workermill.com) contain dots, prefix domains don't
      const cognitoDomain = config.cognito.domain;
      const region = config.cognito.region;
      const isCustomDomain = cognitoDomain.includes(".");
      const tokenUrl = isCustomDomain
        ? `https://${cognitoDomain}/oauth2/token`
        : `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;

      const tokenResponse = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.cognito.clientId,
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const { access_token, refresh_token, id_token, expires_in } = tokenResponse.data;

      // Auto-provision user if not exists
      if (id_token) {
        try {
          const idPayload = decodeJwtPayload(id_token);
          const cognitoId = idPayload.sub;
          const userEmail = idPayload.email;

          const userRepo = AppDataSource.getRepository(User);

          let user = await userRepo.findOne({ where: { cognitoId } });

          if (!user) {
            // Check if user exists by email (could have been invited)
            user = await userRepo.findOne({ where: { email: userEmail.toLowerCase() } });

            if (user) {
              // Link existing user to Cognito
              user.cognitoId = cognitoId;
              user.status = "active";
              if (user.tosVersion !== TOS_VERSION) {
                user.tosAcceptedAt = new Date();
                user.tosVersion = TOS_VERSION;
              }
              await userRepo.save(user);
              logger.info("Linked SSO user to existing account", { email: userEmail, cognitoId });
            } else {
              // Check for pending invite before auto-provisioning
              const inviteRepo = AppDataSource.getRepository(OrgInvite);
              const pendingInvite = await inviteRepo.findOne({
                where: { email: userEmail.toLowerCase(), accepted: false },
              });
              const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

              // Create new user without org - they'll complete setup via invite or onboarding
              logger.info("Auto-provisioning new SSO user (pending setup)", {
                email: userEmail,
                cognitoId,
                hasValidInvite,
                inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
              });

              user = userRepo.create({
                cognitoId,
                email: userEmail.toLowerCase(), // Normalize email
                fullName: idPayload.name || userEmail.split("@")[0],
                role: hasValidInvite ? "member" : "admin",
                status: "active",
                orgId: null, // No org yet - requires invite acceptance or onboarding
                tosAcceptedAt: new Date(),
                tosVersion: TOS_VERSION,
              });
              await userRepo.save(user);

              logger.info("SSO user provisioned (pending org setup)", { userId: user.id, hasValidInvite });

              // Return invite token so frontend can redirect to invite acceptance
              if (hasValidInvite) {
                return res.json({
                  tokens: {
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    idToken: id_token,
                    expiresIn: expires_in,
                  },
                  pendingInvite: true,
                  inviteToken: pendingInvite.token,
                });
              }
            }
          }
        } catch (provisionError) {
          logger.error("Failed to auto-provision SSO user", { error: provisionError });
          // Continue anyway - SSO succeeded, provisioning is best-effort
        }
      }

      res.json({
        tokens: {
          accessToken: access_token,
          refreshToken: refresh_token,
          idToken: id_token,
          expiresIn: expires_in,
        },
      });
    } catch (error: any) {
      logger.error("SSO callback error", {
        error: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 400) {
        return res.status(400).json({
          error: "Invalid authorization code or it has expired",
        });
      }

      res.status(500).json({ error: "SSO authentication failed" });
    }
  }
);

export default router;
