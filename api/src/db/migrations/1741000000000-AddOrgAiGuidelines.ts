import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrgAiGuidelines1741000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_guidelines TEXT DEFAULT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations DROP COLUMN IF EXISTS ai_guidelines`
    );
  }
}
