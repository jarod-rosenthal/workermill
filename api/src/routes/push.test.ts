/**
 * Push Notification Routes Integration Tests
 *
 * Tests all 4 push notification endpoints:
 * - POST /register (upsert push subscription)
 * - DELETE /register (unregister push subscription)
 * - GET /prefs (read notification preferences)
 * - PUT /prefs (update notification preferences)
 *
 * Verifies authentication requirements, request/response formats,
 * validation, and database interactions.
 */

import { describe, test, expect, vi, beforeEach, MockedFunction } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { Repository } from "typeorm";

// Mock the dependencies before importing the router
vi.mock("../db/connection.js", () => ({
  AppDataSource: {
    getRepository: vi.fn(),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../utils/errors.js", () => ({
  BadRequestError: class BadRequestError extends Error {
    constructor(message: string) { super(message); this.name = "BadRequestError"; }
  },
}));

const { MockPushSubscription, MockUser } = vi.hoisted(() => ({
  MockPushSubscription: class MockPushSubscription {},
  MockUser: class MockUser {},
}));

vi.mock("../models/index.js", () => ({
  PushSubscription: MockPushSubscription,
  User: MockUser,
  NotificationPreferences: {},
}));

import { AppDataSource } from "../db/connection.js";
import { authenticateUser } from "../middleware/auth.js";
import pushRouter from "./push.js";

const PushSubscription = MockPushSubscription;
const User = MockUser;

describe("Push Notification Routes", () => {
  let app: express.Express;
  let mockPushRepo: Partial<Repository<PushSubscription>>;
  let mockUserRepo: Partial<Repository<User>>;
  let authenticateUserMock: MockedFunction<typeof authenticateUser>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create Express app with router
    app = express();
    app.use(express.json());
    app.use("/api/push", pushRouter);

    // Mock repositories
    mockPushRepo = {
      findOne: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    };

    mockUserRepo = {
      findOne: vi.fn(),
      update: vi.fn(),
    };

    const mockAppDataSource = AppDataSource as { getRepository: MockedFunction<any> };
    mockAppDataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === PushSubscription) {
        return mockPushRepo;
      }
      if (entity === User) {
        return mockUserRepo;
      }
      throw new Error(`Unexpected entity: ${entity}`);
    });

    // Mock auth middleware
    authenticateUserMock = authenticateUser as MockedFunction<typeof authenticateUser>;
    authenticateUserMock.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      // Simulate authenticated user
      req.user = {
        id: "test-user-id",
        email: "test@example.com",
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: false,
          push_plan_approvals: true,
        }
      } as any;
      req.organization = {
        id: "test-org-id",
        name: "Test Org"
      } as any;
      next();
    });
  });

  describe("Authentication", () => {
    test("POST /register requires authentication", async () => {
      // Mock auth failure
      authenticateUserMock.mockImplementationOnce((req: Request, res: Response) => {
        res.status(401).json({ error: "Missing or invalid authorization header" });
      });

      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test123]",
          platform: "ios"
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Missing or invalid authorization header");
      expect(authenticateUserMock).toHaveBeenCalled();
    });

    test("DELETE /register requires authentication", async () => {
      authenticateUserMock.mockImplementationOnce((req: Request, res: Response) => {
        res.status(401).json({ error: "Missing or invalid authorization header" });
      });

      const response = await request(app)
        .delete("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test123]"
        });

      expect(response.status).toBe(401);
      expect(authenticateUserMock).toHaveBeenCalled();
    });

    test("GET /prefs requires authentication", async () => {
      authenticateUserMock.mockImplementationOnce((req: Request, res: Response) => {
        res.status(401).json({ error: "Missing or invalid authorization header" });
      });

      const response = await request(app).get("/api/push/prefs");

      expect(response.status).toBe(401);
      expect(authenticateUserMock).toHaveBeenCalled();
    });

    test("PUT /prefs requires authentication", async () => {
      authenticateUserMock.mockImplementationOnce((req: Request, res: Response) => {
        res.status(401).json({ error: "Missing or invalid authorization header" });
      });

      const response = await request(app)
        .put("/api/push/prefs")
        .send({ push_completions: false });

      expect(response.status).toBe(401);
      expect(authenticateUserMock).toHaveBeenCalled();
    });
  });

  describe("POST /register (upsert push subscription)", () => {
    test("creates new push subscription", async () => {
      const mockSubscription = {
        id: "sub-123",
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[test123]",
        platform: "ios",
        deviceName: "iPhone 15 Pro",
      };

      (mockPushRepo.findOne as MockedFunction<any>).mockResolvedValue(null);
      (mockPushRepo.create as MockedFunction<any>).mockReturnValue(mockSubscription);
      (mockPushRepo.save as MockedFunction<any>).mockResolvedValue(mockSubscription);

      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test123]",
          platform: "ios",
          deviceName: "iPhone 15 Pro"
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: "sub-123",
        expoPushToken: "ExponentPushToken[test123]",
        platform: "ios",
      });

      expect(mockPushRepo.findOne).toHaveBeenCalledWith({
        where: { userId: "test-user-id", orgId: "test-org-id" },
      });
      expect(mockPushRepo.create).toHaveBeenCalledWith({
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[test123]",
        platform: "ios",
        deviceName: "iPhone 15 Pro",
      });
      expect(mockPushRepo.save).toHaveBeenCalled();
    });

    test("updates existing push subscription", async () => {
      const existingSubscription = {
        id: "sub-123",
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[old]",
        platform: "android",
        deviceName: "Old Device",
      };

      const updatedSubscription = {
        ...existingSubscription,
        expoPushToken: "ExponentPushToken[new]",
        platform: "ios",
        deviceName: "New Device",
      };

      (mockPushRepo.findOne as MockedFunction<any>).mockResolvedValue(existingSubscription);
      (mockPushRepo.save as MockedFunction<any>).mockResolvedValue(updatedSubscription);

      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[new]",
          platform: "ios",
          deviceName: "New Device"
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: "sub-123",
        expoPushToken: "ExponentPushToken[new]",
        platform: "ios",
      });

      expect(mockPushRepo.save).toHaveBeenCalledWith({
        ...existingSubscription,
        expoPushToken: "ExponentPushToken[new]",
        platform: "ios",
        deviceName: "New Device",
      });
    });

    test("validates required fields", async () => {
      const response = await request(app)
        .post("/api/push/register")
        .send({
          platform: "ios" // missing expoPushToken
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ msg: "Valid expo push token is required" })
        ])
      );
    });

    test("validates platform field", async () => {
      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "windows" // invalid platform
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ msg: "Platform must be 'ios' or 'android'" })
        ])
      );
    });

    test("handles deviceName as optional", async () => {
      const mockSubscription = {
        id: "sub-123",
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[test]",
        platform: "android",
        deviceName: null,
      };

      (mockPushRepo.findOne as MockedFunction<any>).mockResolvedValue(null);
      (mockPushRepo.create as MockedFunction<any>).mockReturnValue(mockSubscription);
      (mockPushRepo.save as MockedFunction<any>).mockResolvedValue(mockSubscription);

      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "android"
          // no deviceName
        });

      expect(response.status).toBe(200);
      expect(mockPushRepo.create).toHaveBeenCalledWith({
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[test]",
        platform: "android",
        deviceName: null,
      });
    });
  });

  describe("DELETE /register (unregister push subscription)", () => {
    test("successfully unregisters push subscription", async () => {
      (mockPushRepo.delete as MockedFunction<any>).mockResolvedValue({ affected: 1 });

      const response = await request(app)
        .delete("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]"
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      expect(mockPushRepo.delete).toHaveBeenCalledWith({
        userId: "test-user-id",
        orgId: "test-org-id",
        expoPushToken: "ExponentPushToken[test]",
      });
    });

    test("returns success even if no subscription found", async () => {
      (mockPushRepo.delete as MockedFunction<any>).mockResolvedValue({ affected: 0 });

      const response = await request(app)
        .delete("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[notfound]"
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });

    test("validates expoPushToken is required", async () => {
      const response = await request(app)
        .delete("/api/push/register")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ msg: "Valid expo push token is required" })
        ])
      );
    });
  });

  describe("GET /prefs (read notification preferences)", () => {
    test("returns user notification preferences", async () => {
      const mockUser = {
        id: "test-user-id",
        notificationPreferences: {
          push_completions: true,
          push_failures: false,
          push_blockers: true,
          push_plan_approvals: false,
        }
      };

      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(mockUser);

      const response = await request(app).get("/api/push/prefs");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        push_completions: true,
        push_failures: false,
        push_blockers: true,
        push_plan_approvals: false,
      });

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: "test-user-id" },
        select: ["id", "notificationPreferences"],
      });
    });

    test("returns defaults if user preferences are empty", async () => {
      const mockUser = {
        id: "test-user-id",
        notificationPreferences: {}
      };

      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(mockUser);

      const response = await request(app).get("/api/push/prefs");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        push_completions: true,
        push_failures: true,
        push_blockers: true,
        push_plan_approvals: true,
      });
    });

    test("handles user not found", async () => {
      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(null);

      const response = await request(app).get("/api/push/prefs");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("user_not_found");
    });
  });

  describe("PUT /prefs (update notification preferences)", () => {
    test("updates notification preferences partially", async () => {
      const mockUser = {
        id: "test-user-id",
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        }
      };

      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(mockUser);
      (mockUserRepo.update as MockedFunction<any>).mockResolvedValue({});

      const response = await request(app)
        .put("/api/push/prefs")
        .send({
          push_completions: false,
          push_blockers: false,
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        push_completions: false,
        push_failures: true,
        push_blockers: false,
        push_plan_approvals: true,
      });

      expect(mockUserRepo.update).toHaveBeenCalledWith("test-user-id", {
        notificationPreferences: {
          push_completions: false,
          push_failures: true,
          push_blockers: false,
          push_plan_approvals: true,
        }
      });
    });

    test("validates boolean values", async () => {
      const response = await request(app)
        .put("/api/push/prefs")
        .send({
          push_completions: "yes", // should be boolean
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ msg: "push_completions must be a boolean" })
        ])
      );
    });

    test("allows empty body (no updates)", async () => {
      const mockUser = {
        id: "test-user-id",
        notificationPreferences: {
          push_completions: true,
          push_failures: false,
          push_blockers: true,
          push_plan_approvals: false,
        }
      };

      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(mockUser);
      (mockUserRepo.update as MockedFunction<any>).mockResolvedValue({});

      const response = await request(app)
        .put("/api/push/prefs")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUser.notificationPreferences);

      // Should still update with same values (no-op)
      expect(mockUserRepo.update).toHaveBeenCalled();
    });

    test("handles user not found", async () => {
      (mockUserRepo.findOne as MockedFunction<any>).mockResolvedValue(null);

      const response = await request(app)
        .put("/api/push/prefs")
        .send({ push_completions: false });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("user_not_found");
    });
  });

  describe("Error handling", () => {
    test("handles database errors gracefully", async () => {
      (mockPushRepo.findOne as MockedFunction<any>).mockRejectedValue(new Error("Database connection failed"));

      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "ExponentPushToken[test]",
          platform: "ios"
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("internal_error");
      expect(response.body.message).toBe("Failed to register push subscription");
    });

    test("handles validation errors with proper details", async () => {
      const response = await request(app)
        .post("/api/push/register")
        .send({
          expoPushToken: "", // empty string
          platform: "invalid"
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
      expect(response.body.details).toHaveLength(2);
    });
  });
});