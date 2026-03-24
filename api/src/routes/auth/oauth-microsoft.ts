import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import axios from "axios";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, Organization, OrgInvite, UserOrganization } from "../../models/index.js";
import { randomBytes, randomUUID, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { TOS_VERSION } from "../../constants/tos.js";
import {
  decodeJwtPayload,
  setMicrosoftOAuthState,
  getMicrosoftOAuthState,
  createCognitoUserForMicrosoft,
  getCognitoTokensForUser,
} from "./helpers.js";

const router = Router();

/**
 * GET /api/auth/microsoft/config
 * Returns Microsoft OAuth configuration for frontend
 */
router.get("/microsoft/config", (_req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;

  if (!clientId) {
    return res.status(503).json({
      error: "Microsoft SSO not configured",
      enabled: false,
    });
  }

  res.json({
    enabled: true,
    clientId,
    // Use "organizations" endpoint for work accounts only (any Azure AD tenant)
    authorizeUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    scopes: "openid profile email",
  });
});

/**
 * GET /api/auth/microsoft/authorize
 * Generates Microsoft OAuth URL with state parameter
 * Returns the URL for frontend to redirect to
 */
router.get("/microsoft/authorize", async (req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const inviteToken = req.query.inviteToken as string | undefined;

  if (!clientId) {
    return res.status(503).json({ error: "Microsoft SSO not configured" });
  }

  // Generate state and PKCE code verifier
  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");

  // Store state with 10-minute expiration
  await setMicrosoftOAuthState(state, {
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
    inviteToken,
  });

  // Build redirect URI - use the requesting origin if available
  const origin = req.headers.origin || config.apiBaseUrl.replace("/api", "");
  const redirectUri = `${origin}/auth/microsoft/callback`;

  // Build authorize URL
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email User.Read",
    state,
    response_mode: "query",
    // PKCE with S256: code_challenge = BASE64URL(SHA256(code_verifier))
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
  });

  const authorizeUrl = `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;

  res.json({
    authorizeUrl,
    state,
    redirectUri,
  });
});

/**
 * POST /api/auth/microsoft/callback
 * Handles Microsoft OAuth callback - exchanges code for tokens
 * Creates/joins organization based on Azure tenant ID
 */
router.post(
  "/microsoft/callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
    body("state").isString().notEmpty().withMessage("State parameter is required"),
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

      const { code, redirectUri, state } = req.body;

      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: "Microsoft SSO not configured" });
      }

      // Verify state (required for CSRF protection)
      const stateData = await getMicrosoftOAuthState(state);
      if (!stateData) {
        return res.status(400).json({ error: "Invalid or expired state parameter" });
      }
      if (stateData.expiresAt < Date.now()) {
        return res.status(400).json({ error: "State parameter expired" });
      }
      const { codeVerifier, inviteToken } = stateData;

      // Exchange code for tokens with Microsoft
      const tokenParams: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      };

      const tokenResponse = await axios.post(
        "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
        new URLSearchParams(tokenParams),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const { id_token, access_token } = tokenResponse.data;

      if (!id_token) {
        return res.status(400).json({ error: "No ID token received from Microsoft" });
      }

      // Decode and validate ID token
      const idPayload = decodeJwtPayload(id_token);

      // Validate issuer - accept any Microsoft tenant
      const issuer = idPayload.iss;
      if (!issuer || !issuer.match(/^https:\/\/login\.microsoftonline\.com\/[a-f0-9-]+\/v2\.0$/)) {
        logger.error("Invalid Microsoft token issuer", { issuer });
        return res.status(400).json({ error: "Invalid token issuer" });
      }

      // Extract tenant ID and user info
      const tenantId = idPayload.tid;
      const email = idPayload.email || idPayload.preferred_username;
      const name = idPayload.name || email?.split("@")[0];

      if (!tenantId || !email) {
        logger.error("Missing required claims from Microsoft token", { tenantId, email });
        return res.status(400).json({ error: "Missing required claims from token" });
      }

      logger.info("Microsoft SSO: Processing user", { email, tenantId: tenantId.slice(0, 8) + "...", hasInviteToken: !!inviteToken });

      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      // Check if there's a pending valid invite for this email
      // If so, don't create/assign to Azure tenant org - user will join invited org via invite acceptance
      const pendingInvite = await inviteRepo.findOne({
        where: { email: email.toLowerCase(), accepted: false },
      });
      const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

      if (hasValidInvite) {
        logger.info("Microsoft SSO: User has pending invite, skipping Azure tenant org assignment", {
          email,
          inviteOrgId: pendingInvite.orgId,
          inviteToken: inviteToken ? "provided" : "not provided",
        });
      }

      // Find or create organization by Azure tenant ID (only if no valid invite)
      let org: Organization | null = hasValidInvite ? null : await orgRepo.findOne({ where: { azureTenantId: tenantId } });
      let isNewOrg = false;

      if (!hasValidInvite && !org) {
        // Try to get organization name from Microsoft Graph API
        let orgName = `Organization ${tenantId.slice(0, 8)}`;
        if (access_token) {
          try {
            const graphResponse = await axios.get("https://graph.microsoft.com/v1.0/organization", {
              headers: { Authorization: `Bearer ${access_token}` },
            });
            orgName = graphResponse.data.value?.[0]?.displayName || orgName;
          } catch (graphError) {
            logger.debug("Could not fetch org name from Microsoft Graph", { error: graphError });
          }
        }

        // Generate slug from organization name
        const baseSlug = orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        // Check for slug uniqueness and add suffix if needed
        let slug = baseSlug;
        let slugSuffix = 0;
        while (await orgRepo.findOne({ where: { slug } })) {
          slugSuffix++;
          slug = `${baseSlug}-${slugSuffix}`;
        }

        // Create new organization linked to Azure tenant
        const msRawKey = `org_${randomUUID().replace(/-/g, "")}`;
        org = orgRepo.create({
          name: orgName,
          slug,
          azureTenantId: tenantId,
          plan: "pro",
          taskQuota: 0, // Unlimited tasks (feature-gated, not quota-based)
          trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),

          apiKeyHash: await bcrypt.hash(msRawKey, 10),
          apiKeyPrefix: msRawKey.substring(0, 12),
        });
        await orgRepo.save(org);
        isNewOrg = true;

        logger.info("Microsoft SSO: Created new organization", { orgId: org.id, orgName, slug, tenantId: tenantId.slice(0, 8) + "..." });
      }

      // Find or create user
      let user = await userRepo.findOne({ where: { email } });
      let isNewUser = false;

      if (!user) {
        // Create Cognito user for this Microsoft-authenticated user
        const tempPassword = randomBytes(16).toString("base64") + "!A1";
        const cognitoId = await createCognitoUserForMicrosoft(email, name, tempPassword);

        if (hasValidInvite) {
          // User has a pending invite - create user WITHOUT an org
          // They will join the invited org via /api/invites/:token/accept
          user = userRepo.create({
            cognitoId,
            email,
            fullName: name,
            role: "member", // Will be set by invite acceptance
            status: "active",
            orgId: null, // No org yet - will be assigned on invite acceptance
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);
          isNewUser = true;

          logger.info("Microsoft SSO: Created new user (pending invite acceptance)", {
            userId: user.id,
            email,
            inviteOrgId: pendingInvite.orgId,
          });
        } else {
          // No invite - assign to Azure tenant org
          // Determine role - first user in org is admin
          const existingUsers = await userRepo.count({ where: { orgId: org!.id } });
          const role = existingUsers === 0 || isNewOrg ? "admin" : "member";

          user = userRepo.create({
            cognitoId,
            email,
            fullName: name,
            role,
            status: "active",
            orgId: null, // UserOrganization is source of truth
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);
          isNewUser = true;

          // Create UserOrganization record for multi-org support
          const userOrgRepo = AppDataSource.getRepository(UserOrganization);
          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org!.id,
            role: role as "admin" | "member" | "viewer",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          logger.info("Microsoft SSO: Created new user", { userId: user.id, email, role, orgId: org!.id });
        }
      } else {
        // Existing user — auto-accept TOS on SSO login
        if (user.tosVersion !== TOS_VERSION) {
          await userRepo.update(
            { id: user.id },
            { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
          );
          user.tosVersion = TOS_VERSION;
        }

        // Existing user - check their org memberships
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const userMemberships = await userOrgRepo.find({ where: { userId: user.id } });

        if (userMemberships.length === 0 && !hasValidInvite && org) {
          // User has no org memberships - link to Azure tenant org
          const existingMembers = await userOrgRepo.count({ where: { orgId: org.id } });
          const assignedRole = existingMembers === 0 || isNewOrg ? "admin" : "member";

          user.status = "active";
          await userRepo.save(user);

          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org.id,
            role: assignedRole as "admin" | "member" | "viewer",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          logger.info("Microsoft SSO: Linked existing user to org", { userId: user.id, orgId: org.id });
        } else if (org) {
          // User has existing memberships - check if they're in the Azure tenant org
          const azureOrgMembership = userMemberships.find(m => m.orgId === org.id);
          if (!azureOrgMembership) {
            // User belongs to different org(s) - log but allow login
            logger.warn("Microsoft SSO: User already belongs to different org(s)", {
              userId: user.id,
              existingOrgIds: userMemberships.map(m => m.orgId),
              azureOrgId: org.id,
            });
          }
        }
      }

      // Get user's role from UserOrganization for response
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const defaultMembership = await userOrgRepo.findOne({
        where: { userId: user.id, isDefault: true },
      }) || await userOrgRepo.findOne({
        where: { userId: user.id },
        order: { joinedAt: "ASC" },
      });
      const userRole = defaultMembership?.role || "member";

      // Generate Cognito tokens for the user
      const tokens = await getCognitoTokensForUser(user.cognitoId, user.email);

      res.json({
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          expiresIn: tokens.expiresIn,
        },
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: userRole,
          status: user.status,
        },
        organization: org ? {
          id: org.id,
          name: org.name,
          plan: org.plan,
          trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null,
          stripeSubscriptionStatus: org.stripeSubscriptionStatus,
        } : null,
        isNewUser,
        isNewOrg,
        // Let frontend know user needs to accept an invite
        pendingInvite: hasValidInvite,
        // Pass invite token if frontend needs to redirect to accept
        inviteToken: hasValidInvite ? inviteToken : undefined,
      });
    } catch (error: any) {
      logger.error("Microsoft SSO callback error", {
        error: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 400) {
        return res.status(400).json({
          error: "Invalid authorization code or it has expired",
        });
      }

      res.status(500).json({ error: "Microsoft SSO authentication failed" });
    }
  }
);

export default router;
