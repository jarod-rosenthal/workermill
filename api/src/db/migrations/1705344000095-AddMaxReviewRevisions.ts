import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add max_review_revisions setting to organizations table.
 * Controls the circuit breaker limit for Tech Lead revision requests.
 */
export class AddMaxReviewRevisions1705344000095 implements MigrationInterface {
  name = "AddMaxReviewRevisions1705344000095";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_review_revisions INT DEFAULT 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_review_revisions
    `);
  }
}
