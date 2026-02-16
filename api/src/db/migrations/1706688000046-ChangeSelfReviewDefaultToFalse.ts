import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeSelfReviewDefaultToFalse1706688000046
  implements MigrationInterface
{
  name = "ChangeSelfReviewDefaultToFalse1706688000046";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change the DB-level default from true to false so new orgs
    // don't have self-review enabled by default
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN self_review_enabled SET DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN self_review_enabled SET DEFAULT true
    `);
  }
}
