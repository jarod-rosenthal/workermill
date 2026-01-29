import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create task_relationships table for storing knowledge graph of task relationships.
 * Part of the Agent Memory & Learning System (Phase 3) - REQ-12: Knowledge Graph.
 *
 * Stores relationships between tasks such as:
 * - similar_to: Tasks that are conceptually similar
 * - depends_on: Task B requires completion of Task A
 * - parent_of: Epic/story parent-child relationships
 * - shares_pattern: Tasks that share implementation patterns
 * - shares_technology: Tasks using the same technologies
 */
export class CreateTaskRelationships1705344000090 implements MigrationInterface {
  name = "CreateTaskRelationships1705344000090";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

        -- Source and target tasks
        source_task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,
        target_task_id UUID NOT NULL REFERENCES worker_tasks(id) ON DELETE CASCADE,

        -- Relationship type
        relationship_type VARCHAR(50) NOT NULL,

        -- Strength/weight of the relationship (0-1)
        strength FLOAT DEFAULT 1.0,

        -- Additional metadata about the relationship
        metadata JSONB DEFAULT '{}',

        -- How the relationship was discovered
        source VARCHAR(30) DEFAULT 'inferred',

        -- Confidence in the relationship
        confidence FLOAT DEFAULT 0.7,

        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

        -- Prevent duplicate relationships
        CONSTRAINT unique_task_relationship UNIQUE (source_task_id, target_task_id, relationship_type)
      )
    `);

    // Index for efficient graph traversal from source
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_rel_source
      ON task_relationships(org_id, source_task_id)
    `);

    // Index for reverse traversal from target
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_rel_target
      ON task_relationships(org_id, target_task_id)
    `);

    // Index for relationship type filtering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_rel_type
      ON task_relationships(relationship_type)
    `);

    // Index for high-strength relationships
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_rel_strength
      ON task_relationships(strength DESC)
      WHERE strength >= 0.7
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_rel_strength`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_rel_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_rel_target`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_rel_source`);
    await queryRunner.query(`DROP TABLE IF EXISTS task_relationships`);
  }
}
