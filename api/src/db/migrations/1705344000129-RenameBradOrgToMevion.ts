import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Delete empty Mevion org and rename Brad's org to Mevion.
 */
export class RenameBradOrgToMevion1705344000129 implements MigrationInterface {
  name = "RenameBradOrgToMevion1705344000129";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bradOrgId = "00000000-4769-437f-b050-1dbaf3b42da8";
    const mevionOrgId = "9d875d55-1236-4aaa-be87-dffd50ea04e9";

    console.log("=== Step 1: Delete empty Mevion org ===");

    // First delete any invites in Mevion org (FK constraint)
    await queryRunner.query(
      `DELETE FROM org_invites WHERE org_id = $1`,
      [mevionOrgId]
    );
    console.log("Deleted Mevion org invites");

    // Delete the Mevion org
    const deleted = await queryRunner.query(
      `DELETE FROM organizations WHERE id = $1 RETURNING name`,
      [mevionOrgId]
    );
    if (deleted.length > 0) {
      console.log(`Deleted org: ${deleted[0].name}`);
    } else {
      console.log("Mevion org already deleted or not found");
    }

    console.log("=== Step 2: Rename Brad's org to Mevion ===");

    // Rename Brad's org
    await queryRunner.query(
      `UPDATE organizations SET name = 'Mevion', slug = 'mevion' WHERE id = $1`,
      [bradOrgId]
    );
    console.log("Renamed Brad's org to Mevion with slug 'mevion'");

    // Verify
    const org = await queryRunner.query(
      `SELECT id, name, slug FROM organizations WHERE id = $1`,
      [bradOrgId]
    );
    console.log("Updated org:", org[0]);

    console.log("=== Done ===");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const bradOrgId = "00000000-4769-437f-b050-1dbaf3b42da8";

    // Revert name
    await queryRunner.query(
      `UPDATE organizations SET name = 'Brad Hawkins''s Organization', slug = NULL WHERE id = $1`,
      [bradOrgId]
    );
    console.log("Reverted org name");
  }
}
