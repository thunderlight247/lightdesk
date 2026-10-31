import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import { compareForm } from "@/modules/business-profile/text";
import {
  type CatalogueFilter,
  type CatalogueItemInput,
  CatalogueItemInputSchema,
  type PriceConflict,
} from "@/modules/catalogue/types";
import { requireMembership } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";

type Tx = Prisma.TransactionClient;

function assertCan(role: string, permission: string): void {
  if (!can(role, permission)) throw new ForbiddenError();
}

async function context(actorId: string, businessId: string, permission: string) {
  const membership = await requireMembership(actorId, businessId);
  assertCan(membership.role, permission);
  return membership;
}

async function loadProfile(db: Tx | typeof prisma, businessId: string) {
  const profile = await db.businessProfile.findUnique({ where: { businessId } });
  if (!profile) throw new NotFoundError("The business profile has not been created yet");
  return profile;
}

async function touchProfile(tx: Tx, profileId: string) {
  await tx.businessProfile.update({
    where: { id: profileId },
    data: { revision: { increment: 1 } },
  });
}

export async function listCatalogueItems(actorId: string, businessId: string, filter?: CatalogueFilter) {
  await context(actorId, businessId, "profile:read");
  const profile = await loadProfile(prisma, businessId);

  const where: Prisma.CatalogueItemWhereInput = {
    profileId: profile.id,
  };

  if (filter?.state) {
    where.state = filter.state;
  }
  if (filter?.inStock !== undefined) {
    where.inStock = filter.inStock;
  }
  if (filter?.category) {
    where.category = { equals: filter.category, mode: "insensitive" };
  }
  if (filter?.search) {
    const s = filter.search.trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { description: { contains: s, mode: "insensitive" } },
      { sku: { contains: s, mode: "insensitive" } },
    ];
  }

  return prisma.catalogueItem.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function getCatalogueItem(actorId: string, businessId: string, itemId: string) {
  await context(actorId, businessId, "profile:read");
  const profile = await loadProfile(prisma, businessId);

  const item = await prisma.catalogueItem.findFirst({
    where: { id: itemId, profileId: profile.id },
  });
  if (!item) throw new NotFoundError("Catalogue item not found");
  return item;
}

export async function saveCatalogueItem(
  actorId: string,
  businessId: string,
  rawInput: CatalogueItemInput,
  itemId?: string,
) {
  await context(actorId, businessId, "profile:edit");
  const profile = await loadProfile(prisma, businessId);

  const parsed = CatalogueItemInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(", "));
  }
  const input = parsed.data;
  const normalizedName = compareForm(input.name);

  // Check for potential duplicate by normalized name
  const existingWithSameName = await prisma.catalogueItem.findFirst({
    where: {
      profileId: profile.id,
      normalizedName,
      ...(itemId ? { NOT: { id: itemId } } : {}),
    },
  });

  const duplicateWarning = existingWithSameName
    ? `An item with a similar name ("${existingWithSameName.name}") already exists.`
    : null;

  return prisma.$transaction(async (tx) => {
    let item;
    if (itemId) {
      const existing = await tx.catalogueItem.findFirst({
        where: { id: itemId, profileId: profile.id },
      });
      if (!existing) throw new NotFoundError("Catalogue item not found");

      item = await tx.catalogueItem.update({
        where: { id: itemId },
        data: {
          name: input.name,
          description: input.description,
          category: input.category,
          priceGhs: input.priceGhs,
          currency: input.currency,
          inStock: input.inStock,
          variants: input.variants,
          sku: input.sku,
          normalizedName,
          state: "DRAFT",
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });

      await recordAudit(tx, {
        action: "catalogue.item_updated",
        actorUserId: actorId,
        businessId,
        targetType: "CatalogueItem",
        targetId: item.id,
        metadata: { name: item.name, price: Number(item.priceGhs), state: item.state },
      });
    } else {
      item = await tx.catalogueItem.create({
        data: {
          profileId: profile.id,
          name: input.name,
          description: input.description,
          category: input.category,
          priceGhs: input.priceGhs,
          currency: input.currency,
          inStock: input.inStock,
          variants: input.variants,
          sku: input.sku,
          normalizedName,
          state: "DRAFT",
          createdById: actorId,
          updatedById: actorId,
        },
      });

      await recordAudit(tx, {
        action: "catalogue.item_created",
        actorUserId: actorId,
        businessId,
        targetType: "CatalogueItem",
        targetId: item.id,
        metadata: { name: item.name, price: Number(item.priceGhs), state: item.state },
      });
    }

    await touchProfile(tx, profile.id);
    return { item, duplicateWarning };
  });
}

export async function approveCatalogueItem(actorId: string, businessId: string, itemId: string) {
  await context(actorId, businessId, "profile:approve");
  const profile = await loadProfile(prisma, businessId);

  return prisma.$transaction(async (tx) => {
    const item = await tx.catalogueItem.findFirst({
      where: { id: itemId, profileId: profile.id },
    });
    if (!item) throw new NotFoundError("Catalogue item not found");

    const approved = await tx.catalogueItem.update({
      where: { id: itemId },
      data: {
        approvedName: item.name,
        approvedDescription: item.description,
        approvedCategory: item.category,
        approvedPriceGhs: item.priceGhs,
        approvedInStock: item.inStock,
        approvedVariants: item.variants,
        approvedSku: item.sku,
        state: "APPROVED",
        revision: { increment: 1 },
        approvedById: actorId,
        approvedAt: new Date(),
        updatedById: actorId,
      },
    });

    await touchProfile(tx, profile.id);

    await recordAudit(tx, {
      action: "catalogue.item_approved",
      actorUserId: actorId,
      businessId,
      targetType: "CatalogueItem",
      targetId: item.id,
      metadata: { name: approved.approvedName ?? approved.name, price: Number(approved.approvedPriceGhs) },
    });

    return approved;
  });
}

export async function deleteCatalogueItem(actorId: string, businessId: string, itemId: string) {
  const membership = await context(actorId, businessId, "profile:edit");
  const profile = await loadProfile(prisma, businessId);

  return prisma.$transaction(async (tx) => {
    const item = await tx.catalogueItem.findFirst({
      where: { id: itemId, profileId: profile.id },
    });
    if (!item) throw new NotFoundError("Catalogue item not found");

    if (item.state === "APPROVED" && !can(membership.role, "profile:approve")) {
      throw new ForbiddenError("Only business owners can delete approved catalogue items");
    }

    await tx.catalogueItem.delete({
      where: { id: itemId },
    });

    await touchProfile(tx, profile.id);

    await recordAudit(tx, {
      action: "catalogue.item_deleted",
      actorUserId: actorId,
      businessId,
      targetType: "CatalogueItem",
      targetId: itemId,
      metadata: { name: item.name },
    });

    return { success: true };
  });
}

/**
 * Cross-checks approved catalogue items against active FAQ answers.
 * If an FAQ answer mentions a product name and quotes a price different from the catalogue,
 * records a conflict that requires owner attention.
 */
export async function detectPriceConflicts(actorId: string, businessId: string): Promise<PriceConflict[]> {
  await context(actorId, businessId, "profile:read");
  const profile = await prisma.businessProfile.findUnique({
    where: { businessId },
    include: {
      catalogueItems: {
        where: { state: "APPROVED" },
      },
      faqs: {
        where: { isActive: true },
      },
    },
  });

  if (!profile) throw new NotFoundError("The business profile has not been created yet");

  const conflicts: PriceConflict[] = [];

  for (const item of profile.catalogueItems) {
    if (!item.approvedPriceGhs || !item.approvedName) continue;
    const catPrice = Number(item.approvedPriceGhs);
    const prodWords = item.approvedName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    for (const faq of profile.faqs) {
      const answer = faq.approvedAnswer ?? faq.answer;
      const lowerAnswer = answer.toLowerCase();

      // Check if this FAQ mentions the product
      const mentionsProduct = prodWords.some((w) => lowerAnswer.includes(w));
      if (!mentionsProduct) continue;

      // Extract currency numbers (e.g. "GHS 500", "500 cedis", "500GHS", "GH₵ 500", or "$500")
      const matches = answer.matchAll(/(?:ghs|gh₵|cedis?|\$)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*(?:ghs|gh₵|cedis?)/gi);
      for (const m of matches) {
        const rawNum = (m[1] || m[2] || "").replace(/,/g, "");
        const num = parseFloat(rawNum);
        if (!isNaN(num) && num > 0 && Math.abs(num - catPrice) > 0.01) {
          conflicts.push({
            catalogueItemId: item.id,
            productName: item.approvedName,
            cataloguePriceGhs: catPrice,
            faqId: faq.id,
            faqQuestion: faq.approvedQuestion ?? faq.question,
            faqText: answer,
            extractedPrice: num,
          });
        }
      }
    }
  }

  return conflicts;
}

export async function toggleCatalogueItemStock(actorId: string, businessId: string, itemId: string) {
  const membership = await context(actorId, businessId, "profile:edit");
  const profile = await loadProfile(prisma, businessId);

  const existing = await prisma.catalogueItem.findFirst({
    where: { id: itemId, profileId: profile.id },
  });
  if (!existing) throw new NotFoundError("Catalogue item not found");

  const newStock = !existing.inStock;
  const isOwner = membership.role === "OWNER";

  return prisma.$transaction(async (tx) => {
    const updated = await tx.catalogueItem.update({
      where: { id: itemId },
      data: {
        inStock: newStock,
        updatedById: actorId,
        revision: { increment: 1 },
        ...(isOwner ? { approvedInStock: newStock } : {}),
      },
    });

    await touchProfile(tx, profile.id);

    await recordAudit(tx, {
      businessId,
      actorUserId: actorId,
      action: "catalogue_item.stock_toggled",
      metadata: { itemId, inStock: newStock, approvedInStock: isOwner ? newStock : existing.approvedInStock },
    });

    return updated;
  });
}

