/**
 * Unit tests for push-notifications service
 */

import { beforeEach, afterEach, describe, it, expect, vi, type MockedFunction } from "vitest";
import { AppDataSource } from "../db/connection.js";
import { PushSubscription } from "../models/PushSubscription.js";
import { User, type NotificationPreferences } from "../models/User.js";
import { sendPushNotification, type PushNotificationData } from "./push-notifications.js";
import type { Repository } from "typeorm";

// Mock fetch globally
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock database repositories
const mockPushSubscriptionRepo = {
  find: vi.fn(),
  delete: vi.fn(),
} as unknown as Repository<PushSubscription>;

const mockUserRepo = {
  findOne: vi.fn(),
} as unknown as Repository<User>;

vi.mock("../db/connection.js", () => ({
  AppDataSource: {
    getRepository: vi.fn((entity) => {
      if (entity === PushSubscription) return mockPushSubscriptionRepo;
      if (entity === User) return mockUserRepo;
      throw new Error(`Unknown entity: ${entity.name}`);
    }),
  },
}));

describe("push-notifications service", () => {
  const testUserId = "user-123";
  const testOrgId = "org-456";
  const testToken1 = "ExponentPushToken[token1]";
  const testToken2 = "ExponentPushToken[token2]";

  const sampleNotification: PushNotificationData = {
    title: "Task Completed",
    body: "Your task WM-123 has been completed successfully",
    category: "completions",
    data: { taskId: "task-789", issueKey: "WM-123" },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful Expo API response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { status: "ok", id: "msg-id-1" },
          { status: "ok", id: "msg-id-2" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sendPushNotification", () => {
    it("sends push notification to all user devices", async () => {
      // Setup: User has two push subscriptions
      const mockSubscriptions: Partial<PushSubscription>[] = [
        { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        { userId: testUserId, orgId: testOrgId, expoPushToken: testToken2, platform: "android" },
      ];

      const mockUser: Partial<User> = {
        id: testUserId,
        notificationPreferences: { push_completions: true } as NotificationPreferences,
      };

      (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
      (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

      // Execute
      await sendPushNotification(testUserId, testOrgId, sampleNotification);

      // Verify database queries
      expect(mockPushSubscriptionRepo.find).toHaveBeenCalledWith({
        where: { userId: testUserId, orgId: testOrgId },
      });

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: testUserId },
        select: ["id", "notificationPreferences"],
      });

      // Verify Expo API call
      expect(mockFetch).toHaveBeenCalledWith(
        "https://exp.host/--/api/v2/push/send",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify([
            {
              to: testToken1,
              title: "Task Completed",
              body: "Your task WM-123 has been completed successfully",
              data: { taskId: "task-789", issueKey: "WM-123" },
              sound: "default",
              priority: "high",
              channelId: "default",
            },
            {
              to: testToken2,
              title: "Task Completed",
              body: "Your task WM-123 has been completed successfully",
              data: { taskId: "task-789", issueKey: "WM-123" },
              sound: "default",
              priority: "high",
              channelId: "default",
            },
          ]),
        })
      );
    });

    it("skips notification when user has no push subscriptions", async () => {
      // Setup: No push subscriptions
      (mockPushSubscriptionRepo.find as any).mockResolvedValue([]);

      // Execute
      await sendPushNotification(testUserId, testOrgId, sampleNotification);

      // Verify: No Expo API call made
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    });

    it("skips notification when user not found", async () => {
      // Setup: Has subscription but user not found
      const mockSubscriptions: Partial<PushSubscription>[] = [
        { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
      ];

      (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
      (mockUserRepo.findOne as any).mockResolvedValue(null);

      // Execute
      await sendPushNotification(testUserId, testOrgId, sampleNotification);

      // Verify: No Expo API call made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe("notification preference filtering", () => {
      beforeEach(() => {
        // Setup: User has one subscription
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];
        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
      });

      it("sends notification when preference is enabled for completions category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "completions" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });

      it("skips notification when preference is disabled for completions category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: false } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "completions" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("sends notification when preference is enabled for failures category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_failures: true } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "failures" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });

      it("skips notification when preference is disabled for failures category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_failures: false } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "failures" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("sends notification when preference is enabled for blockers category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_blockers: true } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "blockers" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });

      it("skips notification when preference is disabled for blockers category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_blockers: false } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "blockers" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("sends notification when preference is enabled for plan_approvals category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_plan_approvals: true } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "plan_approvals" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });

      it("skips notification when preference is disabled for plan_approvals category", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_plan_approvals: false } as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        const notification: PushNotificationData = { ...sampleNotification, category: "plan_approvals" };
        await sendPushNotification(testUserId, testOrgId, notification);

        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("sends notification when user has null notification preferences (defaults to enabled)", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: null,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        await sendPushNotification(testUserId, testOrgId, sampleNotification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });

      it("sends notification when user has empty notification preferences (defaults to enabled)", async () => {
        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: {} as NotificationPreferences,
        };
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        await sendPushNotification(testUserId, testOrgId, sampleNotification);

        expect(mockFetch).toHaveBeenCalledOnce();
      });
    });

    describe("DeviceNotRegistered error handling", () => {
      it("removes invalid token when DeviceNotRegistered error occurs", async () => {
        // Setup: User has subscription
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];

        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);
        (mockPushSubscriptionRepo.delete as any).mockResolvedValue({ affected: 1 });

        // Setup: Expo API returns DeviceNotRegistered error
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              {
                status: "error",
                message: "DeviceNotRegistered",
                details: { error: "DeviceNotRegistered" },
              },
            ],
          }),
        } as Response);

        // Execute
        await sendPushNotification(testUserId, testOrgId, sampleNotification);

        // Verify token was deleted
        expect(mockPushSubscriptionRepo.delete).toHaveBeenCalledWith({
          expoPushToken: testToken1,
        });
      });

      it("handles multiple tokens with mixed success/DeviceNotRegistered responses", async () => {
        // Setup: User has two subscriptions
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken2, platform: "android" },
        ];

        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);
        (mockPushSubscriptionRepo.delete as any).mockResolvedValue({ affected: 1 });

        // Setup: First token succeeds, second token fails with DeviceNotRegistered
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { status: "ok", id: "msg-id-1" },
              {
                status: "error",
                message: "DeviceNotRegistered",
                details: { error: "DeviceNotRegistered" },
              },
            ],
          }),
        } as Response);

        // Execute
        await sendPushNotification(testUserId, testOrgId, sampleNotification);

        // Verify only the second token was deleted
        expect(mockPushSubscriptionRepo.delete).toHaveBeenCalledOnce();
        expect(mockPushSubscriptionRepo.delete).toHaveBeenCalledWith({
          expoPushToken: testToken2,
        });
      });

      it("does not remove token for other error types", async () => {
        // Setup: User has subscription
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];

        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);

        // Setup: Expo API returns different error type
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              {
                status: "error",
                message: "MessageTooBig",
                details: { error: "MessageTooBig" },
              },
            ],
          }),
        } as Response);

        // Execute
        await sendPushNotification(testUserId, testOrgId, sampleNotification);

        // Verify token was NOT deleted
        expect(mockPushSubscriptionRepo.delete).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      beforeEach(() => {
        // Setup: User has subscription and preferences enabled
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];

        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);
      });

      it("handles non-2xx response from Expo Push API", async () => {
        // Setup: Expo API returns 500 error
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response);

        // Execute - should not throw
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();

        // Verify no deletion attempted
        expect(mockPushSubscriptionRepo.delete).not.toHaveBeenCalled();
      });

      it("handles network error when calling Expo Push API", async () => {
        // Setup: Network error
        mockFetch.mockRejectedValue(new Error("Network error"));

        // Execute - should not throw
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();

        // Verify no deletion attempted
        expect(mockPushSubscriptionRepo.delete).not.toHaveBeenCalled();
      });

      it("handles invalid JSON response from Expo Push API", async () => {
        // Setup: Invalid JSON response
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => { throw new Error("Invalid JSON"); },
        } as Response);

        // Execute - should not throw
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();
      });

      it("handles database error when removing invalid token", async () => {
        // Setup: DeviceNotRegistered response but database delete fails
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              {
                status: "error",
                details: { error: "DeviceNotRegistered" },
              },
            ],
          }),
        } as Response);

        (mockPushSubscriptionRepo.delete as any).mockRejectedValue(new Error("Database error"));

        // Execute - should not throw
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();
      });

      it("handles database error when querying push subscriptions", async () => {
        // Setup: Database query fails
        (mockPushSubscriptionRepo.find as any).mockRejectedValue(new Error("Database connection error"));

        // Execute - should not throw (fire-and-forget)
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();

        // Verify no Expo API call made
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("handles database error when querying user preferences", async () => {
        // Setup: Subscriptions query succeeds, user query fails
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockRejectedValue(new Error("User query error"));

        // Execute - should not throw (fire-and-forget)
        await expect(sendPushNotification(testUserId, testOrgId, sampleNotification)).resolves.toBeUndefined();

        // Verify no Expo API call made
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("notification data handling", () => {
      beforeEach(() => {
        // Setup: User has subscription and preferences enabled
        const mockSubscriptions: Partial<PushSubscription>[] = [
          { userId: testUserId, orgId: testOrgId, expoPushToken: testToken1, platform: "ios" },
        ];

        const mockUser: Partial<User> = {
          id: testUserId,
          notificationPreferences: { push_completions: true } as NotificationPreferences,
        };

        (mockPushSubscriptionRepo.find as any).mockResolvedValue(mockSubscriptions);
        (mockUserRepo.findOne as any).mockResolvedValue(mockUser);
      });

      it("includes custom data in push message", async () => {
        const notificationWithData: PushNotificationData = {
          title: "Task Failed",
          body: "Task WM-456 failed with error",
          category: "failures",
          data: {
            taskId: "task-999",
            issueKey: "WM-456",
            deepLink: "workermill://task/task-999",
          },
        };

        await sendPushNotification(testUserId, testOrgId, notificationWithData);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://exp.host/--/api/v2/push/send",
          expect.objectContaining({
            body: expect.stringContaining('"data":{"taskId":"task-999","issueKey":"WM-456","deepLink":"workermill://task/task-999"}'),
          })
        );
      });

      it("handles notification without custom data", async () => {
        const notificationWithoutData: PushNotificationData = {
          title: "Blocker Detected",
          body: "A blocker was detected on your epic",
          category: "blockers",
          // No data field
        };

        await sendPushNotification(testUserId, testOrgId, notificationWithoutData);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://exp.host/--/api/v2/push/send",
          expect.objectContaining({
            body: expect.stringContaining('"data":{}'),
          })
        );
      });
    });
  });
});