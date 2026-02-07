import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add blocker-related message types to worker_contexts check constraint
 *
 * New types:
 * - blocker_detected: Escalated blocker requiring human intervention
 * - blocker_resolved: User resolved a blocker (retry/skip/abort)
 * - user_message: User message from dashboard (Talk to Worker)
 * - worker_ack: Worker acknowledgment of user message
 */
export class AddBlockerMessageTypes1706688000021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing check constraint and add a new one with all message types
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      DROP CONSTRAINT IF EXISTS worker_contexts_message_type_check;
    `);

    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD CONSTRAINT worker_contexts_message_type_check
      CHECK (message_type IN (
        'file_created',
        'file_modified',
        'decision',
        'dependency',
        'question',
        'answer',
        'completion',
        'blocker',
        'warning',
        'progress',
        'story_ready',
        'story_claimed',
        'consultation',
        'constraints',
        'revision_requested',
        'blocker_detected',
        'blocker_resolved',
        'user_message',
        'worker_ack'
      ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to previous constraint (will fail if new types exist in data)
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      DROP CONSTRAINT IF EXISTS worker_contexts_message_type_check;
    `);

    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD CONSTRAINT worker_contexts_message_type_check
      CHECK (message_type IN (
        'file_created',
        'file_modified',
        'decision',
        'dependency',
        'question',
        'answer',
        'completion',
        'blocker',
        'warning',
        'progress',
        'story_ready',
        'story_claimed',
        'consultation',
        'constraints',
        'revision_requested'
      ));
    `);
  }
}
