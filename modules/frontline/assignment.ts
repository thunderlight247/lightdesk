import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/modules/permissions/access";
import { NotFoundError, ValidationError } from "@/lib/security/errors";

export async function assignConversation(
  userId: string,
  businessId: string,
  conversationId: string,
  assignedToUserId: string | null,
) {
  await requirePermission(userId, businessId, "whatsapp:read");

  if (assignedToUserId) {
    const targetMember = await prisma.businessMembership.findUnique({
      where: {
        businessId_userId: {
          businessId,
          userId: assignedToUserId,
        },
      },
    });
    if (!targetMember) {
      throw new ValidationError("Target user is not a member of this workspace.");
    }
  }

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conversation) {
    throw new NotFoundError("Conversation not found.");
  }

  return prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: {
      assignedToId: assignedToUserId,
      assignedAt: assignedToUserId ? new Date() : null,
    },
    include: {
      assignedTo: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}
