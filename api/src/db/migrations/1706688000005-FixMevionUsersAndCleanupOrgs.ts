import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fix Tom Shelley's default org back to Mevion and delete the old personal orgs
 * that were created during a broken signup process.
 *
 * Brad and Tom were invited to Mevion but the signup created personal orgs instead.
 * Those personal orgs should be removed.
 */
export class FixMevionUsersAndCleanupOrgs1706688000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find Mevion org
    const mevionOrg = await queryRunner.query(
      `SELECT id, name FROM organizations WHERE name = 'Mevion' LIMIT 1`
    );

    if (mevionOrg.length === 0) {
      console.log("ERROR: Mevion org not found!");
      return;
    }

    const mevionOrgId = mevionOrg[0].id;
    console.log(`Found Mevion org: ${mevionOrgId}`);

    // Find Tom Shelley
    const tomUser = await queryRunner.query(
      `SELECT id, email, org_id FROM users WHERE email = 'redacted@example.com' LIMIT 1`
    );

    if (tomUser.length > 0) {
      const tomId = tomUser[0].id;
      console.log(`Found Tom Shelley: ${tomId}, current org_id: ${tomUser[0].org_id}`);

      // Update Tom's org_id to Mevion
      await queryRunner.query(
        `UPDATE users SET org_id = $1 WHERE id = $2`,
        [mevionOrgId, tomId]
      );
      console.log(`Updated Tom's org_id to Mevion`);

      // Update Tom's user_organizations to set Mevion as default
      await queryRunner.query(
        `UPDATE user_organizations SET is_default = false WHERE user_id = $1`,
        [tomId]
      );
      await queryRunner.query(
        `UPDATE user_organizations SET is_default = true WHERE user_id = $1 AND org_id = $2`,
        [tomId, mevionOrgId]
      );
      console.log(`Set Mevion as Tom's default org in user_organizations`);
    }

    // Find and delete "Tom Shelley's Organization"
    const tomOrg = await queryRunner.query(
      `SELECT id, name FROM organizations WHERE name = $1 LIMIT 1`,
      ["Tom Shelley's Organization"]
    );

    if (tomOrg.length > 0) {
      const tomOrgId = tomOrg[0].id;
      console.log(`Found Tom's old org: ${tomOrgId} - "${tomOrg[0].name}"`);

      // Remove any user_organizations entries for this org
      await queryRunner.query(
        `DELETE FROM user_organizations WHERE org_id = $1`,
        [tomOrgId]
      );
      console.log(`Deleted user_organizations entries for Tom's old org`);

      // Delete the org
      await queryRunner.query(
        `DELETE FROM organizations WHERE id = $1`,
        [tomOrgId]
      );
      console.log(`Deleted Tom's old org`);
    } else {
      console.log(`Tom's old org not found (already deleted?)`);
    }

    // Find and delete "Brad Hawkins's Organization" (note: might have been renamed)
    // Try both possible names
    const bradOrg = await queryRunner.query(
      `SELECT id, name FROM organizations WHERE name IN ($1, $2) LIMIT 1`,
      ["Brad Hawkins's Organization", "Brad Hawkins' Organization"]
    );

    if (bradOrg.length > 0) {
      const bradOrgId = bradOrg[0].id;
      console.log(`Found Brad's old org: ${bradOrgId} - "${bradOrg[0].name}"`);

      // Remove any user_organizations entries for this org
      await queryRunner.query(
        `DELETE FROM user_organizations WHERE org_id = $1`,
        [bradOrgId]
      );
      console.log(`Deleted user_organizations entries for Brad's old org`);

      // Delete the org
      await queryRunner.query(
        `DELETE FROM organizations WHERE id = $1`,
        [bradOrgId]
      );
      console.log(`Deleted Brad's old org`);
    } else {
      console.log(`Brad's old org not found (already deleted?)`);
    }

    // Also check for Brad user and ensure he's in Mevion
    const bradUser = await queryRunner.query(
      `SELECT id, email, org_id FROM users WHERE email LIKE '%brad%' OR email LIKE '%hawkins%' LIMIT 1`
    );

    if (bradUser.length > 0) {
      const bradId = bradUser[0].id;
      console.log(`Found Brad user: ${bradId} (${bradUser[0].email}), current org_id: ${bradUser[0].org_id}`);

      // Check if Brad has Mevion membership
      const bradMevionMembership = await queryRunner.query(
        `SELECT * FROM user_organizations WHERE user_id = $1 AND org_id = $2`,
        [bradId, mevionOrgId]
      );

      if (bradMevionMembership.length > 0) {
        // Update Brad's org_id to Mevion
        await queryRunner.query(
          `UPDATE users SET org_id = $1 WHERE id = $2`,
          [mevionOrgId, bradId]
        );
        console.log(`Updated Brad's org_id to Mevion`);

        // Set Mevion as default
        await queryRunner.query(
          `UPDATE user_organizations SET is_default = false WHERE user_id = $1`,
          [bradId]
        );
        await queryRunner.query(
          `UPDATE user_organizations SET is_default = true WHERE user_id = $1 AND org_id = $2`,
          [bradId, mevionOrgId]
        );
        console.log(`Set Mevion as Brad's default org`);
      }
    }

    console.log("Migration complete");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log("Cannot restore deleted organizations");
  }
}
