import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add `insight` column to procedural_memories table.
 * Stores the raw learning text from worker self-reported ::learning:: markers.
 * Nullable - existing template-extracted skills won't have insights.
 */
export class AddInsightToProceduralMemory1706688000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE procedural_memories
      ADD COLUMN IF NOT EXISTS insight TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE procedural_memories
      DROP COLUMN IF EXISTS insight;
    `);
  }
}
