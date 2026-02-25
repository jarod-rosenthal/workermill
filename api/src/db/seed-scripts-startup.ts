/**
 * Startup Script Seeder
 *
 * Seeds system persona scripts from worker/execution/ TypeScript source files on API startup.
 * Only seeds if scripts are missing.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { IsNull } from "typeorm";
import { AppDataSource } from "./connection.js";
import { Persona, PersonaScript } from "../models/index.js";
import { logger } from "../utils/logger.js";

// Path to worker execution scripts (relative to compiled api/dist/db/)
const EXECUTION_PATH = resolve(__dirname, "../../../worker/execution");

// Directories to skip (internal plumbing, not user-facing)
const SKIP_DIRS = new Set(["lib", "v2"]);

interface ScriptFile {
  category: string;
  name: string;
  content: string;
}

/**
 * Read all execution script files from worker/execution/
 */
function readExecutionScripts(): ScriptFile[] {
  if (!existsSync(EXECUTION_PATH)) {
    return [];
  }

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

/**
 * Seed system persona scripts if missing
 */
export async function seedScriptsIfMissing(): Promise<void> {
  try {
    const personaRepo = AppDataSource.getRepository(Persona);
    const scriptRepo = AppDataSource.getRepository(PersonaScript);

    // Check if any system personas have active scripts with real content
    const systemPersonasWithScripts = await personaRepo
      .createQueryBuilder("persona")
      .leftJoin("persona.scripts", "script")
      .where("persona.isSystem = true")
      .andWhere("persona.orgId IS NULL")
      .andWhere("script.id IS NOT NULL")
      .andWhere("script.isActive = true")
      .getCount();

    if (systemPersonasWithScripts > 0) {
      logger.info("System persona scripts already exist, skipping seed");
      return;
    }

    // Read script files from disk
    const scriptFiles = readExecutionScripts();
    if (scriptFiles.length === 0) {
      logger.info(
        "No execution scripts found on disk (production Docker?) — run seed-full-scripts.ts manually to populate",
      );
      return;
    }

    logger.info(`Seeding system persona scripts from ${scriptFiles.length} execution files...`);

    // Get all system personas
    const systemPersonas = await personaRepo.find({
      where: { isSystem: true, orgId: IsNull() },
    });

    if (systemPersonas.length === 0) {
      logger.warn("No system personas found, skipping script seed");
      return;
    }

    let seeded = 0;

    for (const persona of systemPersonas) {
      for (const scriptFile of scriptFiles) {
        const script = scriptRepo.create({
          personaId: persona.id,
          orgId: null,
          category: scriptFile.category,
          name: scriptFile.name,
          content: scriptFile.content,
          version: 1,
          isActive: true,
          createdById: null,
          changeSummary: "Initial seed from worker/execution files",
        });

        await scriptRepo.save(script);
        seeded++;
      }
    }

    logger.info(
      `Script seeding complete: ${seeded} scripts seeded across ${systemPersonas.length} personas`,
    );
  } catch (error) {
    logger.error("Failed to seed scripts", { error });
    // Don't throw - seeding failure shouldn't prevent API startup
  }
}
