import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add orgId to Persona-Related Tables
 *
 * Adds org_id column to persona_directives and persona_scripts tables
 * for proper multi-tenant isolation. Backfills from parent persona.
 */
export class AddOrgIdToPersonaTables1705344000051 implements MigrationInterface {
  name = "AddOrgIdToPersonaTables1705344000051";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add org_id to persona_directives
    await queryRunner.query(`
      ALTER TABLE persona_directives
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // Add org_id to persona_scripts
    await queryRunner.query(`
      ALTER TABLE persona_scripts
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // Backfill org_id from parent persona
    await queryRunner.query(`
      UPDATE persona_directives pd
      SET org_id = (
        SELECT p.org_id
        FROM personas p
        WHERE p.id = pd.persona_id
      )
      WHERE pd.org_id IS NULL
    `);

    await queryRunner.query(`
      UPDATE persona_scripts ps
      SET org_id = (
        SELECT p.org_id
        FROM personas p
        WHERE p.id = ps.persona_id
      )
      WHERE ps.org_id IS NULL
    `);

    // Create indexes for org isolation queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_directives_org_id
      ON persona_directives(org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_scripts_org_id
      ON persona_scripts(org_id)
    `);

    // Compound index for common query patterns
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_directives_org_active
      ON persona_directives(org_id, is_active)
      WHERE is_active = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_scripts_org_active
      ON persona_scripts(org_id, is_active)
      WHERE is_active = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_persona_scripts_org_active
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_persona_directives_org_active
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_persona_scripts_org_id
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_persona_directives_org_id
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE persona_scripts
      DROP COLUMN IF EXISTS org_id
    `);

    await queryRunner.query(`
      ALTER TABLE persona_directives
      DROP COLUMN IF EXISTS org_id
    `);
  }
}
