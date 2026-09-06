import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/helpers/setup-state.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "src/__tests__/e2e/**"],
  },
});
