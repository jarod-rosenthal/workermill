import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBoardEpicFields1741700000001 implements MigrationInterface {
  name = "AddBoardEpicFields1741700000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First-class quality gate columns + epic ticket fields on kb_boards
    await queryRunner.query(`
      ALTER TABLE kb_boards
        ADD COLUMN IF NOT EXISTS quality_gate_commands jsonb DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS ci_workflow_path varchar(500) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS priority varchar(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS due_date timestamptz DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS assignee_id uuid DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS status varchar(50) DEFAULT 'active';
    `);

    // FK for assignee
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE kb_boards
          ADD CONSTRAINT fk_kb_boards_assignee
          FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Migrate existing data from metadata JSONB to dedicated columns
    await queryRunner.query(`
      UPDATE kb_boards
        SET quality_gate_commands = metadata->'qualityGates',
            ci_workflow_path = metadata->>'ciWorkflowPath'
        WHERE metadata IS NOT NULL
          AND (metadata ? 'qualityGates' OR metadata ? 'ciWorkflowPath');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kb_boards
        DROP CONSTRAINT IF EXISTS fk_kb_boards_assignee,
        DROP COLUMN IF EXISTS quality_gate_commands,
        DROP COLUMN IF EXISTS ci_workflow_path,
        DROP COLUMN IF EXISTS priority,
        DROP COLUMN IF EXISTS due_date,
        DROP COLUMN IF EXISTS assignee_id,
        DROP COLUMN IF EXISTS status;
    `);
  }
}
