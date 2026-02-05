import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSelfReviewEnabled1706688000020 implements MigrationInterface {
  name = "AddSelfReviewEnabled1706688000020";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add self_review_enabled column to organizations table
    // When enabled, agents will do a pre-completion self-review before finishing a story
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS self_review_enabled BOOLEAN DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS self_review_enabled
    `);
  }
}
