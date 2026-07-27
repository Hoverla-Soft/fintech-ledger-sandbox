import { defineConfig } from "vitest/config";

/**
 * The domain suite. Pure unit tests — no database, no HTTP, no fixtures beyond
 * plain values, which is the property `packages/core` exists to demonstrate.
 * Tests sit next to the code they cover (`src/**\/*.test.ts`).
 */
export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
