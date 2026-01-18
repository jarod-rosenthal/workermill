import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOllamaContextWindow1705344000003 implements MigrationInterface {
  name = "AddOllamaContextWindow1705344000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add ollama_context_window column with default 65536 (64K tokens)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS ollama_context_window INTEGER DEFAULT 65536
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS ollama_context_window
    `);
  }
}
