import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/backend/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000
  }
});
