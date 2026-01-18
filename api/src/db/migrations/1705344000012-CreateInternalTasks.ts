import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create internal_tasks table for Kanban task cards
 *
 * InternalTasks are the cards on the Kanban board. They contain structured
 * user stories, acceptance criteria, and can be assigned to AI workers.
 * When assigned, a WorkerTask is created and linked via worker_task_id.
 */
export class CreateInternalTasks1705344000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE internal_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        column_id UUID NOT NULL REFERENCES board_columns(id) ON DELETE RESTRICT,

        -- Identification
        task_key VARCHAR(20) NOT NULL,
        sequence_number INTEGER NOT NULL,

        -- User Story Format
        title VARCHAR(500) NOT NULL,
        user_story_role VARCHAR(200),
        user_story_want VARCHAR(500),
        user_story_benefit VARCHAR(500),

        -- Rich Content
        description TEXT,
        acceptance_criteria JSONB DEFAULT '[]'::jsonb,
        definition_of_done JSONB DEFAULT '[]'::jsonb,
        technical_notes TEXT,

        -- Worker Config (overrides project defaults)
        persona VARCHAR(50),
        model VARCHAR(100),
        provider VARCHAR(50),
        github_repo VARCHAR(255),
        labels TEXT[],

        -- Position within column
        column_position INTEGER DEFAULT 0,

        -- Worker Integration
        worker_task_id UUID REFERENCES worker_tasks(id) ON DELETE SET NULL,
        assigned_at TIMESTAMP WITH TIME ZONE,

        -- Metadata
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        due_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        UNIQUE(project_id, task_key)
      );
    `);

    // Index for project task lookups
    await queryRunner.query(`
      CREATE INDEX idx_internal_tasks_project_id ON internal_tasks(project_id);
    `);

    // Index for column task lookups
    await queryRunner.query(`
      CREATE INDEX idx_internal_tasks_column_id ON internal_tasks(column_id);
    `);

    // Index for org lookups
    await queryRunner.query(`
      CREATE INDEX idx_internal_tasks_org_id ON internal_tasks(org_id);
    `);

    // Index for worker task linkage
    await queryRunner.query(`
      CREATE INDEX idx_internal_tasks_worker_task_id ON internal_tasks(worker_task_id) WHERE worker_task_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_internal_tasks_worker_task_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_internal_tasks_org_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_internal_tasks_column_id;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_internal_tasks_project_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS internal_tasks;`);
  }
}
