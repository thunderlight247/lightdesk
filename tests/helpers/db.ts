import type { MembershipRole, UserStatus } from "@prisma/client";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { hashPassword } from "@/lib/security/password";
import { cookieStore } from "./cookie-mock";

export const TEST_PASSWORD = "correct-horse-battery-staple";
let cachedHash: Promise<string> | undefined;
const testPasswordHash = () => (cachedHash ??= hashPassword(TEST_PASSWORD));

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditEvent","Invitation","BusinessMembership","Session","Business","User","WhatsAppPendingConnection" RESTART IDENTITY CASCADE',
  );
  cookieStore.clear();
}

export async function makeUser(email: string, opts: { isPlatformAdmin?: boolean; status?: UserStatus } = {}) {
  return prisma.user.create({
    data: {
      email,
      name: email.split("@")[0],
      passwordHash: await testPasswordHash(),
      isPlatformAdmin: opts.isPlatformAdmin ?? false,
      status: opts.status ?? "ACTIVE",
    },
  });
}

export async function makeBusiness(name: string, slug: string) {
  return prisma.business.create({ data: { name, slug } });
}

export async function addMember(businessId: string, userId: string, role: MembershipRole) {
  return prisma.businessMembership.create({ data: { businessId, userId, role } });
}

/** Simulates a logged-in browser: issues a real session and stores its cookie in the mock jar. */
export async function loginAs(userId: string) {
  cookieStore.clear();
  await createSession(userId);
}

export function logout() {
  cookieStore.clear();
}

/** Two isolated tenants with an owner, an admin and a member in the first. */
export async function twoTenants() {
  const [ownerA, adminA, memberA, ownerB] = await Promise.all([
    makeUser("owner-a@test.example"),
    makeUser("admin-a@test.example"),
    makeUser("member-a@test.example"),
    makeUser("owner-b@test.example"),
  ]);
  const bizA = await makeBusiness("Biz A", "biz-a");
  const bizB = await makeBusiness("Biz B", "biz-b");
  await addMember(bizA.id, ownerA.id, "OWNER");
  await addMember(bizA.id, adminA.id, "ADMIN");
  await addMember(bizA.id, memberA.id, "MEMBER");
  await addMember(bizB.id, ownerB.id, "OWNER");
  return { ownerA, adminA, memberA, ownerB, bizA, bizB };
}
