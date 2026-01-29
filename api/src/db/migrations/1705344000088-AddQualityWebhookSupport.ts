import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQualityWebhookSupport1705344000088 implements MigrationInterface {
  name = "AddQualityWebhookSupport1705344000088";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add quality webhook fields to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS quality_webhook_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS quality_webhook_secret VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS quality_webhook_url,
      DROP COLUMN IF EXISTS quality_webhook_secret
    `);
  }
}
