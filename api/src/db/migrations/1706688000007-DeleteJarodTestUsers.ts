import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fully delete jarod test users EXCEPT admin@localhost
 *
 * PROTECTED USERS (will NOT be deleted):
 * - admin@localhost
 * - Anyone with @mevion.com email
 * - Anyone who is a member of Mevion org
 */
export class DeleteJarodTestUsers1706688000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get Mevion org ID to protect its members
    const mevionOrg = await queryRunner.query(
      `SELECT id FROM organizations WHERE name = 'Mevion' LIMIT 1`
    );
    const mevionOrgId = mevionOrg.length > 0 ? mevionOrg[0].id : null;
    console.log(`Mevion org ID: ${mevionOrgId}`);

    // Find jarod test users to delete - with safety exclusions
    const jarodUsers = await queryRunner.query(`
      SELECT u.id, u.email
      FROM users u
      WHERE u.email ILIKE '%jarod%'
        AND u.email != 'admin@localhost'
        AND u.email NOT LIKE 'redacted@example.com'
        AND NOT EXISTS (
          SELECT 1 FROM user_organizations uo
          WHERE uo.user_id = u.id AND uo.org_id = $1
        )
    `, [mevionOrgId]);

    console.log(`Found ${jarodUsers.length} jarod test users to delete (Mevion members protected):`);
    for (const user of jarodUsers) {
      console.log(`  - ${user.email} (${user.id})`);
    }

    if (jarodUsers.length === 0) {
      console.log("No users to delete");
      return;
    }

    for (const user of jarodUsers) {
      const userId = user.id;
      const email = user.email;

      // Delete from user_organizations
      await queryRunner.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);

      // Delete from org_invites (invites sent BY this user)
      await queryRunner.query(`DELETE FROM org_invites WHERE invited_by = $1`, [userId]);

      // Delete from org_invites (invites TO this email)
      await queryRunner.query(`DELETE FROM org_invites WHERE email = $1`, [email]);

      // Delete from user_api_keys
      await queryRunner.query(`DELETE FROM user_api_keys WHERE user_id = $1`, [userId]);

      // Delete from audit_logs
      await queryRunner.query(`DELETE FROM audit_logs WHERE user_id = $1`, [userId]);

      // Delete the user
      await queryRunner.query(`DELETE FROM users WHERE id = $1`, [userId]);

      console.log(`Deleted user ${email}`);
    }

    console.log(`Deleted ${jarodUsers.length} test users. Mevion users protected.`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log("Cannot restore deleted users");
  }
}
