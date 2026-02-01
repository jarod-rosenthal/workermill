import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPersonaKeywordPattern1706688000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add keyword_pattern column for regex-based inference
    await queryRunner.query(`
      ALTER TABLE personas
      ADD COLUMN IF NOT EXISTS keyword_pattern TEXT
    `);

    // Add label_shortcuts column for short label mappings
    await queryRunner.query(`
      ALTER TABLE personas
      ADD COLUMN IF NOT EXISTS label_shortcuts TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE personas
      DROP COLUMN IF EXISTS keyword_pattern
    `);
    await queryRunner.query(`
      ALTER TABLE personas
      DROP COLUMN IF EXISTS label_shortcuts
    `);
  }
}
