import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDirectiveUsageTracking1705344000110 implements MigrationInterface {
  name = "AddDirectiveUsageTracking1705344000110";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add directives_used JSONB column to worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS directives_used JSONB DEFAULT '[]'
    `);

    // Add metrics columns to persona_directives
    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS usage_count INT DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS success_count INT DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS failure_count INT DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS avg_quality_score FLOAT
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS avg_accuracy_score FLOAT
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ
    `);

    // Add deprecation columns to persona_directives
    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS deprecation_reason TEXT
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS superseded_by_id UUID REFERENCES persona_directives(id)
    `);

    // Add GIN index for efficient JSONB queries on directives_used
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_directives_used
      ON worker_tasks USING GIN (directives_used)
    `);

    // Add index for finding tasks that used a specific directive
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_worker_tasks_directives_used_id
      ON worker_tasks USING GIN ((directives_used))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_directives_used_id
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_tasks_directives_used
    `);

    // Remove deprecation columns from persona_directives
    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS superseded_by_id
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS deprecation_reason
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS deprecated_at
    `);

    // Remove metrics columns from persona_directives
    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS last_used_at
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS avg_accuracy_score
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS avg_quality_score
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS failure_count
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS success_count
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS usage_count
    `);

    // Remove directives_used column from worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS directives_used
    `);
  }
}
