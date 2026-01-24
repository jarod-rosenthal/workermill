import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryReadyMessageType1705344000032 implements MigrationInterface {
  name = "AddStoryReadyMessageType1705344000032";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing constraint
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      DROP CONSTRAINT IF EXISTS worker_contexts_message_type_check
    `);

    // Add new constraint with story_ready and story_claimed types
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ADD CONSTRAINT worker_contexts_message_type_check
      CHECK (message_type IN (
        'constraints',
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
        'story_claimed'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to original constraint without story_ready/story_claimed
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      DROP CONSTRAINT IF EXISTS worker_contexts_message_type_check
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
      ))
    `);
  }
}
