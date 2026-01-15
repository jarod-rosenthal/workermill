import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Multi-Worker Coordination Schema
 *
 * Enables parallel execution of AI workers on the same repository:
 * - worker_check_ins: Real-time status of active workers
 * - worker_file_locks: Pessimistic file-level locks to prevent conflicts
 * - worker_resource_reservations: Shared resource coordination (test DBs, deploy slots, etc.)
 */
export class AddWorkerCoordination1704067200017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create worker_check_ins table
    await queryRunner.query(`
      CREATE TABLE worker_check_ins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        worker_id VARCHAR(100) NOT NULL,
        repo VARCHAR(255) NOT NULL,
        branch VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        current_file VARCHAR(500),
        files_modified JSONB DEFAULT '[]',
        heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      )
    `);

    // Indexes for worker_check_ins
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_checkins_task ON worker_check_ins(task_id)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_checkins_repo ON worker_check_ins(org_id, repo)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_checkins_heartbeat ON worker_check_ins(heartbeat_at)`
    );

    // Create worker_file_locks table
    await queryRunner.query(`
      CREATE TABLE worker_file_locks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        repo VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        worker_id VARCHAR(100) NOT NULL,
        lock_type VARCHAR(20) NOT NULL DEFAULT 'exclusive',
        acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Indexes for worker_file_locks
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_locks_file ON worker_file_locks(org_id, repo, file_path)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_locks_expiry ON worker_file_locks(expires_at)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_locks_task ON worker_file_locks(task_id)`
    );

    // Create worker_resource_reservations table
    await queryRunner.query(`
      CREATE TABLE worker_resource_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        resource_type VARCHAR(50) NOT NULL,
        resource_id VARCHAR(100) NOT NULL,
        task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        worker_id VARCHAR(100) NOT NULL,
        acquired_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Indexes for worker_resource_reservations
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_resources_unique ON worker_resource_reservations(org_id, resource_type, resource_id)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_resources_expiry ON worker_resource_reservations(expires_at)`
    );
    await queryRunner.query(
      `CREATE INDEX idx_resources_task ON worker_resource_reservations(task_id)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS worker_resource_reservations`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_file_locks`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_check_ins`);
  }
}
