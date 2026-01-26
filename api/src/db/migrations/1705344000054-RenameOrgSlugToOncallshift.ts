import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time migration to rename the org slug from "jarods-organization" to "oncallshift"
 * This updates the webhook URL from:
 *   /api/webhooks/jarods-organization/jira
 * To:
 *   /api/webhooks/oncallshift/jira
 */
export class RenameOrgSlugToOncallshift1705344000054 implements MigrationInterface {
  name = "RenameOrgSlugToOncallshift1705344000054";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update the slug for the primary organization
    await queryRunner.query(`
      UPDATE organizations
      SET slug = 'oncallshift'
      WHERE slug = 'jarods-organization'
    `);

    // Log the change
    const result = await queryRunner.query(`
      SELECT id, name, slug FROM organizations WHERE slug = 'oncallshift'
    `);

    if (result.length > 0) {
      console.log(`[Migration] Renamed org slug to 'oncallshift' for org: ${result[0].name} (${result[0].id})`);
    } else {
      console.log(`[Migration] No org found with slug 'jarods-organization' - may already be renamed`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to original slug
    await queryRunner.query(`
      UPDATE organizations
      SET slug = 'jarods-organization'
      WHERE slug = 'oncallshift'
    `);
  }
}
