/**
 * Codebase Indexer Service
 *
 * Indexes repository code into semantic chunks with embeddings.
 * Part of the Codebase RAG system.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { CodebaseIndex } from "../models/CodebaseIndex.js";
import { CodebaseIndexStatus, IndexingStatus } from "../models/CodebaseIndexStatus.js";
import { codeChunker, ChunkResult } from "./code-chunker.js";
import { generateEmbeddingsBatch, formatEmbeddingForStorage } from "./embedding.js";
import { getScmProvider, getGitHubProvider } from "../scm-providers/index.js";
import { logger } from "../utils/logger.js";
import { minimatch } from "minimatch";

// Ollama embeddings are free (local inference)
const COST_PER_1M_TOKENS = 0;

// Batch size for embedding generation
const EMBEDDING_BATCH_SIZE = 10;

/**
 * Result of an indexing operation
 */
export interface IndexingResult {
  success: boolean;
  repository: string;
  branch: string;
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  skippedFiles: number;
  tokensUsed: number;
  estimatedCostUsd: number;
  durationMs: number;
  error?: string;
}

/**
 * Options for indexing
 */
export interface IndexingOptions {
  forceReindex?: boolean;
  maxFiles?: number;
  branch?: string;
}

/**
 * File entry from SCM tree
 */
interface FileEntry {
  path: string;
  type: string;
  size?: number;
}

/**
 * Codebase Indexer - indexes repositories for semantic search
 */
export class CodebaseIndexer {
  private orgRepo = AppDataSource.getRepository(Organization);
  private indexRepo = AppDataSource.getRepository(CodebaseIndex);
  private statusRepo = AppDataSource.getRepository(CodebaseIndexStatus);

  /**
   * Index a repository for an organization
   */
  async indexRepository(
    orgId: string,
    repository: string,
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    const startTime = Date.now();
    const branch = options.branch || "main";

    logger.info("Starting codebase indexing", { orgId, repository, branch });

    try {
      // Get organization settings
      const org = await this.orgRepo.findOne({ where: { id: orgId } });
      if (!org) {
        throw new Error("Organization not found");
      }

      if (!org.codebaseIndexingEnabled) {
        return {
          success: false,
          repository,
          branch,
          totalFiles: 0,
          indexedFiles: 0,
          totalChunks: 0,
          skippedFiles: 0,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          durationMs: Date.now() - startTime,
          error: "Codebase indexing is not enabled for this organization",
        };
      }

      // Get or create status entry
      let status = await this.statusRepo.findOne({
        where: { orgId, repository, branch },
      });

      if (!status) {
        status = this.statusRepo.create({
          orgId,
          repository,
          branch,
          status: "pending",
        });
        await this.statusRepo.save(status);
      }

      // Check if already indexing
      if (status.status === "indexing" && !options.forceReindex) {
        return {
          success: false,
          repository,
          branch,
          totalFiles: 0,
          indexedFiles: 0,
          totalChunks: 0,
          skippedFiles: 0,
          tokensUsed: 0,
          estimatedCostUsd: 0,
          durationMs: Date.now() - startTime,
          error: "Repository is already being indexed",
        };
      }

      // Update status to indexing
      status.status = "indexing";
      status.startedAt = new Date();
      status.lastError = null;
      await this.statusRepo.save(status);

      // Get SCM provider
      const scmProvider = getScmProvider(org);
      const repoId = scmProvider.parseRepoIdentifier(repository);

      // Fetch file tree from repository
      const fileTree = await this.fetchFileTree(org, repository, branch);
      if (!fileTree) {
        throw new Error("Failed to fetch file tree from repository");
      }

      // Filter files based on settings
      const filesToIndex = this.filterFiles(fileTree, org, options.maxFiles);
      status.totalFiles = filesToIndex.length;
      await this.statusRepo.save(status);

      logger.info("Files to index", {
        orgId,
        repository,
        totalFiles: filesToIndex.length,
        excludedFiles: fileTree.length - filesToIndex.length,
      });

      // Delete existing index if force reindex
      if (options.forceReindex) {
        await this.indexRepo.delete({ orgId, repository, branch });
      }

      // Process files in batches
      let indexedFiles = 0;
      let totalChunks = 0;
      let skippedFiles = 0;
      let totalTokens = 0;

      const chunksToEmbed: Array<{ chunk: ChunkResult["chunks"][0]; filePath: string; chunkId: string }> =
        [];

      for (const file of filesToIndex) {
        try {
          // Fetch file content
          const content = await this.fetchFileContent(org, repository, file.path, branch);
          if (!content) {
            skippedFiles++;
            continue;
          }

          // Chunk the file
          const chunkResult = codeChunker.chunkFile(
            file.path,
            content,
            org.codebaseIncludeLanguages
          );

          if (chunkResult.skipped) {
            skippedFiles++;
            logger.debug("Skipped file", {
              filePath: file.path,
              reason: chunkResult.skipReason,
            });
            continue;
          }

          // Store chunks
          for (const chunk of chunkResult.chunks) {
            const indexEntry = this.indexRepo.create({
              orgId,
              repository,
              branch,
              filePath: file.path,
              fileHash: chunkResult.fileHash,
              chunkIndex: chunk.chunkIndex,
              chunkType: chunk.chunkType,
              content: chunk.content,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              language: chunkResult.language,
              symbolName: chunk.symbolName || null,
              symbolType: chunk.symbolType || null,
            });

            // Save without embedding first
            const saved = await this.indexRepo.save(indexEntry);

            // Queue for embedding
            chunksToEmbed.push({
              chunk,
              filePath: file.path,
              chunkId: saved.id,
            });

            totalChunks++;
          }

          indexedFiles++;

          // Update status periodically
          if (indexedFiles % 10 === 0) {
            status.indexedFiles = indexedFiles;
            status.totalChunks = totalChunks;
            status.skippedFiles = skippedFiles;
            await this.statusRepo.save(status);
          }
        } catch (error) {
          logger.warn("Error processing file", {
            filePath: file.path,
            error: error instanceof Error ? error.message : String(error),
          });
          skippedFiles++;
        }
      }

      // Generate embeddings in batches
      logger.info("Generating embeddings", {
        orgId,
        repository,
        totalChunks: chunksToEmbed.length,
      });

      for (let i = 0; i < chunksToEmbed.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = chunksToEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
        const texts = batch.map((b) => {
          // Create embedding text with context
          const header = b.chunk.symbolName
            ? `${b.filePath} - ${b.chunk.symbolName}`
            : b.filePath;
          return `${header}\n\n${b.chunk.content}`;
        });

        try {
          const embeddings = await generateEmbeddingsBatch(orgId, texts);

          // Store embeddings
          for (let j = 0; j < batch.length; j++) {
            const embedding = embeddings[j];
            const embeddingStr = formatEmbeddingForStorage(embedding.embedding);

            await AppDataSource.query(
              `UPDATE codebase_index SET embedding = $1::vector WHERE id = $2`,
              [embeddingStr, batch[j].chunkId]
            );

            totalTokens += embedding.tokenCount;
          }
        } catch (error) {
          logger.error("Error generating embeddings", {
            batchStart: i,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next batch
        }
      }

      // Calculate cost
      const estimatedCostUsd = (totalTokens / 1_000_000) * COST_PER_1M_TOKENS;

      // Update final status
      status.status = "ready";
      status.indexedFiles = indexedFiles;
      status.totalChunks = totalChunks;
      status.skippedFiles = skippedFiles;
      status.tokensUsed = totalTokens;
      status.estimatedCostUsd = estimatedCostUsd;
      status.completedAt = new Date();
      await this.statusRepo.save(status);

      const durationMs = Date.now() - startTime;

      logger.info("Codebase indexing completed", {
        orgId,
        repository,
        branch,
        indexedFiles,
        totalChunks,
        skippedFiles,
        tokensUsed: totalTokens,
        estimatedCostUsd,
        durationMs,
      });

      return {
        success: true,
        repository,
        branch,
        totalFiles: filesToIndex.length,
        indexedFiles,
        totalChunks,
        skippedFiles,
        tokensUsed: totalTokens,
        estimatedCostUsd,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Codebase indexing failed", {
        orgId,
        repository,
        error: errorMessage,
      });

      // Update status to failed
      try {
        const status = await this.statusRepo.findOne({
          where: { orgId, repository, branch },
        });
        if (status) {
          status.status = "failed";
          status.lastError = errorMessage;
          status.errorCount += 1;
          await this.statusRepo.save(status);
        }
      } catch (err) {
        console.error("[codebase-indexer] status update failed:", err instanceof Error ? err.message : err);
      }

      return {
        success: false,
        repository,
        branch,
        totalFiles: 0,
        indexedFiles: 0,
        totalChunks: 0,
        skippedFiles: 0,
        tokensUsed: 0,
        estimatedCostUsd: 0,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Update index for changed files
   */
  async updateIndex(
    orgId: string,
    repository: string,
    changedFiles: string[],
    branch: string = "main"
  ): Promise<IndexingResult> {
    const startTime = Date.now();

    logger.info("Updating codebase index", {
      orgId,
      repository,
      changedFileCount: changedFiles.length,
    });

    try {
      const org = await this.orgRepo.findOne({ where: { id: orgId } });
      if (!org) {
        throw new Error("Organization not found");
      }

      // Delete existing chunks for changed files
      for (const filePath of changedFiles) {
        await this.indexRepo.delete({ orgId, repository, branch, filePath });
      }

      // Re-index only the changed files
      let indexedFiles = 0;
      let totalChunks = 0;
      let totalTokens = 0;
      const chunksToEmbed: Array<{ chunk: ChunkResult["chunks"][0]; filePath: string; chunkId: string }> =
        [];

      for (const filePath of changedFiles) {
        const content = await this.fetchFileContent(org, repository, filePath, branch);
        if (!content) continue;

        const chunkResult = codeChunker.chunkFile(
          filePath,
          content,
          org.codebaseIncludeLanguages
        );

        if (chunkResult.skipped) continue;

        for (const chunk of chunkResult.chunks) {
          const indexEntry = this.indexRepo.create({
            orgId,
            repository,
            branch,
            filePath,
            fileHash: chunkResult.fileHash,
            chunkIndex: chunk.chunkIndex,
            chunkType: chunk.chunkType,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            language: chunkResult.language,
            symbolName: chunk.symbolName || null,
            symbolType: chunk.symbolType || null,
          });

          const saved = await this.indexRepo.save(indexEntry);
          chunksToEmbed.push({ chunk, filePath, chunkId: saved.id });
          totalChunks++;
        }

        indexedFiles++;
      }

      // Generate embeddings
      for (let i = 0; i < chunksToEmbed.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = chunksToEmbed.slice(i, i + EMBEDDING_BATCH_SIZE);
        const texts = batch.map((b) => {
          const header = b.chunk.symbolName
            ? `${b.filePath} - ${b.chunk.symbolName}`
            : b.filePath;
          return `${header}\n\n${b.chunk.content}`;
        });

        try {
          const embeddings = await generateEmbeddingsBatch(orgId, texts);

          for (let j = 0; j < batch.length; j++) {
            const embedding = embeddings[j];
            const embeddingStr = formatEmbeddingForStorage(embedding.embedding);

            await AppDataSource.query(
              `UPDATE codebase_index SET embedding = $1::vector WHERE id = $2`,
              [embeddingStr, batch[j].chunkId]
            );

            totalTokens += embedding.tokenCount;
          }
        } catch (error) {
          logger.error("Error generating embeddings in update", { error });
        }
      }

      const estimatedCostUsd = (totalTokens / 1_000_000) * COST_PER_1M_TOKENS;

      // Update status
      const status = await this.statusRepo.findOne({
        where: { orgId, repository, branch },
      });
      if (status) {
        status.totalChunks = await this.indexRepo.count({
          where: { orgId, repository, branch },
        });
        status.tokensUsed += totalTokens;
        status.estimatedCostUsd = Number(status.estimatedCostUsd) + estimatedCostUsd;
        status.updatedAt = new Date();
        await this.statusRepo.save(status);
      }

      return {
        success: true,
        repository,
        branch,
        totalFiles: changedFiles.length,
        indexedFiles,
        totalChunks,
        skippedFiles: changedFiles.length - indexedFiles,
        tokensUsed: totalTokens,
        estimatedCostUsd,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        repository,
        branch,
        totalFiles: changedFiles.length,
        indexedFiles: 0,
        totalChunks: 0,
        skippedFiles: 0,
        tokensUsed: 0,
        estimatedCostUsd: 0,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get indexing status for a repository
   */
  async getIndexStatus(
    orgId: string,
    repository: string,
    branch: string = "main"
  ): Promise<CodebaseIndexStatus | null> {
    return this.statusRepo.findOne({
      where: { orgId, repository, branch },
    });
  }

  /**
   * Delete index for a repository
   */
  async deleteIndex(
    orgId: string,
    repository: string,
    branch?: string
  ): Promise<void> {
    if (branch) {
      await this.indexRepo.delete({ orgId, repository, branch });
      await this.statusRepo.delete({ orgId, repository, branch });
    } else {
      await this.indexRepo.delete({ orgId, repository });
      await this.statusRepo.delete({ orgId, repository });
    }

    logger.info("Deleted codebase index", { orgId, repository, branch });
  }

  /**
   * Get all indexed repositories for an organization
   */
  async getIndexedRepositories(orgId: string): Promise<CodebaseIndexStatus[]> {
    return this.statusRepo.find({
      where: { orgId },
      order: { updatedAt: "DESC" },
    });
  }

  /**
   * Get org-wide stats
   */
  async getOrgStats(orgId: string): Promise<{
    totalRepositories: number;
    totalChunks: number;
    totalTokensUsed: number;
    totalCostUsd: number;
  }> {
    const statuses = await this.statusRepo.find({ where: { orgId } });

    return {
      totalRepositories: statuses.length,
      totalChunks: statuses.reduce((sum, s) => sum + (s.totalChunks || 0), 0),
      totalTokensUsed: statuses.reduce((sum, s) => sum + (s.tokensUsed || 0), 0),
      totalCostUsd: statuses.reduce((sum, s) => sum + Number(s.estimatedCostUsd || 0), 0),
    };
  }

  /**
   * Index all repositories configured for an organization.
   * Reads org.getRepositories() and fires off indexRepository() for each (fire-and-forget).
   * Returns the list of repositories that were started.
   */
  async indexAllRepositories(
    orgId: string,
    options: IndexingOptions = {}
  ): Promise<string[]> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new Error("Organization not found");
    }

    const repos = org.getRepositories();
    if (repos.length === 0) {
      return [];
    }

    logger.info("Starting bulk indexing for all repositories", {
      orgId,
      repoCount: repos.length,
      repos,
    });

    for (const repository of repos) {
      // Fire-and-forget each repo indexing
      this.indexRepository(orgId, repository, options).then((result) => {
        logger.info("Bulk index: repository completed", {
          orgId,
          repository,
          success: result.success,
          chunks: result.totalChunks,
        });
      }).catch((error) => {
        logger.error("Bulk index: repository failed", {
          orgId,
          repository,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return repos;
  }

  // Private helper methods

  private async fetchFileTree(
    org: Organization,
    repository: string,
    branch: string
  ): Promise<FileEntry[] | null> {
    const scmProvider = getScmProvider(org);
    const githubProvider = getGitHubProvider();
    const token = await githubProvider.getToken();

    if (!token) {
      logger.warn("No SCM token available for file tree fetch");
      return null;
    }

    const repoId = scmProvider.parseRepoIdentifier(repository);

    // Use GitHub API directly for now (can be abstracted to SCM provider later)
    const response = await fetch(
      `https://api.github.com/repos/${repoId.fullPath}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) {
      logger.warn("Failed to fetch file tree", {
        repository,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as {
      tree: Array<{ path: string; type: string; size?: number }>;
    };

    // Filter to only blob (file) entries
    return data.tree
      .filter((item) => item.type === "blob")
      .map((item) => ({
        path: item.path,
        type: item.type,
        size: item.size,
      }));
  }

  private filterFiles(
    files: FileEntry[],
    org: Organization,
    maxFiles?: number
  ): FileEntry[] {
    const excludePatterns = org.codebaseExcludePatterns || [];
    const maxFileSizeKb = org.codebaseMaxFileSizeKb || 100;
    const limit = maxFiles ?? org.codebaseMaxFilesPerRepo ?? 500;

    const filtered = files.filter((file) => {
      // Skip files that match exclude patterns
      for (const pattern of excludePatterns) {
        if (minimatch(file.path, pattern)) {
          return false;
        }
      }

      // Skip files that are too large
      if (file.size && file.size > maxFileSizeKb * 1024) {
        return false;
      }

      // Check if file has a supported language
      const language = codeChunker.detectLanguage(file.path);
      if (!language) {
        return false;
      }

      const includeLanguages = org.codebaseIncludeLanguages;
      if (includeLanguages && includeLanguages.length > 0) {
        if (!includeLanguages.includes(language)) {
          return false;
        }
      }

      return true;
    });

    // Limit number of files
    return filtered.slice(0, limit);
  }

  private async fetchFileContent(
    org: Organization,
    repository: string,
    filePath: string,
    branch: string
  ): Promise<string | null> {
    const scmProvider = getScmProvider(org);
    const githubProvider = getGitHubProvider();
    const token = await githubProvider.getToken();

    if (!token) {
      return null;
    }

    const repoId = scmProvider.parseRepoIdentifier(repository);

    // Use GitHub API raw content endpoint
    const response = await fetch(
      `https://api.github.com/repos/${repoId.fullPath}/contents/${encodeURIComponent(filePath)}?ref=${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
          "User-Agent": "WorkerMill-API",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    return response.text();
  }
}

// Export singleton instance
export const codebaseIndexer = new CodebaseIndexer();
