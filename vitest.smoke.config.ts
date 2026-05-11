import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["smoke/**/*.test.ts"],
    testTimeout: 6 * 60_000
  }
});
