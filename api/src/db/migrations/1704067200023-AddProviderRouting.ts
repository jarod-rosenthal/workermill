import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProviderRouting1704067200023 implements MigrationInterface {
  name = "AddProviderRouting1704067200023";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add provider_routing column for persona-based provider selection
    // Format: { "persona_name": { "provider": "ollama", "model": "qwen2.5-coder:32b" } }
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS provider_routing JSONB NOT NULL DEFAULT '{}'
    `);

    // Add ollama_base_url for self-hosted Ollama endpoint
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS ollama_base_url VARCHAR(500) NULL
    `);

    // Add index for provider routing queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_provider_routing
      ON organizations USING GIN (provider_routing)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_organizations_provider_routing`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS ollama_base_url`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS provider_routing`);
  }
}
