***REMOVED***!/usr/bin/env npx ts-node
/**
 * Full Script Seeder
 *
 * Reads the actual TypeScript execution scripts from worker/execution/ and seeds them to the database.
 * Run this script locally with a database tunnel:
 *
 *   cd api && npx tsx src/db/seed-full-scripts.ts
 *
 * Prerequisites:
 *   1. Start bastion: ./bin/bastion start && ./bin/bastion ssh
 *   2. Set DATABASE_URL: export DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill
 */

import { DataSource, IsNull } from "typeorm";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

// Path to worker execution scripts (relative to api/ folder)
const EXECUTION_PATH = resolve(__dirname, "../../../worker/execution");

// Directories to skip (internal plumbing, not user-facing)
const SKIP_DIRS = new Set(["lib", "v2"]);

// Database connection (uses DATABASE_URL environment variable)
const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, "../models/*.{ts,js}")],
  synchronize: false,
  logging: false,
});

interface ScriptFile {
  category: string;
  name: string;
  content: string;
}

/**
 * Read all execution script files from worker/execution/
 */
function readExecutionScripts(): ScriptFile[] {
  const scripts: ScriptFile[] = [];
  const categories = readdirSync(EXECUTION_PATH, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
    .map((d) => d.name);

  for (const category of categories) {
    const categoryPath = join(EXECUTION_PATH, category);
    const files = readdirSync(categoryPath).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      const filePath = join(categoryPath, file);
      const content = readFileSync(filePath, "utf-8");
      const name = file.replace(/\.ts$/, "");

      scripts.push({ category, name, content });
    }
  }

  return scripts;
}

async function main(): Promise<void> {
  console.log("Connecting to database...");
  await dataSource.initialize();
  console.log("Connected!\n");

  // Get repositories
  const personaRepo = dataSource.getRepository("Persona");
  const scriptRepo = dataSource.getRepository("PersonaScript");

  // Verify execution path exists
  if (!existsSync(EXECUTION_PATH)) {
    console.error(`Execution path not found: ${EXECUTION_PATH}`);
    console.error("Make sure you're running this from the api/ directory");
    process.exit(1);
  }

  // Read all script files
  const scriptFiles = readExecutionScripts();
  console.log(`Found ${scriptFiles.length} execution scripts\n`);

  // Get all system personas
  const systemPersonas = await personaRepo.find({
    where: { isSystem: true, orgId: IsNull() },
  });

  console.log(`Found ${systemPersonas.length} system personas\n`);

  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const persona of systemPersonas) {
    const personaId = (persona as any).id;
    const personaSlug = (persona as any).slug;

    for (const scriptFile of scriptFiles) {
      // Check if script already exists
      const existing = await scriptRepo.findOne({
        where: {
          personaId,
          category: scriptFile.category,
          name: scriptFile.name,
          isActive: true,
        },
      });

      if (existing) {
        const currentContent = (existing as any).content;
        if (currentContent !== scriptFile.content) {
          await scriptRepo.update((existing as any).id, {
            content: scriptFile.content,
            version: (existing as any).version + 1,
            changeSummary: "Updated from worker/execution files",
          });
          console.log(`  ${personaSlug}: ${scriptFile.category}/${scriptFile.name} → Updated`);
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Create new script
        const newScript = scriptRepo.create({
          personaId,
          orgId: null,
          category: scriptFile.category,
          name: scriptFile.name,
          content: scriptFile.content,
          version: 1,
          isActive: true,
          createdById: null,
          changeSummary: "Seeded from worker/execution files",
        });

        await scriptRepo.save(newScript);
        console.log(`  ${personaSlug}: ${scriptFile.category}/${scriptFile.name} → Created`);
        created++;
      }
    }
  }

  console.log("\n========================================");
  console.log(`Seeding complete!`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log("========================================\n");

  await dataSource.destroy();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
