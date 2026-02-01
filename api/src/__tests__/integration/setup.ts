import { DataSource, QueryRunner } from "typeorm";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";

/**
 * Integration test setup.
 *
 * Creates a database connection and manages transactions for test isolation.
 * Each test runs in a transaction that is rolled back after completion,
 * ensuring tests don't affect each other or pollute the database.
 *
 * Prerequisites:
 * - DATABASE_URL environment variable must be set
 * - Database must be accessible (self-hosted runner in VPC)
 */

let dataSource: DataSource | null = null;
let queryRunner: QueryRunner | null = null;

/**
 * Initialize database connection before all tests.
 */
beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required for integration tests");
  }

  // Create a separate DataSource for tests (don't use the app's singleton)
  dataSource = new DataSource({
    type: "postgres",
    url: databaseUrl,
    entities: ["src/models/**/*.ts"],
    synchronize: false, // Don't modify schema
    logging: process.env.DEBUG === "true",
    ssl: databaseUrl.includes("rds.amazonaws.com") ? { rejectUnauthorized: false } : false,
    extra: {
      max: 5, // Smaller pool for tests
      min: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    },
  });

  await dataSource.initialize();
  console.log("✅ Test database connected");
});

/**
 * Close database connection after all tests.
 */
afterAll(async () => {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
    console.log("✅ Test database connection closed");
  }
});

/**
 * Start a transaction before each test.
 */
beforeEach(async () => {
  if (!dataSource?.isInitialized) {
    throw new Error("Database not initialized");
  }

  queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
});

/**
 * Rollback transaction after each test.
 */
afterEach(async () => {
  if (queryRunner) {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
    queryRunner = null;
  }
});

/**
 * Get the current query runner's entity manager.
 * Use this in tests to ensure operations use the transaction.
 */
export function getTestManager() {
  if (!queryRunner) {
    throw new Error("Query runner not initialized - are you running inside a test?");
  }
  return queryRunner.manager;
}

/**
 * Get the test data source.
 */
export function getTestDataSource() {
  if (!dataSource?.isInitialized) {
    throw new Error("Data source not initialized");
  }
  return dataSource;
}

/**
 * Generates a unique test identifier.
 */
export function generateTestId(): string {
  return `INT-TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
