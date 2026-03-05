import { MigrationInterface, QueryRunner } from "typeorm";

export class SplitPlanningMode1742200000000 implements MigrationInterface {
  name = "SplitPlanningMode1742200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS task_planning_mode VARCHAR(20),
        ADD COLUMN IF NOT EXISTS prd_planning_mode  VARCHAR(20);

      UPDATE organizations
        SET task_planning_mode = 'simplified',
            prd_planning_mode  = COALESCE(planning_mode, 'decomposer_planned')
        WHERE task_planning_mode IS NULL;

      ALTER TABLE organizations
        ALTER COLUMN task_planning_mode SET DEFAULT 'simplified',
        ALTER COLUMN prd_planning_mode  SET DEFAULT 'decomposer_planned';

      ALTER TABLE organizations
        ALTER COLUMN task_planning_mode SET NOT NULL,
        ALTER COLUMN prd_planning_mode  SET NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
        DROP COLUMN IF EXISTS task_planning_mode,
        DROP COLUMN IF EXISTS prd_planning_mode;
    `);
  }
}
