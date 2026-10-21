import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WhatsAppMessageStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { resetDb, twoTenants } from "../helpers/db";
import { MockProvider, buildActiveProfile, groundedAnswer, lastRequestJson, testConfig } from "../helpers/lab";
import { POST } from "@/app/api/whatsapp/webhook/route";
import { runInboundAssist, pendingInboundForAssist } from "@/modules/whatsapp/assist";
import { sendOwnerReply, setConversationMode } from "@/modules/whatsapp/service";
import { encryptSecret } from "@/lib/security/secret-box";

// Webhook route configuration comes from process.env; set and restore it per test.
const ENV_KEYS = ["WHATSAPP_APP_SECRET", "WHATSAPP_TOKEN_ENCRYPTION_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // The send-gate test decrypts the stored connection token: use the real key format while isolated.
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});const APP_SECRET = "test-app-secret";

async function seed(overrides: Partial<{ mode: "OWNER_ONLY" | "AI_ASSIST" }> = {}) {
  const { ownerA, adminA, memberA, bizA } = await twoTenants();
  await buildActiveProfile(ownerA.id, bizA.id);
  const connection = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id, wabaId: "WABA1", phoneNumberId: "PN-AST",
      displayPhoneNumber: "+233540000000", coexistence: true, status: "CONNECTED",
      tokenCiphertext: encryptSecret("live-token", Buffer.alloc(32, 9)),
    },
  });
  const conversation = await prisma.whatsAppConversation.create({
    data: { connectionId: connection.id, businessId: bizA.id, customerPhone: "233540111222", customerName: "Ama", mode: overrides.mode ?? "AI_ASSIST" },
  });
  return { ownerA, adminA, memberA, bizA, connection, conversation };
}

async function seedInbound(conversationId: string, connectionId: string, wamid: string, text: string) {
  const row = await prisma.whatsAppMessage.create({
    data: { conversationId, connectionId, direction: "INBOUND", wamid, text, type: "text", status: "RECEIVED", timestampSent: new Date() },
  });
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  return row;
}

const draftRows = (conversationId: string) =>
  prisma.whatsAppMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

function signedPost(body: string) {
  const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
  return new Request("http://x/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body,
  });
}

const webhookBody = (wamid: string, text: string) => JSON.stringify({
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN-AST" },
    contacts: [{ profile: { name: "Ama" } }],
    messages: [{ id: wamid, from: "233540111222", type: "text", text: { body: text }, timestamp: "1729400000" }],
  } }] }],
});

beforeEach(async () => {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  await resetDb();
});
afterEach(async () => {
  await resetDb();
});

describe("M6c AI-assist drafting (owner control preserved)", () => {
  it("never drafts anything for a brand-new OWNER_ONLY conversation (the safe default)", async () => {
    const { bizA, connection, conversation } = await seed({ mode: "OWNER_ONLY" });
    await seedInbound(conversation.id, connection.id, "wamid.OO1", "Do you deliver to Kumasi?");
    const provider = new MockProvider(() => "must not be called");
    const outcome = await runInboundAssist(
      { businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.OO1", text: "Do you deliver to Kumasi?" },
      { provider },
    );
    expect(outcome).toMatchObject({ produced: false, reason: "not_ai_assist" });
    expect(provider.calls).toHaveLength(0);
    expect(await prisma.whatsAppGeneration.count()).toBe(0);
    expect(await prisma.whatsAppMessage.count({ where: { status: "DRAFT" } })).toBe(0);
  });

  it("produces a DRAFT (never a send) for an AI_ASSIST conversation through the webhook", async () => {
    const { bizA, conversation } = await seed();
    // A price question must take the deterministic RULES path (no approved pricing on record),
    // so this test exercises the webhook without touching a real AI provider.
    const res = await POST(signedPost(webhookBody("wamid.AST1", "How much for the iPhone 13?")));
    expect(res.status).toBe(200);

    const draft = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conversation.id } });
    expect(draft).toMatchObject({
      direction: "OUTBOUND", status: "DRAFT", draftState: "DRAFT", type: "text", wamid: null,
      resultStatus: "NEEDS_INFORMATION", // no approved price/stock info on record: safe holding reply
    });
    expect(draft.source).toBe("RULES");
    expect(draft.text).toContain("business owner");
    // The drafting attempt is audited; the draft production is visible with its metadata.
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, status: { in: ["SENT", "DELIVERED", "READ"] as WhatsAppMessageStatus[] } } })).toBe(0);
    const generation = await prisma.whatsAppGeneration.findFirstOrThrow({ where: { conversationId: conversation.id } });
    expect(generation).toMatchObject({ status: "SUCCEEDED", usedAi: false, businessId: bizA.id });
    // The drafting attempt is audited with its draft metadata.
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.draft.generated", businessId: bizA.id } })).toBe(1);
  });

  it("grounds an AI draft in the approved snapshot, records usage, and feeds only REAL replies into history", async () => {
    const { bizA, connection, conversation } = await seed();
    // A sent reply originally from the owner app (coexistence) — legit history.
    await seedInbound(conversation.id, connection.id, "wamid.AST-H1", "Do you sell used phones?");
    await prisma.whatsAppMessage.create({
      data: { conversationId: conversation.id, connectionId: connection.id, direction: "OUTBOUND", wamid: "wamid.SENTH", text: "No, we sell new phones only.", type: "text", status: "SENT", fromOwnerApp: true },
    });
    // A stale draft row must NOT be fed to the model and must become SUPERSEDED.
    await prisma.whatsAppMessage.create({
      data: { conversationId: conversation.id, connectionId: connection.id, direction: "OUTBOUND", wamid: null, text: "stale draft", type: "text", status: "DRAFT", draftState: "DRAFT", source: "RULES", resultStatus: "NEEDS_INFORMATION" },
    });

    const provider = new MockProvider(groundedAnswer("used phones", "No, we sell new phones only."));
    await seedInbound(conversation.id, connection.id, "wamid.AST2", "And do you sell used phones?");
    const outcome = await runInboundAssist(
      { businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST2", text: "And do you sell used phones?" },
      { provider },
    );
    expect(outcome).toMatchObject({ produced: true, status: "answerable", usedAi: true, escalated: false });
    expect(provider.calls).toHaveLength(1);
    const parsed = lastRequestJson(provider);
    // The current message travels separately (customerMessage); history holds earlier turns.
    expect(parsed.conversation).toEqual([
      { from: "customer", text: "Do you sell used phones?" },
      { from: "assistant", text: "No, we sell new phones only." },
    ]);
    expect(parsed.customerMessage).toBe("And do you sell used phones?");

    const drafts = await draftRows(conversation.id);
    expect(drafts.filter((d) => d.draftState)).toHaveLength(2);
    expect(drafts.find((d) => d.draftState === "SUPERSEDED")?.text).toBe("stale draft");
    const fresh = drafts.find((d) => d.draftState === "DRAFT");
    expect(fresh).toMatchObject({ source: "AI", resultStatus: "ANSWERABLE", wamid: null });
    const generation = await prisma.whatsAppGeneration.findFirstOrThrow({ where: { conversationId: conversation.id, idempotencyKey: "wamid.AST2" } });
    expect(generation.usedAi).toBe(true);
    expect(generation.totalTokens).not.toBeNull();
    // Still nothing sent.
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, wamid: { not: null }, direction: "OUTBOUND" } })).toBe(1);
  });

  it("escalates a payment claim via the deterministic pre-check: provider NOT called, never auto-sent", async () => {
    const { bizA, connection, conversation } = await seed();
    await seedInbound(conversation.id, connection.id, "wamid.AST-P1", "I have already paid, please confirm and dispatch my order");
    const provider = new MockProvider(() => "the AI must never see this");
    const outcome = await runInboundAssist(
      { businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-P1", text: "I have already paid, please confirm and dispatch my order" },
      { provider },
    );
    expect(provider.calls).toHaveLength(0); // zero tokens, zero AI exposure
    expect(outcome).toMatchObject({ produced: true, status: "escalation_required", usedAi: false, escalated: true });

    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv.status).toBe("ESCALATED"); // escalation banner in the inbox
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, status: "SENT" } })).toBe(0); // NEVER auto-sent
    const draft = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conversation.id, draftState: "DRAFT" } });
    expect(draft).toMatchObject({ source: "RULES", resultStatus: "ESCALATION_REQUIRED" });
  });

  it("is idempotent per wamid: a webhook retry never produces a second draft or a second AI call", async () => {
    const { bizA, connection, conversation } = await seed();
    const provider = new MockProvider(groundedAnswer("delivery", "We deliver within Kumasi."));
    await seedInbound(conversation.id, connection.id, "wamid.AST-D1", "Do you deliver?");
    const first = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-D1", text: "Do you deliver?" }, { provider });
    expect(first.produced).toBe(true);
    const again = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-D1", text: "Do you deliver?" }, { provider });
    expect(again).toMatchObject({ produced: false, reason: "duplicate" });
    expect(provider.calls).toHaveLength(1);
    expect(await prisma.whatsAppGeneration.count({ where: { conversationId: conversation.id } })).toBe(1);
    const retryRes = await POST(signedPost(webhookBody("wamid.AST-D1", "Do you deliver?")));
    expect(await retryRes.json()).toEqual({ received: 0, unknown: 0 });
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "DRAFT" } })).toBe(1);
  });

  it("rides the shared M3 hourly cap: throttled messages are skipped and audited, never auto-replied", async () => {
    const { bizA, connection, conversation } = await seed();
    const provider = new MockProvider(groundedAnswer("delivery", "We deliver within Kumasi."));
    await seedInbound(conversation.id, connection.id, "wamid.AST-C1", "Do you deliver?");
    const first = await runInboundAssist(
      { businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-C1", text: "Do you deliver?" },
      { provider, config: testConfig({ rateBusinessPerHour: 1 }) },
    );
    expect(first.produced).toBe(true);
    await seedInbound(conversation.id, connection.id, "wamid.AST-C2", "And the price of cases?");
    const second = await runInboundAssist(
      { businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-C2", text: "And the price of cases?" },
      { provider, config: testConfig({ rateBusinessPerHour: 1 }) },
    );
    expect(second).toMatchObject({ produced: false, reason: "rate_limited" });
    expect(provider.calls).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.draft.skipped", businessId: bizA.id } })).toBe(1);
    // Only the earlier (first) draft exists; the throttled message produced none.
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "DRAFT" } })).toBe(1);
    // The throttled inbound still exists for the owner to answer personally.
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, wamid: "wamid.AST-C2" } })).toBe(1);
  });
});

describe("M6c takeover state machine", () => {
  it("takeover (AI_ASSIST → OWNER_ONLY) immediately stops drafting and marks the pending draft superseded", async () => {
    const { ownerA, bizA, connection, conversation } = await seed();
    const provider = new MockProvider(groundedAnswer("delivery", "We deliver within Kumasi."));
    await seedInbound(conversation.id, connection.id, "wamid.AST-T1", "Do you deliver?");
    await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-T1", text: "Do you deliver?" }, { provider });
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "DRAFT" } })).toBe(1);

    const change = await setConversationMode(ownerA.id, bizA.id, conversation.id, { mode: "OWNER_ONLY" });
    expect(change).toMatchObject({ changed: true });
    // Not deleted — clearly marked stale:
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "SUPERSEDED" } })).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.conversation.mode_changed" } });
    expect(audit.actorUserId).toBe(ownerA.id);
    expect(audit.metadata).toMatchObject({ from: "AI_ASSIST", to: "OWNER_ONLY", takeover: true });

    await seedInbound(conversation.id, connection.id, "wamid.AST-T2", "One more question");
    const after = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-T2", text: "One more question" }, { provider });
    expect(after).toMatchObject({ produced: false, reason: "not_ai_assist" });
    expect(provider.calls).toHaveLength(1); // unchanged by the new inbound
  });

  it("\"hand back to AI\" drafts the still-unanswered inbound immediately, through the same path", async () => {
    const { ownerA, bizA } = await seed({ mode: "OWNER_ONLY" });
    const conv = await prisma.whatsAppConversation.findFirstOrThrow({ where: { businessId: bizA.id } });
    const connectionId = conv.connectionId;
    await seedInbound(conv.id, connectionId, "wamid.AST-HB1", "What are your opening hours?");
    const provider = new MockProvider(groundedAnswer("opening", "Open Monday to Saturday, 8am to 6pm."));

    expect(await pendingInboundForAssist(conv.id)).toEqual({ wamid: "wamid.AST-HB1", text: "What are your opening hours?" });
    const change = await setConversationMode(ownerA.id, bizA.id, conv.id, { mode: "AI_ASSIST" }, { provider });
    expect(change).toMatchObject({ changed: true, draft: { produced: true } });
    expect(provider.calls).toHaveLength(1);
    const draft = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conv.id, draftState: "DRAFT" } });
    expect(draft).toMatchObject({ status: "DRAFT", direction: "OUTBOUND", wamid: null });
    const generation = await prisma.whatsAppGeneration.findFirstOrThrow({ where: { conversationId: conv.id } });
    expect(generation.requestedById).toBeNull();
    expect(generation.idempotencyKey).toBe("wamid.AST-HB1");
  });

  it("is owner/admin-only; MEMBERs are forbidden, invalid modes rejected, repeats are no-ops", async () => {
    const { ownerA, adminA, memberA, bizA } = await seed({ mode: "OWNER_ONLY" });
    const conv = await prisma.whatsAppConversation.findFirstOrThrow({ where: { businessId: bizA.id } });
    await expect(setConversationMode(memberA.id, bizA.id, conv.id, { mode: "AI_ASSIST" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const untouched = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(untouched.mode).toBe("OWNER_ONLY");
    await expect(setConversationMode(adminA.id, bizA.id, conv.id, { mode: "CHATBOT" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setConversationMode(adminA.id, bizA.id, conv.id, { mode: "AI_ASSIST" })).resolves.toMatchObject({ mode: "AI_ASSIST", changed: true });
    const repeat = await setConversationMode(adminA.id, bizA.id, conv.id, { mode: "AI_ASSIST" });
    expect(repeat).toMatchObject({ changed: false });
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.conversation.mode_changed" } })).toBe(1);
    const takeover = await setConversationMode(ownerA.id, bizA.id, conv.id, { mode: "OWNER_ONLY" });
    expect(takeover).toMatchObject({ changed: true });
  });
});

describe("M6c send gate closes the review loop", () => {
  it("sending an approved draft records what was actually sent, supersedes drafts, and never inflates the meter with drafts", async () => {
    const { ownerA, bizA, connection, conversation } = await seed();
    await seedInbound(conversation.id, connection.id, "wamid.AST-S1", "What are your opening hours?");
    const provider = new MockProvider(groundedAnswer("opening", "Open Monday to Saturday, 8am to 6pm."));
    await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.AST-S1", text: "What are your opening hours?" }, { provider });
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "DRAFT" } })).toBe(1);

    // The draft must not appear in the monthly service meter before it is actually sent.
    const okFetch = (async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.SENT-DRAFT" }] }), { status: 200 })) as typeof fetch;
    const out = await sendOwnerReply(ownerA.id, bizA.id, conversation.id, {
      text: "Open Monday to Saturday, 8am to 6pm",
    }, { fetchImpl: okFetch });
    expect(out).toMatchObject({ sent: true, wamid: "wamid.SENT-DRAFT", meterUsed: 1 });

    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, draftState: "SUPERSEDED" } })).toBe(1);
    const usedDraft = await prisma.whatsAppMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, draftState: "SUPERSEDED" },
      orderBy: { createdAt: "desc" },
    });
    expect(usedDraft.approvedContent).toBe("Open Monday to Saturday, 8am to 6pm"); // what the owner actually sent
    expect(usedDraft.approvedById).toBe(ownerA.id);
    const sentRow = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { wamid: "wamid.SENT-DRAFT" } });
    expect(sentRow).toMatchObject({ status: "SENT", direction: "OUTBOUND" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "whatsapp.message.sent" } });
    expect(audit.metadata).toMatchObject({ meterUsed: 1, meterFree: 999 });
  });
});
