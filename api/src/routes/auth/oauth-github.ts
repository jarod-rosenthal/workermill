import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { authenticateApiKey, authenticateUserAllowNoOrg } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, Organization, OrgInvite, UserOrganization, UserApiKey } from "../../models/index.js";
import { notifyNewSignup } from "../../services/admin-notifications.js";
import { sendWelcomeEmail } from "../../services/email/index.js";
import {
  getDefaultOrganization,
  getUserOrganizations,
  hasOrgAccess,
} from "../../services/user-organizations.js";
import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { TOS_VERSION } from "../../constants/tos.js";
import { logTosAccepted } from "../../services/audit.js";
import { createStore } from "../../middleware/rate-limit.js";
import {
  decodeJwtPayload,
  setGithubOAuthState,
  getGithubOAuthState,
  createCognitoUserForMicrosoft,
  getCognitoTokensForUser,
} from "./helpers.js";

const router = Router();

// =============================================================================
// GitHub OAuth SSO (Web Login — Direct OAuth, not via Cognito)
// =============================================================================

/**
 * GET /api/auth/github/config
 * Returns GitHub OAuth configuration for frontend
 */
router.get("/github/config", (_req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    return res.json({ enabled: false });
  }

  res.json({ enabled: true, clientId });
});

/**
 * GET /api/auth/github/authorize
 * Generates GitHub OAuth URL with state parameter
 */
router.get("/github/authorize", async (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const inviteToken = req.query.inviteToken as string | undefined;

  if (!clientId) {
    return res.status(503).json({ error: "GitHub SSO not configured" });
  }

  const state = randomBytes(32).toString("hex");
  await setGithubOAuthState(state, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    inviteToken,
  });

  const origin = req.headers.origin || config.apiBaseUrl.replace("/api", "");
  const redirectUri = `${origin}/auth/github/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email repo",
    state,
  });

  const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

  res.json({ authorizeUrl, state, redirectUri });
});

/**
 * POST /api/auth/github/callback
 * Handles GitHub OAuth callback — exchanges code for tokens, creates/finds user
 */
router.post(
  "/github/callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
    body("state").isString().notEmpty().withMessage("State parameter is required"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Validation failed", details: errors.array() });
      }

      const { code, redirectUri, state } = req.body;
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: "GitHub SSO not configured" });
      }

      // Verify state (required for CSRF protection)
      const stateData = await getGithubOAuthState(state);
      if (!stateData) {
        return res.status(400).json({ error: "Invalid or expired state parameter" });
      }
      if (stateData.expiresAt < Date.now()) {
        return res.status(400).json({ error: "State parameter expired" });
      }
      const inviteToken = stateData.inviteToken;

      // Exchange code for access token
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
        { headers: { Accept: "application/json" } },
      );

      const githubToken = tokenResponse.data.access_token;
      if (!githubToken) {
        return res.status(400).json({ error: "Failed to get access token from GitHub" });
      }

      // Get user info and email from GitHub
      let githubUser: { login: string; name: string | null; id: number };
      let primaryEmail: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        githubUser = userResponse.data;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      const name = githubUser.name || githubUser.login;
      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);

      // Check for pending invite
      const pendingInvite = await inviteRepo.findOne({
        where: { email: primaryEmail.toLowerCase(), accepted: false },
      });
      const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

      let user = await userRepo.findOne({ where: { email: primaryEmail } });
      let org: Organization | null = null;
      let isNewUser = false;
      let isNewOrg = false;

      if (!user) {
        // New user — create Cognito account + org
        isNewUser = true;

        const tempPassword = randomBytes(32).toString("base64") + "!A1";
        const cognitoId = await createCognitoUserForMicrosoft(primaryEmail, name, tempPassword);

        if (hasValidInvite) {
          // User has invite — create without org, they'll accept invite after
          user = userRepo.create({
            cognitoId,
            email: primaryEmail.toLowerCase(),
            fullName: name,
            role: "member",
            status: "active",
            orgId: null,
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("GitHub SSO: Created new user (pending invite)", { userId: user.id, email: primaryEmail });
        } else {
          // No invite — create org linked to GitHub
          isNewOrg = true;
          const login = githubUser.login;
          const baseSlug = login.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          let slug = baseSlug;
          let slugSuffix = 0;
          while (await orgRepo.findOne({ where: { slug } })) {
            slugSuffix++;
            slug = `${baseSlug}-${slugSuffix}`;
          }

          const rawKey = `org_${randomUUID().replace(/-/g, "")}`;
          org = orgRepo.create({
            name: `${login}'s org`,
            slug,
            plan: "pro",
            taskQuota: 0,
            scmProvider: "github",
            trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            apiKeyHash: await bcrypt.hash(rawKey, 10),
            apiKeyPrefix: rawKey.substring(0, 12),
          });
          await orgRepo.save(org);

          user = userRepo.create({
            cognitoId,
            email: primaryEmail.toLowerCase(),
            fullName: name,
            role: "admin",
            status: "active",
            orgId: null,
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org.id,
            role: "admin",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          notifyNewSignup({ email: primaryEmail, fullName: name, organizationName: org.name }).catch(() => {});
          sendWelcomeEmail(user, org, false).catch(() => {});

          logger.info("GitHub SSO: Created new user + org", { userId: user.id, orgId: org.id, email: primaryEmail });
        }
      } else {
        // Existing user — find their org
        const defaultMembership = await userOrgRepo.findOne({
          where: { userId: user.id, isDefault: true },
        }) || await userOrgRepo.findOne({
          where: { userId: user.id },
          order: { joinedAt: "ASC" },
        });

        if (defaultMembership) {
          org = await orgRepo.findOne({ where: { id: defaultMembership.orgId } }) || null;

        }

        // Auto-accept TOS on SSO login (user already accepted via GitHub OAuth consent)
        if (user.tosVersion !== TOS_VERSION) {
          await userRepo.update(
            { id: user.id },
            { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
          );
          user.tosVersion = TOS_VERSION;
        }

        logger.info("GitHub SSO: Existing user login", { userId: user.id, email: primaryEmail });
      }

      // Get Cognito tokens for web auth
      const tokens = await getCognitoTokensForUser(user.cognitoId, user.email);

      // Get user role
      const membership = await userOrgRepo.findOne({
        where: { userId: user.id, isDefault: true },
      }) || await userOrgRepo.findOne({
        where: { userId: user.id },
        order: { joinedAt: "ASC" },
      });
      const userRole = membership?.role || "member";

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
        organization: org ? { id: org.id, name: org.name, plan: org.plan, trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null, stripeSubscriptionStatus: org.stripeSubscriptionStatus } : null,
        isNewUser,
        isNewOrg,
        pendingInvite: hasValidInvite,
        inviteToken: hasValidInvite ? inviteToken : undefined,
      });
    } catch (error: any) {
      logger.error("GitHub SSO callback error", { error: error.message, response: error.response?.data });

      if (error.response?.status === 400) {
        return res.status(400).json({ error: "Invalid authorization code or it has expired" });
      }

      res.status(500).json({ error: "GitHub SSO authentication failed" });
    }
  },
);

// =============================================================================
// GitHub Onboarding (VS Code Extension)
// =============================================================================

const githubOnboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many signup attempts" },
  ...createStore("rl:ghonboard:"),
});

/**
 * POST /api/auth/github-onboard
 * Zero-friction signup via GitHub token (VS Code extension onboarding)
 */
router.post(
  "/github-onboard",
  githubOnboardLimiter,
  [
    body("githubToken").isString().notEmpty().withMessage("githubToken is required"),
    body("githubUsername").isString().notEmpty().withMessage("githubUsername is required"),
    body("tosAccepted").isBoolean().equals("true").withMessage("Terms of Service must be accepted"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { githubToken, githubUsername, tosAccepted } = req.body;

      // Validate GitHub token and get user info
      let githubUser: { login: string; name: string | null; id: number };
      let primaryEmail: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        githubUser = userResponse.data;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      // Check for duplicate email
      const userRepo = AppDataSource.getRepository(User);
      const existingUser = await userRepo.findOne({ where: { email: primaryEmail } });
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists. Use /github-signin instead." });
      }

      // Create Cognito user
      const tempPassword = randomBytes(32).toString("base64") + "!A1";
      const name = githubUser.name || githubUsername;
      const cognitoId = await createCognitoUserForMicrosoft(primaryEmail, name, tempPassword);

      // Create Organization
      const orgRepo = AppDataSource.getRepository(Organization);
      // Use validated GitHub login for slug (not client-provided username)
      const login = githubUser.login;
      const baseSlug = login
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      let slug = baseSlug;
      let slugSuffix = 0;
      while (await orgRepo.findOne({ where: { slug } })) {
        slugSuffix++;
        slug = `${baseSlug}-${slugSuffix}`;
      }

      const rawKey = `org_${randomUUID().replace(/-/g, "")}`;
      const org = orgRepo.create({
        name: `${login}'s org`,
        slug,
        plan: "pro",
        taskQuota: 0,
        scmProvider: "github",
        trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        apiKeyHash: await bcrypt.hash(rawKey, 10),
        apiKeyPrefix: rawKey.substring(0, 12),
      });
      await orgRepo.save(org);

      // Create User
      const user = userRepo.create({
        cognitoId,
        email: primaryEmail,
        fullName: name,
        role: "admin",
        status: "active",
        orgId: null,
        tosAcceptedAt: tosAccepted ? new Date() : null,
        tosVersion: tosAccepted ? TOS_VERSION : null,
      });
      await userRepo.save(user);

      // Create UserOrganization
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const userOrgMembership = userOrgRepo.create({
        userId: user.id,
        orgId: org.id,
        role: "admin",
        isDefault: true,
      });
      await userOrgRepo.save(userOrgMembership);

      // Create a user API key (per-user, auditable) instead of exposing the org key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      // Fire notifications (non-blocking)
      notifyNewSignup({ email: primaryEmail, fullName: name, organizationName: org.name }).catch(() => {});
      sendWelcomeEmail(user, org, false).catch(() => {});

      if (tosAccepted) {
        logTosAccepted(
          { organizationId: org.id, userId: user.id, ipAddress: req.ip || null },
          TOS_VERSION,
          "github-onboard",
        ).catch(() => {});
      }

      logger.info("GitHub onboard completed", { userId: user.id, orgId: org.id, email: primaryEmail });

      res.status(201).json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: primaryEmail,
        name,
        organizations: [{ id: org.id, name: org.name, slug, role: "admin" }],
      });
    } catch (error) {
      logger.error("GitHub onboard failed", { error });
      res.status(500).json({ error: "GitHub onboarding failed" });
    }
  },
);

/**
 * POST /api/auth/github-signin
 * Existing account setup via GitHub token (VS Code extension)
 */
router.post(
  "/github-signin",
  githubOnboardLimiter,
  [body("githubToken").isString().notEmpty().withMessage("githubToken is required")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { githubToken, orgId: requestedOrgId } = req.body;

      // Validate GitHub token and get user info
      let primaryEmail: string;
      let name: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        name = userResponse.data.name || userResponse.data.login;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      // Find existing user
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { email: primaryEmail } });
      if (!user) {
        return res.status(404).json({ error: "No account found with this email. Use /github-onboard to create one." });
      }

      // Get all user organizations
      const userOrgs = await getUserOrganizations(user.id);

      // Determine target org: use requested orgId if provided and user is a member, else default
      let org: Organization | null;
      if (requestedOrgId) {
        const isMember = await hasOrgAccess(user.id, requestedOrgId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of the requested organization" });
        }
        const orgRepo = AppDataSource.getRepository(Organization);
        org = await orgRepo.findOneBy({ id: requestedOrgId });
      } else {
        org = await getDefaultOrganization(user.id);
      }
      if (!org) {
        return res.status(404).json({ error: "No organization found for this account" });
      }

      // Create a user API key (per-user, auditable) instead of rotating the shared org key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      // Auto-accept TOS on SSO login
      if (user.tosVersion !== TOS_VERSION) {
        await userRepo.update(
          { id: user.id },
          { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
        );
      }

      logger.info("GitHub signin completed", { userId: user.id, orgId: org.id, email: primaryEmail });

      res.json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: org.slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: primaryEmail,
        name,
        organizations: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      });
    } catch (error) {
      logger.error("GitHub signin failed", { error });
      res.status(500).json({ error: "GitHub signin failed" });
    }
  },
);

/**
 * POST /api/auth/switch-org-key
 * Generate a new API key for a different organization (VS Code org switching)
 */
router.post(
  "/switch-org-key",
  githubOnboardLimiter,
  authenticateApiKey,
  [body("orgId").isUUID().withMessage("orgId must be a valid UUID")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User API key required (not org key)" });
      }

      const { orgId } = req.body;

      // Verify user is a member of the target org
      const isMember = await hasOrgAccess(user.id, orgId);
      if (!isMember) {
        return res.status(403).json({ error: "You are not a member of the requested organization" });
      }

      // Load the target org
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOneBy({ id: orgId });
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Create a new user API key for the target org
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      logger.info("Org switch key created", { userId: user.id, orgId: org.id });

      res.json({
        apiKey: userToken,
        orgId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
      });
    } catch (error) {
      logger.error("Switch org key failed", { error });
      res.status(500).json({ error: "Failed to switch organization" });
    }
  },
);

/**
 * POST /api/auth/vscode-exchange
 * Exchange a Cognito JWT for a VS Code API key.
 * Bridges JWT-based auth flows (email/password, Google SSO) to the usr_ API key the agent needs.
 */
router.post(
  "/vscode-exchange",
  githubOnboardLimiter,
  authenticateUserAllowNoOrg,
  async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Get all user organizations
      const userOrgs = await getUserOrganizations(user.id);

      // Get default org
      const org = await getDefaultOrganization(user.id);
      if (!org) {
        return res
          .status(404)
          .json({ error: "No organization found. Complete onboarding at workermill.com first." });
      }

      // Create a user API key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      logger.info("VS Code exchange completed", { userId: user.id, orgId: org.id, email: user.email });

      res.json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: org.slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: user.email,
        name: user.fullName,
        organizations: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      });
    } catch (error) {
      logger.error("VS Code exchange failed", { error });
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

/**
 * GET /api/auth/vscode-sso-callback
 * Server-side callback for VS Code Google SSO flow.
 * After Cognito redirects here with an auth code:
 * 1. Exchange code for Cognito tokens
 * 2. Auto-provision user if needed
 * 3. Generate usr_ API key
 * 4. Redirect to vscode://workermill.workermill/auth-callback?apiKey=...
 */
router.get("/vscode-sso-callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).send("Missing authorization code");
    }

    // Exchange authorization code for tokens via Cognito token endpoint
    const cognitoDomain = config.cognito.domain;
    const region = config.cognito.region;
    const isCustomDomain = cognitoDomain.includes(".");
    const tokenUrl = isCustomDomain
      ? `https://${cognitoDomain}/oauth2/token`
      : `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;

    const redirectUri = `${config.apiBaseUrl}/api/auth/vscode-sso-callback`;

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
      },
    );

    const { id_token } = tokenResponse.data;

    if (!id_token) {
      return res.status(400).send("No ID token received from SSO provider");
    }

    // Decode ID token to get user info
    const idPayload = decodeJwtPayload(id_token);
    const cognitoId = idPayload.sub;
    const userEmail = idPayload.email;
    const userName = idPayload.name || userEmail.split("@")[0];

    // Find or auto-provision user
    const userRepo = AppDataSource.getRepository(User);
    let user = await userRepo.findOne({ where: { cognitoId } });

    if (!user) {
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
        logger.info("Linked SSO user to existing account (VS Code)", { email: userEmail, cognitoId });
      } else {
        // Auto-provision new user
        const inviteRepo = AppDataSource.getRepository(OrgInvite);
        const pendingInvite = await inviteRepo.findOne({
          where: { email: userEmail.toLowerCase(), accepted: false },
        });
        const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

        user = userRepo.create({
          cognitoId,
          email: userEmail.toLowerCase(),
          fullName: userName,
          role: hasValidInvite ? "member" : "admin",
          status: "active",
          orgId: null,
          tosAcceptedAt: new Date(),
          tosVersion: TOS_VERSION,
        });
        await userRepo.save(user);
        logger.info("SSO user provisioned via VS Code", { userId: user.id, hasValidInvite });
      }
    }

    // Auto-accept TOS on SSO login
    if (user.tosVersion !== TOS_VERSION) {
      await userRepo.update(
        { id: user.id },
        { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
      );
    }

    // Get default org
    const org = await getDefaultOrganization(user.id);
    if (!org) {
      const errorUrl = `vscode://workermill.workermill/auth-callback?error=${encodeURIComponent("No organization found. Complete onboarding at workermill.com first.")}`;
      return res.redirect(errorUrl);
    }

    // Create user API key
    const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
    const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
    const userKeyPrefix = userToken.substring(0, 12);
    const userKeyHash = await bcrypt.hash(userToken, 10);
    const userApiKey = userApiKeyRepo.create({
      userId: user.id,
      orgId: org.id,
      name: "VS Code Extension",
      keyHash: userKeyHash,
      keyPrefix: userKeyPrefix,
      scopes: ["*"],
    });
    await userApiKeyRepo.save(userApiKey);

    logger.info("VS Code SSO callback completed", { userId: user.id, orgId: org.id });

    // Redirect to VS Code with credentials
    const params = new URLSearchParams({
      apiKey: userToken,
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug || "",
      email: user.email,
      name: user.fullName || userName,
      ...(typeof state === "string" ? { state } : {}),
    });
    res.redirect(`vscode://workermill.workermill/auth-callback?${params.toString()}`);
  } catch (error: any) {
    logger.error("VS Code SSO callback error", {
      error: error.message,
      response: error.response?.data,
    });

    if (error.response?.status === 400) {
      return res.status(400).send("Invalid or expired authorization code. Please try signing in again.");
    }

    res.status(500).send("SSO authentication failed. Please try again.");
  }
});

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

    // Validate by generating a token (will fail if credentials are wrong)
    try {
      const { getInstallationToken } = await import("../../services/github-app.js");
      await getInstallationToken(installationId);
    } catch (err) {
      logger.error("GitHub App callback: failed to validate installation", {
        installationId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send("Failed to validate GitHub App installation. Check server logs.");
      return;
    }

    // The state param carries the org ID from the install URL
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

export default router;
