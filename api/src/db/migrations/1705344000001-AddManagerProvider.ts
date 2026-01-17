import { MigrationInterface, QueryRunner } from "typeorm";

export class AddManagerProvider1705344000001 implements MigrationInterface {
  name = "AddManagerProvider1705344000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add manager_provider column for Virtual Manager provider selection
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS manager_provider VARCHAR(50) NOT NULL DEFAULT 'openai'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS manager_provider`);
  }
}
