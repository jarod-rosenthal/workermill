import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMultiPhasePlanningSettings1705344000021 implements MigrationInterface {
  name = "AddMultiPhasePlanningSettings1705344000021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add V2 multi-phase planning settings to organizations
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS use_multi_phase_planning BOOLEAN DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS min_plan_quality_score DECIMAL(3, 1) DEFAULT 3.5
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS use_multi_phase_planning
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS min_plan_quality_score
    `);
  }
}
