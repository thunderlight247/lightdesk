import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetDb, twoTenants } from "../helpers/db";
import { prisma } from "@/lib/db/client";
import { getSendReadiness, sendOwnerReply } from "@/modules/whatsapp/service";
import { encryptSecret } from "@/lib/security/secret-box";

// The send path decrypts WhatsAppConnection.tokenCiphertext: use the real key format while isolated.
const KEY = Buffer.alloc(32, 9);
const savedEnvKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
const KEY_HEX = KEY.toString("hex");
beforeAll(async () => {
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = KEY_HEX;
  // Other test files truncate in beforeEach, so rows may survive into this file. Clean first.
  await resetDb();
});
afterAll(() => {
  if (savedEnvKey === undefined) delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  else process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = savedEnvKey;
});

async function seed(opts: { role?: "ADMIN" | "MEMBER" | "OWNER" } = {}) {
  const { ownerA, adminA, memberA, bizA } = await twoTenants();
  const role = opts.role ?? "OWNER";
  const actor = role === "OWNER" ? ownerA : role === "ADMIN" ? adminA : memberA;
  // Stable connection + conversation for bizA (m4 seed tenants are ignored).
  const connection = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id, wabaId: "WABA1", phoneNumberId: "PN-SENDTEST",
      displayPhoneNumber: "+233540000000", tokenCiphertext: encryptSecret("live-token", KEY),
    },
  });
  return { bizA, actor, ownerA, adminA, memberA, connection };
}

async function seedConversationWithInbound(bizId: string, opts: { inboundAgeMs?: number } = {}) {
  const conv = await prisma.whatsAppConversation.create({
    data: { connectionId: (await prisma.whatsAppConnection.findFirstOrThrow({ where: { businessId: bizId } })).id, businessId: bizId, customerPhone: "233540111222", customerName: "Ama" },
  });
  const sentAt = new Date(Date.now() - (opts.inboundAgeMs ?? 0));
  const inbound = await prisma.whatsAppMessage.create({
    data: { conversationId: conv.id, connectionId: conv.connectionId, direction: "INBOUND", wamid: `wamid.IN-${conv.id}`, text: "Is the iPhone 13 in stock?", type: "text", status: "RECEIVED", timestampSent: sentAt },
  });
  return { conv, inbound };
}

const okFetch = (async () =>
  new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [], messages: [{ id: "wamid.OUT1" }] }), { status: 200 })) as typeof fetch;

afterEach(async () => {
  await resetDb();
});

describe("getSendReadiness", () => {
  it("reports window open inside 24h and the free meter", async () => {
    const { bizA, actor } = await seed();
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    const r = await getSendReadiness(actor.id, bizA.id, conv.id);
    expect(r.windowOpen).toBe(true);
    expect(r.mode).toBe("OWNER_ONLY");
    expect(r.meterUsed).toBe(0);
    expect(r.meterFree).toBe(1000);
    // The window closes 24h after the LAST inbound, which was seeded 60s ago.
    expect(r.windowClosesAt?.getTime()).toBeCloseTo(Date.now() - 60_000 + 24 * 3_600_000, -4);
  });

  it("reports the window closed after 24h and with no inbound at all", async () => {
    const { bizA, actor } = await seed();
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 25 * 3_600_000 });
    expect((await getSendReadiness(actor.id, bizA.id, conv.id)).windowOpen).toBe(false);
    const conv2 = await prisma.whatsAppConversation.create({
      data: { connectionId: (await prisma.whatsAppConnection.findFirstOrThrow({ where: { businessId: bizA.id } })).id, businessId: bizA.id, customerPhone: "233540999111" },
    });
    expect((await getSendReadiness(actor.id, bizA.id, conv2.id)).windowOpen).toBe(false);
  });

  it("404s for another business's conversation id and hides tenant existence", async () => {
    const { bizA, actor } = await seed();
    const { conv } = await seedConversationWithInbound(bizA.id);
    const bizB = await prisma.business.findFirstOrThrow({ where: { name: "Biz B" } });
    await expect(getSendReadiness(actor.id, bizB.id, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getSendReadiness("not-a-member", bizB.id, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("sendOwnerReply", () => {
  it("sends inside the window with the right role, records the message and audits", async () => {
    const { bizA, actor } = await seed({ role: "OWNER" });
    const { conv, inbound } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    const out = await sendOwnerReply(actor.id, bizA.id, conv.id, { text: "Yes! The iPhone 13 is in stock." }, { fetchImpl: okFetch });
    expect(out).toMatchObject({ sent: true, wamid: "wamid.OUT1", meterUsed: 1, meterFree: 999 });
    const row = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { wamid: "wamid.OUT1" } });
    expect(row).toMatchObject({ direction: "OUTBOUND", status: "SENT", type: "text", conversationId: conv.id });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.message.sent", businessId: bizA.id } });
    expect(audit.actorUserId).toBe(actor.id);
    expect(audit.metadata).toMatchObject({ meterUsed: 1 });
    // reply context kept coherent with the last inbound
    expect(inbound.wamid).toContain("wamid.IN-");
  });

  it("MEMBERs may not send; ADMINs may", async () => {
    const { bizA, memberA, adminA } = await seed({ role: "OWNER" });
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    await expect(sendOwnerReply(memberA.id, bizA.id, conv.id, { text: "hi" }, { fetchImpl: okFetch })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    // admin allowed
    const out = await sendOwnerReply(adminA.id, bizA.id, conv.id, { text: "Yes, in stock!" }, { fetchImpl: okFetch });
    expect(out.sent).toBe(true);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.message.sent" } });
    expect(audit.actorUserId).toBe(adminA.id);
  });

  it("refuses outside the 24h window with the honest reason and no Graph call", async () => {
    const { bizA, actor } = await seed({ role: "OWNER" });
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 25 * 3_600_000 });
    let called = false;
    const spyFetch = (async () => { called = true; return new Response("{}", { status: 200 }); }) as typeof fetch;
    const out = await sendOwnerReply(actor.id, bizA.id, conv.id, { text: "hi" }, { fetchImpl: spyFetch });
    expect(out.sent).toBe(false);
    if (!out.sent) {
      expect(out.reason).toContain("24-hour");
      expect(out.reason).toContain("window");
    }
    expect(called).toBe(false);
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("never sends when the stored token cannot be decrypted; writes a failure audit", async () => {
    const { bizA, actor } = await seed({ role: "OWNER" });
    await prisma.whatsAppConnection.update({ where: { phoneNumberId: "PN-SENDTEST" }, data: { tokenCiphertext: "tampered-garbage" } });
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    await expect(sendOwnerReply(actor.id, bizA.id, conv.id, { text: "hi" }, { fetchImpl: okFetch })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.failed" } })).toBe(1);
  });

  it("surfaces Graph send failures with a safe reason and no message row", async () => {
    const { bizA, actor } = await seed({ role: "OWNER" });
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    const failFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "(#131047) Re-engagement message is required", type: "OAuthException", code: 131047 } }), { status: 400 })) as typeof fetch;
    const out = await sendOwnerReply(actor.id, bizA.id, conv.id, { text: "hi" }, { fetchImpl: failFetch });
    expect(out.sent).toBe(false);
    if (!out.sent) expect(out.reason).toContain("Re-engagement");
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.failed" } })).toBe(1);
  });

  it("updates the meter across sends in the same month", async () => {
    const { bizA, actor } = await seed({ role: "OWNER" });
    const { conv } = await seedConversationWithInbound(bizA.id, { inboundAgeMs: 60_000 });
    const bodies = ["one", "two"];
    let n = 0;
    const multiFetch = (async () =>
      new Response(JSON.stringify({ messages: [{ id: `wamid.OUTN${++n}` }] }), { status: 200 })) as typeof fetch;
    for (const text of bodies) {
      const out = await sendOwnerReply(actor.id, bizA.id, conv.id, { text }, { fetchImpl: multiFetch });
      expect(out.sent).toBe(true);
    }
    const r = await getSendReadiness(actor.id, bizA.id, conv.id);
    expect(r.meterUsed).toBe(2);
    expect(r.meterFree).toBe(998);
  });
});
