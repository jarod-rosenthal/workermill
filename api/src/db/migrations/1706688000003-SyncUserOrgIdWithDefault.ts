import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sync users.org_id with their actual default organization from user_organizations.
 *
 * This fixes the multi-tenant bug where auth middleware was using stale user.org_id
 * instead of the user_organizations.is_default flag.
 *
 * For each user, this migration:
 * 1. Finds their default org from user_organizations (is_default = true, or earliest joined)
 * 2. Updates users.org_id to match
 */
export class SyncUserOrgIdWithDefault1706688000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get all users with user_organizations entries
    const usersWithMemberships = await queryRunner.query(`
      SELECT DISTINCT u.id as user_id, u.email, u.org_id as current_org_id
      FROM users u
      INNER JOIN user_organizations uo ON uo.user_id = u.id
    `);

    console.log(`Found ${usersWithMemberships.length} users with organization memberships`);

    let updatedCount = 0;
    for (const user of usersWithMemberships) {
      // Find the user's effective default org:
      // 1. First try is_default = true
      // 2. Fall back to earliest joined_at
      const defaultOrg = await queryRunner.query(`
        SELECT org_id, is_default, joined_at
        FROM user_organizations
        WHERE user_id = $1
        ORDER BY is_default DESC, joined_at ASC
        LIMIT 1
      `, [user.user_id]);

      if (defaultOrg.length > 0) {
        const effectiveOrgId = defaultOrg[0].org_id;

        if (effectiveOrgId !== user.current_org_id) {
          // Get org names for logging
          const currentOrgName = user.current_org_id
            ? (await queryRunner.query(`SELECT name FROM organizations WHERE id = $1`, [user.current_org_id]))?.[0]?.name
            : 'null';
          const newOrgName = (await queryRunner.query(`SELECT name FROM organizations WHERE id = $1`, [effectiveOrgId]))?.[0]?.name;

          console.log(`Updating user ${user.email}: org_id from "${currentOrgName}" to "${newOrgName}" (is_default=${defaultOrg[0].is_default})`);

          await queryRunner.query(`
            UPDATE users SET org_id = $1 WHERE id = $2
          `, [effectiveOrgId, user.user_id]);

          updatedCount++;
        }
      }
    }

    console.log(`Updated org_id for ${updatedCount} users`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot reliably restore previous org_id values
    console.log("Cannot restore previous org_id values - this migration is one-way");
  }
}
