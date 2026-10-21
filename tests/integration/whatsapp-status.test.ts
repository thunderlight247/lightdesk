import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resetDb } from "../helpers/db";
import { POST } from "@/app/api/whatsapp/webhook/route";

// Route configuration comes from process.env; set and restore it per test.
const ENV_KEYS = ["WHATSAPP_APP_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.WHATSAPP_APP_SECRET = "status-test-secret";
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function signedPost(body: string) {
  const sig = `sha256=${createHmac("sha256", "status-test-secret").update(body, "utf8").digest("hex")}`;
  return POST(new Request("http://x/api/whatsapp/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body,
  }));
}

const statusesBody = (wamid: string, status: string, errors?: unknown[]) => JSON.stringify({
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN-ST" },
    statuses: [{ id: wamid, status, timestamp: "1792555000", ...(errors ? { errors } : {}) }],
  } }] }],
});

let state: {
  connection: { id: string };
  conversation: { id: string };
  sent: { id: string; wamid: string };
};

// Prisma's full row type allows nullable wamid; the seeded rows always provide it.
const sentRow = (row: { id: string; wamid: string | null }) => ({ id: row.id, wamid: row.wamid! });

async function seedThread() {
  const connection = await prisma.whatsAppConnection.create({
    data: { businessId: (await prisma.business.findFirstOrThrow({ where: { name: "Biz A" } })).id, wabaId: "WABA1", phoneNumberId: "PN-ST", displayPhoneNumber: "+1 555-000-1111", tokenCiphertext: "x" },
  });
  const businessId = connection.businessId;
  const conversation = await prisma.whatsAppConversation.create({
    data: { connectionId: connection.id, businessId, customerPhone: "233540111222" },
  });
  const sent = await prisma.whatsAppMessage.create({
    data: { conversationId: conversation.id, connectionId: connection.id, direction: "OUTBOUND", wamid: "wamid.OUT-ST1", text: "answer", type: "text", status: "SENT" },
  });
  state = { connection, conversation, sent: sentRow(sent) };
  return { businessId, sent };
}

beforeEach(async () => {
  // Clean FIRST: under the full suite the previous file's seeds can survive into this file.
  await resetDb();
  // Standard two-tenant seed (owner/admin/member + Biz B) provides the isolation material.
  const { makeUser, addMember, makeBusiness } = await import("../helpers/db");
  const ownerA = await makeUser("owner-a@test.example");
  const bizA = await makeBusiness("Biz A", "biz-a");
  await addMember(bizA.id, ownerA.id, "OWNER");
  await makeBusiness("Biz B", "biz-b");
  await seedThread();
});
afterEach(async () => {
  await resetDb();
});

describe("M6d delivery status callbacks", () => {
  it("advances SENT -> DELIVERED -> READ over the same webhook", async () => {
    let res = await signedPost(statusesBody(state.sent.wamid, "delivered"));
    expect(await res.json()).toEqual({ received: 0, unknown: 0, statusUpdated: 1 });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: state.sent.id } })).status).toBe("DELIVERED");
    res = await signedPost(statusesBody(state.sent.wamid, "read"));
    expect(await res.json()).toEqual({ received: 0, unknown: 0, statusUpdated: 1 });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: state.sent.id } })).status).toBe("READ");
    // No audit spam for normal progress; failures are the only audited status.
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.message.failed" } })).toBe(0);
  });

  it("never moves backwards: DELIVERED after READ is ignored", async () => {
    await signedPost(statusesBody(state.sent.wamid, "read"));
    await signedPost(statusesBody(state.sent.wamid, "delivered"));
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: state.sent.id } })).status).toBe("READ");
  });

  it("stores the failure reason and audits it — never auto-resending", async () => {
    const res = await signedPost(statusesBody(state.sent.wamid, "failed", [
      { code: 131031, title: "Business Account locked", message: "Business Account locked", error_data: { details: "Business account has been locked." } },
    ]));
    expect(await res.json()).toEqual({ received: 0, unknown: 0, statusUpdated: 1 });
    const row = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: state.sent.id } });
    expect(row.status).toBe("FAILED");
    expect(row.errorInfo).toMatchObject({ code: 131031, details: "Business account has been locked." });
    const audits = await prisma.auditEvent.findMany({ where: { action: "whatsapp.message.failed" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(state.sent.id);
    expect(JSON.stringify(audits[0].metadata)).toContain("Business account has been locked.");
    // Nothing is removed or resent: the failure stays visible in the owner console.
    expect(await prisma.whatsAppMessage.count({ where: { id: state.sent.id, status: "SENT" } })).toBe(0);
  });

  it("ignores unknown wamids without touching rows", async () => {
    await signedPost(statusesBody("wamid.NEVER-SEEN", "read"));
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: state.sent.id } })).status).toBe("SENT");
    expect(await prisma.auditEvent.count({ where: { action: "whatsapp.message.failed" } })).toBe(0);
  });

  it("never changes INBOUND rows and ignores unrecognized statuses", async () => {
    const inbound = await prisma.whatsAppMessage.create({
      data: { conversationId: state.conversation.id, connectionId: state.connection.id, direction: "INBOUND", wamid: "wamid.IN-SET", text: "q", type: "text", status: "RECEIVED" },
    });
    await signedPost(statusesBody(inbound.wamid!, "read"));
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: inbound.id } })).status).toBe("RECEIVED");
    await signedPost(statusesBody("wamid.NEVER-SEEN-2", "queued"));
    expect(await prisma.whatsAppMessage.count({ where: { status: "DRAFT" } })).toBe(0);
  });

  it("is tenant-scoped: only this connection's rows move", async () => {
    const bizB = await prisma.business.findFirstOrThrow({ where: { name: "Biz B" } });
    const otherConnection = await prisma.whatsAppConnection.create({
      data: { businessId: bizB.id, wabaId: "WABA2", phoneNumberId: "PN-ST-OTHER", displayPhoneNumber: "+1 000", tokenCiphertext: "x" },
    });
    const otherConversation = await prisma.whatsAppConversation.create({
      data: { connectionId: otherConnection.id, businessId: bizB.id, customerPhone: "15550002" },
    });
    const otherRow = await prisma.whatsAppMessage.create({
      data: { conversationId: otherConversation.id, connectionId: otherConnection.id, direction: "OUTBOUND", wamid: "wamid.OTHER-TENANT", text: "x", type: "text", status: "SENT" },
    });
    await signedPost(statusesBody(otherRow.wamid!, "delivered"));
    // The status came for PN-ST; Biz B's row belongs to another phone number id.
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: otherRow.id } })).status).toBe("SENT");
  });
});
