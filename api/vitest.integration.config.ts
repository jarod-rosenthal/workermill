import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for integration tests.
 *
 * Integration tests run against a real database and require:
 * - DATABASE_URL environment variable set
 * - Network access to the database (self-hosted runner in VPC)
 *
 * Tests use transactions with rollback for isolation.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    // Run integration tests sequentially to avoid database conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Longer timeouts for database operations
    testTimeout: 60000,
    hookTimeout: 60000,
    // Setup file for database connection
    setupFiles: ["src/__tests__/integration/setup.ts"],
    // Don't run in parallel to avoid connection pool issues
    maxWorkers: 1,
    minWorkers: 1,
  },
});
