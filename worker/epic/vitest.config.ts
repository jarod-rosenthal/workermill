import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["epic/__tests__/**/*.test.ts", "ai-clients/__tests__/**/*.test.ts"],
    exclude: ["**/templates/**", "**/node_modules/**", "**/dist/**"],
  },
});
