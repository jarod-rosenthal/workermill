import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fix: Rename "jarod's Organization" to "OnCallShift"
 * Previous migration failed due to case sensitivity (looked for "Jarod's" not "jarod's")
 */
export class FixOncallshiftRename1705344000059 implements MigrationInterface {
  name = "FixOncallshiftRename1705344000059";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if already renamed
    const existingOcs = await queryRunner.query(`
      SELECT id FROM organizations WHERE name = 'OnCallShift' AND slug = 'oncallshift' LIMIT 1
    `);

    if (existingOcs.length > 0) {
      console.log("OnCallShift org already exists, skipping");
      return;
    }

    // Find the main org using case-insensitive match
    const mainOrg = await queryRunner.query(`
      SELECT id FROM organizations WHERE LOWER(name) LIKE '%jarod%organization%' LIMIT 1
    `);

    if (mainOrg.length === 0) {
      console.log("No organization matching 'jarod's Organization' found");
      return;
    }

    const mainOrgId = mainOrg[0].id;

    // Delete any duplicate orgs named "OnCallShift" that aren't the main one
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
      SET name = 'jarod''s Organization', slug = 'jarods-organization'
      WHERE name = 'OnCallShift' AND slug = 'oncallshift'
    `);
  }
}
