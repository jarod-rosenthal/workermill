import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delete the incorrect invite to jarod120@gmail.com
 * This invite was created from the wrong org context due to the auth middleware
 * using stale user.org_id instead of user_organizations.is_default
 */
export class DeleteJarod120Invite1706688000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete the pending invite to jarod120@gmail.com
    // This is safe - we're only removing a pending invite record
    const result = await queryRunner.query(
      `DELETE FROM org_invites WHERE email = $1 AND accepted = false`,
      ["jarod120@gmail.com"]
    );

    console.log(`Deleted ${result?.[1] || 0} invite(s) for jarod120@gmail.com`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot restore deleted invite - token would be lost anyway
    console.log("Cannot restore deleted invite");
  }
}
