import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create codebase_index table for storing semantic code chunks.
 * Part of the Codebase RAG system for code-grounded context.
 * Uses pgvector for similarity search on code embeddings.
 */
export class CreateCodebaseIndex1705344000100 implements MigrationInterface {
  name = "CreateCodebaseIndex1705344000100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure pgvector extension is enabled (may already exist from semantic memory)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Create codebase index table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS codebase_index (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Repository identification
        repository VARCHAR(255) NOT NULL,
        branch VARCHAR(255) DEFAULT 'main',

        -- File/chunk identification
        file_path VARCHAR(1000) NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        chunk_index INT NOT NULL DEFAULT 0,
        chunk_type VARCHAR(50) NOT NULL,

        -- Content
        content TEXT NOT NULL,
        start_line INT,
        end_line INT,

        -- Metadata
        language VARCHAR(50),
        symbol_name VARCHAR(255),
        symbol_type VARCHAR(50),

        -- Embedding (1536 dimensions for OpenAI text-embedding-3-small)
        embedding vector(1536),

        -- Tracking
        indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        access_count INT DEFAULT 0,
        last_accessed_at TIMESTAMP WITH TIME ZONE,

        -- Unique constraint: one chunk per file per index
        UNIQUE(org_id, repository, branch, file_path, chunk_index)
      )
    `);

    // Create indexes for efficient querying
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_org_repo
      ON codebase_index(org_id, repository)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_org_repo_branch
      ON codebase_index(org_id, repository, branch)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_file_hash
      ON codebase_index(file_hash)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_language
      ON codebase_index(language)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_symbol_name
      ON codebase_index(symbol_name)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_chunk_type
      ON codebase_index(chunk_type)
    `);

    // HNSW index for vector similarity search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_codebase_embedding
      ON codebase_index USING hnsw (embedding vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_embedding`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_chunk_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_symbol_name`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_language`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_file_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_org_repo_branch`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_codebase_org_repo`);
    await queryRunner.query(`DROP TABLE IF EXISTS codebase_index`);
  }
}
