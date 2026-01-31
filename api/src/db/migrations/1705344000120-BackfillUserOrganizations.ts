import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backfill UserOrganization junction records for users with legacy orgId
 *
 * Issue: When users accepted invites, the code set user.orgId but didn't create
 * a UserOrganization junction record. This migration backfills those records.
 */
export class BackfillUserOrganizations1705344000120 implements MigrationInterface {
  name = "BackfillUserOrganizations1705344000120";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find all users with orgId who don't have a corresponding UserOrganization record
    // and create the junction records
    await queryRunner.query(`
      INSERT INTO user_organizations (id, user_id, org_id, role, is_default, joined_at, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        u.id,
        u.org_id,
        COALESCE(u.role, 'member'),
        true,
        COALESCE(u.created_at, NOW()),
        NOW(),
        NOW()
      FROM users u
      LEFT JOIN user_organizations uo ON uo.user_id = u.id AND uo.org_id = u.org_id
      WHERE u.org_id IS NOT NULL
        AND uo.id IS NULL
    `);

    // Also clean up orphaned invites where user already exists in the org
    await queryRunner.query(`
      DELETE FROM org_invites oi
      WHERE EXISTS (
        SELECT 1 FROM users u
        WHERE LOWER(u.email) = LOWER(oi.email)
          AND u.org_id = oi.org_id
      )
      AND oi.accepted = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a data backfill migration - no rollback needed
    // The junction records are valid and shouldn't be removed
  }
}
