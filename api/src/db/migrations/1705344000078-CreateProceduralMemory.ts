import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create procedural_memories table for storing reusable procedures (skills).
 * Part of the Agent Memory & Learning System (Phase 3).
 */
export class CreateProceduralMemory1705344000078 implements MigrationInterface {
  name = "CreateProceduralMemory1705344000078";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create procedural memories (skills) table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS procedural_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Skill identification
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,

        -- Applicability
        repository VARCHAR(255),
        applicable_to JSONB,

        -- The procedure
        steps JSONB NOT NULL,
        prerequisites JSONB,

        -- Source tracking
        source_task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
        extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Quality metrics
        success_count INT DEFAULT 0,
        failure_count INT DEFAULT 0,
        success_rate FLOAT GENERATED ALWAYS AS (
          CASE WHEN (success_count + failure_count) > 0
          THEN success_count::FLOAT / (success_count + failure_count)
          ELSE NULL END
        ) STORED,

        -- Embedding for similarity search
        embedding vector(1536),

        -- Metadata
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Retrieval tracking
        retrieval_count INT DEFAULT 0,
        last_retrieved_at TIMESTAMP WITH TIME ZONE,
        last_used_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_org_repo
      ON procedural_memories(org_id, repository)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_slug
      ON procedural_memories(org_id, slug)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_success_rate
      ON procedural_memories(success_rate DESC NULLS LAST)
    `);

    // HNSW index for vector similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_embedding
      ON procedural_memories USING hnsw (embedding vector_cosine_ops)
    `);

    // GIN index for JSONB applicability queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_procedural_applicable
      ON procedural_memories USING gin (applicable_to)
    `);

    // Unique slug per org
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_procedural_unique_slug
      ON procedural_memories(org_id, slug)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_unique_slug`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_applicable`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_embedding`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_success_rate`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_slug`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_procedural_org_repo`);
    await queryRunner.query(`DROP TABLE IF EXISTS procedural_memories`);
  }
}
