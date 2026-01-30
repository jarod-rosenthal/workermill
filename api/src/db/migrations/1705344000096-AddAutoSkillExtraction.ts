import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoSkillExtraction1705344000096 implements MigrationInterface {
  name = "AddAutoSkillExtraction1705344000096";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add auto_skill_extraction column to organizations
    // Default to true so existing orgs get the feature enabled
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS auto_skill_extraction BOOLEAN NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS auto_skill_extraction
    `);
  }
}
