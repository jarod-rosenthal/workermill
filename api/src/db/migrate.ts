import { AppDataSource } from "./connection.js";
import { logger } from "../utils/logger.js";

async function runMigrations() {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");

    const migrations = await AppDataSource.runMigrations();

    if (migrations.length === 0) {
      logger.info("No pending migrations");
    } else {
      logger.info(`Ran ${migrations.length} migration(s)`, {
        migrations: migrations.map((m) => m.name),
      });
    }

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    logger.error("Migration failed", { error });
    process.exit(1);
  }
}

runMigrations();
