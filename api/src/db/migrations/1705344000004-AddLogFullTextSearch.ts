import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add full-text search capability to worker_task_logs
 *
 * This migration adds:
 * 1. A tsvector column for full-text search
 * 2. A GIN index for fast searching
 * 3. A trigger to automatically update the search vector when logs are inserted/updated
 * 4. Initial population of the search vector for existing logs
 */
export class AddLogFullTextSearch1705344000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add tsvector column for full-text search
    await queryRunner.query(`
      ALTER TABLE worker_task_logs
      ADD COLUMN search_vector tsvector;
    `);

    // Create GIN index for fast full-text searching
    await queryRunner.query(`
      CREATE INDEX idx_worker_task_logs_search
      ON worker_task_logs
      USING GIN(search_vector);
    `);

    // Create function to update search vector
    // Weights: A (highest) for message, B for command/filePath, C for stdout/stderr, D (lowest) for metadata
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION worker_task_logs_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', COALESCE(NEW.message, '')), 'A') ||
          setweight(to_tsvector('english', COALESCE(NEW.command, '')), 'B') ||
          setweight(to_tsvector('english', COALESCE(NEW.file_path, '')), 'B') ||
          setweight(to_tsvector('english', COALESCE(NEW.stdout, '')), 'C') ||
          setweight(to_tsvector('english', COALESCE(NEW.stderr, '')), 'C') ||
          setweight(to_tsvector('english', COALESCE(NEW.metadata::text, '')), 'D');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger to auto-update search vector on insert/update
    await queryRunner.query(`
      CREATE TRIGGER worker_task_logs_search_vector_trigger
      BEFORE INSERT OR UPDATE ON worker_task_logs
      FOR EACH ROW
      EXECUTE FUNCTION worker_task_logs_search_vector_update();
    `);

    // Populate search vector for existing logs (do in batches to avoid locking)
    await queryRunner.query(`
      UPDATE worker_task_logs
      SET search_vector =
        setweight(to_tsvector('english', COALESCE(message, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(command, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(file_path, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(stdout, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(stderr, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(metadata::text, '')), 'D');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger and function
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS worker_task_logs_search_vector_trigger ON worker_task_logs;
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS worker_task_logs_search_vector_update();
    `);

    // Drop index
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_worker_task_logs_search;
    `);

    // Drop column
    await queryRunner.query(`
      ALTER TABLE worker_task_logs
      DROP COLUMN IF EXISTS search_vector;
    `);
  }
}
