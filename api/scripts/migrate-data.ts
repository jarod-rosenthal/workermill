/**
 * Migrate data from production to local database
 * Usage: npx tsx scripts/migrate-data.ts
 */

import { DataSource } from "typeorm";

const PROD_DB_URL = process.env.PROD_DATABASE_URL ?? (() => { throw new Error("PROD_DATABASE_URL env var required"); })();
const LOCAL_DB_URL = "postgresql://workermill:localdev@localhost:5433/workermill";

async function migrate() {
  console.log("=== WorkerMill Data Migration ===\n");

  // Connect to production
  console.log("Connecting to production database...");
  const prodDs = new DataSource({
    type: "postgres",
    url: PROD_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectTimeoutMS: 30000,
  });
  await prodDs.initialize();
  console.log("✓ Connected to production\n");

  // Connect to local
  console.log("Connecting to local database...");
  const localDs = new DataSource({
    type: "postgres",
    url: LOCAL_DB_URL,
    ssl: false,
  });
  await localDs.initialize();
  console.log("✓ Connected to local\n");

  // Tables to migrate in order (respecting foreign keys)
  const tables = [
    "organizations",
    "users",
    "user_organizations",
    "personas",
    "persona_directives",
    "persona_scripts",
    "projects",
    "worker_tasks",
    "worker_task_logs",
  ];

  // Clear local tables in reverse order
  console.log("Clearing local tables...");
  for (const table of [...tables].reverse()) {
    try {
      await localDs.query(`TRUNCATE "${table}" CASCADE`);
      console.log(`  ✓ Cleared ${table}`);
    } catch (e) {
      console.log(`  - Skipped ${table}`);
    }
  }

  console.log("\nMigrating data...");

  for (const table of tables) {
    try {
      // Get local table columns first
      const localCols = await localDs.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
      `, [table]);
      const localColumnNames = new Set(localCols.map((c: {column_name: string}) => c.column_name));

      // Get data from production (order worker_tasks by parent_task_id to handle dependencies)
      const orderClause = table === 'worker_tasks'
        ? 'ORDER BY parent_task_id NULLS FIRST, created_at ASC'
        : '';
      const rows = await prodDs.query(`SELECT * FROM "${table}" ${orderClause}`);

      if (rows.length === 0) {
        console.log(`  - ${table}: empty`);
        continue;
      }

      // Get column names that exist in BOTH prod and local
      const prodColumns = Object.keys(rows[0]);
      const columns = prodColumns.filter(col => localColumnNames.has(col));

      if (columns.length === 0) {
        console.log(`  - ${table}: no matching columns`);
        continue;
      }

      // Insert into local (batch insert)
      let inserted = 0;
      let failed = 0;
      for (const row of rows) {
        // Set defaults for null values and handle JSON columns
        if (table === 'users') {
          if (row.preferences === null) row.preferences = {};
        }
        if (table === 'worker_tasks') {
          if (row.worker_provider === null) row.worker_provider = 'anthropic';
        }

        // Stringify JSON/JSONB columns properly for PostgreSQL
        const jsonColumns = [
          'provider_settings', 'provider_routing', 'default_email_preferences',
          'persona_inference_rules', 'auto_fix_stats', 'preferences', 'feature_flags',
          'codebase_exclude_patterns', 'codebase_include_languages', 'siem_event_filters',
          // worker_tasks JSON columns
          'jira_fields', 'plan_json', 'execution_plan_v2', 'context_sidecar', 'commit_history',
          'subtasks_json', 'subtask_results', 'quality_analysis_json', 'directives_used',
          'providers_used', 'provider_config'
        ];
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
            `INSERT INTO "${table}" (${colNames}) VALUES (${placeholders})`,
            values
          );
          inserted++;
        } catch (insertErr) {
          failed++;
          if (failed <= 3) {
            console.log(`    Error inserting into ${table}: ${(insertErr as Error).message?.slice(0, 100)}`);
          }
        }
      }

      console.log(`  ✓ ${table}: ${inserted}/${rows.length} rows (${failed} failed)`);
    } catch (e) {
      console.log(`  - ${table}: failed (${(e as Error).message?.slice(0, 50)})`);
    }
  }

  // Verify
  console.log("\nVerifying migration...");
  for (const table of ["organizations", "users", "worker_tasks"]) {
    try {
      const result = await localDs.query(`SELECT COUNT(*) as count FROM "${table}"`);
      console.log(`  ${table}: ${result[0].count} rows`);
    } catch (e) {
      // ignore
    }
  }

  await prodDs.destroy();
  await localDs.destroy();

  console.log("\n=== Migration Complete ===");
}

migrate().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
