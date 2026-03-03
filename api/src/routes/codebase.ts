/**
 * Codebase RAG API Routes
 *
 * Endpoints for managing code indexing and semantic search.
 */

import { Router, type Request, type Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { codebaseIndexer, IndexingOptions } from "../services/codebase-indexer.js";
import { codebaseRetriever, CodeSearchOptions } from "../services/codebase-retriever.js";
import { authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { AppDataSource } from "../db/connection.js";
import { CodebaseIndex } from "../models/CodebaseIndex.js";
import { CodebaseIndexStatus } from "../models/CodebaseIndexStatus.js";
import { formatEmbeddingForStorage } from "../services/embedding.js";
import { logger } from "../utils/logger.js";

const router = Router();

// ─── POST /ingest ─────────────────────────────────────────────────────────────
// Agent pushes pre-chunked + pre-embedded code for storage.
// Uses API key auth (agent auth) — defined before the global JWT middleware.
router.post(
  "/ingest",
  authenticateApiKey,
  [
    body("repository").isString().notEmpty(),
    body("branch").optional().isString(),
    body("chunks")
      .isArray({ min: 1, max: 100 })
      .withMessage("chunks must be an array of 1-100 items"),
    body("chunks.*.filePath").isString().notEmpty(),
    body("chunks.*.chunkIndex").isInt({ min: 0 }),
    body("chunks.*.chunkType").isString().notEmpty(),
    body("chunks.*.content").isString().notEmpty(),
    body("chunks.*.embedding").isArray(),
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

    const { repository, branch = "main", chunks } = req.body;

    // Validate all embeddings are exactly 768 dimensions
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== 768) {
        return res.status(400).json({
          error: `chunks[${i}].embedding must be an array of exactly 768 numbers`,
        });
      }
    }

    try {
      const indexRepo = AppDataSource.getRepository(CodebaseIndex);
      const statusRepo = AppDataSource.getRepository(CodebaseIndexStatus);

      let ingested = 0;

      for (const chunk of chunks) {
        const embeddingStr = formatEmbeddingForStorage(chunk.embedding);

        // Upsert: ON CONFLICT (org_id, repository, file_path, chunk_index) update
        await AppDataSource.query(
          `INSERT INTO codebase_index (
            id, org_id, repository, branch, file_path, file_hash, chunk_index,
            chunk_type, content, start_line, end_line, language,
            symbol_name, symbol_type, embedding, indexed_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14::vector, NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            chunk_type = EXCLUDED.chunk_type,
            file_hash = EXCLUDED.file_hash,
            start_line = EXCLUDED.start_line,
            end_line = EXCLUDED.end_line,
            language = EXCLUDED.language,
            symbol_name = EXCLUDED.symbol_name,
            symbol_type = EXCLUDED.symbol_type,
            indexed_at = NOW()`,
          [
            orgId,
            repository,
            branch,
            chunk.filePath,
            chunk.fileHash || "",
            chunk.chunkIndex,
            chunk.chunkType,
            chunk.content,
            chunk.startLine ?? null,
            chunk.endLine ?? null,
            chunk.language ?? null,
            chunk.symbolName ?? null,
            chunk.symbolType ?? null,
            embeddingStr,
          ],
        );
        ingested++;
      }

      // Update or create CodebaseIndexStatus
      const existingStatus = await statusRepo.findOne({
        where: { orgId, repository, branch },
      });

      if (existingStatus) {
        existingStatus.totalChunks = (existingStatus.totalChunks || 0) + ingested;
        existingStatus.status = "ready";
        existingStatus.completedAt = new Date();
        await statusRepo.save(existingStatus);
      } else {
        const newStatus = statusRepo.create({
          orgId,
          repository,
          branch,
          status: "ready",
          totalChunks: ingested,
          completedAt: new Date(),
        });
        await statusRepo.save(newStatus);
      }

      logger.info("Agent ingested codebase chunks", {
        orgId,
        repository,
        branch,
        ingested,
      });

      return res.json({ ingested, repository, branch });
    } catch (error) {
      logger.error("Error ingesting codebase chunks", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to ingest chunks" });
    }
  },
);

// All routes below require authentication (JWT or API key)
router.use(authenticateRequest);
router.use(requireCurrentTos);

// Block codebase RAG for Pro plan (requires Max or higher)
router.use((req: Request, res: Response, next) => {
  const plan = req.organization?.plan;
  if (!plan || plan === "pro") {
    res.status(403).json({
      error: "Codebase RAG requires Max plan or higher.",
    });
    return;
  }
  next();
});

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

    const options: IndexingOptions = {
      branch,
      forceReindex,
      maxFiles,
    };

    // Fire-and-forget: indexing can take minutes (embedding generation).
    codebaseIndexer.indexRepository(orgId, repository, options).then((result) => {
      logger.info("Codebase index completed", {
        orgId,
        repository,
        success: result.success,
        chunks: result.totalChunks,
        files: result.indexedFiles,
      });
    }).catch((error) => {
      logger.error("Codebase index failed", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return res.status(202).json({
      message: "Indexing started",
      repository,
      branch: branch || "main",
    });
  }
);

/**
 * POST /api/codebase/index-all
 * Trigger indexing for all repositories configured on the organization.
 */
router.post(
  "/index-all",
  [
    body("branch").optional().isString(),
    body("forceReindex").optional().isBoolean(),
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

    const { branch, forceReindex } = req.body;

    try {
      const startedRepos = await codebaseIndexer.indexAllRepositories(orgId, {
        branch,
        forceReindex,
      });

      if (startedRepos.length === 0) {
        return res.status(400).json({
          error: "No repositories configured. Add repositories in Settings first.",
        });
      }

      return res.status(202).json({
        message: "Indexing started for all repositories",
        repositories: startedRepos,
        branch: branch || "main",
      });
    } catch (error) {
      logger.error("Error starting bulk indexing", {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to start bulk indexing" });
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
 * POST /api/codebase/search-with-embedding
 * Search using a pre-computed embedding vector (skips server-side embedding generation).
 * Used by the remote agent which generates embeddings locally via Ollama.
 */
router.post(
  "/search-with-embedding",
  [
    body("repository").isString().notEmpty(),
    body("embedding").isArray(),
    body("limit").optional().isInt({ min: 1, max: 50 }),
    body("minSimilarity").optional().isFloat({ min: 0, max: 1 }),
    body("language").optional().isString(),
    body("branch").optional().isString(),
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
      embedding,
      limit = 10,
      minSimilarity = 0.4,
      language,
      branch,
    } = req.body;

    // Validate embedding dimensions
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      return res.status(400).json({
        error: "embedding must be an array of exactly 768 numbers",
      });
    }

    try {
      const embeddingStr = formatEmbeddingForStorage(embedding);
      const maxDistance = 1 - minSimilarity;

      let sql = `
        SELECT
          id,
          repository,
          branch,
          file_path as "filePath",
          content,
          start_line as "startLine",
          end_line as "endLine",
          language,
          symbol_name as "symbolName",
          symbol_type as "symbolType",
          chunk_type as "chunkType",
          1 - (embedding <=> $1::vector) as similarity
        FROM codebase_index
        WHERE org_id = $2
          AND repository = $3
          AND embedding IS NOT NULL
          AND (embedding <=> $1::vector) < $4
      `;

      const params: unknown[] = [embeddingStr, orgId, repository, maxDistance];
      let paramIndex = 5;

      if (branch) {
        sql += ` AND branch = $${paramIndex}`;
        params.push(branch);
        paramIndex++;
      }

      if (language) {
        sql += ` AND language = $${paramIndex}`;
        params.push(language);
        paramIndex++;
      }

      sql += `
        ORDER BY embedding <=> $1::vector
        LIMIT $${paramIndex}
      `;
      params.push(limit);

      const results = await AppDataSource.query(sql, params);

      // Update access counts
      if (results.length > 0) {
        const ids = results.map((r: { id: string }) => r.id);
        await AppDataSource.query(
          `UPDATE codebase_index
           SET access_count = access_count + 1,
               last_accessed_at = NOW()
           WHERE id = ANY($1)`,
          [ids],
        );
      }

      const snippets = results.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        repository: r.repository as string,
        branch: r.branch as string,
        filePath: r.filePath as string,
        content: r.content as string,
        startLine: r.startLine as number,
        endLine: r.endLine as number,
        language: r.language as string | null,
        symbolName: r.symbolName as string | null,
        symbolType: r.symbolType as string | null,
        chunkType: r.chunkType as string,
        similarity: Number(r.similarity),
      }));

      return res.json({
        snippets,
        formattedText: "",
        totalSnippets: snippets.length,
      });
    } catch (error) {
      logger.error("Error searching code with embedding", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: "Failed to search code" });
    }
  },
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
