import { prisma } from "@/lib/db/client";
import { ConflictError } from "@/lib/security/errors";
import { hashPassword } from "@/lib/security/password";
import { bootstrapSchema, parseOrThrow } from "@/lib/validation/schemas";
import { recordAudit } from "@/modules/audit/service";

/**
 * Creates the FIRST platform administrator. Only reachable from the CLI
 * (scripts/bootstrap-admin.ts); there is no HTTP endpoint for it. Refuses to
 * run once any platform administrator exists. A transaction-scoped advisory
 * lock makes concurrent invocations safe.
 */
export async function bootstrapPlatformAdmin(input: { email: string; name: string; password: string }) {
  const data = parseOrThrow(bootstrapSchema, input);
  const passwordHash = await hashPassword(data.password); // slow: keep outside the transaction

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
    const existing = await tx.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
    if (existing) throw new ConflictError("A platform administrator already exists");

    const taken = await tx.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (taken) throw new ConflictError("A user with this email already exists");

    const admin = await tx.user.create({
      data: { email: data.email, name: data.name, passwordHash, isPlatformAdmin: true },
    });
    await recordAudit(tx, {
      action: "platform.admin_bootstrapped",
      actorUserId: admin.id,
      targetType: "User",
      targetId: admin.id,
    });
    return admin;
  });
}
