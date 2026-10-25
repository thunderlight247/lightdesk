import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resetDb, twoTenants } from "../helpers/db";
import { getWhatsAppConversation, listWhatsAppConversations } from "@/modules/whatsapp/service";

beforeAll(async () => {
  await resetDb();
});
afterEach(async () => {
  await resetDb();
});

async function seed() {
  const { ownerA, adminA, memberA, ownerB, bizA, bizB } = await twoTenants();
  const connection = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id,
      wabaId: "WABA-CONSOLE",
      phoneNumberId: "PN-CONSOLE",
      displayPhoneNumber: "+233540000000",
      tokenCiphertext: "never-selected-by-console-query",
    },
  });
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      connectionId: connection.id,
      businessId: bizA.id,
      customerPhone: "233540111222",
      customerName: "Ama",
    },
  });
  await prisma.whatsAppMessage.create({
    data: {
      connectionId: connection.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      wamid: "wamid.CONSOLE1",
      text: "Do you have the phone in stock?",
      type: "text",
      status: "RECEIVED",
      timestampSent: new Date(),
    },
  });
  return { ownerA, adminA, memberA, ownerB, bizA, bizB, conversation };
}

describe("WhatsApp owner-console reads", () => {
  it("allows OWNER, ADMIN, and MEMBER to read only their own business conversations", async () => {
    const { ownerA, adminA, memberA, ownerB, bizA, bizB, conversation } = await seed();
    for (const user of [ownerA, adminA, memberA]) {
      const list = await listWhatsAppConversations(user.id, bizA.id);
      expect(list.connection?.displayPhoneNumber).toBe("+233540000000");
      expect(list.conversations).toHaveLength(1);
      expect(list.conversations[0]).toMatchObject({
        id: conversation.id,
        customerName: "Ama",
        customerPhone: "233540111222",
        lastMessagePreview: "Do you have the phone in stock?",
        messageCount: 1,
      });
      const detail = await getWhatsAppConversation(user.id, bizA.id, conversation.id);
      expect(detail.conversation.messages).toHaveLength(1);
      expect(detail.readiness.windowOpen).toBe(true);
    }
    await expect(listWhatsAppConversations(ownerB.id, bizA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const bizBList = await listWhatsAppConversations(ownerB.id, bizB.id);
    expect(bizBList).toEqual({ connection: null, conversations: [], queuedCount: 0, providerDegraded: null });
  });

  it("does not return the encrypted connection token in console results", async () => {
    const { ownerA, bizA, conversation } = await seed();
    const list = await listWhatsAppConversations(ownerA.id, bizA.id);
    const detail = await getWhatsAppConversation(ownerA.id, bizA.id, conversation.id);
    expect(JSON.stringify({ list, detail })).not.toContain("never-selected-by-console-query");
  });

  it("does not allow a non-member to load a guessed conversation ID", async () => {
    const { ownerB, bizB, conversation } = await seed();
    await expect(getWhatsAppConversation(ownerB.id, bizB.id, conversation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
