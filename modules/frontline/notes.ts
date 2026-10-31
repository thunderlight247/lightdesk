import { prisma } from "@/lib/db/client";
import { requireMembership, requirePermission } from "@/modules/permissions/access";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";

export async function listConversationNotes(
  userId: string,
  businessId: string,
  conversationId: string,
) {
  await requireMembership(userId, businessId);

  return prisma.conversationNote.findMany({
    where: { businessId, conversationId },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createConversationNote(
  userId: string,
  businessId: string,
  input: {
    conversationId: string;
    conversationType?: "whatsapp" | "lab";
    content: string;
  },
) {
  await requirePermission(userId, businessId, "whatsapp:read");

  const trimmed = input.content.trim();
  if (!trimmed || trimmed.length > 1000) {
    throw new ValidationError("Note content must be between 1 and 1000 characters.");
  }

  return prisma.conversationNote.create({
    data: {
      businessId,
      conversationId: input.conversationId,
      conversationType: input.conversationType ?? "whatsapp",
      content: trimmed,
      authorId: userId,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

export async function deleteConversationNote(
  userId: string,
  businessId: string,
  noteId: string,
) {
  const membership = await requireMembership(userId, businessId);
  const note = await prisma.conversationNote.findFirst({
    where: { id: noteId, businessId },
  });

  if (!note) {
    throw new NotFoundError("Note not found.");
  }

  // Only the note author or an OWNER/ADMIN can delete the note
  if (note.authorId !== userId && membership.role === "MEMBER") {
    throw new ForbiddenError("You can only delete your own notes.");
  }

  return prisma.conversationNote.delete({
    where: { id: noteId },
  });
}
