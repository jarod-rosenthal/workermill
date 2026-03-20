import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { AppDataSource } from "../db/connection.js";
import { User, Organization, UserOrganization, PushSubscription } from "../models/index.js";
import pushRouter from "./push.js";
import { authenticateUser } from "../middleware/auth.js";

// Mock the auth middleware for testing
const mockUser = {
  id: "test-user-id",
  cognitoId: "test-cognito-id",
  email: "test@example.com",
  fullName: "Test User",
  role: "member" as const,
  status: "active" as const,
  notificationPreferences: {
    push_completions: true,
    push_failures: true,
    push_blockers: false,
    push_plan_approvals: true,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  preferences: {},
  orgId: null,
  referralCode: null,
  referredByCode: null,
  tosAcceptedAt: null,
  tosVersion: null,
  mfaBackupCodes: [],
  supportAdmin: false,
  organization: undefined as any,
};

const mockOrg = {
  id: "test-org-id",
  name: "Test Organization",
  slug: "test-org",
  apiKeyHash: null,
  apiKeyPrefix: null,
  billingEmail: "billing@test.com",
  plan: "pro" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  users: [],
  tasks: [],
  invites: [],
  boards: [],
  projects: [],
  personas: [],
  userOrganizations: [],
  githubInstallations: [],
  linearIntegrations: [],
  jiraIntegrations: [],
  notionIntegrations: [],
  slackIntegrations: [],
};

// Mock authentication middleware
const mockAuth = (req: any, res: any, next: any) => {
  req.user = mockUser;
  req.organization = mockOrg;
  req.orgRole = "member";
  next();
};

// Create test app
const app = express();
app.use(express.json());
app.use(mockAuth);
app.use("/api/push", pushRouter);

describe("Push Routes", () => {
  let userRepo: any;
  let orgRepo: any;
  let pushRepo: any;
  let userOrgRepo: any;

  beforeAll(async () => {
    // Initialize database connection if not already initialized
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Get repositories
    userRepo = AppDataSource.getRepository(User);
    orgRepo = AppDataSource.getRepository(Organization);
    pushRepo = AppDataSource.getRepository(PushSubscription);
    userOrgRepo = AppDataSource.getRepository(UserOrganization);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up existing test data
    await pushRepo.clear();
    await userOrgRepo.clear();
    await userRepo.clear();
    await orgRepo.clear();

    // Create test organization
    const org = orgRepo.create(mockOrg);
    await orgRepo.save(org);

    // Create test user
    const user = userRepo.create(mockUser);
    await userRepo.save(user);

    // Create user-organization relationship
    const userOrg = userOrgRepo.create({
      userId: mockUser.id,
      orgId: mockOrg.id,
      role: "member",
      isDefault: true,
      joinedAt: new Date(),
    });
    await userOrgRepo.save(userOrg);
  });

  afterEach(async () => {
    // Clean up test data
    await pushRepo.clear();
    await userOrgRepo.clear();
    await userRepo.clear();
    await orgRepo.clear();
  });

  describe("POST /api/push/register", () => {
    it("should register a new push subscription successfully", async () => {
      const subscriptionData = {
        expoPushToken: "ExponentPushToken[test-token-123]",
        platform: "ios",
        deviceName: "Test iPhone",
      };

      const response = await request(app)
        .post("/api/push/register")
        .send(subscriptionData)
        .expect(200);

      expect(response.body).toEqual({
        id: expect.any(String),
        expoPushToken: subscriptionData.expoPushToken,
        platform: subscriptionData.platform,
      });

      // Verify subscription was created in database
      const subscription = await pushRepo.findOne({
        where: {
          userId: mockUser.id,
          orgId: mockOrg.id,
          expoPushToken: subscriptionData.expoPushToken,
        },
      });

      expect(subscription).toBeTruthy();
      expect(subscription.platform).toBe("ios");
      expect(subscription.deviceName).toBe("Test iPhone");
    });

    it("should update existing subscription if token already exists for user+org", async () => {
      const expoPushToken = "ExponentPushToken[test-token-456]";

      // Create initial subscription
      const existingSubscription = pushRepo.create({
        userId: mockUser.id,
        orgId: mockOrg.id,
        expoPushToken,
        platform: "android",
        deviceName: "Old Device",
      });
      await pushRepo.save(existingSubscription);

      // Update with new data
      const updateData = {
        expoPushToken,
        platform: "ios",
        deviceName: "New Device",
      };

      const response = await request(app)
        .post("/api/push/register")
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual({
        id: existingSubscription.id,
        expoPushToken,
        platform: "ios",
      });

      // Verify subscription was updated
      const updatedSubscription = await pushRepo.findOne({
        where: { id: existingSubscription.id },
      });

      expect(updatedSubscription.platform).toBe("ios");
      expect(updatedSubscription.deviceName).toBe("New Device");
    });

    it("should require authentication", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use("/api/push", pushRouter); // No auth middleware

      await request(testApp)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "ios",
        })
        .expect(401);
    });

    it("should validate required fields", async () => {
      // Missing expoPushToken
      await request(app)
        .post("/api/push/register")
        .send({ platform: "ios" })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("expoPushToken is required");
        });

      // Missing platform
      await request(app)
        .post("/api/push/register")
        .send({ expoPushToken: "ExponentPushToken[test]" })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("platform is required");
        });

      // Invalid platform
      await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "windows",
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("must be 'ios' or 'android'");
        });

      // Invalid deviceName type
      await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "ios",
          deviceName: 123,
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("deviceName must be a string");
        });
    });

    it("should handle duplicate token across different users", async () => {
      const expoPushToken = "ExponentPushToken[duplicate-token]";

      // Create subscription for different user
      const otherUser = userRepo.create({
        id: "other-user-id",
        cognitoId: "other-cognito-id",
        email: "other@example.com",
        fullName: "Other User",
        role: "member",
        status: "active",
        notificationPreferences: null,
        preferences: {},
        orgId: null,
        referralCode: null,
        referredByCode: null,
        tosAcceptedAt: null,
        tosVersion: null,
        mfaBackupCodes: [],
        supportAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await userRepo.save(otherUser);

      const existingSubscription = pushRepo.create({
        userId: otherUser.id,
        orgId: mockOrg.id,
        expoPushToken,
        platform: "android",
        deviceName: "Other Device",
      });
      await pushRepo.save(existingSubscription);

      // Try to register same token with current user
      await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken,
          platform: "ios",
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.error).toContain("already registered to another user");
        });
    });
  });

  describe("DELETE /api/push/register", () => {
    let testSubscription: any;

    beforeEach(async () => {
      // Create a test subscription
      testSubscription = pushRepo.create({
        userId: mockUser.id,
        orgId: mockOrg.id,
        expoPushToken: "ExponentPushToken[test-delete-123]",
        platform: "ios",
        deviceName: "Test Device",
      });
      await pushRepo.save(testSubscription);
    });

    it("should remove push subscription successfully", async () => {
      const response = await request(app)
        .delete("/api/push/register")
        .send({ expoPushToken: testSubscription.expoPushToken })
        .expect(200);

      expect(response.body).toEqual({ success: true });

      // Verify subscription was deleted
      const deletedSubscription = await pushRepo.findOne({
        where: { id: testSubscription.id },
      });
      expect(deletedSubscription).toBeNull();
    });

    it("should return 404 for non-existent subscription", async () => {
      await request(app)
        .delete("/api/push/register")
        .send({ expoPushToken: "ExponentPushToken[non-existent]" })
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe("Push subscription not found");
        });
    });

    it("should require authentication", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use("/api/push", pushRouter);

      await request(testApp)
        .delete("/api/push/register")
        .send({ expoPushToken: "ExponentPushToken[test]" })
        .expect(401);
    });

    it("should validate required expoPushToken", async () => {
      await request(app)
        .delete("/api/push/register")
        .send({})
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("expoPushToken is required");
        });
    });
  });

  describe("GET /api/push/prefs", () => {
    it("should return notification preferences", async () => {
      const response = await request(app)
        .get("/api/push/prefs")
        .expect(200);

      expect(response.body).toEqual({
        push_completions: true,
        push_failures: true,
        push_blockers: false,
        push_plan_approvals: true,
      });
    });

    it("should return default preferences when user has none", async () => {
      // Update user to have no preferences
      await userRepo.update(
        { id: mockUser.id },
        { notificationPreferences: null }
      );

      const response = await request(app)
        .get("/api/push/prefs")
        .expect(200);

      expect(response.body).toEqual({
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      });
    });

    it("should require authentication", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use("/api/push", pushRouter);

      await request(testApp).get("/api/push/prefs").expect(401);
    });
  });

  describe("PUT /api/push/prefs", () => {
    it("should update notification preferences", async () => {
      const newPrefs = {
        push_completions: false,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: false,
      };

      const response = await request(app)
        .put("/api/push/prefs")
        .send(newPrefs)
        .expect(200);

      expect(response.body).toEqual(newPrefs);

      // Verify preferences were updated in database
      const updatedUser = await userRepo.findOne({
        where: { id: mockUser.id },
      });
      expect(updatedUser.notificationPreferences).toEqual(newPrefs);
    });

    it("should allow partial updates", async () => {
      const partialUpdate = {
        push_completions: false,
      };

      const response = await request(app)
        .put("/api/push/prefs")
        .send(partialUpdate)
        .expect(200);

      expect(response.body).toEqual({
        push_completions: false, // Updated
        push_failures: true, // Preserved
        push_blockers: false, // Preserved
        push_plan_approvals: true, // Preserved
      });
    });

    it("should validate preference values", async () => {
      // Invalid preference key
      await request(app)
        .put("/api/push/prefs")
        .send({ invalid_key: true })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("Invalid preference key: invalid_key");
        });

      // Non-boolean value
      await request(app)
        .put("/api/push/prefs")
        .send({ push_completions: "yes" })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("must be a boolean");
        });

      // Non-object body
      await request(app)
        .put("/api/push/prefs")
        .send("invalid")
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toContain("Preferences must be an object");
        });
    });

    it("should require authentication", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use("/api/push", pushRouter);

      await request(testApp)
        .put("/api/push/prefs")
        .send({ push_completions: false })
        .expect(401);
    });
  });
});