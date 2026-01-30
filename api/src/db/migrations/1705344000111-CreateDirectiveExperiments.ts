import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDirectiveExperiments1705344000111 implements MigrationInterface {
  name = "CreateDirectiveExperiments1705344000111";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create directive_experiments table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS directive_experiments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Experiment identity
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'draft',

        -- What we're testing
        persona_slug VARCHAR(100) NOT NULL,
        directive_type VARCHAR(50) NOT NULL,
        directive_filename VARCHAR(255),

        -- Variants (A/B/C)
        control_directive_id UUID NOT NULL REFERENCES persona_directives(id),
        variant_directive_ids UUID[] NOT NULL DEFAULT '{}',

        -- Traffic allocation (percentages, must sum to 100)
        traffic_allocation JSONB NOT NULL DEFAULT '{"control": 100}',

        -- Results
        min_samples_per_variant INT DEFAULT 20,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        winner_directive_id UUID REFERENCES persona_directives(id),
        winner_reason TEXT,

        -- Audit
        created_by_id UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),

        -- Constraints
        CONSTRAINT chk_experiment_status CHECK (status IN ('draft', 'running', 'completed', 'cancelled')),
        CONSTRAINT chk_directive_type CHECK (directive_type IN ('readme', 'common'))
      )
    `);

    // Add indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_experiments_org ON directive_experiments(org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_experiments_status ON directive_experiments(status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_experiments_persona ON directive_experiments(persona_slug)
    `);

    // Create updated_at trigger function if not exists
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_directive_experiments_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Create trigger
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS directive_experiments_updated_at ON directive_experiments
    `);

    await queryRunner.query(`
      CREATE TRIGGER directive_experiments_updated_at
      BEFORE UPDATE ON directive_experiments
      FOR EACH ROW
      EXECUTE FUNCTION update_directive_experiments_updated_at()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger and function
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS directive_experiments_updated_at ON directive_experiments
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS update_directive_experiments_updated_at()
    `);

    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_experiments_persona
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_experiments_status
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_experiments_org
    `);

    // Drop table
    await queryRunner.query(`
      DROP TABLE IF EXISTS directive_experiments
    `);
  }
}
