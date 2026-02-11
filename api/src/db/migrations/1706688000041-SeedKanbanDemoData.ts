import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedKanbanDemoData1706688000041 implements MigrationInterface {
  name = "SeedKanbanDemoData1706688000041";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find the platform org (is_platform = true) to seed demo data into
    const platformOrg = await queryRunner.query(
      `SELECT id FROM organizations WHERE is_platform_org = true LIMIT 1`
    );

    if (!platformOrg || platformOrg.length === 0) {
      // No platform org found — skip seeding
      return;
    }

    const orgId = platformOrg[0].id;

    // Check if demo boards already exist for this org
    const existing = await queryRunner.query(
      `SELECT id FROM kb_boards WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );

    if (existing && existing.length > 0) {
      // Already seeded
      return;
    }

    // Seed labels
    await queryRunner.query(`
      INSERT INTO kb_labels (org_id, name, color) VALUES
        ('${orgId}', 'Bug', '***REMOVED***ef4444'),
        ('${orgId}', 'Feature', '***REMOVED***3b82f6'),
        ('${orgId}', 'Enhancement', '***REMOVED***22c55e'),
        ('${orgId}', 'Documentation', '***REMOVED***a855f7'),
        ('${orgId}', 'Urgent', '***REMOVED***f97316')
    `);

    // Board 1: Product Roadmap
    const board1 = await queryRunner.query(`
      INSERT INTO kb_boards (org_id, name, description, position, template)
      VALUES ('${orgId}', 'Product Roadmap', 'High-level product planning and feature tracking', 0, 'project')
      RETURNING id
    `);
    const b1 = board1[0].id;

    const b1Cols = await queryRunner.query(`
      INSERT INTO kb_columns (board_id, name, position, color) VALUES
        ('${b1}', 'Backlog', 0, '***REMOVED***6b7280'),
        ('${b1}', 'Up Next', 1, '***REMOVED***3b82f6'),
        ('${b1}', 'In Progress', 2, '***REMOVED***f59e0b'),
        ('${b1}', 'Done', 3, '***REMOVED***10b981')
      RETURNING id, position
    `);

    const b1ColIds = b1Cols.sort((a: { position: number }, b: { position: number }) => a.position - b.position).map((c: { id: string }) => c.id);

    // Cards for Product Roadmap
    await queryRunner.query(`
      INSERT INTO kb_cards (board_id, column_id, title, description, position, priority) VALUES
        ('${b1}', '${b1ColIds[0]}', 'Multi-workspace support', 'Allow users to create and switch between workspaces', 0, 'medium'),
        ('${b1}', '${b1ColIds[0]}', 'Custom field types', 'Support custom fields on cards (date, number, select)', 1, 'low'),
        ('${b1}', '${b1ColIds[0]}', 'Board templates gallery', 'Curated templates for common workflows', 2, 'low'),
        ('${b1}', '${b1ColIds[1]}', 'Card attachments', 'File upload and attachment support on cards', 0, 'medium'),
        ('${b1}', '${b1ColIds[1]}', 'Board activity feed', 'Real-time activity log for board changes', 1, 'high'),
        ('${b1}', '${b1ColIds[2]}', 'Drag-and-drop cards', 'Implement card DnD between columns', 0, 'urgent'),
        ('${b1}', '${b1ColIds[2]}', 'Card labels and filtering', 'Color-coded labels with filter support', 1, 'high'),
        ('${b1}', '${b1ColIds[3]}', 'Board CRUD API', 'REST endpoints for board management', 0, 'high'),
        ('${b1}', '${b1ColIds[3]}', 'Database schema migration', 'Create kb_* tables with proper indexes', 1, 'urgent')
    `);

    // Board 2: Sprint Board
    const board2 = await queryRunner.query(`
      INSERT INTO kb_boards (org_id, name, description, position, template)
      VALUES ('${orgId}', 'Sprint Board', 'Current sprint task tracking', 1, 'sprint')
      RETURNING id
    `);
    const b2 = board2[0].id;

    const b2Cols = await queryRunner.query(`
      INSERT INTO kb_columns (board_id, name, position, color, wip_limit) VALUES
        ('${b2}', 'To Do', 0, '***REMOVED***6b7280', NULL),
        ('${b2}', 'In Progress', 1, '***REMOVED***f59e0b', 3),
        ('${b2}', 'Review', 2, '***REMOVED***8b5cf6', 2),
        ('${b2}', 'Done', 3, '***REMOVED***10b981', NULL)
      RETURNING id, position
    `);

    const b2ColIds = b2Cols.sort((a: { position: number }, b: { position: number }) => a.position - b.position).map((c: { id: string }) => c.id);

    await queryRunner.query(`
      INSERT INTO kb_cards (board_id, column_id, title, description, position, priority) VALUES
        ('${b2}', '${b2ColIds[0]}', 'Write unit tests for board API', 'Cover all CRUD endpoints', 0, 'high'),
        ('${b2}', '${b2ColIds[0]}', 'Add keyboard shortcuts', 'Arrow keys for navigation, Enter to open', 1, 'medium'),
        ('${b2}', '${b2ColIds[1]}', 'Implement checklist component', 'Checkboxes with progress bar', 0, 'medium'),
        ('${b2}', '${b2ColIds[2]}', 'Code review: card detail modal', 'Review the CardDetail.tsx implementation', 0, 'high'),
        ('${b2}', '${b2ColIds[3]}', 'Setup project structure', 'Create folder layout and base components', 0, 'medium'),
        ('${b2}', '${b2ColIds[3]}', 'Configure Tailwind theme', 'Add board-specific color tokens', 1, 'low')
    `);

    // Board 3: Bug Tracker
    const board3 = await queryRunner.query(`
      INSERT INTO kb_boards (org_id, name, description, position, template)
      VALUES ('${orgId}', 'Bug Tracker', 'Track and resolve reported bugs', 2, 'bugs')
      RETURNING id
    `);
    const b3 = board3[0].id;

    const b3Cols = await queryRunner.query(`
      INSERT INTO kb_columns (board_id, name, position, color) VALUES
        ('${b3}', 'New', 0, '***REMOVED***ef4444'),
        ('${b3}', 'Triaging', 1, '***REMOVED***f59e0b'),
        ('${b3}', 'In Fix', 2, '***REMOVED***3b82f6'),
        ('${b3}', 'Testing', 3, '***REMOVED***8b5cf6'),
        ('${b3}', 'Resolved', 4, '***REMOVED***10b981')
      RETURNING id, position
    `);

    const b3ColIds = b3Cols.sort((a: { position: number }, b: { position: number }) => a.position - b.position).map((c: { id: string }) => c.id);

    await queryRunner.query(`
      INSERT INTO kb_cards (board_id, column_id, title, description, position, priority) VALUES
        ('${b3}', '${b3ColIds[0]}', 'Card drag drops to wrong position', 'When dragging fast, card ends up in wrong index', 0, 'urgent'),
        ('${b3}', '${b3ColIds[0]}', 'Column color not saving', 'Color picker changes dont persist after refresh', 1, 'high'),
        ('${b3}', '${b3ColIds[1]}', 'Duplicate labels created on rapid click', 'Race condition in label creation', 0, 'medium'),
        ('${b3}', '${b3ColIds[2]}', 'Fix SSE reconnection on network drop', 'EventSource doesnt reconnect after wifi toggle', 0, 'high'),
        ('${b3}', '${b3ColIds[4]}', 'Fix login redirect loop', 'Fixed 401 interceptor redirect condition', 0, 'urgent')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Find the platform org
    const platformOrg = await queryRunner.query(
      `SELECT id FROM organizations WHERE is_platform_org = true LIMIT 1`
    );

    if (!platformOrg || platformOrg.length === 0) {
      return;
    }

    const orgId = platformOrg[0].id;

    // Delete in reverse dependency order
    await queryRunner.query(`DELETE FROM kb_cards WHERE board_id IN (SELECT id FROM kb_boards WHERE org_id = $1)`, [orgId]);
    await queryRunner.query(`DELETE FROM kb_columns WHERE board_id IN (SELECT id FROM kb_boards WHERE org_id = $1)`, [orgId]);
    await queryRunner.query(`DELETE FROM kb_boards WHERE org_id = $1`, [orgId]);
    await queryRunner.query(`DELETE FROM kb_labels WHERE org_id = $1`, [orgId]);
  }
}
