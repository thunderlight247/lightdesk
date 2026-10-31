import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const WASM_MODULE_SUFFIX = ".wasm?module";
const VIRTUAL_PREFIX = "\0wasm-module:";

// Prisma's generated client (lib/generated/prisma) loads its query compiler with
// `import("./query_compiler_fast_bg.wasm?module")`, which Vite cannot parse. Under Vitest
// (plain Node) we resolve that import to a real WebAssembly.Module compiled from the file.
// Test-only: the app build uses the Next/OpenNext pipeline (next.config.ts).
function wasmModuleForVitest(): Plugin {
  return {
    name: "lightdesk-wasm-module-for-tests",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(WASM_MODULE_SUFFIX) || !importer) return null;
      const file = path.resolve(path.dirname(importer), source.slice(0, -"?module".length));
      return VIRTUAL_PREFIX + file;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const file = id.slice(VIRTUAL_PREFIX.length);
      const b64 = readFileSync(file).toString("base64");
      return `export default new WebAssembly.Module(Buffer.from("${b64}", "base64"));`;
    },
  };
}

// Integration + security tests run against a REAL PostgreSQL database
// (TEST_DATABASE_URL). They never skip: a missing database fails the run.
export default defineConfig({
  plugins: [wasmModuleForVitest()],
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
