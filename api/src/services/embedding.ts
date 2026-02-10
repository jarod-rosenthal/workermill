/**
 * Embedding Service for Agent Memory System
 *
 * Generates vector embeddings for memory entries using Ollama's embedding API
 * (nomic-embed-text model). Supports storing and querying embeddings in
 * PostgreSQL via pgvector.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";

// Embedding model configuration
const EMBEDDING_MODEL = "nomic-embed-text";
const EMBEDDING_DIMENSIONS = 768;
const MAX_INPUT_CHARS = 8191 * 4; // Rough char limit matching old token limit

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

/**
 * Options for similarity search
 */
export interface SimilaritySearchOptions {
  limit?: number;
  minSimilarity?: number; // 0-1, where 1 is identical
  repository?: string;
}

/**
 * Resolve the Ollama base URL for an organization.
 * Fallback chain: org ollamaBaseUrl → OLLAMA_HOST env var → http://localhost:11434
 */
async function getOllamaBaseUrl(orgId: string): Promise<string> {
  try {
    const org = await AppDataSource.getRepository(Organization).findOne({
      where: { id: orgId },
      select: ["id", "ollamaBaseUrl"],
    });
    if (org?.ollamaBaseUrl) {
      return org.ollamaBaseUrl;
    }
  } catch (error) {
    logger.warn("Failed to look up org ollamaBaseUrl, using fallback", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return process.env.OLLAMA_HOST || "http://localhost:11434";
}

/**
 * Generate an embedding for text using Ollama's API
 *
 * @param orgId - Organization ID for Ollama URL lookup
 * @param text - Text to embed
 * @returns Embedding result with vector and metadata
 */
export async function generateEmbedding(
  orgId: string,
  text: string,
): Promise<EmbeddingResult> {
  const ollamaBaseUrl = await getOllamaBaseUrl(orgId);

  // Truncate text if too long
  const truncatedText =
    text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

  const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncatedText,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("Ollama embedding API error", {
      status: response.status,
      error,
    });
    throw new Error(
      `Ollama embedding API error: ${response.status} - ${error}`,
    );
  }

  const data = (await response.json()) as {
    embeddings: number[][];
  };

  return {
    embedding: data.embeddings[0],
    model: EMBEDDING_MODEL,
    tokenCount: 0,
  };
}

/**
 * Generate embeddings for multiple texts in batch
 *
 * @param orgId - Organization ID for Ollama URL lookup
 * @param texts - Array of texts to embed
 * @returns Array of embedding results
 */
export async function generateEmbeddingsBatch(
  orgId: string,
  texts: string[],
): Promise<EmbeddingResult[]> {
  const ollamaBaseUrl = await getOllamaBaseUrl(orgId);

  // Truncate texts if too long
  const truncatedTexts = texts.map((text) =>
    text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text,
  );

  const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncatedTexts,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("Ollama embedding API error", {
      status: response.status,
      error,
    });
    throw new Error(
      `Ollama embedding API error: ${response.status} - ${error}`,
    );
  }

  const data = (await response.json()) as {
    embeddings: number[][];
  };

  return data.embeddings.map((embedding) => ({
    embedding,
    model: EMBEDDING_MODEL,
    tokenCount: 0,
  }));
}

/**
 * Format embedding vector for PostgreSQL pgvector storage
 *
 * @param embedding - Array of numbers
 * @returns String formatted for pgvector (e.g., "[0.1,0.2,0.3]")
 */
export function formatEmbeddingForStorage(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Parse embedding vector from PostgreSQL pgvector format
 *
 * @param stored - String from database
 * @returns Array of numbers
 */
export function parseEmbeddingFromStorage(stored: string): number[] {
  // Remove brackets and split by comma
  const cleaned = stored.replace(/[[\]]/g, "");
  return cleaned.split(",").map(Number);
}

/**
 * Find similar semantic memories using vector similarity search
 *
 * @param orgId - Organization ID
 * @param queryEmbedding - Query embedding vector
 * @param options - Search options
 * @returns Array of similar memories with similarity scores
 */
export async function findSimilarSemanticMemories(
  orgId: string,
  queryEmbedding: number[],
  options: SimilaritySearchOptions = {},
): Promise<Array<{ id: string; similarity: number; [key: string]: unknown }>> {
  const { limit = 10, minSimilarity = 0.5, repository } = options;

  // Convert similarity threshold to distance (cosine distance = 1 - similarity)
  const maxDistance = 1 - minSimilarity;

  const embeddingStr = formatEmbeddingForStorage(queryEmbedding);

  let query = `
    SELECT
      id,
      repository,
      scope,
      category,
      subject,
      knowledge,
      confidence,
      1 - (embedding <=> $1::vector) as similarity
    FROM semantic_memories
    WHERE org_id = $2
      AND embedding IS NOT NULL
      AND (embedding <=> $1::vector) < $3
  `;

  const params: unknown[] = [embeddingStr, orgId, maxDistance];

  if (repository) {
    query += ` AND (repository = $4 OR repository IS NULL)`;
    params.push(repository);
  }

  query += `
    ORDER BY embedding <=> $1::vector
    LIMIT $${params.length + 1}
  `;
  params.push(limit);

  const results = await AppDataSource.query(query, params);

  // Update retrieval counts
  if (results.length > 0) {
    const ids = results.map((r: { id: string }) => r.id);
    await AppDataSource.query(
      `UPDATE semantic_memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return results;
}

/**
 * Find similar episodic memories using vector similarity search
 *
 * @param orgId - Organization ID
 * @param queryEmbedding - Query embedding vector
 * @param options - Search options
 * @returns Array of similar memories with similarity scores
 */
export async function findSimilarEpisodicMemories(
  orgId: string,
  queryEmbedding: number[],
  options: SimilaritySearchOptions = {},
): Promise<Array<{ id: string; similarity: number; [key: string]: unknown }>> {
  const { limit = 10, minSimilarity = 0.5, repository } = options;

  const maxDistance = 1 - minSimilarity;
  const embeddingStr = formatEmbeddingForStorage(queryEmbedding);

  let query = `
    SELECT
      id,
      repository,
      event_type,
      summary,
      details,
      outcome,
      outcome_details,
      persona,
      model,
      created_at,
      1 - (embedding <=> $1::vector) as similarity
    FROM episodic_memories
    WHERE org_id = $2
      AND embedding IS NOT NULL
      AND (embedding <=> $1::vector) < $3
  `;

  const params: unknown[] = [embeddingStr, orgId, maxDistance];

  if (repository) {
    query += ` AND repository = $4`;
    params.push(repository);
  }

  query += `
    ORDER BY embedding <=> $1::vector
    LIMIT $${params.length + 1}
  `;
  params.push(limit);

  const results = await AppDataSource.query(query, params);

  // Update retrieval counts
  if (results.length > 0) {
    const ids = results.map((r: { id: string }) => r.id);
    await AppDataSource.query(
      `UPDATE episodic_memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return results;
}

/**
 * Find similar procedural memories (skills) using vector similarity search
 *
 * @param orgId - Organization ID
 * @param queryEmbedding - Query embedding vector
 * @param options - Search options
 * @returns Array of similar skills with similarity scores
 */
export async function findSimilarProceduralMemories(
  orgId: string,
  queryEmbedding: number[],
  options: SimilaritySearchOptions = {},
): Promise<Array<{ id: string; similarity: number; [key: string]: unknown }>> {
  const { limit = 5, minSimilarity = 0.4, repository } = options;

  const maxDistance = 1 - minSimilarity;
  const embeddingStr = formatEmbeddingForStorage(queryEmbedding);

  let query = `
    SELECT
      id,
      name,
      slug,
      description,
      repository,
      applicable_to,
      steps,
      prerequisites,
      success_count,
      failure_count,
      success_rate,
      1 - (embedding <=> $1::vector) as similarity
    FROM procedural_memories
    WHERE org_id = $2
      AND embedding IS NOT NULL
      AND (embedding <=> $1::vector) < $3
      AND (success_rate IS NULL OR success_rate > 0.6)
  `;

  const params: unknown[] = [embeddingStr, orgId, maxDistance];

  if (repository) {
    query += ` AND (repository = $4 OR repository IS NULL)`;
    params.push(repository);
  }

  query += `
    ORDER BY success_rate DESC NULLS LAST, embedding <=> $1::vector
    LIMIT $${params.length + 1}
  `;
  params.push(limit);

  const results = await AppDataSource.query(query, params);

  // Update retrieval counts
  if (results.length > 0) {
    const ids = results.map((r: { id: string }) => r.id);
    await AppDataSource.query(
      `UPDATE procedural_memories
       SET retrieval_count = retrieval_count + 1,
           last_retrieved_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return results;
}

/**
 * Store embedding for a semantic memory
 */
export async function storeSemanticMemoryEmbedding(
  memoryId: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE semantic_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId],
  );
}

/**
 * Store embedding for an episodic memory
 */
export async function storeEpisodicMemoryEmbedding(
  memoryId: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE episodic_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId],
  );
}

/**
 * Store embedding for a procedural memory (skill)
 */
export async function storeProceduralMemoryEmbedding(
  memoryId: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE procedural_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId],
  );
}

/**
 * Generate and store embedding for a semantic memory entry
 *
 * Creates embedding text from category, subject, and knowledge.
 */
export async function embedSemanticMemory(
  orgId: string,
  memoryId: string,
  category: string,
  subject: string,
  knowledge: string,
): Promise<void> {
  const text = `${category} - ${subject}: ${knowledge}`;
  const result = await generateEmbedding(orgId, text);
  await storeSemanticMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded semantic memory", {
    memoryId,
  });
}

/**
 * Generate and store embedding for an episodic memory entry
 *
 * Creates embedding text from event type and summary.
 */
export async function embedEpisodicMemory(
  orgId: string,
  memoryId: string,
  eventType: string,
  summary: string,
): Promise<void> {
  const text = `${eventType}: ${summary}`;
  const result = await generateEmbedding(orgId, text);
  await storeEpisodicMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded episodic memory", {
    memoryId,
  });
}

/**
 * Generate and store embedding for a procedural memory (skill)
 *
 * Creates embedding text from name, description, and step summaries.
 */
export async function embedProceduralMemory(
  orgId: string,
  memoryId: string,
  name: string,
  description: string,
  steps: Array<{ action: string }>,
): Promise<void> {
  const stepSummaries = steps.map((s) => s.action).join(". ");
  const text = `${name}: ${description}. Steps: ${stepSummaries}`;
  const result = await generateEmbedding(orgId, text);
  await storeProceduralMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded procedural memory", {
    memoryId,
  });
}

// Export constants for use elsewhere
export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
