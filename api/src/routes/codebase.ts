/**
 * Codebase RAG API Routes
 *
 * Endpoints for managing code indexing and semantic search.
 */

import { Router, type Request, type Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { codebaseIndexer, IndexingOptions } from "../services/codebase-indexer.js";
import { codebaseRetriever, CodeSearchOptions } from "../services/codebase-retriever.js";
import { authenticateRequest } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

/**
 * POST /api/codebase/index
 * Trigger indexing for a repository
 */
router.post(
  "/index",
  [
    body("repository")
      .isString()
      .notEmpty()
      .withMessage("Repository is required (e.g., owner/repo)"),
    body("branch").optional().isString(),
    body("forceReindex").optional().isBoolean(),
    body("maxFiles").optional().isInt({ min: 1, max: 2000 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const { repository, branch, forceReindex, maxFiles } = req.body;

    try {
      const options: IndexingOptions = {
        branch,
        forceReindex,
        maxFiles,
      };

      // Start indexing
      const result = await codebaseIndexer.indexRepository(orgId, repository, options);

      logger.info("Codebase index request completed", {
        orgId,
        repository,
        success: result.success,
      });

      if (result.success) {
        return res.status(200).json({
          message: "Indexing completed",
          ...result,
        });
      } else {
        return res.status(400).json({
          message: "Indexing failed",
          error: result.error,
          ...result,
        });
      }
    } catch (error) {
      logger.error("Error starting index", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: "Failed to start indexing",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * GET /api/codebase/status/:repository
 * Get indexing status for a repository
 */
router.get(
  "/status/:repository(*)",
  [param("repository").isString().notEmpty(), query("branch").optional().isString()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const repository = req.params.repository as string;
    const branch = (req.query.branch as string) || "main";

    try {
      const status = await codebaseIndexer.getIndexStatus(orgId, repository, branch);

      if (!status) {
        return res.status(404).json({
          error: "No index found for this repository",
          repository,
          branch,
        });
      }

      return res.json(status);
    } catch (error) {
      logger.error("Error getting index status", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to get index status" });
    }
  }
);

/**
 * POST /api/codebase/search
 * Search code index
 */
router.post(
  "/search",
  [
    body("repository")
      .isString()
      .notEmpty()
      .withMessage("Repository is required"),
    body("query").isString().notEmpty().withMessage("Search query is required"),
    body("limit").optional().isInt({ min: 1, max: 50 }),
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }),
    body("language").optional().isString(),
    body("chunkTypes").optional().isArray(),
    body("symbolType").optional().isString(),
    body("branch").optional().isString(),
    body("multiQuery").optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const {
      repository,
      query: searchQuery,
      limit,
      minSimilarity,
      language,
      chunkTypes,
      symbolType,
      branch,
      multiQuery,
    } = req.body;

    try {
      const options: CodeSearchOptions = {
        limit: limit || 10,
        minSimilarity: minSimilarity || 0.4,
        language,
        chunkTypes,
        symbolType,
        branch,
      };

      let result;
      if (multiQuery) {
        result = await codebaseRetriever.getCodeContextMultiQuery(
          orgId,
          repository,
          searchQuery,
          options
        );
      } else {
        result = await codebaseRetriever.getCodeContextForTask(
          orgId,
          repository,
          searchQuery,
          options
        );
      }

      logger.debug("Code search completed", {
        orgId,
        repository,
        resultCount: result.totalSnippets,
      });

      return res.json(result);
    } catch (error) {
      logger.error("Error searching code", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to search code" });
    }
  }
);

/**
 * GET /api/codebase/symbol/:repository
 * Find code by symbol name
 */
router.get(
  "/symbol/:repository(*)",
  [
    param("repository").isString().notEmpty(),
    query("name").isString().notEmpty().withMessage("Symbol name is required"),
    query("branch").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const repository = req.params.repository as string;
    const symbolName = req.query.name as string;
    const branch = req.query.branch as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    try {
      const snippets = await codebaseRetriever.findBySymbol(
        orgId,
        repository,
        symbolName,
        { branch, limit }
      );

      return res.json({
        snippets,
        total: snippets.length,
      });
    } catch (error) {
      logger.error("Error finding symbol", {
        orgId,
        repository,
        symbolName,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to find symbol" });
    }
  }
);

/**
 * GET /api/codebase/file/:repository
 * Get indexed chunks for a specific file
 */
router.get(
  "/file/:repository(*)",
  [
    param("repository").isString().notEmpty(),
    query("path").isString().notEmpty().withMessage("File path is required"),
    query("branch").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const repository = req.params.repository as string;
    const filePath = req.query.path as string;
    const branch = req.query.branch as string | undefined;

    try {
      const chunks = await codebaseRetriever.getFileContext(
        orgId,
        repository,
        filePath,
        { branch }
      );

      return res.json({
        chunks,
        total: chunks.length,
      });
    } catch (error) {
      logger.error("Error getting file context", {
        orgId,
        repository,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to get file context" });
    }
  }
);

/**
 * DELETE /api/codebase/index/:repository
 * Delete index for a repository
 */
router.delete(
  "/index/:repository(*)",
  [param("repository").isString().notEmpty(), query("branch").optional().isString()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      return res.status(401).json({ error: "Organization context required" });
    }

    const repository = req.params.repository as string;
    const branch = req.query.branch as string | undefined;

    try {
      await codebaseIndexer.deleteIndex(orgId, repository, branch);

      logger.info("Deleted codebase index", {
        orgId,
        repository,
        branch,
      });

      return res.json({
        message: "Index deleted successfully",
        repository,
        branch,
      });
    } catch (error) {
      logger.error("Error deleting index", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to delete index" });
    }
  }
);

/**
 * GET /api/codebase/stats
 * Get org-wide indexing stats
 */
router.get("/stats", async (req: Request, res: Response) => {
  const orgId = req.organization?.id;
  if (!orgId) {
    return res.status(401).json({ error: "Organization context required" });
  }

  try {
    const stats = await codebaseIndexer.getOrgStats(orgId);
    const repositories = await codebaseIndexer.getIndexedRepositories(orgId);

    return res.json({
      ...stats,
      repositories: repositories.map((r) => ({
        repository: r.repository,
        branch: r.branch,
        status: r.status,
        totalChunks: r.totalChunks,
        indexedFiles: r.indexedFiles,
        lastIndexedCommit: r.lastIndexedCommit,
        completedAt: r.completedAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    logger.error("Error getting stats", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to get stats" });
  }
});

/**
 * GET /api/codebase/repositories
 * List all indexed repositories
 */
router.get("/repositories", async (req: Request, res: Response) => {
  const orgId = req.organization?.id;
  if (!orgId) {
    return res.status(401).json({ error: "Organization context required" });
  }

  try {
    const repositories = await codebaseIndexer.getIndexedRepositories(orgId);

    return res.json({
      repositories,
      total: repositories.length,
    });
  } catch (error) {
    logger.error("Error listing repositories", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Failed to list repositories" });
  }
});

export default router;
