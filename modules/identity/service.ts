import { prisma } from "@/lib/db/client";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/security/password";
import { recordAudit } from "@/modules/audit/service";

let dummyHash: Promise<string> | undefined;

/**
 * Returns the user when credentials are valid and the account is active.
 * Always performs one password verification so unknown emails and wrong
 * passwords take comparable time.
 */
export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  dummyHash ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok || user.status !== "ACTIVE") return null;
  // Transparent upgrade: hashes stored at pre-2026-10-28 parameters (N=2^17,
  // ~10 CPU-s per verification on Workers — see lib/security/password.ts) are
  // rehashed once, right after a successful verification proves the plaintext.
  // A failed upgrade must never block the login, so failures are swallowed after
  // being audited; the next successful login retries the upgrade.
  if (needsRehash(user.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
      // Audits carry identifiers, never credentials; plaintext is not logged.
      await recordAudit(prisma, { action: "auth.login.password_rehashed", targetType: "User", targetId: user.id });
    } catch (err) {
      await recordAudit(prisma, {
        action: "auth.login.rehash_failed",
        targetType: "User",
        targetId: user.id,
        metadata: { error: String(err) },
      });
    }
  }
  return user;
}
