import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetDb, twoTenants } from "../helpers/db";
import { prisma } from "@/lib/db/client";
import {
  cancelQueuedSend,
  getSendReadiness,
  processStatusUpdates,
  sendOwnerReply,
  setConversationMode,
} from "@/modules/whatsapp/service";
import { flushDueMessages } from "@/modules/whatsapp/outbox";
import { POST as flushRoute } from "@/app/api/whatsapp/outbox/flush/route";
import { encryptSecret } from "@/lib/security/secret-box";

const KEY = Buffer.alloc(32, 9);
const KEY_HEX = KEY.toString("hex");
const FLUSH_TOKEN = "f".repeat(64);
const envSaves = {
  key: process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY,
  token: process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN,
};
beforeAll(async () => {
  process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = KEY_HEX;
  process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN = FLUSH_TOKEN;
  await resetDb(); // other files truncate in beforeEach; clean baseline first
});
afterAll(() => {
  if (envSaves.key === undefined) delete process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  else process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = envSaves.key;
  if (envSaves.token === undefined) delete process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN;
  else process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN = envSaves.token;
});
afterEach(async () => {
  await resetDb();
});

const flushPost = (authorization: string | null, body: unknown) =>
  flushRoute(
    new Request("http://test/api/whatsapp/outbox/flush", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify(body),
    }),
  );

const failFetch = (status: number, errCode?: number) => (async () =>
  new Response(
    JSON.stringify({ error: { message: `transient excursion #${errCode ?? 0}`, type: "O", ...(errCode ? { code: errCode } : {}) } }),
    { status },
  )) as typeof fetch;

const always500 = failFetch(500);

let wamidSeq = 0;
const okFetch = (async () =>
  new Response(JSON.stringify({ messages: [{ id: `wamid.FLUSH${++wamidSeq}` }] }), { status: 200 })) as typeof fetch;

async function seed() {
  const { ownerA, adminA, memberA, bizA } = await twoTenants();
  const connection = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id, wabaId: "WABA-OB", phoneNumberId: "PN-OUTBOXTEST",
      displayPhoneNumber: "+233540000000", tokenCiphertext: encryptSecret("live-token", KEY),
    },
  });
  const conv = await prisma.whatsAppConversation.create({
    data: { connectionId: connection.id, businessId: bizA.id, customerPhone: "233540111222", customerName: "Ama" },
  });
  const inbound = await prisma.whatsAppMessage.create({
    data: { conversationId: conv.id, connectionId: connection.id, direction: "INBOUND", wamid: `wamid.IN-${conv.id}`, text: "Is the iPhone 13 in stock?", type: "text", status: "RECEIVED", timestampSent: new Date(Date.now() - 60_000) },
  });
  return { ownerA, adminA, memberA, bizA, connection, conv, inbound };
}

/** Seed a QUEUED row directly (full control over attempts/dueness). */
async function seedQueued(ctx: Awaited<ReturnType<typeof seed>>, opts: {
  attempts?: number; maxAttempts?: number; dueInMs?: number; agoInMs?: number; text?: string;
} = {}) {
  const nowMs = Date.now();
  const row = await prisma.whatsAppMessage.create({
    data: {
      conversationId: ctx.conv.id, connectionId: ctx.connection.id, direction: "OUTBOUND",
      text: opts.text ?? "Approved outage reply", type: "text", status: "QUEUED",
      queuedAt: new Date(nowMs - (opts.agoInMs ?? 90_000)),
      nextAttemptAt: new Date(nowMs + (opts.dueInMs ?? -1_000)), // due by default
      attempts: opts.attempts ?? 0,
      maxAttempts: opts.maxAttempts ?? 5,
      lastErrorKind: "TRANSIENT", lastErrorAt: new Date(nowMs - (opts.agoInMs ?? 90_000)),
      approvedContent: opts.text ?? "Approved outage reply",
      approvedById: ctx.ownerA.id, approvedAt: new Date(nowMs - (opts.agoInMs ?? 90_000)),
    },
  });
  return row;
}

const HOUR = 3_600_000;

describe("sendOwnerReply: transient failures queue (ADR 0010 §3/§4)", () => {
  it("a 5xx outage queues the approved text with meter untouched, drafts consumed, breaker +1", async () => {
    const ctx = await seed();
    const out = await sendOwnerReply(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, { text: "Yes, in stock!" }, { fetchImpl: always500, now: () => new Date() });
    expect(out.sent).toBe(false);
    if (!out.sent) {
      expect(out.queued).toBe(true);
      expect(out.reason).toContain("queued");
      expect(out.meterUsed).toBe(0);
    }
    const row = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: ctx.conv.id, status: "QUEUED" } });
    expect(row).toMatchObject({ direction: "OUTBOUND", approvedContent: "Yes, in stock!", approvedById: ctx.ownerA.id, attempts: 0, maxAttempts: 5 });
    const backoffMs = row.nextAttemptAt!.getTime() - Date.now();
    expect(backoffMs).toBeGreaterThan(45_000); // step 1: ~1m ±20%
    expect(backoffMs).toBeLessThan(80_000);
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: ctx.conv.id, draftState: "DRAFT" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.queued" } })).toBe(1);
    const conn = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: ctx.connection.id } });
    expect(conn.consecutiveSendFailures).toBe(1);
    expect(conn.providerDownSince).toBeNull(); // opens at 3
  });

  it("permanent failures stay inline and never queue nor feed the breaker", async () => {
    const ctx = await seed();
    const out = await sendOwnerReply(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, { text: "hi" }, { fetchImpl: failFetch(400, 131047) });
    expect(out.sent).toBe(false);
    if (!out.sent) expect(out.queued).toBeUndefined();
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: ctx.conv.id, status: "QUEUED" } })).toBe(0);
    const conn = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: ctx.connection.id } });
    expect(conn.consecutiveSendFailures).toBe(0);
  });

  it("a queued reply blocks new sends for the conversation until resolved", async () => {
    const ctx = await seed();
    await seedQueued(ctx, { dueInMs: 600_000 });
    const out = await sendOwnerReply(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, { text: "second reply" }, { fetchImpl: okFetch });
    expect(out.sent).toBe(false);
    if (!out.sent) expect(out.reason).toContain("queued");
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: ctx.conv.id, status: "QUEUED" } })).toBe(1);
    expect(await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND", status: { in: ["SENT"] } } })).toBe(0);
  });

  it("readiness exposes queued + degraded facts and never meters QUEUED", async () => {
    const ctx = await seed();
    await seedQueued(ctx);
    const r = await getSendReadiness(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id);
    expect(r.queued).toMatchObject({ count: 1 });
    expect(r.queued?.nextRetryAt).not.toBeNull();
    expect(r.providerDegraded).toBeNull();
    expect(r.meterUsed).toBe(0);
  });
});

describe("flushDueMessages (ADR 0010 §5/§6)", () => {
  it("delivers a due queued row: SENT + wamid, meter counts it, breaker resets, audits", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    await prisma.whatsAppConnection.update({ where: { id: ctx.connection.id }, data: { consecutiveSendFailures: 2 } });
    const out = await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch });
    expect(out).toMatchObject({ found: 1, sent: 1, failedTerminal: 0, held: 0 });
    const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("SENT");
    expect(after.wamid).toContain("wamid.FLUSH");
    expect(after.nextAttemptAt).toBeNull();
    expect(after.timestampSent).not.toBeNull();
    expect(await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: ctx.connection.id } })).toMatchObject({ consecutiveSendFailures: 0 });
    const r = await getSendReadiness(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id);
    expect(r.meterUsed).toBe(1);
    expect(r.queued).toBeNull();
  });

  it("a transient flush failure re-queues with backoff and fast-fails the pass", async () => {
    const ctx = await seed();
    await seedQueued(ctx);
    await seedQueued(ctx, { text: "second row", agoInMs: 80_000 });
    const out = await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: always500 });
    expect(out).toMatchObject({ found: 2, sent: 0, failedTerminal: 0, leftDue: 1 });
    const rows = await prisma.whatsAppMessage.findMany({ where: { conversationId: ctx.conv.id, status: "QUEUED" } });
    const advanced = rows.find((r) => r.attempts === 1);
    expect(advanced).toBeDefined();
    const backoffMs = advanced!.nextAttemptAt!.getTime() - Date.now();
    expect(backoffMs).toBeGreaterThan(45_000); // attempt 1 failed → ~1m ±20%
    expect(backoffMs).toBeLessThan(80_000);
    expect(rows.find((r) => r.attempts === 0)).toBeDefined(); // untouched, still due
  });

  it("exhausts retries at the row's cap: FAILED/EXHAUSTED_RETRIES, audited", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    let now = new Date();
    for (let i = 0; i < 5; i += 1) {
      await flushDueMessages(ctx.connection.id, { now: () => now, fetchImpl: always500 });
      now = new Date(now.getTime() + 2 * HOUR);
      const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.attempts).toBe(i + 1);
      if (i < 4) {
        expect(after.status).toBe("QUEUED");
      } else {
        expect(after.status).toBe("FAILED");
        expect((after.errorInfo as { code: string }).code).toBe("EXHAUSTED_RETRIES");
        expect(after.nextAttemptAt).toBeNull();
      }
    }
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.failed", targetId: row.id } })).toBe(1);
  });

  it("expires when the 24-hour window has closed, even pre-attempt", async () => {
    const ctx = await seed();
    await prisma.whatsAppMessage.update({
      where: { id: ctx.inbound.id }, data: { timestampSent: new Date(Date.now() - 25 * HOUR) },
    });
    const row = await seedQueued(ctx);
    const out = await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch });
    expect(out).toMatchObject({ found: 1, sent: 0, failedTerminal: 1 });
    const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect((after.errorInfo as { code: string }).code).toBe("EXPIRED_WINDOW");
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.expired" } })).toBe(1);
  });

  it("pilot pause HOLDS the row (never fails it), resumes when the pilot reopens", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    await prisma.pilotEnrollment.create({
      data: { businessId: ctx.bizA.id, status: "PAUSED", createdById: ctx.ownerA.id, pausedReason: "test" },
    });
    expect(await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch })).toMatchObject({ found: 1, held: 1, sent: 0 });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("QUEUED");
    await prisma.pilotEnrollment.update({ where: { businessId: ctx.bizA.id }, data: { status: "ACTIVE" } });
    expect(await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch })).toMatchObject({ found: 1, sent: 1, held: 0 });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
  });

  it("breaker opens at the 3rd consecutive transient failure (one audit), closes on the next success", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx, { maxAttempts: 6 });
    let now = new Date();
    for (let i = 0; i < 4; i += 1) {
      now = new Date(now.getTime() + 2 * HOUR);
      await flushDueMessages(ctx.connection.id, { now: () => now, fetchImpl: always500 });
    }
    const open = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: ctx.connection.id } });
    expect(open.consecutiveSendFailures).toBe(4);
    expect(open.providerDownSince).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.provider.outage.open" } })).toBe(1); // no alert spam
    now = new Date(now.getTime() + 2 * HOUR);
    await flushDueMessages(ctx.connection.id, { now: () => now, fetchImpl: okFetch });
    const closed = await prisma.whatsAppConnection.findUniqueOrThrow({ where: { id: ctx.connection.id } });
    expect(closed.consecutiveSendFailures).toBe(0);
    expect(closed.providerDownSince).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.provider.outage.closed" } })).toBe(1);
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
  });
});

describe("takeover & cancel (ADR 0010 §4)", () => {
  it("owner takeover does NOT cancel the queued reply", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    await setConversationMode(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, { mode: "OWNER_ONLY" });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("QUEUED");
    expect(await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch })).toMatchObject({ sent: 1 });
  });

  it("cancel is terminal FAILED/CANCELLED_BY_OWNER with an audit, and refuses to re-cancel", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    await expect(cancelQueuedSend(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, row.id)).resolves.toMatchObject({ cancelled: true });
    const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect((after.errorInfo as { code: string }).code).toBe("CANCELLED_BY_OWNER");
    expect(after.nextAttemptAt).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.send.cancelled" } })).toBe(1);
    await expect(cancelQueuedSend(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, row.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await flushDueMessages(ctx.connection.id, { now: () => new Date(), fetchImpl: okFetch })).toMatchObject({ found: 0 });
  });

  it("members cannot cancel; unknown conversations are tenant-fenced", async () => {
    const ctx = await seed();
    const row = await seedQueued(ctx);
    await expect(cancelQueuedSend(ctx.memberA.id, ctx.bizA.id, ctx.conv.id, row.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelQueuedSend(ctx.ownerA.id, ctx.bizA.id, "made-up-conversation", row.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("QUEUED");
  });
});

describe("meter & status monotonicity with QUEUED present (ADR 0010 §7)", () => {
  it("a DELIVERED callback on a real send works; meter ignores queued rows", async () => {
    const ctx = await seed();
    const sentOutcome = await sendOwnerReply(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id, { text: "direct send" }, { fetchImpl: okFetch, now: () => new Date() });
    expect(sentOutcome.sent).toBe(true);
    await seedQueued(ctx, { dueInMs: 600_000 });
    const sent = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: ctx.conv.id, status: "SENT" } });
    const r = await getSendReadiness(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id);
    expect(r.meterUsed).toBe(1); // queued row excluded
    expect(r.queued?.count).toBe(1);
    const result = await processStatusUpdates(
      ctx.connection.phoneNumberId,
      [{ wamid: sent.wamid!, status: "delivered", timestamp: Math.floor(Date.now() / 1000), errors: [] }],
    );
    expect(result.updated).toBe(1);
    const r2 = await getSendReadiness(ctx.ownerA.id, ctx.bizA.id, ctx.conv.id);
    expect(r2.meterUsed).toBe(1); // DELIVERED is still one metered send
  });
});

describe("POST /api/whatsapp/outbox/flush (cron endpoint)", () => {
  it("refuses when disabled, when unauthenticated, and accepts the right bearer token", async () => {
    const ctx = await seed();
    process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN = "";
    try {
      expect((await flushPost(`Bearer ${FLUSH_TOKEN}`, { businessId: ctx.bizA.id })).status).toBe(403);
    } finally {
      process.env.WHATSAPP_OUTBOX_FLUSH_TOKEN = FLUSH_TOKEN;
    }
    expect((await flushPost("Bearer wrong-token", { businessId: ctx.bizA.id })).status).toBe(401);
    expect((await flushPost(null, { businessId: ctx.bizA.id })).status).toBe(401);
    // nothing due: an authorized no-op pass
    const ok = await flushPost(`Bearer ${FLUSH_TOKEN}`, { businessId: ctx.bizA.id });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ found: 0, sent: 0, failedTerminal: 0, held: 0, leftDue: 0, breakerOpen: false });
  });

  it("drains a due queued row through the cron path", async () => {
    const ctx = await seed();
    await seedQueued(ctx);
    const globalFetch = globalThis.fetch;
    globalThis.fetch = okFetch as typeof fetch;
    try {
      const drained = await flushPost(`Bearer ${FLUSH_TOKEN}`, { businessId: ctx.bizA.id });
      expect(await drained.json()).toMatchObject({ found: 1, sent: 1 });
    } finally {
      globalThis.fetch = globalFetch;
    }
    expect((await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: ctx.conv.id, status: "SENT" } })).status).toBe("SENT");
  });

  it("rejects an invalid businessId payload", async () => {
    await expect(flushPost(`Bearer ${FLUSH_TOKEN}`, { businessId: "" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
