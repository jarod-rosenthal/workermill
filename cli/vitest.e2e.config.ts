import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/e2e/**/*.test.ts"],
    testTimeout: 0, // No artificial timeout — AI operations take as long as they take
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
