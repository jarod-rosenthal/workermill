import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create worker_commands table for interactive REPL functionality
 *
 * This enables bidirectional communication between dashboard and workers:
 * - Users can send messages/questions to running workers
 * - Users can pause/resume worker execution
 * - Workers poll for pending commands and respond
 */
export class CreateWorkerCommands1705344000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE worker_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL CHECK (type IN ('message', 'question', 'pause', 'resume')),
        content TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'responded', 'completed')),
        response TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMP,
        responded_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX idx_worker_commands_task_status ON worker_commands(task_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_worker_commands_task_created ON worker_commands(task_id, created_at);
    `);

    // Add trigger to update updated_at timestamp
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_worker_commands_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trigger_update_worker_commands_updated_at
      BEFORE UPDATE ON worker_commands
      FOR EACH ROW
      EXECUTE FUNCTION update_worker_commands_updated_at();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trigger_update_worker_commands_updated_at ON worker_commands;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_worker_commands_updated_at();`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_commands_task_created;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_worker_commands_task_status;`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_commands;`);
  }
}
