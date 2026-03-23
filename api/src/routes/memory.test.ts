/**
 * Memory API Route Tests
 *
 * Unit tests for the memory analytics and management endpoints.
 * These tests verify that the analytics queries use correct TypeORM operators.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoreThan, FindOperator } from "typeorm";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// Mock the dependencies before importing the router
vi.mock("../db/connection.js", () => ({
  AppDataSource: {
    getRepository: vi.fn(),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  authenticateRequest: vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

vi.mock("../services/embedding.js", () => ({
  generateEmbedding: vi.fn(),
  findSimilarSemanticMemories: vi.fn(),
  findSimilarEpisodicMemories: vi.fn(),
  findSimilarProceduralMemories: vi.fn(),
  embedSemanticMemory: vi.fn(),
  embedEpisodicMemory: vi.fn(),
  embedProceduralMemory: vi.fn(),
}));

vi.mock("../services/feedback-aggregator.js", () => ({
  feedbackAggregator: {},
}));

vi.mock("../services/feedback-router.js", () => ({
  feedbackRouter: {},
}));

vi.mock("../services/knowledge-sharing.js", () => ({
  knowledgeSharingService: {},
}));

vi.mock("../services/task-recommender.js", () => ({
  taskRecommender: {},
}));

vi.mock("../services/knowledge-graph.js", () => ({
  knowledgeGraphService: {},
}));

vi.mock("../services/skill-extractor.js", () => ({
  skillExtractor: {},
}));

vi.mock("../services/skill-injector.js", () => ({
  skillInjector: {},
}));

vi.mock("../middleware/tos.js", () => ({
  requireCurrentTos: vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  }),
}));

vi.mock("../models/index.js", () => ({
  SemanticMemory: class SemanticMemory {},
  EpisodicMemory: class EpisodicMemory {},
  ProceduralMemory: class ProceduralMemory {},
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AppDataSource } from "../db/connection.js";
import memoryRouter from "./memory.js";

describe("Memory Analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/memory/analytics/overview", () => {
    it("should use MoreThan for 24-hour queries, not exact equality", async () => {
      // This test verifies the fix for the bug where createdAt was checked
      // with exact equality instead of MoreThan, resulting in 0 results

      const mockCount = vi.fn().mockResolvedValue(5);
      const mockCreateQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([]),
        getRawOne: vi.fn().mockResolvedValue({ avgConfidence: 0.75, total: 10 }),
      });

      const mockRepository = {
        count: mockCount,
        createQueryBuilder: mockCreateQueryBuilder,
      };

      vi.mocked(AppDataSource.getRepository).mockReturnValue(mockRepository as never);

      const app = express();
      app.use(express.json());

      // Mock auth middleware - set organization on request
      app.use((req: Request, _res: Response, next: NextFunction) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).organization = { id: "test-org-id" };
        next();
      });

      app.use("/api/memory", memoryRouter);

      await request(app).get("/api/memory/analytics/overview");

      // Verify that count() was called with MoreThan, not exact date equality
      // The key assertion: the where clause should use MoreThan operator
      const countCalls = mockCount.mock.calls;

      // Should have 3 count calls (semantic, episodic, procedural)
      expect(countCalls.length).toBeGreaterThanOrEqual(3);

      // Each call should have a where clause with MoreThan for createdAt
      for (const call of countCalls) {
        const whereClause = call[0]?.where;
        if (whereClause?.createdAt) {
          // The createdAt should be a FindOperator (MoreThan), not a plain Date
          expect(whereClause.createdAt).toBeInstanceOf(FindOperator);
        }
      }
    });

    it("should return correct structure for analytics overview", async () => {
      const mockCount = vi.fn().mockResolvedValue(10);
      const mockCreateQueryBuilder = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([
          { outcome: "success", count: "5" },
          { outcome: "failure", count: "3" },
        ]),
        getRawOne: vi.fn().mockResolvedValue({ avgConfidence: 0.75, total: "15" }),
      });

      const mockRepository = {
        count: mockCount,
        createQueryBuilder: mockCreateQueryBuilder,
      };

      vi.mocked(AppDataSource.getRepository).mockReturnValue(mockRepository as never);

      const app = express();
      app.use(express.json());
      app.use((req: Request, _res: Response, next: NextFunction) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).organization = { id: "test-org-id" };
        next();
      });
      app.use("/api/memory", memoryRouter);

      const response = await request(app).get("/api/memory/analytics/overview");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("totalMemories");
      expect(response.body).toHaveProperty("byCategory");
      expect(response.body).toHaveProperty("byOutcome");
      expect(response.body).toHaveProperty("avgConfidence");
      expect(response.body).toHaveProperty("recentActivity");
      expect(response.body.recentActivity).toHaveProperty("created24h");
      expect(response.body.recentActivity).toHaveProperty("retrieved24h");
    });
  });
});

describe("MoreThan operator usage", () => {
  it("should create correct FindOperator for date comparisons", () => {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const operator = MoreThan(twentyFourHoursAgo);

    // Verify the operator is correctly structured
    expect(operator).toBeInstanceOf(FindOperator);
  });
});
