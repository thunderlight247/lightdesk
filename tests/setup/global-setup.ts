import { execSync } from "node:child_process";

/** Fails loudly (never skips) when the test database is not configured. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration and security tests need a real PostgreSQL database; see README.",
    );
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: test database name "${dbName}" must contain "test" (tests TRUNCATE tables).`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
