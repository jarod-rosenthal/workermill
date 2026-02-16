import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Update board columns to match worker task lifecycle:
 * Backlog -> In Progress -> Review -> PR Approved -> Deployed
 *
 * Changes:
 * 1. Move tasks from "ready" columns to "backlog" columns
 * 2. Delete "ready" columns
 * 3. Rename "done" columns to "Deployed", change type to "deployed"
 * 4. Insert "PR Approved" columns (type "pr_approved", position 3)
 * 5. Reposition all columns
 * 6. Update internal_tasks: "completed" -> "deployed"
 */
export class UpdateBoardColumns1706688000045 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 0. Drop the old CHECK constraint on column_type (it only allows old values)
    //    The constraint name varies — drop all CHECK constraints on the column
    await queryRunner.query(`
      ALTER TABLE board_columns DROP CONSTRAINT IF EXISTS board_columns_column_type_check
    `);
    // Also try the auto-generated naming pattern
    await queryRunner.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'board_columns'
            AND con.contype = 'c'
            AND pg_get_constraintdef(con.oid) LIKE '%column_type%'
        ) LOOP
          EXECUTE 'ALTER TABLE board_columns DROP CONSTRAINT ' || r.conname;
        END LOOP;
      END $$;
    `);

    // 1. Move all tasks from "ready" columns to "backlog" columns (same project)
    await queryRunner.query(`
      UPDATE internal_tasks it
      SET column_id = bc_backlog.id
      FROM board_columns bc_ready, board_columns bc_backlog
      WHERE it.column_id = bc_ready.id
        AND bc_ready.column_type = 'ready'
        AND bc_backlog.project_id = bc_ready.project_id
        AND bc_backlog.column_type = 'backlog'
    `);

    // 2. Delete "ready" columns (tasks already moved)
    await queryRunner.query(`
      DELETE FROM board_columns WHERE column_type = 'ready'
    `);

    // 3. Rename "done" columns to "Deployed", change type to "deployed"
    await queryRunner.query(`
      UPDATE board_columns
      SET name = 'Deployed', column_type = 'deployed'
      WHERE column_type = 'done'
    `);

    // 4. Insert "PR Approved" columns for each project that has columns
    //    (insert after review, before deployed)
    await queryRunner.query(`
      INSERT INTO board_columns (id, project_id, org_id, name, column_type, position, color, is_default, created_at)
      SELECT
        gen_random_uuid(),
        bc.project_id,
        bc.org_id,
        'PR Approved',
        'pr_approved',
        3,
        '***REMOVED***3b82f6',
        false,
        NOW()
      FROM board_columns bc
      WHERE bc.column_type = 'backlog'
        AND NOT EXISTS (
          SELECT 1 FROM board_columns bc2
          WHERE bc2.project_id = bc.project_id AND bc2.column_type = 'pr_approved'
        )
    `);

    // 5. Reposition all columns: backlog=0, in_progress=1, review=2, pr_approved=3, deployed=4
    const positionMap = [
      { type: "backlog", pos: 0 },
      { type: "in_progress", pos: 1 },
      { type: "review", pos: 2 },
      { type: "pr_approved", pos: 3 },
      { type: "deployed", pos: 4 },
    ];
    for (const { type, pos } of positionMap) {
      await queryRunner.query(
        `UPDATE board_columns SET position = $1 WHERE column_type = $2`,
        [pos, type],
      );
    }

    // 6. Set isDefault on backlog columns (new tasks land here)
    await queryRunner.query(`
      UPDATE board_columns SET is_default = true WHERE column_type = 'backlog'
    `);
    await queryRunner.query(`
      UPDATE board_columns SET is_default = false WHERE column_type != 'backlog'
    `);

    // 7. Add the new CHECK constraint (all rows now have valid values)
    await queryRunner.query(`
      ALTER TABLE board_columns
      ADD CONSTRAINT board_columns_column_type_check
      CHECK (column_type IN ('backlog', 'in_progress', 'review', 'pr_approved', 'deployed'))
    `);

    // 8. Update internal_tasks: change status "completed" -> "deployed"
    await queryRunner.query(`
      UPDATE internal_tasks SET status = 'deployed' WHERE status = 'completed'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: restore "ready" and "done" columns, remove "pr_approved"

    // Revert internal_tasks status
    await queryRunner.query(`
      UPDATE internal_tasks SET status = 'completed' WHERE status = 'deployed'
    `);
    await queryRunner.query(`
      UPDATE internal_tasks SET status = 'completed' WHERE status = 'pr_approved'
    `);

    // Move tasks from "pr_approved" columns to "review" before deleting
    await queryRunner.query(`
      UPDATE internal_tasks it
      SET column_id = bc_review.id
      FROM board_columns bc_pr, board_columns bc_review
      WHERE it.column_id = bc_pr.id
        AND bc_pr.column_type = 'pr_approved'
        AND bc_review.project_id = bc_pr.project_id
        AND bc_review.column_type = 'review'
    `);

    // Delete "pr_approved" columns
    await queryRunner.query(`
      DELETE FROM board_columns WHERE column_type = 'pr_approved'
    `);

    // Rename "deployed" back to "done"
    await queryRunner.query(`
      UPDATE board_columns
      SET name = 'Done', column_type = 'done'
      WHERE column_type = 'deployed'
    `);

    // Re-insert "ready" columns
    await queryRunner.query(`
      INSERT INTO board_columns (id, project_id, org_id, name, column_type, position, color, is_default, created_at)
      SELECT
        gen_random_uuid(),
        bc.project_id,
        bc.org_id,
        'Ready',
        'ready',
        1,
        '***REMOVED***3b82f6',
        true,
        NOW()
      FROM board_columns bc
      WHERE bc.column_type = 'backlog'
        AND NOT EXISTS (
          SELECT 1 FROM board_columns bc2
          WHERE bc2.project_id = bc.project_id AND bc2.column_type = 'ready'
        )
    `);

    // Reposition: backlog=0, ready=1, in_progress=2, review=3, done=4
    await queryRunner.query(`UPDATE board_columns SET position = 0 WHERE column_type = 'backlog'`);
    await queryRunner.query(`UPDATE board_columns SET position = 1 WHERE column_type = 'ready'`);
    await queryRunner.query(`UPDATE board_columns SET position = 2 WHERE column_type = 'in_progress'`);
    await queryRunner.query(`UPDATE board_columns SET position = 3 WHERE column_type = 'review'`);
    await queryRunner.query(`UPDATE board_columns SET position = 4 WHERE column_type = 'done'`);

    // Restore isDefault on ready
    await queryRunner.query(`UPDATE board_columns SET is_default = false WHERE column_type = 'backlog'`);
    await queryRunner.query(`UPDATE board_columns SET is_default = true WHERE column_type = 'ready'`);

    // Restore the old CHECK constraint
    await queryRunner.query(`ALTER TABLE board_columns DROP CONSTRAINT IF EXISTS board_columns_column_type_check`);
    await queryRunner.query(`
      ALTER TABLE board_columns
      ADD CONSTRAINT board_columns_column_type_check
      CHECK (column_type IN ('backlog', 'ready', 'in_progress', 'review', 'done'))
    `);
  }
}
