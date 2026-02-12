import { Router, Request, Response } from "express";
import { authenticateRequest } from "../../middleware/auth.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { query, validateRequest } from "../../middleware/validation.js";

const router = Router();

/**
 * GET /api/control-center/search
 * Full-text search across all task logs
 */
router.get(
  "/search",
  authenticateRequest,
  query("q").isString().notEmpty().withMessage("Search query is required"),
  query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be between 1 and 500"),
  query("offset").optional().isInt({ min: 0 }).withMessage("offset must be non-negative"),
  query("taskId").optional().isUUID().withMessage("taskId must be a valid UUID"),
  query("type").optional().isString(),
  query("severity").optional().isIn(["debug", "info", "warning", "error"]),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const searchQuery = req.query.q as string;
      const limit = parseInt((req.query.limit as string) || "50");
      const offset = parseInt((req.query.offset as string) || "0");
      const taskId = req.query.taskId as string | undefined;
      const logType = req.query.type as string | undefined;
      const severity = req.query.severity as string | undefined;

      const logRepo = AppDataSource.getRepository(WorkerTaskLog);
      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Build the query
      let queryBuilder = logRepo
        .createQueryBuilder("log")
        .leftJoinAndSelect("log.task", "task")
        .where("task.orgId = :orgId", { orgId: org.id })
        .andWhere("log.search_vector @@ plainto_tsquery('english', :query)", { query: searchQuery });

      // Apply filters
      if (taskId) {
        queryBuilder = queryBuilder.andWhere("log.taskId = :taskId", { taskId });
      }
      if (logType) {
        queryBuilder = queryBuilder.andWhere("log.type = :logType", { logType });
      }
      if (severity) {
        queryBuilder = queryBuilder.andWhere("log.severity = :severity", { severity });
      }

      // Order by relevance (rank) first, then by creation time
      // Add ts_headline for search result highlighting
      queryBuilder = queryBuilder
        .addSelect(
          "ts_rank(log.search_vector, plainto_tsquery('english', :query))",
          "rank"
        )
        .addSelect(
          "ts_headline('english', log.message, plainto_tsquery('english', :query), 'MaxWords=50, MinWords=30, StartSel=<mark>, StopSel=</mark>')",
          "headline"
        )
        .orderBy("rank", "DESC")
        .addOrderBy("log.createdAt", "DESC")
        .skip(offset)
        .take(limit);

      // Get raw results to access headline, plus count
      const { entities: logs, raw: rawResults } = await queryBuilder.getRawAndEntities();
      const total = await queryBuilder.getCount();

      // Format results with task context
      const results = logs.map((log, index) => ({
        id: log.id,
        taskId: log.taskId,
        jiraIssueKey: log.task?.jiraIssueKey,
        taskSummary: log.task?.summary,
        timestamp: log.createdAt,
        type: log.type,
        message: log.message,
        severity: log.severity,
        command: log.command,
        filePath: log.filePath,
        // Fallback snippet for non-highlighted display
        snippet: log.message.substring(0, 200) + (log.message.length > 200 ? "..." : ""),
        // Highlighted snippet from ts_headline
        headline: rawResults[index]?.headline || log.message.substring(0, 200),
      }));

      // Task search - search by jiraIssueKey (exact) or summary (ILIKE)
      const taskResults = await taskRepo
        .createQueryBuilder("task")
        .where("task.orgId = :orgId", { orgId: org.id })
        .andWhere(
          "(task.jiraIssueKey ILIKE :query OR task.summary ILIKE :queryWild)",
          { query: searchQuery, queryWild: `%${searchQuery}%` }
        )
        .select([
          "task.id",
          "task.jiraIssueKey",
          "task.summary",
          "task.status",
          "task.createdAt",
        ])
        .orderBy("task.createdAt", "DESC")
        .take(10)
        .getMany();

      res.json({
        query: searchQuery,
        tasks: taskResults,
        results,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      logger.error("Error searching logs", { error });
      res.status(500).json({ error: "Failed to search logs" });
    }
  }
);

export default router;
