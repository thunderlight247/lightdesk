/* Creates the first platform administrator. CLI only — no HTTP endpoint exists. */
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/security/errors";
import { bootstrapPlatformAdmin } from "@/modules/identity/bootstrap";

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? "Platform Admin";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (see README).");
    process.exitCode = 1;
    return;
  }
  const admin = await bootstrapPlatformAdmin({ email, name, password });
  console.log(`Platform administrator created: ${admin.email}`);
}

main()
  .catch((err) => {
    console.error("Bootstrap failed:", err instanceof AppError ? err.message : "unexpected error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
