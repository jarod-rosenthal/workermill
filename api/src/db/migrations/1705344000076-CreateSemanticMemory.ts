import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create semantic_memories table for storing codebase-specific patterns and conventions.
 * Part of the Agent Memory & Learning System (Phase 3).
 * Enables pgvector extension for similarity search.
 */
export class CreateSemanticMemory1705344000076 implements MigrationInterface {
  name = "CreateSemanticMemory1705344000076";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension for vector similarity search
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Create semantic memories table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS semantic_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Scope: What does this knowledge apply to?
        repository VARCHAR(255),
        scope VARCHAR(50) NOT NULL DEFAULT 'repository',

        -- The knowledge
        category VARCHAR(50) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        knowledge TEXT NOT NULL,

        -- Confidence and source
        confidence FLOAT DEFAULT 0.5,
        source VARCHAR(50) NOT NULL DEFAULT 'inferred',
        evidence_count INT DEFAULT 1,

        -- Embedding for similarity search (1536 dimensions for OpenAI embeddings)
        embedding vector(1536),

        -- Metadata
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_validated_at TIMESTAMP WITH TIME ZONE,

        -- Retrieval tracking
        retrieval_count INT DEFAULT 0,
        last_retrieved_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_org_repo
      ON semantic_memories(org_id, repository)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_scope
      ON semantic_memories(scope)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_category
      ON semantic_memories(category)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_subject
      ON semantic_memories(subject)
    `);

    // HNSW index for vector similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_semantic_embedding
      ON semantic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // Unique constraint: one knowledge entry per subject per scope per repository
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_unique
      ON semantic_memories(org_id, COALESCE(repository, ''), scope, category, subject)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_unique`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_embedding`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_subject`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_category`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_scope`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_semantic_org_repo`);
    await queryRunner.query(`DROP TABLE IF EXISTS semantic_memories`);
    // Note: Not dropping pgvector extension as other tables may use it
  }
}
