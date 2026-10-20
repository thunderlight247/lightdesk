import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { stageBulkImport } from "@/modules/catalogue/import";
import {
  approveCatalogueItem,
  deleteCatalogueItem,
  detectPriceConflicts,
  getCatalogueItem,
  listCatalogueItems,
  saveCatalogueItem,
} from "@/modules/catalogue/service";
import { resetDb, twoTenants } from "../helpers/db";

describe("Catalogue management service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup() {
    const t = await twoTenants();
    const profileA = await prisma.businessProfile.create({
      data: { businessId: t.bizA.id, createdById: t.ownerA.id, status: "ACTIVE", activatedAt: new Date() },
    });
    const profileB = await prisma.businessProfile.create({
      data: { businessId: t.bizB.id, createdById: t.ownerB.id, status: "ACTIVE", activatedAt: new Date() },
    });
    return { ...t, profileA, profileB };
  }

  it("enforces tenant isolation: users from business B cannot view or modify items in business A", async () => {
    const { ownerA, ownerB, bizA, bizB } = await setup();

    const { item } = await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "Sneakers",
      priceGhs: 300,
      inStock: true,
      currency: "GHS",
    });

    // Owner B cannot get or edit item in Biz A
    await expect(getCatalogueItem(ownerB.id, bizB.id, item.id)).rejects.toThrow(NotFoundError);
    await expect(saveCatalogueItem(ownerB.id, bizB.id, { name: "Hack", priceGhs: 10, inStock: true, currency: "GHS" }, item.id)).rejects.toThrow(NotFoundError);
    await expect(approveCatalogueItem(ownerB.id, bizB.id, item.id)).rejects.toThrow(NotFoundError);
    await expect(deleteCatalogueItem(ownerB.id, bizB.id, item.id)).rejects.toThrow(NotFoundError);
  });

  it("enforces role permissions: admins can draft, only owners can approve", async () => {
    const { ownerA, adminA, memberA, bizA } = await setup();

    // Member cannot save items
    await expect(
      saveCatalogueItem(memberA.id, bizA.id, { name: "Bag", priceGhs: 150, inStock: true, currency: "GHS" }),
    ).rejects.toThrow(ForbiddenError);

    // Admin can create a draft item
    const { item } = await saveCatalogueItem(adminA.id, bizA.id, {
      name: "Leather Bag",
      priceGhs: 150,
      inStock: true,
      currency: "GHS",
    });
    expect(item.state).toBe("DRAFT");
    expect(item.approvedPriceGhs).toBeNull();

    // Admin cannot approve
    await expect(approveCatalogueItem(adminA.id, bizA.id, item.id)).rejects.toThrow(ForbiddenError);

    // Owner can approve
    const approved = await approveCatalogueItem(ownerA.id, bizA.id, item.id);
    expect(approved.state).toBe("APPROVED");
    expect(approved.approvedName).toBe("Leather Bag");
    expect(Number(approved.approvedPriceGhs)).toBe(150);
    expect(approved.approvedById).toBe(ownerA.id);
  });

  it("warns when saving an item with a duplicate normalized name", async () => {
    const { ownerA, bizA } = await setup();

    await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "Men Casual Shoe",
      priceGhs: 250,
      inStock: true,
      currency: "GHS",
    });

    const res = await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "  men   casual   shoe  ",
      priceGhs: 260,
      inStock: true,
      currency: "GHS",
    });

    expect(res.duplicateWarning).toContain('An item with a similar name ("Men Casual Shoe") already exists');
  });

  it("stages bulk imports into DRAFT state and reports duplicates", async () => {
    const { ownerA, bizA } = await setup();

    // First create an existing item
    await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "Watch",
      priceGhs: 500,
      inStock: true,
      currency: "GHS",
    });

    const csv = `name,price,category,inStock,variants
"Watch",550,Accessories,true,"Gold"
"Sunglasses",120,Accessories,true,"UV400"
"Bad Item",-10,Accessories,true,""`;

    const summary = await stageBulkImport(ownerA.id, bizA.id, csv);
    expect(summary.stagedCount).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.duplicateWarnings).toHaveLength(1);
    expect(summary.duplicateWarnings[0].name).toBe("Watch");

    const items = await listCatalogueItems(ownerA.id, bizA.id);
    expect(items.length).toBe(3); // 1 original + 2 successfully staged
    expect(items.every((i) => i.state === "DRAFT")).toBe(true);
  });

  it("detects price conflicts between approved catalogue items and FAQs", async () => {
    const { ownerA, bizA, profileA } = await setup();

    // Create and approve catalogue item
    const { item } = await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "PlayStation 5",
      priceGhs: 8500,
      inStock: true,
      currency: "GHS",
    });
    await approveCatalogueItem(ownerA.id, bizA.id, item.id);

    // Create FAQ with conflicting price (e.g. 7,000 GHS)
    await prisma.faqEntry.create({
      data: {
        profileId: profileA.id,
        question: "How much is the PlayStation 5 console?",
        answer: "The PlayStation 5 is currently available for GHS 7,000 with one controller.",
        normalizedQuestion: "how much is the playstation 5 console",
        isActive: true,
        state: "APPROVED",
        approvedQuestion: "How much is the PlayStation 5 console?",
        approvedAnswer: "The PlayStation 5 is currently available for GHS 7,000 with one controller.",
        createdById: ownerA.id,
        updatedById: ownerA.id,
        approvedById: ownerA.id,
        approvedAt: new Date(),
      },
    });

    const conflicts = await detectPriceConflicts(ownerA.id, bizA.id);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].productName).toBe("PlayStation 5");
    expect(conflicts[0].cataloguePriceGhs).toBe(8500);
    expect(conflicts[0].extractedPrice).toBe(7000);
  });
});
