/**
 * Migrate recent tasks from production to local database
 * Handles parent_task_id by setting to null if parent doesn't exist locally
 */

import { DataSource } from "typeorm";

const PROD_DB_URL = "postgresql://workermill:C6uNpsUwiQD1sQg6fOG7u6ryaCD0uY@localhost:5432/workermill";
const LOCAL_DB_URL = "postgresql://workermill:localdev@localhost:5433/workermill";

async function migrate() {
  console.log("=== Migrating Recent Tasks ===\n");

  const prodDs = new DataSource({
    type: "postgres",
    url: PROD_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectTimeoutMS: 30000,
  });
  await prodDs.initialize();
  console.log("✓ Connected to production\n");

  const localDs = new DataSource({
    type: "postgres",
    url: LOCAL_DB_URL,
    ssl: false,
  });
  await localDs.initialize();
  console.log("✓ Connected to local\n");

  // Get local organization ID
  const localOrgs = await localDs.query(`SELECT id FROM organizations`);
  const localOrgIds = new Set(localOrgs.map((o: {id: string}) => o.id));
  console.log(`Local org IDs: ${[...localOrgIds].join(', ')}\n`);

  // Get local columns
  const localCols = await localDs.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'worker_tasks' AND table_schema = 'public'
  `);
  const localColumnNames = new Set(localCols.map((c: {column_name: string}) => c.column_name));

  // Get recent tasks from production (last 7 days) for our org
  const tasks = await prodDs.query(`
    SELECT * FROM worker_tasks
    WHERE created_at > NOW() - INTERVAL '7 days'
    AND org_id IN (SELECT id FROM organizations WHERE slug = 'oncallshift')
    ORDER BY created_at ASC
  `);
  console.log(`Found ${tasks.length} recent tasks to migrate\n`);

  // Get existing task IDs in local
  const existingTasks = await localDs.query(`SELECT id FROM worker_tasks`);
  const existingIds = new Set(existingTasks.map((t: {id: string}) => t.id));

  // Filter to only columns that exist locally
  const prodColumns = tasks.length > 0 ? Object.keys(tasks[0]) : [];
  const columns = prodColumns.filter(col => localColumnNames.has(col));

  const jsonColumns = [
    'provider_settings', 'provider_routing', 'default_email_preferences',
    'persona_inference_rules', 'auto_fix_stats', 'preferences', 'feature_flags',
    'jira_fields', 'plan_json', 'target_files', 'reference_files',
    'execution_plan_v2', 'context_sidecar', 'commit_history', 'subtasks_json',
    'subtask_results', 'providers_used', 'quality_analysis_json', 'directives_used'
  ];

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of tasks) {
    // Skip if already exists
    if (existingIds.has(row.id)) {
      skipped++;
      continue;
    }

    // Set default provider if null
    if (row.worker_provider === null) {
      row.worker_provider = 'anthropic';
    }

    // Clear parent_task_id if parent doesn't exist locally
    if (row.parent_task_id && !existingIds.has(row.parent_task_id)) {
      row.parent_task_id = null;
    }

    // Stringify JSON columns
    for (const col of columns) {
      if (jsonColumns.includes(col) && row[col] !== null && typeof row[col] === 'object') {
        row[col] = JSON.stringify(row[col]);
      }
    }

    const values = columns.map(col => row[col]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const colNames = columns.map(c => `"${c}"`).join(", ");

    try {
      await localDs.query(
        `INSERT INTO "worker_tasks" (${colNames}) VALUES (${placeholders})`,
        values
      );
      existingIds.add(row.id); // Track for parent references
      inserted++;
    } catch (err) {
      failed++;
      if (failed <= 5) {
        console.log(`  Error: ${(err as Error).message?.slice(0, 100)}`);
      }
    }
  }

  console.log(`\nResults: ${inserted} inserted, ${skipped} skipped, ${failed} failed`);

  // Now migrate logs for these tasks
  console.log("\nMigrating task logs...");

  const recentTaskIds = tasks.map((t: {id: string}) => t.id);
  if (recentTaskIds.length > 0) {
    const logs = await prodDs.query(`
      SELECT * FROM worker_task_logs
      WHERE task_id = ANY($1)
    `, [recentTaskIds]);

    const logCols = await localDs.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'worker_task_logs' AND table_schema = 'public'
    `);
    const logColumnNames = new Set(logCols.map((c: {column_name: string}) => c.column_name));

    let logInserted = 0;
    for (const log of logs) {
      // Only include columns that exist locally
      const logColumns = Object.keys(log).filter(col => logColumnNames.has(col));
      const values = logColumns.map(col => log[col]);
      const placeholders = logColumns.map((_, i) => `$${i + 1}`).join(", ");
      const colNames = logColumns.map(c => `"${c}"`).join(", ");

      try {
        await localDs.query(
          `INSERT INTO "worker_task_logs" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
        logInserted++;
      } catch {
        // Skip
      }
    }
    console.log(`Logs: ${logInserted}/${logs.length} inserted`);
  }

  // Verify
  const latest = await localDs.query(`SELECT MAX(created_at) as latest FROM worker_tasks`);
  console.log(`\nLatest task in local: ${latest[0].latest}`);

  await prodDs.destroy();
  await localDs.destroy();
  console.log("\n=== Done ===");
}

migrate().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
