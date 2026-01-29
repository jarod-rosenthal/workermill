/**
 * Memory API Routes
 *
 * Exposes the Agent Memory System for semantic search and memory management.
 * Part of Phase 3: Agent Memory & Learning System.
 */

import { Router, type Request, type Response } from "express";
import { body, query, validationResult } from "express-validator";
import { authenticateRequest } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import {
  SemanticMemory,
  EpisodicMemory,
  ProceduralMemory,
} from "../models/index.js";
import {
  generateEmbedding,
  findSimilarSemanticMemories,
  findSimilarEpisodicMemories,
  findSimilarProceduralMemories,
  embedSemanticMemory,
  embedEpisodicMemory,
  embedProceduralMemory,
} from "../services/embedding.js";
import { logger } from "../utils/logger.js";
import { feedbackAggregator } from "../services/feedback-aggregator.js";
import { feedbackRouter } from "../services/feedback-router.js";
import { knowledgeSharingService, type TaskTypeCategory } from "../services/knowledge-sharing.js";
import { taskRecommender } from "../services/task-recommender.js";
import { knowledgeGraphService, type TaskRelationshipType } from "../services/knowledge-graph.js";
import { skillExtractor } from "../services/skill-extractor.js";
import { skillInjector } from "../services/skill-injector.js";

const router = Router();

// All memory routes require authentication
router.use(authenticateRequest);

/**
 * POST /api/memory/search
 *
 * Semantic search across all memory types for relevant past experiences.
 * Given a query (e.g., task description), returns similar memories.
 */
router.post(
  "/search",
  [
    body("query").isString().notEmpty().withMessage("Query is required"),
    body("repository").optional().isString(),
    body("memoryTypes")
      .optional()
      .isArray()
      .withMessage("memoryTypes must be an array"),
    body("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      query: searchQuery,
      repository,
      memoryTypes = ["semantic", "episodic", "procedural"],
      limit = 10,
      minSimilarity = 0.5,
    } = req.body;

    try {
      // Generate embedding for the search query
      const { embedding } = await generateEmbedding(orgId, searchQuery);

      const searchOptions = {
        limit,
        minSimilarity,
        repository,
      };

      const results: {
        semantic: Array<{ id: string; similarity: number; [key: string]: unknown }>;
        episodic: Array<{ id: string; similarity: number; [key: string]: unknown }>;
        procedural: Array<{ id: string; similarity: number; [key: string]: unknown }>;
      } = {
        semantic: [],
        episodic: [],
        procedural: [],
      };

      // Search each memory type in parallel
      const searches = [];

      if (memoryTypes.includes("semantic")) {
        searches.push(
          findSimilarSemanticMemories(orgId, embedding, searchOptions).then(
            (r) => {
              results.semantic = r;
            }
          )
        );
      }

      if (memoryTypes.includes("episodic")) {
        searches.push(
          findSimilarEpisodicMemories(orgId, embedding, searchOptions).then(
            (r) => {
              results.episodic = r;
            }
          )
        );
      }

      if (memoryTypes.includes("procedural")) {
        searches.push(
          findSimilarProceduralMemories(orgId, embedding, searchOptions).then(
            (r) => {
              results.procedural = r;
            }
          )
        );
      }

      await Promise.all(searches);

      res.json({
        query: searchQuery,
        repository,
        results,
        totalResults:
          results.semantic.length +
          results.episodic.length +
          results.procedural.length,
      });
    } catch (error) {
      logger.error("Memory search error", { error, orgId });
      res.status(500).json({ error: "Failed to search memories" });
    }
  }
);

/**
 * POST /api/memory/similar-tasks
 *
 * Find similar tasks across all repositories.
 * Given a task description, returns similar past tasks from any repository.
 */
router.post(
  "/similar-tasks",
  [
    body("description").isString().notEmpty().withMessage("Task description is required"),
    body("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      description,
      limit = 10,
      minSimilarity = 0.5,
    } = req.body;

    try {
      // Generate embedding for the task description
      const { embedding } = await generateEmbedding(orgId, description);

      // Search episodic memories across ALL repositories (no repository filter)
      const similarTasks = await findSimilarEpisodicMemories(orgId, embedding, {
        limit,
        minSimilarity,
        // No repository filter - searches across all repos
      });

      // Group results by repository for easier consumption
      const byRepository: Record<string, typeof similarTasks> = {};
      for (const task of similarTasks) {
        const repo = (task.repository as string) || "unknown";
        if (!byRepository[repo]) {
          byRepository[repo] = [];
        }
        byRepository[repo].push(task);
      }

      res.json({
        query: description,
        totalResults: similarTasks.length,
        results: similarTasks,
        byRepository,
        repositoriesSearched: Object.keys(byRepository).length,
      });
    } catch (error) {
      logger.error("Similar tasks search error", { error, orgId });
      res.status(500).json({ error: "Failed to search for similar tasks" });
    }
  }
);

/**
 * GET /api/memory/semantic
 *
 * List semantic memories with optional filtering.
 */
router.get(
  "/semantic",
  [
    query("repository").optional().isString(),
    query("category").optional().isString(),
    query("scope").optional().isIn(["repository", "organization", "global"]),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      repository,
      category,
      scope,
      limit = 50,
      offset = 0,
    } = req.query;

    try {
      const repo = AppDataSource.getRepository(SemanticMemory);
      const qb = repo
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .orderBy("m.confidence", "DESC")
        .addOrderBy("m.updatedAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset));

      if (repository) {
        qb.andWhere("m.repository = :repository", { repository });
      }
      if (category) {
        qb.andWhere("m.category = :category", { category });
      }
      if (scope) {
        qb.andWhere("m.scope = :scope", { scope });
      }

      const [memories, total] = await qb.getManyAndCount();

      res.json({
        memories,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("List semantic memories error", { error, orgId });
      res.status(500).json({ error: "Failed to list memories" });
    }
  }
);

/**
 * POST /api/memory/semantic
 *
 * Create a new semantic memory entry.
 */
router.post(
  "/semantic",
  [
    body("repository").optional().isString(),
    body("scope")
      .isIn(["repository", "organization", "global"])
      .withMessage("Invalid scope"),
    body("category")
      .isIn(["convention", "pattern", "technology", "structure", "rule"])
      .withMessage("Invalid category"),
    body("subject").isString().notEmpty().withMessage("Subject is required"),
    body("knowledge").isString().notEmpty().withMessage("Knowledge is required"),
    body("confidence").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    body("source")
      .optional()
      .isIn(["inferred", "explicit", "feedback", "documentation"]),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      repository,
      scope,
      category,
      subject,
      knowledge,
      confidence = 0.5,
      source = "explicit",
    } = req.body;

    try {
      const repo = AppDataSource.getRepository(SemanticMemory);

      // Check for existing entry with same subject/scope/category
      const existing = await repo.findOne({
        where: {
          orgId,
          repository: repository || undefined,
          scope,
          category,
          subject,
        },
      });

      if (existing) {
        // Update existing entry
        existing.knowledge = knowledge;
        existing.confidence = Math.min(1, existing.confidence + 0.1); // Boost confidence
        existing.evidenceCount += 1;
        existing.lastValidatedAt = new Date();
        await repo.save(existing);

        // Re-embed with updated knowledge
        await embedSemanticMemory(orgId, existing.id, category, subject, knowledge);

        return res.json({ memory: existing, updated: true });
      }

      // Create new entry
      const memory = repo.create({
        orgId,
        repository,
        scope,
        category,
        subject,
        knowledge,
        confidence,
        source,
      });

      await repo.save(memory);

      // Generate and store embedding
      await embedSemanticMemory(orgId, memory.id, category, subject, knowledge);

      res.status(201).json({ memory, updated: false });
    } catch (error) {
      logger.error("Create semantic memory error", { error, orgId });
      res.status(500).json({ error: "Failed to create memory" });
    }
  }
);

/**
 * GET /api/memory/episodic
 *
 * List episodic memories with optional filtering.
 */
router.get(
  "/episodic",
  [
    query("repository").optional().isString(),
    query("eventType").optional().isString(),
    query("outcome").optional().isIn(["success", "failure", "partial"]),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      repository,
      eventType,
      outcome,
      limit = 50,
      offset = 0,
    } = req.query;

    try {
      const repo = AppDataSource.getRepository(EpisodicMemory);
      const qb = repo
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .orderBy("m.createdAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset));

      if (repository) {
        qb.andWhere("m.repository = :repository", { repository });
      }
      if (eventType) {
        qb.andWhere("m.eventType = :eventType", { eventType });
      }
      if (outcome) {
        qb.andWhere("m.outcome = :outcome", { outcome });
      }

      const [memories, total] = await qb.getManyAndCount();

      res.json({
        memories,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("List episodic memories error", { error, orgId });
      res.status(500).json({ error: "Failed to list memories" });
    }
  }
);

/**
 * POST /api/memory/episodic
 *
 * Create a new episodic memory entry.
 */
router.post(
  "/episodic",
  [
    body("repository").isString().notEmpty().withMessage("Repository is required"),
    body("eventType")
      .isIn([
        "task_completed",
        "task_failed",
        "approach_worked",
        "approach_failed",
        "error_resolved",
        "pattern_discovered",
      ])
      .withMessage("Invalid event type"),
    body("summary").isString().notEmpty().withMessage("Summary is required"),
    body("details").optional().isObject(),
    body("outcome")
      .isIn(["success", "failure", "partial"])
      .withMessage("Invalid outcome"),
    body("outcomeDetails").optional().isString(),
    body("taskId").optional().isUUID(),
    body("persona").optional().isString(),
    body("model").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      repository,
      eventType,
      summary,
      details,
      outcome,
      outcomeDetails,
      taskId,
      persona,
      model,
    } = req.body;

    try {
      const repo = AppDataSource.getRepository(EpisodicMemory);

      const memory = repo.create({
        orgId,
        repository,
        eventType,
        summary,
        details,
        outcome,
        outcomeDetails,
        taskId,
        persona,
        model,
      });

      await repo.save(memory);

      // Generate and store embedding
      await embedEpisodicMemory(orgId, memory.id, eventType, summary);

      res.status(201).json({ memory });
    } catch (error) {
      logger.error("Create episodic memory error", { error, orgId });
      res.status(500).json({ error: "Failed to create memory" });
    }
  }
);

/**
 * GET /api/memory/procedural
 *
 * List procedural memories (skills) with optional filtering.
 */
router.get(
  "/procedural",
  [
    query("repository").optional().isString(),
    query("minSuccessRate").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("offset").optional().isInt({ min: 0 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      repository,
      minSuccessRate,
      limit = 50,
      offset = 0,
    } = req.query;

    try {
      const repo = AppDataSource.getRepository(ProceduralMemory);
      const qb = repo
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .orderBy("m.successRate", "DESC", "NULLS LAST")
        .addOrderBy("m.updatedAt", "DESC")
        .take(Number(limit))
        .skip(Number(offset));

      if (repository) {
        qb.andWhere("(m.repository = :repository OR m.repository IS NULL)", {
          repository,
        });
      }
      if (minSuccessRate !== undefined) {
        qb.andWhere("(m.successRate >= :minSuccessRate OR m.successRate IS NULL)", {
          minSuccessRate: Number(minSuccessRate),
        });
      }

      const [memories, total] = await qb.getManyAndCount();

      res.json({
        skills: memories,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      logger.error("List procedural memories error", { error, orgId });
      res.status(500).json({ error: "Failed to list skills" });
    }
  }
);

/**
 * POST /api/memory/procedural
 *
 * Create a new procedural memory (skill) entry.
 */
router.post(
  "/procedural",
  [
    body("name").isString().notEmpty().withMessage("Name is required"),
    body("description")
      .isString()
      .notEmpty()
      .withMessage("Description is required"),
    body("steps")
      .isArray({ min: 1 })
      .withMessage("At least one step is required"),
    body("steps.*.step").isInt({ min: 1 }),
    body("steps.*.action").isString().notEmpty(),
    body("repository").optional().isString(),
    body("applicableTo").optional().isObject(),
    body("prerequisites").optional().isObject(),
    body("sourceTaskId").optional().isUUID(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const {
      name,
      description,
      steps,
      repository,
      applicableTo,
      prerequisites,
      sourceTaskId,
    } = req.body;

    try {
      const repo = AppDataSource.getRepository(ProceduralMemory);

      // Generate slug from name
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      // Check for duplicate slug
      const existing = await repo.findOne({
        where: { orgId, slug },
      });

      if (existing) {
        return res.status(409).json({
          error: "A skill with this name already exists",
          existingId: existing.id,
        });
      }

      const memory = repo.create({
        orgId,
        name,
        slug,
        description,
        steps,
        repository,
        applicableTo,
        prerequisites,
        sourceTaskId,
      });

      await repo.save(memory);

      // Generate and store embedding
      await embedProceduralMemory(orgId, memory.id, name, description, steps);

      res.status(201).json({ skill: memory });
    } catch (error) {
      logger.error("Create procedural memory error", { error, orgId });
      res.status(500).json({ error: "Failed to create skill" });
    }
  }
);

/**
 * DELETE /api/memory/:type/:id
 *
 * Delete a memory entry.
 */
router.delete(
  "/:type/:id",
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { type, id } = req.params;
    const memoryId = id as string;

    try {
      let result;
      switch (type) {
        case "semantic":
          result = await AppDataSource.getRepository(SemanticMemory).delete({
            id: memoryId,
            orgId,
          });
          break;
        case "episodic":
          result = await AppDataSource.getRepository(EpisodicMemory).delete({
            id: memoryId,
            orgId,
          });
          break;
        case "procedural":
          result = await AppDataSource.getRepository(ProceduralMemory).delete({
            id: memoryId,
            orgId,
          });
          break;
        default:
          return res.status(400).json({ error: "Invalid memory type" });
      }

      if (result.affected === 0) {
        return res.status(404).json({ error: "Memory not found" });
      }

      res.json({ deleted: true });
    } catch (error) {
      logger.error("Delete memory error", { error, orgId, type, id });
      res.status(500).json({ error: "Failed to delete memory" });
    }
  }
);

// ============================================================================
// Feedback Aggregation Routes (REQ-7)
// ============================================================================

/**
 * GET /api/memory/feedback/persona/:persona
 *
 * Get aggregated feedback statistics for a specific persona.
 */
router.get(
  "/feedback/persona/:persona",
  [query("days").optional().isInt({ min: 1, max: 365 }).toInt()],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const persona = req.params.persona as string;
    const days = req.query.days ? Number(req.query.days) : 30;

    try {
      const stats = await feedbackAggregator.getPersonaStats(orgId, persona, days);
      res.json(stats);
    } catch (error) {
      logger.error("Get persona feedback stats error", { error, orgId, persona });
      res.status(500).json({ error: "Failed to get persona feedback stats" });
    }
  }
);

/**
 * GET /api/memory/feedback/repository/:repository
 *
 * Get aggregated feedback statistics for a specific repository.
 */
router.get(
  "/feedback/repository/:repository(*)",
  [query("days").optional().isInt({ min: 1, max: 365 }).toInt()],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const repository = req.params.repository as string;
    const days = req.query.days ? Number(req.query.days) : 30;

    try {
      const stats = await feedbackAggregator.getRepositoryStats(orgId, repository, days);
      res.json(stats);
    } catch (error) {
      logger.error("Get repository feedback stats error", { error, orgId, repository });
      res.status(500).json({ error: "Failed to get repository feedback stats" });
    }
  }
);

/**
 * GET /api/memory/feedback/patterns
 *
 * Identify feedback patterns across the organization.
 */
router.get(
  "/feedback/patterns",
  [query("days").optional().isInt({ min: 1, max: 365 }).toInt()],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const days = req.query.days ? Number(req.query.days) : 90;

    try {
      const patterns = await feedbackAggregator.identifyPatterns(orgId, days);
      res.json({ patterns });
    } catch (error) {
      logger.error("Identify feedback patterns error", { error, orgId });
      res.status(500).json({ error: "Failed to identify feedback patterns" });
    }
  }
);

/**
 * POST /api/memory/feedback/pipeline
 *
 * Run the full feedback aggregation pipeline.
 * Identifies patterns and optionally stores them as semantic memories.
 */
router.post(
  "/feedback/pipeline",
  [
    body("days").optional().isInt({ min: 1, max: 365 }).toInt(),
    body("storePatterns").optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { days = 90, storePatterns = true } = req.body;

    try {
      const result = await feedbackAggregator.runPipeline(orgId, { days, storePatterns });
      res.json(result);
    } catch (error) {
      logger.error("Run feedback pipeline error", { error, orgId });
      res.status(500).json({ error: "Failed to run feedback pipeline" });
    }
  }
);

// ============================================================================
// Feedback-Based Routing Routes (REQ-8)
// ============================================================================

/**
 * GET /api/memory/routing/scores
 *
 * Get routing scores for all personas based on feedback history.
 */
router.get(
  "/routing/scores",
  [
    query("repository").optional().isString(),
    query("days").optional().isInt({ min: 1, max: 365 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const repository = req.query.repository as string | undefined;
    const days = req.query.days ? Number(req.query.days) : 90;

    try {
      const scores = await feedbackRouter.getPersonaScores(orgId, { repository, days });
      res.json({ scores });
    } catch (error) {
      logger.error("Get routing scores error", { error, orgId });
      res.status(500).json({ error: "Failed to get routing scores" });
    }
  }
);

/**
 * POST /api/memory/routing/recommend
 *
 * Get routing recommendation for a specific task.
 */
router.post(
  "/routing/recommend",
  [
    body("taskType").optional().isString(),
    body("technologies").optional().isArray(),
    body("complexity").optional().isIn(["low", "medium", "high"]),
    body("repository").optional().isString(),
    body("keywords").optional().isArray(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { taskType, technologies, complexity, repository, keywords } = req.body;

    try {
      const recommendation = await feedbackRouter.getRoutingRecommendation(orgId, {
        taskType,
        technologies,
        complexity,
        repository,
        keywords,
      });
      res.json(recommendation);
    } catch (error) {
      logger.error("Get routing recommendation error", { error, orgId });
      res.status(500).json({ error: "Failed to get routing recommendation" });
    }
  }
);

/**
 * GET /api/memory/routing/history
 *
 * Get historical routing decisions and their outcomes.
 */
router.get(
  "/routing/history",
  [
    query("persona").optional().isString(),
    query("days").optional().isInt({ min: 1, max: 365 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const persona = req.query.persona as string | undefined;
    const days = req.query.days ? Number(req.query.days) : 30;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    try {
      const history = await feedbackRouter.getRoutingHistory(orgId, { persona, days, limit });
      res.json({ history });
    } catch (error) {
      logger.error("Get routing history error", { error, orgId });
      res.status(500).json({ error: "Failed to get routing history" });
    }
  }
);

// ============================================================================
// Knowledge Sharing Routes (REQ-10)
// ============================================================================

const VALID_TASK_TYPES: TaskTypeCategory[] = [
  "feature",
  "bugfix",
  "refactor",
  "test",
  "documentation",
  "security",
  "performance",
  "infrastructure",
];

/**
 * GET /api/memory/sharing/related/:taskType
 *
 * Get related task types for knowledge sharing.
 */
router.get("/sharing/related/:taskType", async (req: Request, res: Response) => {
  const taskType = req.params.taskType as TaskTypeCategory;

  if (!VALID_TASK_TYPES.includes(taskType)) {
    return res.status(400).json({
      error: "Invalid task type",
      validTypes: VALID_TASK_TYPES,
    });
  }

  try {
    const relatedTypes = knowledgeSharingService.getRelatedTaskTypes(taskType);
    res.json({ taskType, relatedTypes });
  } catch (error) {
    logger.error("Get related task types error", { error, taskType });
    res.status(500).json({ error: "Failed to get related task types" });
  }
});

/**
 * GET /api/memory/sharing/learnings/:taskType
 *
 * Find shareable learnings from a source task type.
 */
router.get(
  "/sharing/learnings/:taskType",
  [
    query("repository").optional().isString(),
    query("minConfidence").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskType = req.params.taskType as TaskTypeCategory;

    if (!VALID_TASK_TYPES.includes(taskType)) {
      return res.status(400).json({
        error: "Invalid task type",
        validTypes: VALID_TASK_TYPES,
      });
    }

    const repository = req.query.repository as string | undefined;
    const minConfidence = req.query.minConfidence
      ? Number(req.query.minConfidence)
      : 0.6;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    try {
      const learnings = await knowledgeSharingService.findShareableLearnings(
        orgId,
        taskType,
        { repository, minConfidence, limit }
      );
      res.json({ taskType, learnings });
    } catch (error) {
      logger.error("Find shareable learnings error", { error, orgId, taskType });
      res.status(500).json({ error: "Failed to find shareable learnings" });
    }
  }
);

/**
 * POST /api/memory/sharing/transfer
 *
 * Transfer knowledge from one memory to related task types.
 */
router.post(
  "/sharing/transfer",
  [
    body("memoryId").isUUID().withMessage("Valid memory ID required"),
    body("memoryType")
      .isIn(["semantic", "episodic", "procedural"])
      .withMessage("Valid memory type required"),
    body("targetTypes")
      .isArray({ min: 1 })
      .withMessage("At least one target type required"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { memoryId, memoryType, targetTypes } = req.body;

    // Validate target types
    const invalidTypes = targetTypes.filter(
      (t: string) => !VALID_TASK_TYPES.includes(t as TaskTypeCategory)
    );
    if (invalidTypes.length > 0) {
      return res.status(400).json({
        error: "Invalid target types",
        invalidTypes,
        validTypes: VALID_TASK_TYPES,
      });
    }

    try {
      const result = await knowledgeSharingService.transferKnowledge(
        orgId,
        memoryId,
        memoryType,
        targetTypes
      );
      res.json(result);
    } catch (error) {
      logger.error("Transfer knowledge error", { error, orgId, memoryId });
      res.status(500).json({ error: "Failed to transfer knowledge" });
    }
  }
);

/**
 * POST /api/memory/sharing/auto
 *
 * Automatically share learnings between related task types.
 */
router.post(
  "/sharing/auto",
  [
    body("repository").optional().isString(),
    body("maxTransfers").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { repository, maxTransfers } = req.body;

    try {
      const result = await knowledgeSharingService.autoShareLearnings(orgId, {
        repository,
        maxTransfers,
      });
      res.json(result);
    } catch (error) {
      logger.error("Auto share learnings error", { error, orgId });
      res.status(500).json({ error: "Failed to auto-share learnings" });
    }
  }
);

// ============================================================================
// Task Recommendation Routes (REQ-11)
// ============================================================================

/**
 * POST /api/memory/recommend/similar
 *
 * Find similar past tasks based on task description.
 */
router.post(
  "/recommend/similar",
  [
    body("title").isString().notEmpty().withMessage("Task title is required"),
    body("description").optional().isString(),
    body("repository").optional().isString(),
    body("technologies").optional().isArray(),
    body("taskType").optional().isString(),
    body("limit").optional().isInt({ min: 1, max: 20 }).toInt(),
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { title, description, repository, technologies, taskType, limit, minSimilarity } = req.body;

    try {
      const similarTasks = await taskRecommender.findSimilarTasks(
        orgId,
        { title, description, repository, technologies, taskType },
        { limit, minSimilarity }
      );
      res.json({ similarTasks });
    } catch (error) {
      logger.error("Find similar tasks error", { error, orgId });
      res.status(500).json({ error: "Failed to find similar tasks" });
    }
  }
);

/**
 * POST /api/memory/recommend/context
 *
 * Get full planning context with memories and recommendations.
 */
router.post(
  "/recommend/context",
  [
    body("title").isString().notEmpty().withMessage("Task title is required"),
    body("description").optional().isString(),
    body("repository").optional().isString(),
    body("technologies").optional().isArray(),
    body("taskType").optional().isString(),
    body("limit").optional().isInt({ min: 1, max: 10 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { title, description, repository, technologies, taskType, limit } = req.body;

    try {
      const context = await taskRecommender.getPlanningContext(
        orgId,
        { title, description, repository, technologies, taskType },
        { limit }
      );
      res.json(context);
    } catch (error) {
      logger.error("Get planning context error", { error, orgId });
      res.status(500).json({ error: "Failed to get planning context" });
    }
  }
);

/**
 * POST /api/memory/recommend/quick
 *
 * Get brief recommendations for a task (lighter weight).
 */
router.post(
  "/recommend/quick",
  [
    body("title").isString().notEmpty().withMessage("Task title is required"),
    body("description").optional().isString(),
    body("repository").optional().isString(),
    body("technologies").optional().isArray(),
    body("taskType").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { title, description, repository, technologies, taskType } = req.body;

    try {
      const recommendations = await taskRecommender.getQuickRecommendations(
        orgId,
        { title, description, repository, technologies, taskType }
      );
      res.json(recommendations);
    } catch (error) {
      logger.error("Get quick recommendations error", { error, orgId });
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  }
);

// ============================================================================
// Knowledge Graph Routes (REQ-12)
// ============================================================================

const VALID_RELATIONSHIP_TYPES: TaskRelationshipType[] = [
  "similar_to",
  "depends_on",
  "parent_of",
  "shares_pattern",
  "shares_technology",
  "preceded_by",
  "related_to",
  "blocks",
  "duplicates",
];

/**
 * GET /api/memory/graph
 *
 * Get the full knowledge graph for the organization.
 */
router.get(
  "/graph",
  [
    query("repository").optional().isString(),
    query("minStrength").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    query("limit").optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const repository = req.query.repository as string | undefined;
    const minStrength = req.query.minStrength ? Number(req.query.minStrength) : 0.5;
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    try {
      const graph = await knowledgeGraphService.getKnowledgeGraph(orgId, {
        repository,
        minStrength,
        limit,
      });
      res.json(graph);
    } catch (error) {
      logger.error("Get knowledge graph error", { error, orgId });
      res.status(500).json({ error: "Failed to get knowledge graph" });
    }
  }
);

/**
 * GET /api/memory/graph/task/:taskId
 *
 * Get relationships for a specific task.
 */
router.get(
  "/graph/task/:taskId",
  [
    query("direction").optional().isIn(["outgoing", "incoming", "both"]),
    query("types").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskId = req.params.taskId as string;
    const direction = (req.query.direction as "outgoing" | "incoming" | "both") || "both";
    const typesStr = req.query.types as string | undefined;
    const types = typesStr
      ? (typesStr.split(",") as TaskRelationshipType[])
      : undefined;

    try {
      const relationships = await knowledgeGraphService.getTaskRelationships(orgId, taskId, {
        direction,
        types,
      });
      res.json({ relationships });
    } catch (error) {
      logger.error("Get task relationships error", { error, orgId, taskId });
      res.status(500).json({ error: "Failed to get task relationships" });
    }
  }
);

/**
 * GET /api/memory/graph/connected/:taskId
 *
 * Get connected tasks (neighbors in the graph).
 */
router.get(
  "/graph/connected/:taskId",
  [
    query("depth").optional().isInt({ min: 1, max: 5 }).toInt(),
    query("minStrength").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    query("types").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskId = req.params.taskId as string;
    const depth = req.query.depth ? Number(req.query.depth) : 1;
    const minStrength = req.query.minStrength ? Number(req.query.minStrength) : 0.5;
    const typesStr = req.query.types as string | undefined;
    const types = typesStr
      ? (typesStr.split(",") as TaskRelationshipType[])
      : undefined;

    try {
      const connectedTasks = await knowledgeGraphService.getConnectedTasks(orgId, taskId, {
        depth,
        minStrength,
        types,
      });
      res.json({ connectedTasks });
    } catch (error) {
      logger.error("Get connected tasks error", { error, orgId, taskId });
      res.status(500).json({ error: "Failed to get connected tasks" });
    }
  }
);

/**
 * GET /api/memory/graph/path
 *
 * Find shortest path between two tasks.
 */
router.get(
  "/graph/path",
  [
    query("source").isUUID().withMessage("Source task ID required"),
    query("target").isUUID().withMessage("Target task ID required"),
    query("maxDepth").optional().isInt({ min: 1, max: 10 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const source = req.query.source as string;
    const target = req.query.target as string;
    const maxDepth = req.query.maxDepth ? Number(req.query.maxDepth) : 5;

    try {
      const path = await knowledgeGraphService.findPath(orgId, source, target, { maxDepth });
      if (!path) {
        return res.status(404).json({ error: "No path found between tasks" });
      }
      res.json(path);
    } catch (error) {
      logger.error("Find path error", { error, orgId, source, target });
      res.status(500).json({ error: "Failed to find path" });
    }
  }
);

/**
 * POST /api/memory/graph/relationship
 *
 * Create a relationship between two tasks.
 */
router.post(
  "/graph/relationship",
  [
    body("sourceTaskId").isUUID().withMessage("Source task ID required"),
    body("targetTaskId").isUUID().withMessage("Target task ID required"),
    body("relationshipType")
      .isIn(VALID_RELATIONSHIP_TYPES)
      .withMessage("Valid relationship type required"),
    body("strength").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    body("confidence").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    body("metadata").optional().isObject(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { sourceTaskId, targetTaskId, relationshipType, strength, confidence, metadata } = req.body;

    try {
      const relationship = await knowledgeGraphService.createRelationship(
        orgId,
        sourceTaskId,
        targetTaskId,
        relationshipType,
        { strength, confidence, source: "explicit", metadata }
      );
      res.status(201).json(relationship);
    } catch (error) {
      logger.error("Create relationship error", { error, orgId });
      res.status(500).json({ error: "Failed to create relationship" });
    }
  }
);

/**
 * POST /api/memory/graph/discover/:taskId
 *
 * Auto-discover similarity relationships for a task.
 */
router.post(
  "/graph/discover/:taskId",
  [
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }).toFloat(),
    body("maxRelationships").optional().isInt({ min: 1, max: 20 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskId = req.params.taskId as string;
    const { minSimilarity, maxRelationships } = req.body;

    try {
      const relationships = await knowledgeGraphService.discoverSimilarityRelationships(
        orgId,
        taskId,
        { minSimilarity, maxRelationships }
      );
      res.json({ discovered: relationships.length, relationships });
    } catch (error) {
      logger.error("Discover relationships error", { error, orgId, taskId });
      res.status(500).json({ error: "Failed to discover relationships" });
    }
  }
);

/**
 * DELETE /api/memory/graph/relationship/:id
 *
 * Delete a relationship.
 */
router.delete("/graph/relationship/:id", async (req: Request, res: Response) => {
  const org = req.organization;
  const orgId = org?.id;

  if (!orgId) {
    return res.status(401).json({ error: "Organization not found" });
  }

  const relationshipId = req.params.id as string;

  try {
    const deleted = await knowledgeGraphService.deleteRelationship(orgId, relationshipId);
    if (!deleted) {
      return res.status(404).json({ error: "Relationship not found" });
    }
    res.json({ deleted: true });
  } catch (error) {
    logger.error("Delete relationship error", { error, orgId, relationshipId });
    res.status(500).json({ error: "Failed to delete relationship" });
  }
});

// ============================================================================
// Skill Extraction Routes (REQ-14)
// ============================================================================

/**
 * POST /api/memory/skills/extract/:taskId
 *
 * Extract skills from a completed task.
 */
router.post(
  "/skills/extract/:taskId",
  [
    body("autoCreate").optional().isBoolean(),
    body("minConfidence").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskId = req.params.taskId as string;
    const { autoCreate, minConfidence } = req.body;

    try {
      const result = await skillExtractor.extractFromTask(orgId, taskId, { autoCreate, minConfidence });
      res.json(result);
    } catch (error) {
      logger.error("Extract skills from task error", { error, orgId, taskId });
      res.status(500).json({ error: "Failed to extract skills from task" });
    }
  }
);

/**
 * POST /api/memory/skills/batch-extract
 *
 * Batch extract skills from recent successful tasks.
 */
router.post(
  "/skills/batch-extract",
  [
    body("days").optional().isInt({ min: 1, max: 365 }).toInt(),
    body("maxTasks").optional().isInt({ min: 1, max: 100 }).toInt(),
    body("autoCreate").optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { days, maxTasks, autoCreate } = req.body;

    try {
      const result = await skillExtractor.batchExtract(orgId, { days, maxTasks, autoCreate });
      res.json(result);
    } catch (error) {
      logger.error("Batch extract skills error", { error, orgId });
      res.status(500).json({ error: "Failed to batch extract skills" });
    }
  }
);

/**
 * POST /api/memory/skills/suggest
 *
 * Get skill suggestions based on task description.
 */
router.post(
  "/skills/suggest",
  [
    body("description").isString().notEmpty().withMessage("Task description is required"),
    body("limit").optional().isInt({ min: 1, max: 20 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { description, limit } = req.body;

    try {
      const skills = await skillExtractor.suggestSkillsForTask(orgId, description, { limit });
      res.json({ skills });
    } catch (error) {
      logger.error("Suggest skills error", { error, orgId });
      res.status(500).json({ error: "Failed to suggest skills" });
    }
  }
);

// ============================================================================
// Skill Injection Routes (REQ-16)
// ============================================================================

/**
 * GET /api/memory/skills/inject/:taskId
 *
 * Get skills to inject for a specific task.
 * Workers call this to get relevant skills for their current task.
 */
router.get(
  "/skills/inject/:taskId",
  [
    query("limit").optional().isInt({ min: 1, max: 10 }).toInt(),
    query("minRelevance").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const taskId = req.params.taskId as string;
    const limit = req.query.limit ? Number(req.query.limit) : 5;
    const minRelevance = req.query.minRelevance ? Number(req.query.minRelevance) : 0.5;

    try {
      const result = await skillInjector.getSkillsForTask(orgId, taskId, { limit, minRelevance });
      res.json(result);
    } catch (error) {
      logger.error("Get skills for task error", { error, orgId, taskId });
      res.status(500).json({ error: "Failed to get skills for task" });
    }
  }
);

/**
 * POST /api/memory/skills/inject
 *
 * Get skills based on task description (for planning phase).
 */
router.post(
  "/skills/inject",
  [
    body("description").isString().notEmpty().withMessage("Description is required"),
    body("repository").optional().isString(),
    body("taskType").optional().isString(),
    body("limit").optional().isInt({ min: 1, max: 10 }).toInt(),
    body("minRelevance").optional().isFloat({ min: 0, max: 1 }).toFloat(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { description, repository, taskType, limit, minRelevance } = req.body;

    try {
      const result = await skillInjector.getSkillsForDescription(orgId, description, {
        repository,
        taskType,
        limit,
        minRelevance,
      });
      res.json(result);
    } catch (error) {
      logger.error("Get skills for description error", { error, orgId });
      res.status(500).json({ error: "Failed to get skills for description" });
    }
  }
);

/**
 * GET /api/memory/skills/inject/persona/:persona
 *
 * Get skills for a specific persona.
 */
router.get(
  "/skills/inject/persona/:persona",
  [
    query("taskType").optional().isString(),
    query("repository").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 10 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const persona = req.params.persona as string;
    const taskType = req.query.taskType as string | undefined;
    const repository = req.query.repository as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 5;

    try {
      const result = await skillInjector.getSkillsForPersona(orgId, persona, {
        taskType,
        repository,
        limit,
      });
      res.json(result);
    } catch (error) {
      logger.error("Get skills for persona error", { error, orgId, persona });
      res.status(500).json({ error: "Failed to get skills for persona" });
    }
  }
);

/**
 * POST /api/memory/skills/usage
 *
 * Record skill usage outcome (success/failure).
 * Workers call this after using a skill to track effectiveness.
 */
router.post(
  "/skills/usage",
  [
    body("skillId").isUUID().withMessage("Valid skill ID required"),
    body("outcome").isIn(["success", "failure"]).withMessage("Outcome must be success or failure"),
    body("taskId").optional().isUUID(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const { skillId, outcome, taskId } = req.body;

    try {
      await skillInjector.recordSkillUsage(orgId, skillId, outcome, taskId);
      res.json({ recorded: true });
    } catch (error) {
      logger.error("Record skill usage error", { error, orgId, skillId });
      res.status(500).json({ error: "Failed to record skill usage" });
    }
  }
);

// ============================================================================
// Memory Analytics Routes (REQ-21)
// ============================================================================

/**
 * GET /api/memory/analytics/overview
 *
 * Get overview statistics for all memory types.
 */
router.get("/analytics/overview", async (req: Request, res: Response) => {
  const org = req.organization;
  const orgId = org?.id;

  if (!orgId) {
    return res.status(401).json({ error: "Organization not found" });
  }

  try {
    // Get counts for each memory type
    const [semanticCount, episodicCount, proceduralCount] = await Promise.all([
      AppDataSource.getRepository(SemanticMemory).count({ where: { orgId } }),
      AppDataSource.getRepository(EpisodicMemory).count({ where: { orgId } }),
      AppDataSource.getRepository(ProceduralMemory).count({ where: { orgId } }),
    ]);

    // Get semantic memory breakdown by category
    const semanticByCategory = await AppDataSource.getRepository(SemanticMemory)
      .createQueryBuilder("m")
      .select("m.category", "category")
      .addSelect("COUNT(*)", "count")
      .where("m.orgId = :orgId", { orgId })
      .groupBy("m.category")
      .getRawMany();

    // Get episodic memory breakdown by outcome
    const episodicByOutcome = await AppDataSource.getRepository(EpisodicMemory)
      .createQueryBuilder("m")
      .select("m.outcome", "outcome")
      .addSelect("COUNT(*)", "count")
      .where("m.orgId = :orgId", { orgId })
      .groupBy("m.outcome")
      .getRawMany();

    // Get procedural memory stats
    const proceduralStats = await AppDataSource.getRepository(ProceduralMemory)
      .createQueryBuilder("m")
      .select("AVG(m.successRate)", "avgSuccessRate")
      .addSelect("SUM(m.successCount)", "totalSuccesses")
      .addSelect("SUM(m.failureCount)", "totalFailures")
      .addSelect("SUM(m.retrievalCount)", "totalRetrievals")
      .where("m.orgId = :orgId", { orgId })
      .getRawOne();

    res.json({
      overview: {
        totalMemories: semanticCount + episodicCount + proceduralCount,
        semanticMemories: semanticCount,
        episodicMemories: episodicCount,
        proceduralMemories: proceduralCount,
      },
      semanticByCategory: semanticByCategory.reduce((acc, r) => {
        acc[r.category] = parseInt(r.count, 10);
        return acc;
      }, {} as Record<string, number>),
      episodicByOutcome: episodicByOutcome.reduce((acc, r) => {
        acc[r.outcome] = parseInt(r.count, 10);
        return acc;
      }, {} as Record<string, number>),
      proceduralStats: {
        avgSuccessRate: proceduralStats?.avgSuccessRate ? parseFloat(proceduralStats.avgSuccessRate) : null,
        totalSuccesses: parseInt(proceduralStats?.totalSuccesses || "0", 10),
        totalFailures: parseInt(proceduralStats?.totalFailures || "0", 10),
        totalRetrievals: parseInt(proceduralStats?.totalRetrievals || "0", 10),
      },
    });
  } catch (error) {
    logger.error("Get memory analytics overview error", { error, orgId });
    res.status(500).json({ error: "Failed to get analytics overview" });
  }
});

/**
 * GET /api/memory/analytics/most-used
 *
 * Get most frequently retrieved/used memories.
 */
router.get(
  "/analytics/most-used",
  [query("limit").optional().isInt({ min: 1, max: 50 }).toInt()],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 10;

    try {
      // Get most retrieved semantic memories
      const mostRetrievedSemantic = await AppDataSource.getRepository(SemanticMemory)
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .orderBy("m.evidenceCount", "DESC")
        .limit(limit)
        .getMany();

      // Get most retrieved procedural memories (skills)
      const mostRetrievedSkills = await AppDataSource.getRepository(ProceduralMemory)
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .orderBy("m.retrievalCount", "DESC")
        .limit(limit)
        .getMany();

      // Get most used skills (by total usage)
      const mostUsedSkills = await AppDataSource.getRepository(ProceduralMemory)
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("(m.successCount + m.failureCount) > 0")
        .orderBy("(m.successCount + m.failureCount)", "DESC")
        .limit(limit)
        .getMany();

      res.json({
        mostRetrievedPatterns: mostRetrievedSemantic.map((m) => ({
          id: m.id,
          subject: m.subject,
          category: m.category,
          retrievalCount: m.evidenceCount,
          confidence: m.confidence,
        })),
        mostRetrievedSkills: mostRetrievedSkills.map((m) => ({
          id: m.id,
          name: m.name,
          retrievalCount: m.retrievalCount,
          successRate: m.successRate,
        })),
        mostUsedSkills: mostUsedSkills.map((m) => ({
          id: m.id,
          name: m.name,
          totalUsage: m.successCount + m.failureCount,
          successCount: m.successCount,
          failureCount: m.failureCount,
          successRate: m.successRate,
        })),
      });
    } catch (error) {
      logger.error("Get most used memories error", { error, orgId });
      res.status(500).json({ error: "Failed to get most used memories" });
    }
  }
);

/**
 * GET /api/memory/analytics/most-effective
 *
 * Get skills with highest success rates.
 */
router.get(
  "/analytics/most-effective",
  [
    query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
    query("minUsage").optional().isInt({ min: 1 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const minUsage = req.query.minUsage ? Number(req.query.minUsage) : 3;

    try {
      // Get highest success rate skills (with minimum usage threshold)
      const mostEffective = await AppDataSource.getRepository(ProceduralMemory)
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("(m.successCount + m.failureCount) >= :minUsage", { minUsage })
        .andWhere("m.successRate IS NOT NULL")
        .orderBy("m.successRate", "DESC")
        .limit(limit)
        .getMany();

      // Get least effective (for improvement opportunities)
      const leastEffective = await AppDataSource.getRepository(ProceduralMemory)
        .createQueryBuilder("m")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("(m.successCount + m.failureCount) >= :minUsage", { minUsage })
        .andWhere("m.successRate IS NOT NULL")
        .orderBy("m.successRate", "ASC")
        .limit(limit)
        .getMany();

      res.json({
        mostEffective: mostEffective.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          successRate: m.successRate,
          successCount: m.successCount,
          failureCount: m.failureCount,
          lastUsedAt: m.lastUsedAt,
        })),
        leastEffective: leastEffective.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          successRate: m.successRate,
          successCount: m.successCount,
          failureCount: m.failureCount,
          lastUsedAt: m.lastUsedAt,
        })),
      });
    } catch (error) {
      logger.error("Get most effective skills error", { error, orgId });
      res.status(500).json({ error: "Failed to get most effective skills" });
    }
  }
);

/**
 * GET /api/memory/analytics/trends
 *
 * Get memory creation trends over time.
 */
router.get(
  "/analytics/trends",
  [query("days").optional().isInt({ min: 7, max: 90 }).toInt()],
  async (req: Request, res: Response) => {
    const org = req.organization;
    const orgId = org?.id;

    if (!orgId) {
      return res.status(401).json({ error: "Organization not found" });
    }

    const days = req.query.days ? Number(req.query.days) : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    try {
      // Get semantic memory creation by day
      const semanticTrend = await AppDataSource.getRepository(SemanticMemory)
        .createQueryBuilder("m")
        .select("DATE(m.createdAt)", "date")
        .addSelect("COUNT(*)", "count")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("m.createdAt >= :since", { since })
        .groupBy("DATE(m.createdAt)")
        .orderBy("date", "ASC")
        .getRawMany();

      // Get episodic memory creation by day
      const episodicTrend = await AppDataSource.getRepository(EpisodicMemory)
        .createQueryBuilder("m")
        .select("DATE(m.createdAt)", "date")
        .addSelect("COUNT(*)", "count")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("m.createdAt >= :since", { since })
        .groupBy("DATE(m.createdAt)")
        .orderBy("date", "ASC")
        .getRawMany();

      // Get procedural memory creation by day
      const proceduralTrend = await AppDataSource.getRepository(ProceduralMemory)
        .createQueryBuilder("m")
        .select("DATE(m.createdAt)", "date")
        .addSelect("COUNT(*)", "count")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("m.createdAt >= :since", { since })
        .groupBy("DATE(m.createdAt)")
        .orderBy("date", "ASC")
        .getRawMany();

      // Get episodic outcomes by day
      const outcomesTrend = await AppDataSource.getRepository(EpisodicMemory)
        .createQueryBuilder("m")
        .select("DATE(m.createdAt)", "date")
        .addSelect("m.outcome", "outcome")
        .addSelect("COUNT(*)", "count")
        .where("m.orgId = :orgId", { orgId })
        .andWhere("m.createdAt >= :since", { since })
        .groupBy("DATE(m.createdAt)")
        .addGroupBy("m.outcome")
        .orderBy("date", "ASC")
        .getRawMany();

      res.json({
        period: { days, since: since.toISOString() },
        semanticTrend: semanticTrend.map((r) => ({
          date: r.date,
          count: parseInt(r.count, 10),
        })),
        episodicTrend: episodicTrend.map((r) => ({
          date: r.date,
          count: parseInt(r.count, 10),
        })),
        proceduralTrend: proceduralTrend.map((r) => ({
          date: r.date,
          count: parseInt(r.count, 10),
        })),
        outcomesTrend: outcomesTrend.map((r) => ({
          date: r.date,
          outcome: r.outcome,
          count: parseInt(r.count, 10),
        })),
      });
    } catch (error) {
      logger.error("Get memory trends error", { error, orgId });
      res.status(500).json({ error: "Failed to get memory trends" });
    }
  }
);

export default router;
