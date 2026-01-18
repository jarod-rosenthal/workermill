import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create projects table for internal task management
 *
 * Projects are the top-level container for Kanban boards and tasks.
 * Each project belongs to an organization and can optionally be linked
 * to a GitHub repo for worker execution.
 */
export class CreateProjects1705344000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key VARCHAR(10) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        github_repo VARCHAR(255),
        default_persona VARCHAR(50) DEFAULT 'backend_developer',
        default_model VARCHAR(100) DEFAULT 'claude-haiku-4-5-20251001',
        default_provider VARCHAR(50) DEFAULT 'anthropic',
        task_sequence INTEGER DEFAULT 0,
        is_archived BOOLEAN DEFAULT false,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(org_id, key)
      );
    `);

    // Index for org lookups
    await queryRunner.query(`
      CREATE INDEX idx_projects_org_id ON projects(org_id);
    `);

    // Index for non-archived projects
    await queryRunner.query(`
      CREATE INDEX idx_projects_active ON projects(org_id) WHERE is_archived = false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_projects_active;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_projects_org_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS projects;`);
  }
}
