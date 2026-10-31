import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { createConversationNote, deleteConversationNote, listConversationNotes } from "@/modules/frontline/notes";
import { createOrderLead, listOrderLeads, updateOrderLeadStatus } from "@/modules/frontline/orders";
import { createQuickReply, deleteQuickReply, listQuickReplies } from "@/modules/frontline/quick-replies";
import { assignConversation } from "@/modules/frontline/assignment";
import { toggleCatalogueItemStock, saveCatalogueItem, approveCatalogueItem } from "@/modules/catalogue/service";
import { resetDb, twoTenants } from "../helpers/db";

describe("Frontline CRM, Notes, and Quick Replies Service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup() {
    const t = await twoTenants();
    // Create WhatsApp connection & conversation for bizA
    const connA = await prisma.whatsAppConnection.create({
      data: {
        businessId: t.bizA.id,
        phoneNumberId: "phone_123",
        wabaId: "waba_123",
        displayPhoneNumber: "+233240000001",
        tokenCiphertext: "enc_token",
        status: "CONNECTED",
      },
    });

    const convA = await prisma.whatsAppConversation.create({
      data: {
        businessId: t.bizA.id,
        connectionId: connA.id,
        customerPhone: "+233244999999",
        customerName: "Kofi Mensah",
        mode: "OWNER_ONLY",
      },
    });

    return { ...t, connA, convA };
  }

  it("handles conversation internal notes with tenant and author boundaries", async () => {
    const { ownerA, memberA, ownerB, bizA, bizB, convA } = await setup();

    // Owner A adds a note
    const note = await createConversationNote(ownerA.id, bizA.id, {
      conversationId: convA.id,
      content: "Customer asked for delivery to Spintex Road.",
    });
    expect(note.content).toBe("Customer asked for delivery to Spintex Road.");

    // Member A can read notes in bizA
    const notes = await listConversationNotes(memberA.id, bizA.id, convA.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].author.name).toBe(ownerA.name);

    // User in Biz B cannot access notes in Biz A
    await expect(listConversationNotes(ownerB.id, bizB.id, convA.id)).resolves.toEqual([]);

    // Member A cannot delete Owner A's note
    await expect(deleteConversationNote(memberA.id, bizA.id, note.id)).rejects.toThrow(ForbiddenError);

    // Owner A can delete their note
    await deleteConversationNote(ownerA.id, bizA.id, note.id);
    const notesAfter = await listConversationNotes(ownerA.id, bizA.id, convA.id);
    expect(notesAfter).toHaveLength(0);
  });

  it("handles quick replies with shortcut uniqueness and tenancy", async () => {
    const { ownerA, ownerB, bizA, bizB } = await setup();

    const qr1 = await createQuickReply(ownerA.id, bizA.id, {
      shortcut: "/delivery",
      title: "Delivery details",
      content: "Deliveries within Accra cost GHS 30.",
      category: "Logistics",
    });
    expect(qr1.shortcut).toBe("/delivery");

    // Updating existing shortcut replaces content
    const qrUpdated = await createQuickReply(ownerA.id, bizA.id, {
      shortcut: "/delivery",
      title: "Updated Delivery",
      content: "Deliveries within Accra cost GHS 35.",
    });
    expect(qrUpdated.content).toBe("Deliveries within Accra cost GHS 35.");

    // List quick replies
    const list = await listQuickReplies(ownerA.id, bizA.id);
    expect(list).toHaveLength(1);

    // Biz B does not see Biz A's quick replies
    const listB = await listQuickReplies(ownerB.id, bizB.id);
    expect(listB).toHaveLength(0);

    // Owner B cannot delete Biz A's quick reply
    await expect(deleteQuickReply(ownerB.id, bizB.id, qr1.id)).rejects.toThrow(NotFoundError);

    // Owner A can delete it
    await deleteQuickReply(ownerA.id, bizA.id, qr1.id);
    const listAfter = await listQuickReplies(ownerA.id, bizA.id);
    expect(listAfter).toHaveLength(0);
  });

  it("captures and updates frontline orders / leads", async () => {
    const { ownerA, bizA, convA } = await setup();

    const order = await createOrderLead(ownerA.id, bizA.id, {
      conversationId: convA.id,
      customerName: "Kofi Mensah",
      customerPhone: "+233244999999",
      items: [{ name: "Shea Body Butter", quantity: 2, priceGhs: 60 }],
      totalGhs: 120,
      deliveryAddress: "Spintex, near Shell",
      status: "PENDING",
      paymentStatus: "UNPAID",
    });

    expect(Number(order.totalGhs)).toBe(120);
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("UNPAID");

    // Update status to CONFIRMED and MOMO_VERIFIED
    const updated = await updateOrderLeadStatus(ownerA.id, bizA.id, order.id, {
      status: "CONFIRMED",
      paymentStatus: "MOMO_VERIFIED",
      receiptRef: "TXN12345678",
    });

    expect(updated.status).toBe("CONFIRMED");
    expect(updated.paymentStatus).toBe("MOMO_VERIFIED");
    expect(updated.receiptRef).toBe("TXN12345678");

    // List orders for this conversation
    const ordersList = await listOrderLeads(ownerA.id, bizA.id, { conversationId: convA.id });
    expect(ordersList).toHaveLength(1);
    expect(ordersList[0].receiptRef).toBe("TXN12345678");
  });

  it("assigns conversations to workspace members", async () => {
    const { ownerA, memberA, bizA, convA } = await setup();

    // Assign conversation to member A
    const assigned = await assignConversation(ownerA.id, bizA.id, convA.id, memberA.id);
    expect(assigned.assignedToId).toBe(memberA.id);
    expect(assigned.assignedTo?.email).toBe(memberA.email);

    // Unassign conversation
    const unassigned = await assignConversation(ownerA.id, bizA.id, convA.id, null);
    expect(unassigned.assignedToId).toBeNull();
  });

  it("toggles catalogue item stock with instant mobile toggle", async () => {
    const { ownerA, bizA } = await setup();

    await prisma.businessProfile.create({
      data: { businessId: bizA.id, createdById: ownerA.id, status: "ACTIVE", activatedAt: new Date() },
    });

    const { item } = await saveCatalogueItem(ownerA.id, bizA.id, {
      name: "Organic Shea Butter",
      priceGhs: 80,
      inStock: true,
      currency: "GHS",
    });
    await approveCatalogueItem(ownerA.id, bizA.id, item.id);

    // Toggle out of stock
    const toggledOff = await toggleCatalogueItemStock(ownerA.id, bizA.id, item.id, false);
    expect(toggledOff.inStock).toBe(false);

    // Toggle in stock
    const toggledOn = await toggleCatalogueItemStock(ownerA.id, bizA.id, item.id, true);
    expect(toggledOn.inStock).toBe(true);
  });
});
