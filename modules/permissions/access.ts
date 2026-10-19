import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { can } from "@/modules/permissions/roles";

/**
 * The ONLY way business resources are reached. The business id supplied by a
 * client is never trusted: access requires an active membership row for
 * (businessId, userId). Non-members get the same NotFoundError as a business
 * that does not exist, so existence is not disclosed.
 */
export async function requireMembership(userId: string, businessId: string) {
  const membership = await prisma.businessMembership.findUnique({
    where: { businessId_userId: { businessId, userId } },
    include: { business: true, user: { select: { status: true } } },
  });
  if (!membership || membership.business.status !== "ACTIVE" || membership.user.status !== "ACTIVE") {
    throw new NotFoundError("Business not found");
  }
  return membership;
}

export async function requirePermission(userId: string, businessId: string, permission: string) {
  const membership = await requireMembership(userId, businessId);
  if (!can(membership.role, permission)) throw new ForbiddenError();
  return membership;
}

export async function requirePlatformAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.isPlatformAdmin) throw new ForbiddenError();
  return user;
}
