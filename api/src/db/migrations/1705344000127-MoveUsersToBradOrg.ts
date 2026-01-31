import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Move tshelley and any Mevion users to Brad's org.
 * User will manually delete Mevion org after.
 */
export class MoveUsersToBradOrg1705344000127 implements MigrationInterface {
  name = "MoveUsersToBradOrg1705344000127";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bradOrgId = "0e40e770-4769-437f-b050-1dbaf3b42da8";
    const mevionOrgId = "9d875d55-1236-4aaa-be87-dffd50ea04e9";

    console.log("=== Moving all users to Brad's org ===");

    // Get Brad's org info
    const bradOrg = await queryRunner.query(
      `SELECT id, name FROM organizations WHERE id = $1`,
      [bradOrgId]
    );
    console.log(`Target org: ${bradOrg[0]?.name} (${bradOrgId})`);

    // Get tshelley
    const tshelley = await queryRunner.query(
      `SELECT id, email, org_id FROM users WHERE LOWER(email) = 'tshelley@mevion.com'`
    );

    // Get all Mevion users
    const mevionUsers = await queryRunner.query(
      `SELECT id, email, org_id FROM users WHERE org_id = $1`,
      [mevionOrgId]
    );
    console.log(
      `Mevion users to move:`,
      mevionUsers.map((u: { email: string }) => u.email)
    );

    // Move tshelley to Brad's org
    if (tshelley.length > 0 && tshelley[0].org_id !== bradOrgId) {
      const userId = tshelley[0].id;
      console.log(`Moving tshelley (${userId}) to Brad's org...`);

      await queryRunner.query(`UPDATE users SET org_id = $1 WHERE id = $2`, [
        bradOrgId,
        userId,
      ]);

      await queryRunner.query(
        `
        INSERT INTO user_organizations (id, user_id, org_id, role, is_default, joined_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'admin', true, NOW(), NOW(), NOW())
        ON CONFLICT (user_id, org_id) DO UPDATE SET is_default = true, role = 'admin', updated_at = NOW()
      `,
        [userId, bradOrgId]
      );

      console.log(`tshelley moved to Brad's org as admin`);
    }

    // Move all Mevion users to Brad's org
    for (const user of mevionUsers) {
      if (user.org_id === bradOrgId) {
        console.log(`${user.email} already in Brad's org, skipping`);
        continue;
      }

      console.log(`Moving ${user.email} (${user.id}) to Brad's org...`);

      await queryRunner.query(`UPDATE users SET org_id = $1 WHERE id = $2`, [
        bradOrgId,
        user.id,
      ]);

      await queryRunner.query(
        `
        INSERT INTO user_organizations (id, user_id, org_id, role, is_default, joined_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'admin', true, NOW(), NOW(), NOW())
        ON CONFLICT (user_id, org_id) DO UPDATE SET is_default = true, role = 'admin', updated_at = NOW()
      `,
        [user.id, bradOrgId]
      );

      console.log(`${user.email} moved to Brad's org as admin`);
    }

    // Verify
    const bradOrgMembers = await queryRunner.query(
      `
      SELECT u.email, uo.role, uo.is_default
      FROM user_organizations uo
      JOIN users u ON u.id = uo.user_id
      WHERE uo.org_id = $1
    `,
      [bradOrgId]
    );
    console.log("Brad's org members:", bradOrgMembers);

    console.log("=== DONE - User can now manually delete Mevion org ===");
  }

  public async down(): Promise<void> {
    console.log("Manual rollback required");
  }
}
