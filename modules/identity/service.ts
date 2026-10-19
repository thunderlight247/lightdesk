import { prisma } from "@/lib/db/client";
import { hashPassword, verifyPassword } from "@/lib/security/password";

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
  return user;
}
