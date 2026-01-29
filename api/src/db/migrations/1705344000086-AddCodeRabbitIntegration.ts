import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCodeRabbitIntegration1705344000086 implements MigrationInterface {
  name = "AddCodeRabbitIntegration1705344000086";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add CodeRabbit integration fields to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS coderabbit_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS coderabbit_api_key VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS coderabbit_enabled,
      DROP COLUMN IF EXISTS coderabbit_api_key
    `);
  }
}
