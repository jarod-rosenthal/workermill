import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delete specific jarod test users: user@example.com and user@example.com
 */
export class DeleteJarodTestUsersAgain1706688000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const emails = ["user@example.com", "user@example.com"];

    for (const email of emails) {
      const users = await queryRunner.query(
        `SELECT id FROM users WHERE email = $1`,
        [email]
      );

      if (users.length === 0) {
        console.log(`User ${email} not found - skipping`);
        continue;
      }

      const userId = users[0].id;
      console.log(`Deleting user ${email} (${userId})`);

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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log("Cannot restore deleted users");
  }
}
