import { randomBytes } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError } from "@/lib/security/errors";
import {
  createBusinessSchema,
  parseOrThrow,
  updateBusinessSchema,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/modules/audit/service";
import { issueInvitation } from "@/modules/businesses/invitations";
import { requireMembership, requirePermission, requirePlatformAdmin } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";

function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base || "business";
}

/** Only businesses the user is an active member of. */
export async function listBusinessesForUser(userId: string) {
  const memberships = await prisma.businessMembership.findMany({
    where: { userId, business: { status: "ACTIVE" } },
    select: { role: true, business: { select: { id: true, name: true, slug: true, location: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.business, role: m.role }));
}

export async function listMembers(actorId: string, businessId: string) {
  await requirePermission(actorId, businessId, "members:read");
  return prisma.businessMembership.findMany({
    where: { businessId },
    select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Everything the overview/settings pages need, in one membership-checked call:
 * the business identity fields, the caller's role, and what the caller may do.
 * Capabilities are computed here (server-side) from the permission matrix; the UI
 * only uses them to decide what to render — the mutating paths re-check on their own.
 */
export async function getBusinessOverview(userId: string, businessId: string) {
  const membership = await requireMembership(userId, businessId);
  const { id, name, slug, status, description, location, createdAt, updatedAt } = membership.business;
  const memberCount = can(membership.role, "members:read")
    ? await prisma.businessMembership.count({ where: { businessId: id } })
    : null;
  return {
    business: { id, name, slug, status, description, location, createdAt, updatedAt },
    role: membership.role,
    memberCount,
    capabilities: {
      canUpdate: can(membership.role, "business:update"),
      canRename: can(membership.role, "business:rename"),
      canManageInvitations: can(membership.role, "invitations:manage"),
    },
  };
}

/**
 * Update business identity fields. Authorisation first (membership, then
 * `business:update`; renaming additionally needs `business:rename`), then
 * validation. Nothing is written unless every requested change is allowed.
 * Audit records WHICH fields changed, never their values.
 */
export async function updateBusiness(actorId: string, businessId: string, input: unknown) {
  const membership = await requirePermission(actorId, businessId, "business:update");
  const data = parseOrThrow(updateBusinessSchema, input);
  const current = membership.business;

  if (data.name !== undefined && data.name !== current.name && !can(membership.role, "business:rename")) {
    throw new ForbiddenError("Only owners can rename a business");
  }

  const changes: Prisma.BusinessUpdateInput = {};
  const fields: string[] = [];
  if (data.name !== undefined && data.name !== current.name) {
    changes.name = data.name;
    fields.push("name");
  }
  if (data.description !== undefined && data.description !== current.description) {
    changes.description = data.description;
    fields.push("description");
  }
  if (data.location !== undefined && data.location !== current.location) {
    changes.location = data.location;
    fields.push("location");
  }
  if (fields.length === 0) return { business: current, changed: [] as string[] };

  const business = await prisma.$transaction(async (tx) => {
    const row = await tx.business.update({ where: { id: current.id }, data: changes });
    await recordAudit(tx, {
      action: "business.updated",
      actorUserId: actorId,
      businessId: current.id,
      targetType: "Business",
      targetId: current.id,
      metadata: { fields: fields.join(",") },
    });
    return row;
  });
  return { business, changed: fields };
}

/**
 * Platform administrators create businesses but get NO implicit access to
 * business data: the first owner joins through an OWNER invitation.
 */
export async function createBusinessWithOwnerInvitation(
  actorId: string,
  input: { name: string; ownerEmail: string },
) {
  await requirePlatformAdmin(actorId);
  const data = parseOrThrow(createBusinessSchema, input);

  return prisma.$transaction(async (tx) => {
    let slug = slugify(data.name);
    if (await tx.business.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${slug.slice(0, 54)}-${randomBytes(3).toString("hex")}`;
      if (await tx.business.findUnique({ where: { slug }, select: { id: true } })) {
        throw new ConflictError("Could not allocate a unique business slug; try again");
      }
    }
    const business = await tx.business.create({ data: { name: data.name, slug } });
    await recordAudit(tx, {
      action: "business.created",
      actorUserId: actorId,
      businessId: business.id,
      targetType: "Business",
      targetId: business.id,
    });
    const invitation = await issueInvitation(tx, {
      businessId: business.id,
      email: data.ownerEmail,
      role: "OWNER",
      invitedById: actorId,
    });
    return { business, invitation };
  });
}

/** Names only — platform admins can see that businesses exist, not their data. */
export async function listAllBusinessNames(actorId: string) {
  await requirePlatformAdmin(actorId);
  return prisma.business.findMany({
    select: { id: true, name: true, slug: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}
