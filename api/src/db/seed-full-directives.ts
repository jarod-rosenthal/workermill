#!/usr/bin/env npx ts-node
/**
 * Full Directive Seeder
 *
 * Reads the actual directive files from worker/directives/ and seeds them to the database.
 * Run this script locally with a database tunnel:
 *
 *   cd api && npx ts-node src/db/seed-full-directives.ts
 *
 * Prerequisites:
 *   1. Start bastion: ./bin/bastion start && ./bin/bastion ssh
 *   2. Set DATABASE_URL: export DATABASE_URL=postgresql://workermill:<password>@localhost:5432/workermill
 */

import { DataSource, IsNull } from "typeorm";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

// Path to worker directives (relative to api/ folder)
const DIRECTIVES_PATH = resolve(__dirname, "../../../worker/directives");

// Database connection (uses DATABASE_URL environment variable)
const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [join(__dirname, "../models/*.{ts,js}")],
  synchronize: false,
  logging: false,
});

interface DirectiveFile {
  personaSlug: string;
  type: "readme" | "common";
  filename: string | null;
  content: string;
}

/**
 * Read all directive files from a persona's directory
 */
function readPersonaDirectives(personaSlug: string): DirectiveFile[] {
  const personaPath = join(DIRECTIVES_PATH, personaSlug);
  if (!existsSync(personaPath)) {
    return [];
  }

  const files = readdirSync(personaPath);
  const directives: DirectiveFile[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = join(personaPath, file);
    const content = readFileSync(filePath, "utf-8");

    if (file === "README.md") {
      directives.push({
        personaSlug,
        type: "readme",
        filename: null,
        content,
      });
    } else {
      directives.push({
        personaSlug,
        type: "common",
        filename: file,
        content,
      });
    }
  }

  return directives;
}

/**
 * Read common directives (shared across all personas)
 */
function readCommonDirectives(): DirectiveFile[] {
  const commonPath = join(DIRECTIVES_PATH, "common");
  if (!existsSync(commonPath)) {
    return [];
  }

  const files = readdirSync(commonPath);
  const directives: DirectiveFile[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = join(commonPath, file);
    const content = readFileSync(filePath, "utf-8");

    // Common directives apply to all personas, but we'll skip them for now
    // since they're loaded separately during worker execution
    directives.push({
      personaSlug: "_common",
      type: "common",
      filename: file,
      content,
    });
  }

  return directives;
}

async function main(): Promise<void> {
  console.log("Connecting to database...");
  await dataSource.initialize();
  console.log("Connected!\n");

  // Get repositories
  const personaRepo = dataSource.getRepository("Persona");
  const directiveRepo = dataSource.getRepository("PersonaDirective");

  // Get all persona directories
  if (!existsSync(DIRECTIVES_PATH)) {
    console.error(`Directives path not found: ${DIRECTIVES_PATH}`);
    console.error("Make sure you're running this from the api/ directory");
    process.exit(1);
  }

  const personaDirs = readdirSync(DIRECTIVES_PATH).filter(
    (dir) => !dir.startsWith(".") && dir !== "common"
  );

  console.log(`Found ${personaDirs.length} persona directories\n`);

  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const personaSlug of personaDirs) {
    const directives = readPersonaDirectives(personaSlug);

    if (directives.length === 0) {
      console.log(`  ${personaSlug}: No directives found, skipping`);
      skipped++;
      continue;
    }

    // Find the system persona
    const persona = await personaRepo.findOne({
      where: { slug: personaSlug, isSystem: true, orgId: IsNull() },
    });

    if (!persona) {
      console.log(`  ${personaSlug}: Persona not found in database, skipping`);
      skipped++;
      continue;
    }

    for (const directive of directives) {
      // Check if directive already exists
      const existing = await directiveRepo.findOne({
        where: {
          personaId: (persona as any).id,
          type: directive.type,
          filename: directive.filename ?? IsNull(),
          isActive: true,
        },
      });

      if (existing) {
        // Update existing directive content
        const currentContent = (existing as any).content;
        if (currentContent !== directive.content) {
          await directiveRepo.update((existing as any).id, {
            content: directive.content,
            version: (existing as any).version + 1,
            changeSummary: "Updated from worker/directives files",
          });
          console.log(`  ${personaSlug}/${directive.filename || "README.md"}: Updated`);
          updated++;
        } else {
          console.log(`  ${personaSlug}/${directive.filename || "README.md"}: No changes`);
        }
      } else {
        // Create new directive
        const newDirective = directiveRepo.create({
          personaId: (persona as any).id,
          type: directive.type,
          filename: directive.filename,
          content: directive.content,
          version: 1,
          isActive: true,
          createdById: null,
          changeSummary: "Seeded from worker/directives files",
        });

        await directiveRepo.save(newDirective);
        console.log(`  ${personaSlug}/${directive.filename || "README.md"}: Created`);
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
