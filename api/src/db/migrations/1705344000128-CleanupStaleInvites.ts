import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delete pending invites for users who are already members of the org.
 * This fixes a bug where invites weren't cleaned up when users joined.
 */
export class CleanupStaleInvites1705344000128 implements MigrationInterface {
  name = "CleanupStaleInvites1705344000128";

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log("=== Cleaning up stale invites ===");

    // Find and delete invites where the user is already a member of that org
    const staleInvites = await queryRunner.query(`
      SELECT oi.id, oi.email, oi.org_id, o.name as org_name
      FROM org_invites oi
      JOIN users u ON LOWER(u.email) = LOWER(oi.email)
      JOIN user_organizations uo ON uo.user_id = u.id AND uo.org_id = oi.org_id
      JOIN organizations o ON o.id = oi.org_id
    `);

    console.log(`Found ${staleInvites.length} stale invites to delete:`);
    for (const invite of staleInvites) {
      console.log(`  - ${invite.email} in ${invite.org_name}`);
    }

    if (staleInvites.length > 0) {
      const ids = staleInvites.map((i: { id: string }) => i.id);
      await queryRunner.query(
        `DELETE FROM org_invites WHERE id = ANY($1)`,
        [ids]
      );
      console.log(`Deleted ${staleInvites.length} stale invites`);
    }

    console.log("=== Done ===");
  }

  public async down(): Promise<void> {
    console.log("Cannot restore deleted invites");
  }
}
