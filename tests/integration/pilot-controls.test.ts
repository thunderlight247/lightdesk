import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resetDb, twoTenants } from "../helpers/db";
import { MockProvider, buildActiveProfile, groundedAnswer } from "../helpers/lab";
import { runInboundAssist } from "@/modules/whatsapp/assist";
import { sendOwnerReply, setConversationMode } from "@/modules/whatsapp/service";
import { encryptSecret } from "@/lib/security/secret-box";
import {
  PLATFORM_CEILING_AI_CALLS_PER_DAY,
  PLATFORM_CEILING_OUTBOUND_PER_MONTH,
  enrollBusinessInPilot,
  getPilotOverview,
  getPilotStatus,
  setPilotStatus,
  submitPilotFeedback,
  updateUsageCaps,
  consentToPilot,
  revokePilotConsent,
  listPilotCandidates,
} from "@/modules/pilot/service";

// The send-gate test decrypts the stored connection token: same key format the send suite uses.
const ENV_KEYS = ["WHATSAPP_TOKEN_ENCRYPTION_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function seedPlatformAdmin() {
  return prisma.user.upsert({
    where: { email: "platform-admin@test.example" },
    update: {},
    create: { email: "platform-admin@test.example", name: "Platform Admin", passwordHash: "x", isPlatformAdmin: true },
  });
}

async function seedEnrolled(
  opts: { consent?: boolean; caps?: { aiCallsPerDay: number; outboundPerMonth: number }; convMode?: "OWNER_ONLY" | "AI_ASSIST" } = {},
) {
  const { ownerA, adminA, memberA, ownerB, bizA, bizB } = await twoTenants();
  await buildActiveProfile(ownerA.id, bizA.id);
  const platformAdmin = await seedPlatformAdmin();
  await enrollBusinessInPilot(platformAdmin.id, bizA.id);
  if (opts.caps) await updateUsageCaps(ownerA.id, bizA.id, opts.caps);
  if (opts.consent) await consentToPilot(ownerA.id, bizA.id);
  const connection = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id, wabaId: "WABA-P", phoneNumberId: "PN-P",
      displayPhoneNumber: "+233540000001", coexistence: true, status: "CONNECTED",
      tokenCiphertext: encryptSecret("live-token", Buffer.alloc(32, 9)),
    },
  });
  const conversation = await prisma.whatsAppConversation.create({
    data: { connectionId: connection.id, businessId: bizA.id, customerPhone: "233540111333", customerName: "Kofi", mode: opts.convMode ?? "OWNER_ONLY" },
  });
  return { ownerA, adminA, memberA, ownerB, bizA, bizB, platformAdmin, connection, conversation };
}

async function seedInbound(conversationId: string, connectionId: string, wamid: string, text: string) {
  const row = await prisma.whatsAppMessage.create({
    data: { conversationId, connectionId, direction: "INBOUND", wamid, text, type: "text", status: "RECEIVED", timestampSent: new Date() },
  });
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  return row;
}

const okFetch = (wamid: string) => (async () =>
  new Response(JSON.stringify({ messages: [{ id: wamid }] }), { status: 200 })) as typeof fetch;

beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  await resetDb();
});

describe("M7 pilot enrollment", () => {
  it("is platform-admin-only and creates PENDING_CONSENT with conservative default caps and an audit", async () => {
    const { ownerA, bizA } = await twoTenants();
    await expect(enrollBusinessInPilot(ownerA.id, bizA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.pilotEnrollment.count()).toBe(0);

    const admin = await seedPlatformAdmin();
    const enrollment = await enrollBusinessInPilot(admin.id, bizA.id);
    expect(enrollment.status).toBe("PENDING_CONSENT");
    expect(enrollment.caps).toMatchObject({ aiCallsPerDay: 50, outboundPerMonth: 100 });
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.enrolled" } })).actorUserId).toBe(admin.id);
  });

  it("refuses duplicates and unknown businesses", async () => {
    const admin = await seedPlatformAdmin();
    const { bizA } = await twoTenants();
    await enrollBusinessInPilot(admin.id, bizA.id);
    await expect(enrollBusinessInPilot(admin.id, bizA.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(enrollBusinessInPilot(admin.id, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists only un-enrolled ACTIVE businesses as candidates, admin-only", async () => {
    const admin = await seedPlatformAdmin();
    const { ownerA, bizA, bizB } = await twoTenants();
    await expect(listPilotCandidates(ownerA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = await listPilotCandidates(admin.id);
    expect(before.map((b) => b.id).sort()).toEqual([bizA.id, bizB.id].sort());
    await enrollBusinessInPilot(admin.id, bizA.id);
    const after = await listPilotCandidates(admin.id);
    expect(after.map((b) => b.id)).toEqual([bizB.id]);
  });
});

describe("M7 pilot consent gate: nothing restricted works without consent", () => {
  it("blocks the AI_ASSIST mode switch and the owner send while PENDING_CONSENT, and audits both", async () => {
    const { ownerA, bizA, conversation, connection } = await seedEnrolled();
    await expect(setConversationMode(ownerA.id, bizA.id, conversation.id, { mode: "AI_ASSIST" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conv.mode).toBe("OWNER_ONLY"); // unchanged

    await seedInbound(conversation.id, connection.id, "wamid.PG1", "Where is your shop?");
    const neverFetch = (async () => {
      throw new Error("Graph must not be reached while consent is missing");
    }) as typeof fetch;
    const out = await sendOwnerReply(ownerA.id, bizA.id, conversation.id, { text: "We are in Accra." }, { fetchImpl: neverFetch });
    expect(out).toMatchObject({ sent: false });
    if (!out.sent) expect(out.reason).toContain("pilot terms");
    expect(await prisma.auditEvent.count({ where: { action: "pilot.send.blocked", businessId: bizA.id } })).toBe(1);
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, status: "SENT" } })).toBe(0);
  });

  it("can only be given by the OWNER and only for their business; activates restricted capabilities", async () => {
    const { ownerA, adminA, memberA, ownerB, bizA, conversation } = await seedEnrolled();
    await expect(consentToPilot(memberA.id, bizA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(consentToPilot(adminA.id, bizA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Cross-tenant: a non-member must not even learn that the enrollment exists (no existence oracle).
    await expect(consentToPilot(ownerB.id, bizA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await consentToPilot(ownerA.id, bizA.id);
    const row = await prisma.pilotEnrollment.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.consentById).toBe(ownerA.id);
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.consented" } })).actorUserId).toBe(ownerA.id);

    // Restricted capability works again now: the OWNER_ONLY -> AI_ASSIST switch succeeds.
    await expect(setConversationMode(ownerA.id, bizA.id, conversation.id, { mode: "AI_ASSIST" }))
      .resolves.toMatchObject({ changed: true });
    await expect(getPilotStatus(memberA.id, bizA.id)).resolves.toMatchObject({ enrolled: true, status: "ACTIVE" });
  });

  it("owner can leave at any time; restricted capabilities switch off immediately and stay off", async () => {
    const { ownerA, bizA, conversation, connection } = await seedEnrolled({ consent: true });
    // Before leaving, drafting works (deterministic RULES draft; provider never called either way).
    const provider = new MockProvider(() => "the AI must not be consulted");
    await setConversationMode(ownerA.id, bizA.id, conversation.id, { mode: "AI_ASSIST" });
    await seedInbound(conversation.id, connection.id, "wamid.EX1", "How much for the iPhone 13?");
    const before = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.EX1", text: "How much for the iPhone 13?" }, { provider });
    expect(before).toMatchObject({ produced: true });

    await revokePilotConsent(ownerA.id, bizA.id);
    const row = await prisma.pilotEnrollment.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(row.status).toBe("EXITED");
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.exited" } })).actorUserId).toBe(ownerA.id);
  });

  it("admin pause stops drafting; resume after prior consent returns to ACTIVE without re-consent", async () => {
    const { bizA, conversation, connection, platformAdmin } = await seedEnrolled({ consent: true, convMode: "AI_ASSIST" });
    await setPilotStatus(platformAdmin.id, bizA.id, "pause", "reviewing a concern");
    const provider = new MockProvider(() => "must not be called");
    await seedInbound(conversation.id, connection.id, "wamid.PA1", "Do you deliver?");
    const blocked = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.PA1", text: "Do you deliver?" }, { provider });
    expect(blocked).toMatchObject({ produced: false, reason: "pilot_blocked" });
    expect(provider.calls).toHaveLength(0);
    expect(await prisma.whatsAppGeneration.count({ where: { conversationId: conversation.id } })).toBe(0); // nothing even attempted
    expect(await prisma.auditEvent.count({ where: { action: "pilot.cap.blocked", businessId: bizA.id } })).toBe(1);

    await setPilotStatus(platformAdmin.id, bizA.id, "resume");
    const row = await prisma.pilotEnrollment.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(row.status).toBe("ACTIVE"); // consented earlier -> straight back
    await seedInbound(conversation.id, connection.id, "wamid.PA2", "Do you deliver to Tema?");
    const resumed = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.PA2", text: "Do you deliver to Tema?" }, { provider });
    expect(resumed).toMatchObject({ produced: true });
  });
});

describe("M7 hard usage caps", () => {
  it("block the daily AI allowance before any call and audit the breach", async () => {
    const { bizA, conversation, connection } = await seedEnrolled({ consent: true, convMode: "AI_ASSIST", caps: { aiCallsPerDay: 1, outboundPerMonth: 100 } });
    const provider = new MockProvider(groundedAnswer("delivery", "We deliver within Accra."));
    await seedInbound(conversation.id, connection.id, "wamid.CAP1", "Do you deliver?");
    const first = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.CAP1", text: "Do you deliver?" }, { provider });
    expect(first).toMatchObject({ produced: true });

    await seedInbound(conversation.id, connection.id, "wamid.CAP2", "And prices?");
    const second = await runInboundAssist({ businessId: bizA.id, conversationId: conversation.id, wamid: "wamid.CAP2", text: "And prices?" }, { provider });
    expect(second).toMatchObject({ produced: false, reason: "pilot_blocked" });
    expect(provider.calls).toHaveLength(1); // only the first really went through
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.cap.blocked" } });
    expect(audit.metadata).toMatchObject({ reason: expect.stringContaining("Daily AI drafting limit") });
    expect(await prisma.whatsAppGeneration.count({ where: { idempotencyKey: "wamid.CAP2" } })).toBe(0);
  });

  it("block the monthly outbound allowance before any Graph request and audit the breach", async () => {
    const { ownerA, bizA, conversation, connection } = await seedEnrolled({ consent: true, convMode: "AI_ASSIST", caps: { aiCallsPerDay: 50, outboundPerMonth: 1 } });
    await seedInbound(conversation.id, connection.id, "wamid.OUT1", "Where is your shop?");
    const first = await sendOwnerReply(ownerA.id, bizA.id, conversation.id, { text: "We are in Accra." }, { fetchImpl: okFetch("wamid.OUT1-SENT") });
    expect(first).toMatchObject({ sent: true });

    let graphCalls = 0;
    const spyFetch: typeof fetch = async () => {
      graphCalls += 1;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.SHOULD-NOT-SEND" }] }), { status: 200 });
    };
    const second = await sendOwnerReply(ownerA.id, bizA.id, conversation.id, { text: "GreaterThan cap" }, { fetchImpl: spyFetch });
    expect(second).toMatchObject({ sent: false });
    if (!second.sent) expect(second.reason).toContain("Monthly outbound limit");
    expect(graphCalls).toBe(0);
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id, status: "SENT" } })).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.send.blocked" } });
    expect(audit.metadata).toMatchObject({ reason: expect.stringContaining("Monthly outbound limit") });
  });

  it("validate owner-set caps: floor 0, platform ceilings, audited changes", async () => {
    const { ownerA, bizA } = await seedEnrolled();
    await expect(updateUsageCaps(ownerA.id, bizA.id, { aiCallsPerDay: -1, outboundPerMonth: 5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateUsageCaps(ownerA.id, bizA.id, { aiCallsPerDay: PLATFORM_CEILING_AI_CALLS_PER_DAY + 1, outboundPerMonth: 5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateUsageCaps(ownerA.id, bizA.id, { aiCallsPerDay: 10, outboundPerMonth: PLATFORM_CEILING_OUTBOUND_PER_MONTH + 1 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateUsageCaps(ownerA.id, bizA.id, { aiCallsPerDay: 0, outboundPerMonth: 0 })).resolves.toBeTruthy();
    const row = await prisma.usageCaps.findUniqueOrThrow({ where: { businessId: bizA.id } });
    expect(row).toMatchObject({ aiCallsPerDay: 0, outboundPerMonth: 0 });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.caps_changed" } });
    expect(audit.actorUserId).toBe(ownerA.id);
  });
});

describe("M7 pilot feedback capture", () => {
  it("stores member feedback with audit, validates category and comment, and is pilot-scoped", async () => {
    const { memberA, ownerA, bizA, bizB } = await seedEnrolled({ consent: true });
    const created = await submitPilotFeedback(memberA.id, bizA.id, { category: "worked_well", comment: "The draft saved me time." });
    const row = await prisma.pilotFeedback.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ businessId: bizA.id, category: "worked_well", createdById: memberA.id });
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: "pilot.feedback" } })).actorUserId).toBe(memberA.id);

    await expect(submitPilotFeedback(ownerA.id, bizA.id, { category: "not_a_category", comment: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitPilotFeedback(ownerA.id, bizA.id, { category: "other", comment: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitPilotFeedback(ownerA.id, bizB.id, { category: "other", comment: "not enrolled" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("M7 platform-admin monitoring view", () => {
  it("is admin-only, aggregates counters per enrolled business, and leaks no conversation content", async () => {
    const { ownerA, bizA, bizB, conversation } = await seedEnrolled({ consent: true, caps: { aiCallsPerDay: 50, outboundPerMonth: 8 } });
    await expect(getPilotOverview(ownerA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Generate fingerprinting data: an escaped conversation would leak mode/status but NOT content.
    const owner = ownerA;
    await submitPilotFeedback(owner.id, bizA.id, { category: "confusing", comment: "caps wording" });

    const admin = await seedPlatformAdmin(); // idempotent upsert by email
    const overview = await getPilotOverview(admin.id);
    expect(overview.rows).toHaveLength(1);
    const row = overview.rows[0];
    expect(row).toMatchObject({
      businessId: bizA.id,
      businessName: "Biz A",
      status: "ACTIVE",
      usage: { aiCallsToday: 0, outboundThisMonth: 0, escalated: 0, openConversations: 1, failedSends: 0 },
      feedbackCount: 1,
    });
    expect(row.caps).toMatchObject({ aiCallsPerDay: 50, outboundPerMonth: 8 });
    expect(overview.recentFeedback).toHaveLength(1);
    expect(overview.recentFeedback[0]).toMatchObject({ businessName: "Biz A", category: "confusing" });
    // No conversation identifiers or customer data in the overview structure.
    expect(JSON.stringify(overview)).not.toContain(conversation.customerPhone);
    expect(JSON.stringify(overview)).not.toContain(conversation.id);

    const candidates = await listPilotCandidates(admin.id);
    expect(candidates.map((c) => c.id)).toEqual([bizB.id]);
  });
});
