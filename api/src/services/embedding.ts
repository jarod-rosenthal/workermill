/**
 * Embedding Service for Agent Memory System
 *
 * Generates vector embeddings for memory entries using OpenAI's embedding API.
 * Supports storing and querying embeddings in PostgreSQL via pgvector.
 */

import { getProviderCredentials } from "../config/index.js";
import { AppDataSource } from "../db/connection.js";
import { logger } from "../utils/logger.js";

// Embedding model configuration
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_INPUT_TOKENS = 8191; // Max tokens for text-embedding-3-small

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
 * Generate an embedding for text using OpenAI's API
 *
 * @param orgId - Organization ID for credentials lookup
 * @param text - Text to embed
 * @returns Embedding result with vector and metadata
 */
export async function generateEmbedding(
  orgId: string,
  text: string
): Promise<EmbeddingResult> {
  const apiKey = await getProviderCredentials(orgId, "openai");

  // Truncate text if too long (rough estimate: 4 chars per token)
  const maxChars = MAX_INPUT_TOKENS * 4;
  const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncatedText,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("OpenAI embedding API error", { status: response.status, error });
    throw new Error(`OpenAI embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage?: { total_tokens: number };
  };
  const embedding = data.data[0].embedding;
  const tokenCount = data.usage?.total_tokens || 0;

  return {
    embedding,
    model: EMBEDDING_MODEL,
    tokenCount,
  };
}

/**
 * Generate embeddings for multiple texts in batch
 *
 * @param orgId - Organization ID for credentials lookup
 * @param texts - Array of texts to embed
 * @returns Array of embedding results
 */
export async function generateEmbeddingsBatch(
  orgId: string,
  texts: string[]
): Promise<EmbeddingResult[]> {
  const apiKey = await getProviderCredentials(orgId, "openai");

  // Truncate texts if too long
  const maxChars = MAX_INPUT_TOKENS * 4;
  const truncatedTexts = texts.map((text) =>
    text.length > maxChars ? text.slice(0, maxChars) : text
  );

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncatedTexts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error("OpenAI embedding API error", { status: response.status, error });
    throw new Error(`OpenAI embedding API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage?: { total_tokens: number };
  };
  const totalTokens = data.usage?.total_tokens || 0;
  const avgTokens = Math.ceil(totalTokens / texts.length);

  return data.data.map((item) => ({
    embedding: item.embedding,
    model: EMBEDDING_MODEL,
    tokenCount: avgTokens,
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
  options: SimilaritySearchOptions = {}
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
      [ids]
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
  options: SimilaritySearchOptions = {}
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
      [ids]
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
  options: SimilaritySearchOptions = {}
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
      [ids]
    );
  }

  return results;
}

/**
 * Store embedding for a semantic memory
 */
export async function storeSemanticMemoryEmbedding(
  memoryId: string,
  embedding: number[]
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE semantic_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId]
  );
}

/**
 * Store embedding for an episodic memory
 */
export async function storeEpisodicMemoryEmbedding(
  memoryId: string,
  embedding: number[]
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE episodic_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId]
  );
}

/**
 * Store embedding for a procedural memory (skill)
 */
export async function storeProceduralMemoryEmbedding(
  memoryId: string,
  embedding: number[]
): Promise<void> {
  const embeddingStr = formatEmbeddingForStorage(embedding);
  await AppDataSource.query(
    `UPDATE procedural_memories SET embedding = $1::vector WHERE id = $2`,
    [embeddingStr, memoryId]
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
  knowledge: string
): Promise<void> {
  const text = `${category} - ${subject}: ${knowledge}`;
  const result = await generateEmbedding(orgId, text);
  await storeSemanticMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded semantic memory", {
    memoryId,
    tokenCount: result.tokenCount,
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
  summary: string
): Promise<void> {
  const text = `${eventType}: ${summary}`;
  const result = await generateEmbedding(orgId, text);
  await storeEpisodicMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded episodic memory", {
    memoryId,
    tokenCount: result.tokenCount,
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
  steps: Array<{ action: string }>
): Promise<void> {
  const stepSummaries = steps.map((s) => s.action).join(". ");
  const text = `${name}: ${description}. Steps: ${stepSummaries}`;
  const result = await generateEmbedding(orgId, text);
  await storeProceduralMemoryEmbedding(memoryId, result.embedding);

  logger.info("Embedded procedural memory", {
    memoryId,
    tokenCount: result.tokenCount,
  });
}

// Export constants for use elsewhere
export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
