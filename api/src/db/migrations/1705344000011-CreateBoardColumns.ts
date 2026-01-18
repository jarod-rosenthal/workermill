import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create board_columns table for Kanban board structure
 *
 * Each project has a set of columns that define the workflow stages.
 * Default columns (Backlog, Ready, In Progress, Review, Done) are
 * seeded when a project is created via the API.
 */
export class CreateBoardColumns1705344000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE board_columns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        column_type VARCHAR(30) NOT NULL CHECK (column_type IN ('backlog', 'ready', 'in_progress', 'review', 'done')),
        position INTEGER NOT NULL,
        wip_limit INTEGER,
        color VARCHAR(20),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Index for project column lookups
    await queryRunner.query(`
      CREATE INDEX idx_board_columns_project_id ON board_columns(project_id);
    `);

    // Ensure only one default column per project
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_board_columns_default ON board_columns(project_id) WHERE is_default = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_board_columns_default;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_board_columns_project_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS board_columns;`);
  }
}
