import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delete jarod120@gmail.com user and their placeholder org for invite flow testing
 */
export class DeleteJarod120ForInviteTest1706688000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = "jarod120@gmail.com";

    const users = await queryRunner.query(
      `SELECT id, org_id FROM users WHERE email = $1`,
      [email]
    );

    if (users.length === 0) {
      console.log(`User ${email} not found - skipping`);
      return;
    }

    const userId = users[0].id;
    const orgId = users[0].org_id;
    console.log(`Deleting user ${email} (${userId}), orgId: ${orgId}`);

    // Delete from user_organizations
    await queryRunner.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);

    // Delete from org_invites (invites sent BY this user)
    await queryRunner.query(`DELETE FROM org_invites WHERE invited_by = $1`, [userId]);

    // Do NOT delete invites TO this email - we want to keep those for testing
    // await queryRunner.query(`DELETE FROM org_invites WHERE email = $1`, [email]);

    // Delete from user_api_keys
    await queryRunner.query(`DELETE FROM user_api_keys WHERE user_id = $1`, [userId]);

    // Delete from audit_logs
    await queryRunner.query(`DELETE FROM audit_logs WHERE user_id = $1`, [userId]);

    // Delete the user
    await queryRunner.query(`DELETE FROM users WHERE id = $1`, [userId]);
    console.log(`Deleted user ${email}`);

    // Delete the placeholder org if it exists and has no other users
    if (orgId) {
      const otherUsers = await queryRunner.query(
        `SELECT COUNT(*) as count FROM users WHERE org_id = $1`,
        [orgId]
      );

      if (parseInt(otherUsers[0].count) === 0) {
        // Check it's not the main oncallshift org before deleting
        const org = await queryRunner.query(
          `SELECT name FROM organizations WHERE id = $1`,
          [orgId]
        );

        if (org.length > 0 && org[0].name !== "oncallshift") {
          console.log(`Deleting placeholder org: ${org[0].name} (${orgId})`);

          // Delete org-related data
          await queryRunner.query(`DELETE FROM worker_tasks WHERE org_id = $1`, [orgId]);
          await queryRunner.query(`DELETE FROM org_invites WHERE org_id = $1`, [orgId]);
          await queryRunner.query(`DELETE FROM user_organizations WHERE org_id = $1`, [orgId]);
          await queryRunner.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

          console.log(`Deleted placeholder org`);
        }
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    console.log("Cannot restore deleted users");
  }
}
