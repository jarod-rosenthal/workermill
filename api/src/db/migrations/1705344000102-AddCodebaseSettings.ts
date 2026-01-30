import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add codebase indexing settings to organizations table.
 * Part of the Codebase RAG system.
 */
export class AddCodebaseSettings1705344000102 implements MigrationInterface {
  name = "AddCodebaseSettings1705344000102";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable codebase indexing feature
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_indexing_enabled BOOLEAN DEFAULT false
    `);

    // Max files per repository to index
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_max_files_per_repo INT DEFAULT 500
    `);

    // Max file size in KB to index (skip larger files)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_max_file_size_kb INT DEFAULT 100
    `);

    // Patterns to exclude (glob patterns as JSON array)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_exclude_patterns JSONB DEFAULT '["node_modules/**", "dist/**", "build/**", "*.min.js", "*.min.css", "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", ".git/**", "coverage/**", "__pycache__/**", "*.pyc", "vendor/**", "*.bundle.js", "*.chunk.js"]'::jsonb
    `);

    // Languages to include (null = all supported languages)
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_include_languages JSONB DEFAULT '["typescript", "javascript", "python", "go", "rust", "java", "ruby", "php", "c", "cpp", "csharp"]'::jsonb
    `);

    // Auto-index on first task for a repository
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_auto_index_on_task BOOLEAN DEFAULT true
    `);

    // Max chunks to retrieve per query
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS codebase_max_retrieval_chunks INT DEFAULT 10
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_max_retrieval_chunks
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_auto_index_on_task
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_include_languages
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_exclude_patterns
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_max_file_size_kb
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_max_files_per_repo
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS codebase_indexing_enabled
    `);
  }
}
