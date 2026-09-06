import { defineConfig } from "vitest/config";

/**
 * Native package/PTY checks are kept separate from unit tests so CI runs each
 * class once: the ordinary unit suite excludes this file, this config includes
 * only it. The suite is deterministic and needs no provider credentials.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/package-os.test.ts"],
    testTimeout: 45_000,
    hookTimeout: 90_000,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
