import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPersonaInferenceRules1705344000053 implements MigrationInterface {
  name = "AddPersonaInferenceRules1705344000053";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add persona_inference_rules JSONB column to organizations
    // Stores org-specific label mappings, keyword patterns, and default persona
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS persona_inference_rules JSONB DEFAULT '{}'::jsonb
    `);

    // Add comment explaining the column structure
    await queryRunner.query(`
      COMMENT ON COLUMN organizations.persona_inference_rules IS
      'Org-specific persona inference rules: { labelMappings: {label: slug}, keywordPatterns: {slug: "pattern"}, defaultPersona: "slug" }'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS persona_inference_rules
    `);
  }
}
