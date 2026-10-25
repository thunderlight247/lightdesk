import { prisma } from "@/lib/db/client";
import { ForbiddenError, ValidationError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import { requireMembership } from "@/modules/permissions/access";

export type DeleteBusinessResult = {
  deleted: boolean;
  businessId: string;
  name: string;
};

/**
 * Permanently deletes a business workspace and cascades removal of all associated
 * tenant data (profile entries, catalogue items, FAQs, WhatsApp connections/messages,
 * pilot enrollments/caps, and memberships).
 *
 * Invariants:
 * 1. Actor must be an active member with role OWNER.
 * 2. Actor must confirm by typing the exact business name (case-sensitive check).
 * 3. Audit record is maintained before deletion (businessId setNull by FK constraint).
 */
export async function deleteBusiness(
  actorUserId: string,
  businessId: string,
  confirmationName: string,
): Promise<DeleteBusinessResult> {
  const membership = await requireMembership(actorUserId, businessId);

  if (membership.role !== "OWNER") {
    throw new ForbiddenError("Only business owners can permanently delete a business workspace.");
  }

  const business = membership.business;

  if (confirmationName.trim() !== business.name.trim()) {
    throw new ValidationError("Business name confirmation does not match.");
  }

  // Audit event before the business is cascade-deleted.
  // Note: AuditEvent.businessId has onDelete: SetNull, so the event persists for compliance.
  await recordAudit(prisma, {
    action: "business.deleted",
    actorUserId,
    businessId,
    targetType: "Business",
    targetId: businessId,
    metadata: {
      businessName: business.name,
      businessSlug: business.slug,
    },
  });

  // Clean up transient pending connection rows if any exist for this business
  await prisma.whatsAppPendingConnection.deleteMany({
    where: { businessId },
  });

  // Delete the business record (Prisma cascade onDelete removes profile, messages, memberships, etc.)
  await prisma.business.delete({
    where: { id: businessId },
  });

  return {
    deleted: true,
    businessId,
    name: business.name,
  };
}
