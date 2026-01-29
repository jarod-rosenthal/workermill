import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeepSourceIntegration1705344000087 implements MigrationInterface {
  name = "AddDeepSourceIntegration1705344000087";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add DeepSource integration fields to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS deepsource_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS deepsource_token VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS deepsource_enabled,
      DROP COLUMN IF EXISTS deepsource_token
    `);
  }
}
