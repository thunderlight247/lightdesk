import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { generateToken, hashToken, TOKEN_PATTERN } from "@/lib/security/tokens";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
};

const isProd = () => process.env.NODE_ENV === "production";

/** `__Host-` prefix (production) forces Secure, Path=/, and no Domain attribute. */
export function sessionCookieName(): string {
  return isProd() ? "__Host-ld_session" : "ld_session";
}

/** Always issues a NEW session id (prevents session fixation). */
export async function createSession(userId: string): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + getEnv().SESSION_TTL_DAYS * 86_400_000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  const { id, email, name, isPlatformAdmin } = session.user;
  return { id, email, name, isPlatformAdmin };
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(sessionCookieName());
}

/** Housekeeping; call from a scheduled job in later milestones. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
