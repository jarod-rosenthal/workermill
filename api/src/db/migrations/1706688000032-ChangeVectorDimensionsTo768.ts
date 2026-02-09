import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change vector embedding dimensions from 1536 (OpenAI text-embedding-3-small)
 * to 768 (Ollama nomic-embed-text).
 *
 * Safe to run — RAG hasn't been used in production, no existing embeddings to preserve.
 *
 * Tables affected: codebase_index, semantic_memories, episodic_memories, procedural_memories
 */
export class ChangeVectorDimensionsTo7681706688000032
  implements MigrationInterface
{
  name = "ChangeVectorDimensionsTo7681706688000032";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- codebase_index ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_codebase_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE codebase_index DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE codebase_index ADD COLUMN embedding vector(768)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_embedding
      ON codebase_index USING hnsw (embedding vector_cosine_ops)
    `);

    // --- semantic_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_semantic_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE semantic_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE semantic_memories ADD COLUMN embedding vector(768)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_embedding
      ON semantic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // --- episodic_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_episodic_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE episodic_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE episodic_memories ADD COLUMN embedding vector(768)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_embedding
      ON episodic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // --- procedural_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_procedural_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE procedural_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE procedural_memories ADD COLUMN embedding vector(768)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_embedding
      ON procedural_memories USING hnsw (embedding vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to 1536 dimensions

    // --- codebase_index ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_codebase_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE codebase_index DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE codebase_index ADD COLUMN embedding vector(1536)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_embedding
      ON codebase_index USING hnsw (embedding vector_cosine_ops)
    `);

    // --- semantic_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_semantic_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE semantic_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE semantic_memories ADD COLUMN embedding vector(1536)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_embedding
      ON semantic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // --- episodic_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_episodic_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE episodic_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE episodic_memories ADD COLUMN embedding vector(1536)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_embedding
      ON episodic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // --- procedural_memories ---
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_procedural_embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE procedural_memories DROP COLUMN IF EXISTS embedding`,
    );
    await queryRunner.query(
      `ALTER TABLE procedural_memories ADD COLUMN embedding vector(1536)`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_embedding
      ON procedural_memories USING hnsw (embedding vector_cosine_ops)
    `);
  }
}
