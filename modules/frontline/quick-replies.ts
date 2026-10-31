import { prisma } from "@/lib/db/client";
import { requireMembership, requirePermission } from "@/modules/permissions/access";
import { NotFoundError, ValidationError } from "@/lib/security/errors";

export async function listQuickReplies(userId: string, businessId: string) {
  await requireMembership(userId, businessId);

  return prisma.quickReply.findMany({
    where: { businessId },
    orderBy: [{ category: "asc" }, { shortcut: "asc" }],
  });
}

export async function createQuickReply(
  userId: string,
  businessId: string,
  input: {
    shortcut: string;
    title: string;
    content: string;
    category?: string;
  },
) {
  await requirePermission(userId, businessId, "whatsapp:read");

  const shortcut = input.shortcut.trim().toLowerCase();
  if (!shortcut.startsWith("/") || shortcut.length < 2 || shortcut.length > 40) {
    throw new ValidationError(
      "Shortcut must start with '/' (e.g. /delivery, /momo) and be between 2 and 40 characters.",
    );
  }

  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || title.length > 100) {
    throw new ValidationError("Title is required and must be under 100 characters.");
  }
  if (!content || content.length > 1000) {
    throw new ValidationError("Content is required and must be under 1000 characters.");
  }

  return prisma.quickReply.upsert({
    where: {
      businessId_shortcut: {
        businessId,
        shortcut,
      },
    },
    update: {
      title,
      content,
      category: input.category?.trim() || null,
    },
    create: {
      businessId,
      shortcut,
      title,
      content,
      category: input.category?.trim() || null,
      createdById: userId,
    },
  });
}

export async function deleteQuickReply(userId: string, businessId: string, id: string) {
  await requirePermission(userId, businessId, "whatsapp:read");

  const existing = await prisma.quickReply.findFirst({
    where: { id, businessId },
  });
  if (!existing) {
    throw new NotFoundError("Quick reply not found.");
  }

  return prisma.quickReply.delete({
    where: { id },
  });
}
