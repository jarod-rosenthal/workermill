import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCriticApprovalThreshold1742300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS critic_approval_threshold INTEGER DEFAULT 85
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS critic_approval_threshold
    `);
  }
}
