import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create episodic_memories table for storing task-specific experiences.
 * Tracks what approaches worked vs failed per repository.
 * Part of the Agent Memory & Learning System (Phase 3).
 */
export class CreateEpisodicMemory1705344000077 implements MigrationInterface {
  name = "CreateEpisodicMemory1705344000077";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create episodic memories table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS episodic_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Context: What task/repo was this about?
        task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
        repository VARCHAR(255) NOT NULL,

        -- The experience
        event_type VARCHAR(50) NOT NULL,
        summary TEXT NOT NULL,
        details JSONB,

        -- Outcome tracking (worked vs failed)
        outcome VARCHAR(20) NOT NULL,
        outcome_details TEXT,

        -- Embedding for similarity search
        embedding vector(1536),

        -- Metadata
        persona VARCHAR(50),
        model VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Retrieval tracking
        retrieval_count INT DEFAULT 0,
        last_retrieved_at TIMESTAMP WITH TIME ZONE,
        effectiveness_score FLOAT
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_org_repo
      ON episodic_memories(org_id, repository)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_event_type
      ON episodic_memories(event_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_outcome
      ON episodic_memories(outcome)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_task_id
      ON episodic_memories(task_id)
    `);

    // HNSW index for vector similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_embedding
      ON episodic_memories USING hnsw (embedding vector_cosine_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_episodic_created_at
      ON episodic_memories(created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_embedding`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_task_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_outcome`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_event_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_episodic_org_repo`);
    await queryRunner.query(`DROP TABLE IF EXISTS episodic_memories`);
  }
}
