import { Prisma } from "@/lib/generated/prisma/client";
import type { MembershipRole } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  InvalidInvitationError,
  NotFoundError,
} from "@/lib/security/errors";
import { hashPassword } from "@/lib/security/password";
import { generateToken, hashToken } from "@/lib/security/tokens";
import {
  createInvitationSchema,
  inviteTokenSchema,
  parseOrThrow,
  registrationSchema,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/modules/audit/service";
import { requirePermission } from "@/modules/permissions/access";
import { canAssignRole } from "@/modules/permissions/roles";

type Tx = Prisma.TransactionClient;

export function buildInviteLink(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

/**
 * Creates an invitation inside the caller's transaction. Any earlier pending
 * invitation for the same business+email is revoked first, so the old token
 * stops working. The plaintext token is returned ONCE; only its hash is stored.
 */
export async function issueInvitation(
  tx: Tx,
  params: { businessId: string; email: string; role: MembershipRole; invitedById: string },
) {
  const now = new Date();
  await tx.invitation.updateMany({
    where: { businessId: params.businessId, email: params.email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  const token = generateToken();
  const invitation = await tx.invitation.create({
    data: {
      businessId: params.businessId,
      email: params.email,
      role: params.role,
      tokenHash: hashToken(token),
      invitedById: params.invitedById,
      createdAt: now,
      expiresAt: new Date(now.getTime() + getEnv().INVITATION_TTL_HOURS * 3_600_000),
    },
    select: { id: true, email: true, role: true, expiresAt: true, businessId: true },
  });
  await recordAudit(tx, {
    action: "invitation.created",
    actorUserId: params.invitedById,
    businessId: params.businessId,
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email: params.email, role: params.role },
  });
  return { ...invitation, token };
}

export async function createInvitation(actorId: string, businessId: string, input: unknown) {
  const data = parseOrThrow(createInvitationSchema, input);
  const membership = await requirePermission(actorId, businessId, "invitations:manage");
  if (!canAssignRole(membership.role, data.role)) {
    throw new ForbiddenError("You cannot grant a role higher than your own");
  }
  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (existingUser) {
      const already = await tx.businessMembership.findUnique({
        where: { businessId_userId: { businessId, userId: existingUser.id } },
        select: { id: true },
      });
      if (already) throw new ConflictError("This person is already a member");
    }
    return issueInvitation(tx, { businessId, email: data.email, role: data.role, invitedById: actorId });
  });
}

export async function revokeInvitation(actorId: string, businessId: string, invitationId: string) {
  await requirePermission(actorId, businessId, "invitations:manage");
  // Scoped by businessId: an invitation id from another business cannot be revoked here.
  const { count } = await prisma.invitation.updateMany({
    where: { id: invitationId, businessId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count !== 1) throw new NotFoundError("Invitation not found");
  await recordAudit(prisma, {
    action: "invitation.revoked",
    actorUserId: actorId,
    businessId,
    targetType: "Invitation",
    targetId: invitationId,
  });
}

export async function listPendingInvitations(actorId: string, businessId: string) {
  await requirePermission(actorId, businessId, "invitations:manage");
  return prisma.invitation.findMany({
    where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }, // never tokenHash
    orderBy: { createdAt: "desc" },
  });
}

/** For the accept page. Returns null for any unusable token (no distinguishing). */
export async function previewInvitation(rawToken: string) {
  const parsed = inviteTokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(parsed.data) },
    include: { business: { select: { name: true, status: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date() || inv.business.status !== "ACTIVE") {
    return null;
  }
  const account = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { businessName: inv.business.name, email: inv.email, role: inv.role, accountExists: !!account };
}

type AcceptInput = {
  token: string;
  /** Authenticated user accepting (must own the invited email), or null to register. */
  actorUserId: string | null;
  registration?: { name: string; password: string };
};

/**
 * Atomic, single-use acceptance. Everything happens in one transaction, so a
 * failure (expired, reused, wrong account, already a member…) leaves no user,
 * membership, or consumed invitation behind. The conditional UPDATE is the
 * single-use gate: concurrent accepts serialize on the row and only one wins.
 */
export async function acceptInvitation(input: AcceptInput) {
  const token = parseOrThrow(inviteTokenSchema, input.token);
  const registration = input.actorUserId ? null : parseOrThrow(registrationSchema, input.registration ?? {});
  const passwordHash = registration ? await hashPassword(registration.password) : null; // outside tx: slow

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const inv = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { business: { select: { status: true } } },
      });
      if (!inv) throw new InvalidInvitationError("not_found");
      if (inv.acceptedAt) throw new InvalidInvitationError("already_used");
      if (inv.revokedAt) throw new InvalidInvitationError("revoked");
      if (inv.expiresAt <= now) throw new InvalidInvitationError("expired");
      if (inv.business.status !== "ACTIVE") throw new InvalidInvitationError("business_inactive");

      let userId: string;
      let createdUser = false;
      if (input.actorUserId) {
        const user = await tx.user.findUnique({ where: { id: input.actorUserId } });
        if (!user || user.status !== "ACTIVE" || user.email !== inv.email) {
          throw new InvalidInvitationError("email_mismatch");
        }
        userId = user.id;
      } else {
        if (await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } })) {
          throw new ConflictError("An account with this email already exists. Log in, then open the link again.");
        }
        // email comes from the invitation, never from the client
        const user = await tx.user.create({
          data: { email: inv.email, name: registration!.name, passwordHash: passwordHash! },
        });
        userId = user.id;
        createdUser = true;
      }

      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now, acceptedById: userId },
      });
      if (claimed.count !== 1) throw new InvalidInvitationError("already_used");

      await tx.businessMembership.create({ data: { businessId: inv.businessId, userId, role: inv.role } });
      await recordAudit(tx, {
        action: "invitation.accepted",
        actorUserId: userId,
        businessId: inv.businessId,
        targetType: "Invitation",
        targetId: inv.id,
        metadata: { role: inv.role, createdUser },
      });
      return { userId, businessId: inv.businessId, role: inv.role, createdUser };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // user-email or membership uniqueness lost a race / already a member; transaction rolled back
      throw new ConflictError("Could not accept this invitation. You may already be a member.");
    }
    throw err;
  }
}

