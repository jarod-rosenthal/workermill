import { DataSource } from "typeorm";
import { config } from "../config/index.js";
import { Organization, User, WorkerTask } from "../models/index.js";
import { InitialSchema1704067200000 } from "./migrations/1704067200000-InitialSchema.js";
import { AddWorkerTaskColumns1704067200001 } from "./migrations/1704067200001-AddWorkerTaskColumns.js";
import { AddOrganizationSettings1704067200002 } from "./migrations/1704067200002-AddOrganizationSettings.js";
import { AddCountersResetAt1704067200003 } from "./migrations/1704067200003-AddCountersResetAt.js";
import { logger } from "../utils/logger.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: config.database.url,
  host: config.database.url ? undefined : config.database.host,
  port: config.database.url ? undefined : config.database.port,
  username: config.database.url ? undefined : config.database.username,
  password: config.database.url ? undefined : config.database.password,
  database: config.database.url ? undefined : config.database.name,
  entities: [Organization, User, WorkerTask],
  migrations: [
    InitialSchema1704067200000,
    AddWorkerTaskColumns1704067200001,
    AddOrganizationSettings1704067200002,
    AddCountersResetAt1704067200003,
  ],
  synchronize: false, // Use migrations in production
  logging: config.nodeEnv === "development",
  ssl: config.database.url?.includes("rds.amazonaws.com")
    ? { rejectUnauthorized: false }
    : false,
});

export async function initializeDatabase(): Promise<DataSource> {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");
    return AppDataSource;
  } catch (error) {
    logger.error("Error connecting to database", { error });
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  try {
    const migrations = await AppDataSource.runMigrations();
    if (migrations.length > 0) {
      logger.info(`Ran ${migrations.length} migrations`, {
        migrations: migrations.map((m) => m.name),
      });
    }
    logger.info("Migrations completed");
  } catch (error) {
    logger.error("Error running migrations", { error });
    throw error;
  }
}
