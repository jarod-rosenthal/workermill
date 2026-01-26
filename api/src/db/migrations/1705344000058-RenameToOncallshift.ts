import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Rename "Jarod's Organization" to "OnCallShift" and set slug
 * Also cleans up any duplicate orgs created during SSO testing
 */
export class RenameToOncallshift1705344000058 implements MigrationInterface {
  name = "RenameToOncallshift1705344000058";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, find the main org (jarod's Organization) - case-insensitive
    const mainOrg = await queryRunner.query(`
      SELECT id FROM organizations WHERE LOWER(name) = LOWER('jarod''s Organization') LIMIT 1
    `);

    if (mainOrg.length === 0) {
      console.log("Main organization not found, checking for existing OnCallShift org");
      // Maybe it was already renamed
      const existingOcs = await queryRunner.query(`
        SELECT id FROM organizations WHERE name = 'OnCallShift' OR slug = 'oncallshift' LIMIT 1
      `);
      if (existingOcs.length > 0) {
        console.log("OnCallShift org already exists, skipping migration");
        return;
      }
      return;
    }

    const mainOrgId = mainOrg[0].id;

    // Delete any duplicate orgs named "OnCallShift" that aren't the main one
    // (These were created accidentally during SSO testing)
    await queryRunner.query(`
      DELETE FROM organizations
      WHERE (name = 'OnCallShift' OR slug = 'oncallshift')
      AND id != $1
    `, [mainOrgId]);

    // Rename the main org
    await queryRunner.query(`
      UPDATE organizations
      SET name = 'OnCallShift', slug = 'oncallshift'
      WHERE id = $1
    `, [mainOrgId]);

    console.log(`Renamed organization ${mainOrgId} to OnCallShift`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert the rename
    await queryRunner.query(`
      UPDATE organizations
      SET name = 'Jarod''s Organization', slug = 'jarods-organization'
      WHERE name = 'OnCallShift' AND slug = 'oncallshift'
    `);
  }
}
