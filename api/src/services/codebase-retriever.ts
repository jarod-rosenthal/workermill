/**
 * Codebase Retriever Service
 *
 * Retrieves relevant code snippets using semantic search.
 * Part of the Codebase RAG system.
 */

import { AppDataSource } from "../db/connection.js";
import { CodebaseIndex, ChunkType } from "../models/CodebaseIndex.js";
import { generateEmbedding, formatEmbeddingForStorage } from "./embedding.js";
import { logger } from "../utils/logger.js";

/**
 * Code snippet retrieved from the index
 */
export interface CodeSnippet {
  id: string;
  repository: string;
  branch: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string | null;
  symbolName: string | null;
  symbolType: string | null;
  chunkType: ChunkType;
  similarity: number;
}

/**
 * Options for code search
 */
export interface CodeSearchOptions {
  limit?: number;
  minSimilarity?: number;
  language?: string;
  chunkTypes?: ChunkType[];
  symbolType?: string;
  branch?: string;
}

/**
 * Formatted code context for worker injection
 */
export interface FormattedCodeContext {
  snippets: CodeSnippet[];
  formattedText: string;
  totalSnippets: number;
}

/**
 * Codebase Retriever - searches indexed code
 */
export class CodebaseRetriever {
  private indexRepo = AppDataSource.getRepository(CodebaseIndex);

  /**
   * Find similar code snippets using semantic search
   */
  async findSimilarCode(
    orgId: string,
    repository: string,
    query: string,
    options: CodeSearchOptions = {}
  ): Promise<CodeSnippet[]> {
    const {
      limit = 10,
      minSimilarity = 0.4,
      language,
      chunkTypes,
      symbolType,
      branch,
    } = options;

    try {
      // Generate embedding for query
      const { embedding } = await generateEmbedding(orgId, query);
      const embeddingStr = formatEmbeddingForStorage(embedding);

      // Convert similarity threshold to distance
      const maxDistance = 1 - minSimilarity;

      // Build query with filters
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

      if (chunkTypes && chunkTypes.length > 0) {
        sql += ` AND chunk_type = ANY($${paramIndex})`;
        params.push(chunkTypes);
        paramIndex++;
      }

      if (symbolType) {
        sql += ` AND symbol_type = $${paramIndex}`;
        params.push(symbolType);
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
          [ids]
        );
      }

      logger.debug("Found similar code snippets", {
        orgId,
        repository,
        queryLength: query.length,
        resultCount: results.length,
      });

      return results.map((r: Record<string, unknown>) => ({
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
        chunkType: r.chunkType as ChunkType,
        similarity: Number(r.similarity),
      }));
    } catch (error) {
      logger.error("Error finding similar code", {
        orgId,
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find code by symbol name
   */
  async findBySymbol(
    orgId: string,
    repository: string,
    symbolName: string,
    options: { branch?: string; limit?: number } = {}
  ): Promise<CodeSnippet[]> {
    const { branch, limit = 10 } = options;

    const qb = this.indexRepo
      .createQueryBuilder("c")
      .where("c.orgId = :orgId", { orgId })
      .andWhere("c.repository = :repository", { repository })
      .andWhere("c.symbolName ILIKE :symbolName", {
        symbolName: `%${symbolName}%`,
      })
      .limit(limit);

    if (branch) {
      qb.andWhere("c.branch = :branch", { branch });
    }

    const results = await qb.getMany();

    return results.map((r) => ({
      id: r.id,
      repository: r.repository,
      branch: r.branch,
      filePath: r.filePath,
      content: r.content,
      startLine: r.startLine || 0,
      endLine: r.endLine || 0,
      language: r.language,
      symbolName: r.symbolName,
      symbolType: r.symbolType,
      chunkType: r.chunkType,
      similarity: 1.0, // Exact match
    }));
  }

  /**
   * Get all indexed chunks for a file
   */
  async getFileContext(
    orgId: string,
    repository: string,
    filePath: string,
    options: { branch?: string } = {}
  ): Promise<CodeSnippet[]> {
    const { branch } = options;

    const qb = this.indexRepo
      .createQueryBuilder("c")
      .where("c.orgId = :orgId", { orgId })
      .andWhere("c.repository = :repository", { repository })
      .andWhere("c.filePath = :filePath", { filePath })
      .orderBy("c.chunkIndex", "ASC");

    if (branch) {
      qb.andWhere("c.branch = :branch", { branch });
    }

    const results = await qb.getMany();

    return results.map((r) => ({
      id: r.id,
      repository: r.repository,
      branch: r.branch,
      filePath: r.filePath,
      content: r.content,
      startLine: r.startLine || 0,
      endLine: r.endLine || 0,
      language: r.language,
      symbolName: r.symbolName,
      symbolType: r.symbolType,
      chunkType: r.chunkType,
      similarity: 1.0,
    }));
  }

  /**
   * Format code snippets for worker context injection
   */
  formatCodeContext(snippets: CodeSnippet[]): FormattedCodeContext {
    if (snippets.length === 0) {
      return {
        snippets: [],
        formattedText: "",
        totalSnippets: 0,
      };
    }

    const lines: string[] = [
      "# Relevant Code from This Repository",
      "",
      "The following code snippets are relevant to your task.",
      "Use these as reference for understanding existing patterns and conventions:",
      "",
    ];

    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i];
      const lineRange =
        snippet.startLine && snippet.endLine
          ? ` (lines ${snippet.startLine}-${snippet.endLine})`
          : "";

      const symbolInfo = snippet.symbolName
        ? ` - ${snippet.symbolType || "symbol"}: ${snippet.symbolName}`
        : "";

      lines.push(`## ${i + 1}. ${snippet.filePath}${lineRange}${symbolInfo}`);
      lines.push("");

      // Add language hint for syntax highlighting
      const lang = snippet.language || "";
      lines.push("```" + lang);
      lines.push(snippet.content);
      lines.push("```");
      lines.push("");

      if (snippet.similarity < 1.0) {
        lines.push(`*Relevance: ${Math.round(snippet.similarity * 100)}%*`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }

    return {
      snippets,
      formattedText: lines.join("\n"),
      totalSnippets: snippets.length,
    };
  }

  /**
   * Get code context for a task description
   *
   * Convenience method that combines search and formatting.
   */
  async getCodeContextForTask(
    orgId: string,
    repository: string,
    taskDescription: string,
    options: CodeSearchOptions = {}
  ): Promise<FormattedCodeContext> {
    const snippets = await this.findSimilarCode(
      orgId,
      repository,
      taskDescription,
      options
    );

    return this.formatCodeContext(snippets);
  }

  /**
   * Multi-query retrieval for better recall
   *
   * Generates multiple search queries from the task description
   * and combines results.
   */
  async getCodeContextMultiQuery(
    orgId: string,
    repository: string,
    taskDescription: string,
    options: CodeSearchOptions & { maxQueries?: number } = {}
  ): Promise<FormattedCodeContext> {
    const { maxQueries = 3, limit = 10, ...searchOptions } = options;

    // Generate multiple queries from the task description
    const queries = this.generateSearchQueries(taskDescription, maxQueries);

    // Run parallel searches
    const allResults = await Promise.all(
      queries.map((query) =>
        this.findSimilarCode(orgId, repository, query, {
          ...searchOptions,
          limit: Math.ceil(limit / queries.length) + 2, // Get a few extra per query
        })
      )
    );

    // Deduplicate and rank results
    const seenIds = new Set<string>();
    const uniqueResults: CodeSnippet[] = [];

    for (const results of allResults) {
      for (const snippet of results) {
        if (!seenIds.has(snippet.id)) {
          seenIds.add(snippet.id);
          uniqueResults.push(snippet);
        }
      }
    }

    // Sort by similarity and limit
    const finalResults = uniqueResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return this.formatCodeContext(finalResults);
  }

  /**
   * Generate multiple search queries from task description
   */
  private generateSearchQueries(description: string, maxQueries: number): string[] {
    const queries: string[] = [description];

    // Extract potential code-related terms
    const codeTerms = description.match(
      /\b(function|class|interface|type|method|api|endpoint|component|service|model|handler|controller|route|middleware|hook|util|helper)\b/gi
    );

    if (codeTerms && codeTerms.length > 0) {
      // Create a query focused on code structures
      const uniqueTerms = [...new Set(codeTerms.map((t) => t.toLowerCase()))];
      queries.push(uniqueTerms.slice(0, 3).join(" ") + " implementation");
    }

    // Extract potential feature/domain terms
    const domainTerms = description
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 4)
      .slice(0, 5);

    if (domainTerms.length > 0) {
      queries.push(domainTerms.join(" "));
    }

    return queries.slice(0, maxQueries);
  }
}

// Export singleton instance
export const codebaseRetriever = new CodebaseRetriever();
