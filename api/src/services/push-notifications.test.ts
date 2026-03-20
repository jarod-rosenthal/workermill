/**
 * Unit tests for push-notifications.ts service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppDataSource } from "../db/connection.js";
import { sendPushNotification } from "./push-notifications.js";
import type { Repository } from "typeorm";
import type { User, NotificationPreferences } from "../models/User.js";
import type { PushSubscription } from "../models/PushSubscription.js";

// Mock the database connection
vi.mock("../db/connection.js");

// Mock the logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("push-notifications service", () => {
  let mockUserRepo: Repository<User>;
  let mockPushRepo: Repository<PushSubscription>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock repository methods
    mockUserRepo = {
      findOne: vi.fn(),
    } as any;

    mockPushRepo = {
      find: vi.fn(),
      createQueryBuilder: vi.fn(() => ({
        delete: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              execute: vi.fn(),
            })),
          })),
        })),
      })),
    } as any;

    // Mock AppDataSource.getRepository
    const mockGetRepository = vi.fn();
    mockGetRepository.mockImplementation((entity) => {
      if (entity.name === "User") return mockUserRepo;
      if (entity.name === "PushSubscription") return mockPushRepo;
      throw new Error(`Unexpected entity: ${entity.name}`);
    });

    (AppDataSource.getRepository as any) = mockGetRepository;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendPushNotification", () => {
    const testUserId = "user-123";
    const testOrgId = "org-456";
    const testNotification = {
      title: "Test Notification",
      body: "Test body",
      category: "completions" as const,
      data: { taskId: "task-789" },
    };

    it("sends push notification to all user subscriptions when preferences allow", async () => {
      // Mock user with push_completions enabled
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      // Mock push subscriptions
      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[abc123]",
          platform: "ios",
          deviceName: "iPhone",
        },
        {
          id: "sub-2",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[def456]",
          platform: "android",
          deviceName: "Android Device",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock successful Expo API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { status: "ok", id: "receipt-1" },
            { status: "ok", id: "receipt-2" },
          ],
        }),
      });

      await sendPushNotification(testUserId, testOrgId, testNotification);

      // Verify user lookup
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: testUserId, orgId: testOrgId },
      });

      // Verify subscriptions lookup
      expect(mockPushRepo.find).toHaveBeenCalledWith({
        where: { userId: testUserId, orgId: testOrgId },
      });

      // Verify Expo API call
      expect(mockFetch).toHaveBeenCalledWith("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify([
          {
            to: "ExponentPushToken[abc123]",
            title: "Test Notification",
            body: "Test body",
            data: { taskId: "task-789" },
            sound: "default",
            priority: "high",
          },
          {
            to: "ExponentPushToken[def456]",
            title: "Test Notification",
            body: "Test body",
            data: { taskId: "task-789" },
            sound: "default",
            priority: "high",
          },
        ]),
      });
    });

    it("skips notification when user preference is disabled", async () => {
      // Mock user with push_completions disabled
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: false,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      await sendPushNotification(testUserId, testOrgId, testNotification);

      // Should not query for subscriptions or call Expo API
      expect(mockPushRepo.find).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles user not found gracefully", async () => {
      mockUserRepo.findOne = vi.fn().mockResolvedValue(null);

      await sendPushNotification(testUserId, testOrgId, testNotification);

      expect(mockPushRepo.find).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles no push subscriptions gracefully", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);
      mockPushRepo.find = vi.fn().mockResolvedValue([]);

      await sendPushNotification(testUserId, testOrgId, testNotification);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("removes invalid push tokens when DeviceNotRegistered", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[invalid123]",
          platform: "ios",
          deviceName: "iPhone",
        },
        {
          id: "sub-2",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[valid456]",
          platform: "android",
          deviceName: "Android Device",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock Expo API response with one DeviceNotRegistered error
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              status: "error",
              message: "Device not registered",
              details: { error: "DeviceNotRegistered" },
            },
            { status: "ok", id: "receipt-2" },
          ],
        }),
      });

      // Mock the query builder chain for token removal
      const mockExecute = vi.fn().mockResolvedValue({ affected: 1 });
      const mockWhere = vi.fn().mockReturnValue({ execute: mockExecute });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockDelete = vi.fn().mockReturnValue({ from: mockFrom });
      const mockQueryBuilder = vi.fn().mockReturnValue({ delete: mockDelete });
      mockPushRepo.createQueryBuilder = mockQueryBuilder;

      await sendPushNotification(testUserId, testOrgId, testNotification);

      // Verify invalid token removal
      expect(mockQueryBuilder).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith(expect.anything()); // PushSubscription entity
      expect(mockWhere).toHaveBeenCalledWith("expo_push_token IN (:...tokens)", {
        tokens: ["ExponentPushToken[invalid123]"],
      });
      expect(mockExecute).toHaveBeenCalled();
    });

    it("removes invalid push tokens when InvalidExpoToken", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_failures: true,
          push_completions: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "InvalidToken123",
          platform: "ios",
          deviceName: "iPhone",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock Expo API response with InvalidExpoToken error
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              status: "error",
              message: "Invalid Expo token format",
              details: { error: "InvalidExpoToken" },
            },
          ],
        }),
      });

      // Mock the query builder chain for token removal
      const mockExecute = vi.fn().mockResolvedValue({ affected: 1 });
      const mockWhere = vi.fn().mockReturnValue({ execute: mockExecute });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      const mockDelete = vi.fn().mockReturnValue({ from: mockFrom });
      const mockQueryBuilder = vi.fn().mockReturnValue({ delete: mockDelete });
      mockPushRepo.createQueryBuilder = mockQueryBuilder;

      await sendPushNotification(testUserId, testOrgId, {
        title: "Task Failed",
        body: "Your task has failed",
        category: "failures",
      });

      // Verify invalid token removal
      expect(mockWhere).toHaveBeenCalledWith("expo_push_token IN (:...tokens)", {
        tokens: ["InvalidToken123"],
      });
    });

    it("does not remove tokens for other error types", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_blockers: true,
          push_completions: true,
          push_failures: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[valid123]",
          platform: "ios",
          deviceName: "iPhone",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock Expo API response with MessageRateExceeded error (should not remove token)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              status: "error",
              message: "Rate limit exceeded",
              details: { error: "MessageRateExceeded" },
            },
          ],
        }),
      });

      await sendPushNotification(testUserId, testOrgId, {
        title: "Blocker Detected",
        body: "A blocker has been detected",
        category: "blockers",
      });

      // Should not call delete query builder
      expect(mockPushRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("handles Expo API non-2xx responses gracefully", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_plan_approvals: true,
          push_completions: true,
          push_failures: true,
          push_blockers: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[abc123]",
          platform: "ios",
          deviceName: "iPhone",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock Expo API 500 error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      // Should not throw - function is fire-and-forget
      await expect(
        sendPushNotification(testUserId, testOrgId, {
          title: "Plan Ready",
          body: "Your plan is ready for review",
          category: "plan_approvals",
        })
      ).resolves.toBeUndefined();
    });

    it("handles network errors gracefully", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[abc123]",
          platform: "ios",
          deviceName: "iPhone",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Should not throw - function is fire-and-forget
      await expect(
        sendPushNotification(testUserId, testOrgId, testNotification)
      ).resolves.toBeUndefined();
    });

    it("handles malformed Expo API response gracefully", async () => {
      const mockUser = {
        id: testUserId,
        orgId: testOrgId,
        notificationPreferences: {
          push_completions: true,
          push_failures: true,
          push_blockers: true,
          push_plan_approvals: true,
        } as NotificationPreferences,
      };
      mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

      const mockSubscriptions = [
        {
          id: "sub-1",
          userId: testUserId,
          orgId: testOrgId,
          expoPushToken: "ExponentPushToken[abc123]",
          platform: "ios",
          deviceName: "iPhone",
        },
      ];
      mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

      // Mock malformed Expo API response (missing data field)
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ receipts: [] }), // Wrong format
      });

      // Should not throw - function is fire-and-forget
      await expect(
        sendPushNotification(testUserId, testOrgId, testNotification)
      ).resolves.toBeUndefined();
    });

    it("maps notification categories to preference keys correctly", async () => {
      const categories = [
        { category: "completions", preferenceKey: "push_completions" },
        { category: "failures", preferenceKey: "push_failures" },
        { category: "blockers", preferenceKey: "push_blockers" },
        { category: "plan_approvals", preferenceKey: "push_plan_approvals" },
      ] as const;

      for (const { category, preferenceKey } of categories) {
        // Reset mocks
        vi.clearAllMocks();

        // Mock user with only this category enabled
        const preferences = {
          push_completions: false,
          push_failures: false,
          push_blockers: false,
          push_plan_approvals: false,
          [preferenceKey]: true,
        } as NotificationPreferences;

        const mockUser = {
          id: testUserId,
          orgId: testOrgId,
          notificationPreferences: preferences,
        };
        mockUserRepo.findOne = vi.fn().mockResolvedValue(mockUser);

        const mockSubscriptions = [
          {
            id: "sub-1",
            userId: testUserId,
            orgId: testOrgId,
            expoPushToken: "ExponentPushToken[abc123]",
            platform: "ios",
            deviceName: "iPhone",
          },
        ];
        mockPushRepo.find = vi.fn().mockResolvedValue(mockSubscriptions);

        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            data: [{ status: "ok", id: "receipt-1" }],
          }),
        });

        await sendPushNotification(testUserId, testOrgId, {
          title: `Test ${category}`,
          body: "Test body",
          category,
        });

        // Should call Expo API since this category is enabled
        expect(mockFetch).toHaveBeenCalled();
      }
    });
  });
});