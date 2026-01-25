import { MigrationInterface, QueryRunner } from "typeorm";

export class AddContextSessionId1705344000036 implements MigrationInterface {
  name = "AddContextSessionId1705344000036";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add session_id column for threading messages by expert story session
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD COLUMN IF NOT EXISTS session_id VARCHAR(100)
    `);

    // Add index for efficient session lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_worker_contexts_session_id"
      ON worker_contexts (session_id)
      WHERE session_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_worker_contexts_session_id"
    `);

    await queryRunner.query(`
      ALTER TABLE worker_contexts
      DROP COLUMN IF EXISTS session_id
    `);
  }
}
