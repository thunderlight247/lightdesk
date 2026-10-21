import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, twoTenants } from "../helpers/db";
import { prisma } from "@/lib/db/client";
import { GET, POST } from "@/app/api/whatsapp/webhook/route";

// Webhook route configuration comes from process.env; set and restore it per test.
const ENV_KEYS = ["WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const before = () => {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
};
afterEach(async () => {
  await resetDb();
});

function sign(body: string) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

function postRequest(body: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": sign(body), ...extra },
    body,
  });
}

const inboundBody = JSON.stringify({
  entry: [{
    id: "WABA1",
    changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "PN1" },
      contacts: [{ profile: { name: "Ama Mensah" } }],
      messages: [{ id: "wamid.TEST1", from: "233540000001", type: "text", text: { body: "How much for the iPhone 13?" }, timestamp: "1729400000" }],
    } }],
  }],
});

async function makeConnection(opts: { phoneNumberId?: string; status?: "CONNECTED" | "DISCONNECTED" } = {}) {
  const { bizA } = await twoTenants();
  const row = await prisma.whatsAppConnection.create({
    data: {
      businessId: bizA.id, wabaId: "WABA1", phoneNumberId: opts.phoneNumberId ?? "PN1",
      displayPhoneNumber: "+233540000000", coexistence: true, status: opts.status ?? "CONNECTED",
      tokenCiphertext: "ciphertext-not-read-in-these-tests",
    },
  });
  return { bizA, row };
}

describe("webhook GET subscription handshake", () => {
  it("echoes the challenge for a matching verify token", async () => {
    before();
    const res = await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE123"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHALLENGE123");
  });

  it("rejects a wrong token; and 403 without challenge or configuration", async () => {
    before();
    const bad = await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=C"));
    expect(bad.status).toBe(403);
    const noChallenge = await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token"));
    expect(noChallenge.status).toBe(403);
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const noConfig = await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=C"));
    expect(noConfig.status).toBe(403);
  });
});

describe("webhook POST inbound pipeline", () => {
  beforeEach(before);

  it("fails closed without the app secret configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const res = await POST(postRequest(inboundBody));
    expect(res.status).toBe(403);
    expect(await prisma.whatsAppConnection.count()).toBe(0);
  });

  it("rejects incorrect, missing, or malformed signatures before event processing", async () => {
    await makeConnection();
    const requests = [
      new Request("http://x/api/whatsapp/webhook", {
        method: "POST", headers: { "x-hub-signature-256": `sha256=${"f".repeat(64)}` }, body: inboundBody,
      }),
      new Request("http://x/api/whatsapp/webhook", { method: "POST", body: inboundBody }),
      new Request("http://x/api/whatsapp/webhook", {
        method: "POST", headers: { "x-hub-signature-256": "sha256=not-a-signature" }, body: inboundBody,
      }),
    ];
    for (const req of requests) expect((await POST(req)).status).toBe(403);
    expect(await prisma.whatsAppMessage.count()).toBe(0);
    expect(await prisma.whatsAppConversation.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.message.received" } })).toBe(0);
  });

  it("rejects a body changed after signing, including JSON formatting changes", async () => {
    await makeConnection();
    const signedBody = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN1" }, messages: [{ id: "wamid.FORMAT", from: "233540000001", type: "text", text: { body: "raw body" } }] } }] }] });
    const formattedBody = JSON.stringify(JSON.parse(signedBody), null, 2);
    const req = new Request("http://x/api/whatsapp/webhook", {
      method: "POST", headers: { "x-hub-signature-256": sign(signedBody) }, body: formattedBody,
    });
    expect((await POST(req)).status).toBe(403);
    expect(await prisma.whatsAppMessage.count()).toBe(0);
    expect(await prisma.whatsAppConversation.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.message.received" } })).toBe(0);
  });

  it("rejects invalid UTF-8 after signature verification without storing an event", async () => {
    await makeConnection();
    const body = new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]);
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
    const req = new Request("http://x/api/whatsapp/webhook", {
      method: "POST", headers: { "x-hub-signature-256": signature }, body,
    });
    expect((await POST(req)).status).toBe(400);
    expect(await prisma.whatsAppMessage.count()).toBe(0);
  });

  it("stores a signed inbound message, conversation defaults to OWNER_ONLY, audit recorded", async () => {
    const { bizA } = await makeConnection();
    const res = await POST(postRequest(inboundBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, unknown: 0, statusUpdated: 0 });

    const conv = await prisma.whatsAppConversation.findFirstOrThrow({ where: { businessId: bizA.id } });
    expect(conv.mode).toBe("OWNER_ONLY");
    expect(conv.status).toBe("ACTIVE");
    expect(conv.customerPhone).toBe("233540000001");
    expect(conv.customerName).toBe("Ama Mensah");
    const msg = await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conv.id } });
    expect(msg).toMatchObject({ direction: "INBOUND", wamid: "wamid.TEST1", type: "text", status: "RECEIVED", text: "How much for the iPhone 13?", fromOwnerApp: false });
    expect(msg.timestampSent?.toISOString()).toBe("2024-10-20T04:53:20.000Z"); // 1729400000
    const audit = await prisma.auditEvent.findFirst({ where: { action: "whatsapp.message.received", businessId: bizA.id } });
    expect(audit).not.toBeNull();

    // Webhook retry of the same wamid is stored exactly once.
    const res2 = await POST(postRequest(inboundBody));
    expect(await res2.json()).toEqual({ received: 0, unknown: 0, statusUpdated: 0 });
    expect(await prisma.whatsAppMessage.count()).toBe(1);
    expect(await prisma.whatsAppConversation.count()).toBe(1);
  });

  it("routes by phone-number id and ignores traffic for unconfigured numbers", async () => {
    await makeConnection({ phoneNumberId: "PN1" });
    // Same tenant, but the payload names a phone number id nobody configured.
    const unknownBody = inboundBody.replace("PN1", "PN-UNKNOWN").replaceAll("wamid.TEST1", "wamid.TEST9");
    const res = await POST(postRequest(unknownBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0, unknown: 1, statusUpdated: 0 });
    expect(await prisma.whatsAppMessage.count()).toBe(0);
  });

  it("ignores DISCONNECTED connections", async () => {
    await makeConnection({ status: "DISCONNECTED" });
    const res = await POST(postRequest(inboundBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0, unknown: 1, statusUpdated: 0 });
    expect(await prisma.whatsAppMessage.count()).toBe(0);
  });

  it("returns 400 on a signed but malformed body", async () => {
    await makeConnection();
    const res = await POST(postRequest("not json"));
    expect(res.status).toBe(400);
    expect(await prisma.whatsAppMessage.count()).toBe(0);
  });
});
