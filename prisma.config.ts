import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 configuration (required since the `prisma-client` generator landed).
 * The CLI (migrate/generate) reads the datasource URL here instead of the schema's
 * `datasource url` line. Runtime DB connections are NOT read from this file: the app
 * always reaches Postgres through the pg driver adapter (lib/db/client.ts), over the
 * Hyperdrive binding in the Worker and `DATABASE_URL` in plain Node.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
