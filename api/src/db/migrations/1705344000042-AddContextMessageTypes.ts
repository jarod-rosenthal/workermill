import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add additional message types to worker_contexts check constraint
 *
 * New types:
 * - story_ready: Story's dependencies met, available for claim in Epic mode
 * - story_claimed: Expert claimed a story in Epic mode
 * - consultation: Targeted expert consultation (CONSULT-PERSONA: question?)
 * - constraints: PRD-level constraints posted by orchestrator
 * - revision_requested: Tech Lead requested revision with feedback
 */
export class AddContextMessageTypes1705344000042 implements MigrationInterface {
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
        'revision_requested'
      ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to original constraint (will fail if new types exist in data)
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
        'progress'
      ));
    `);
  }
}
