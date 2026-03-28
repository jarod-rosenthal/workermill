import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/e2e/**/*.test.ts"],
    testTimeout: 300_000,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
