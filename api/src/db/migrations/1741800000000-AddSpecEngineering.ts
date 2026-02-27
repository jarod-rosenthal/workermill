import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSpecEngineering1741800000000 implements MigrationInterface {
  name = "AddSpecEngineering1741800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Spec templates table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_spec_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        description text,
        content text NOT NULL,
        required_sections jsonb DEFAULT '[]',
        is_default boolean DEFAULT false,
        is_public boolean DEFAULT false,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_template_org FOREIGN KEY (org_id)
          REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spec_templates_org_id ON kb_spec_templates(org_id)
    `);

    // Specs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_specs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        title varchar(500) NOT NULL,
        content text,
        status varchar(50) NOT NULL DEFAULT 'draft',
        quality_score int,
        quality_feedback jsonb,
        template_id uuid,
        version int NOT NULL DEFAULT 1,
        created_by uuid,
        board_id uuid,
        metadata jsonb DEFAULT '{}',
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_org FOREIGN KEY (org_id)
          REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_spec_template FOREIGN KEY (template_id)
          REFERENCES kb_spec_templates(id) ON DELETE SET NULL,
        CONSTRAINT fk_spec_board FOREIGN KEY (board_id)
          REFERENCES kb_boards(id) ON DELETE SET NULL,
        CONSTRAINT fk_spec_created_by FOREIGN KEY (created_by)
          REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_org_id ON kb_specs(org_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_board_id ON kb_specs(board_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_status ON kb_specs(status)
    `);

    // Spec version history table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_spec_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spec_id uuid NOT NULL,
        content text NOT NULL,
        quality_score int,
        version int NOT NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_version_spec FOREIGN KEY (spec_id)
          REFERENCES kb_specs(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spec_versions_spec_id ON kb_spec_versions(spec_id)
    `);

    // Add spec_id to kb_boards for lineage
    await queryRunner.query(`
      ALTER TABLE kb_boards
      ADD COLUMN IF NOT EXISTS spec_id uuid
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE kb_boards ADD CONSTRAINT fk_board_spec FOREIGN KEY (spec_id) REFERENCES kb_specs(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // Add org-level spec settings
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS spec_min_quality_score int DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS spec_required_sections jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS spec_required_sections`,
    );
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS spec_min_quality_score`,
    );
    await queryRunner.query(
      `ALTER TABLE kb_boards DROP CONSTRAINT IF EXISTS fk_board_spec`,
    );
    await queryRunner.query(
      `ALTER TABLE kb_boards DROP COLUMN IF EXISTS spec_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS kb_spec_versions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_specs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_spec_templates CASCADE`);
  }
}
