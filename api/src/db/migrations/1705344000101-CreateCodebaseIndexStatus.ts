import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create codebase_index_status table for tracking repository indexing state.
 * Part of the Codebase RAG system.
 */
export class CreateCodebaseIndexStatus1705344000101 implements MigrationInterface {
  name = "CreateCodebaseIndexStatus1705344000101";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS codebase_index_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Repository identification
        repository VARCHAR(255) NOT NULL,
        branch VARCHAR(255) DEFAULT 'main',

        -- Status
        status VARCHAR(50) DEFAULT 'pending',

        -- Progress tracking
        total_files INT DEFAULT 0,
        indexed_files INT DEFAULT 0,
        total_chunks INT DEFAULT 0,
        skipped_files INT DEFAULT 0,

        -- Cost tracking
        tokens_used INT DEFAULT 0,
        estimated_cost_usd DECIMAL(10,4) DEFAULT 0,

        -- Timing
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,

        -- Git state
        last_indexed_commit VARCHAR(40),

        -- Error handling
        last_error TEXT,
        error_count INT DEFAULT 0,

        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Unique constraint: one status per repository per branch per org
        UNIQUE(org_id, repository, branch)
      )
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_status_org
      ON codebase_index_status(org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_status_status
      ON codebase_index_status(status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_status_org_repo
      ON codebase_index_status(org_id, repository)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_status_org_repo`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_status_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_status_org`);
    await queryRunner.query(`DROP TABLE IF EXISTS codebase_index_status`);
  }
}
