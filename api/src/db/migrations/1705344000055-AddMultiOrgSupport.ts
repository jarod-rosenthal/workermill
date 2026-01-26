import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Multi-Organization Support Migration
 *
 * Enables users to belong to multiple organizations with different roles.
 * - Creates user_organizations junction table
 * - Adds default_org_id to users for org preference
 * - Migrates existing single-org relationships
 */
export class AddMultiOrgSupport1705344000055 implements MigrationInterface {
  name = "AddMultiOrgSupport1705344000055";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the junction table for many-to-many relationship
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        is_default BOOLEAN NOT NULL DEFAULT false,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, org_id)
      )
    `);

    // Add indexes for efficient queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_organizations_user_id ON user_organizations(user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_organizations_org_id ON user_organizations(org_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_organizations_user_default ON user_organizations(user_id, is_default) WHERE is_default = true
    `);

    // Check if the constraint exists before trying to drop (check both old and new naming)
    const constraintExists = await queryRunner.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE (constraint_name = 'users_organization_id_fkey' OR constraint_name = 'users_org_id_fkey')
      AND table_name = 'users'
    `);

    if (constraintExists.length > 0) {
      const constraintName = constraintExists[0].constraint_name;
      await queryRunner.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS ${constraintName}
      `);
    }

    // Migrate existing user-org relationships to junction table
    await queryRunner.query(`
      INSERT INTO user_organizations (user_id, org_id, role, is_default, joined_at)
      SELECT
        u.id,
        u.org_id,
        CASE
          WHEN u.role = 'admin' THEN 'owner'
          ELSE 'member'
        END,
        true,
        u.created_at
      FROM users u
      WHERE u.org_id IS NOT NULL
      ON CONFLICT (user_id, org_id) DO NOTHING
    `);

    console.log("[Migration] Migrated existing user-org relationships to junction table");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_organizations_user_default`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_organizations_org_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_organizations_user_id`);

    // Drop junction table
    await queryRunner.query(`DROP TABLE IF EXISTS user_organizations`);

    // Restore foreign key constraint
    await queryRunner.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
    `);
  }
}
