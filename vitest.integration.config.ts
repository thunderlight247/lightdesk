import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration + security tests run against a REAL PostgreSQL database
// (TEST_DATABASE_URL). They never skip: a missing database fails the run.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts", "tests/security/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_URL: "http://localhost:3000",
      // Pinned so tests assert against fixed throttle budgets, not drifting lib/env defaults.
      LOGIN_MAX_FAILURES_PER_IP: "10",
      LOGIN_MAX_FAILURES_PER_EMAIL: "5",
      LOGIN_FAILURE_WINDOW_MINUTES: "10",
    },
  },
});
