import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Clean up jarod120@gmail.com user completely so they can be properly invited fresh.
 *
 * This user has stale data from previous tests/migrations that's causing issues:
 * - Shows as "already a member" but doesn't appear in member list
 * - Was incorrectly added to Mevion when they should be in OnCallShift
 *
 * This migration removes all organization memberships and invites for this user
 * so they can be invited fresh.
 */
export class CleanupJarod120User1706688000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = "jarod120@gmail.com";

    // Find the user
    const users = await queryRunner.query(
      `SELECT id, email, org_id FROM users WHERE email = $1`,
      [email]
    );

    if (users.length === 0) {
      console.log(`User ${email} not found - nothing to clean up`);
      return;
    }

    const userId = users[0].id;
    console.log(`Found user ${email} with id ${userId}, org_id: ${users[0].org_id}`);

    // Remove ALL user_organizations entries for this user
    const deletedMemberships = await queryRunner.query(
      `DELETE FROM user_organizations WHERE user_id = $1 RETURNING org_id`,
      [userId]
    );
    console.log(`Deleted ${deletedMemberships.length} organization memberships for ${email}`);

    // Delete any pending invites TO this email
    const deletedInvites = await queryRunner.query(
      `DELETE FROM org_invites WHERE email = $1 RETURNING id, org_id`,
      [email]
    );
    console.log(`Deleted ${deletedInvites.length} pending invites for ${email}`);

    // Set org_id to null
    await queryRunner.query(
      `UPDATE users SET org_id = NULL WHERE id = $1`,
      [userId]
    );
    console.log(`Set org_id to NULL for ${email}`);

    console.log(`User ${email} is now clean and can be invited fresh to any org`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log("Cannot restore deleted memberships/invites");
  }
}
