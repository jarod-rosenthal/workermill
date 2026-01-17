import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add vllm_base_url column to organizations table
 * Enables GPU inference via vLLM/OpenAI-compatible endpoints
 */
export class AddVllmBaseUrl1705344000002 implements MigrationInterface {
  name = "AddVllmBaseUrl1705344000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add vLLM base URL column (nullable)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS vllm_base_url VARCHAR(500) DEFAULT NULL
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN organizations.vllm_base_url IS 'vLLM/OpenAI-compatible endpoint URL for GPU inference'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS vllm_base_url
    `);
  }
}
