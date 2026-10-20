/**
 * WhatsApp inbound recording (spec §3.4). M6b scope: every inbound message is stored and the
 * owning business gets an audit trail; conversations default to OWNER_ONLY mode, so no AI call
 * ever happens here. There is no send path in this module yet — outbound is M6d by design.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { readSecretBoxKey, decryptSecret } from "@/lib/security/secret-box";
import { sendWhatsAppText } from "@/modules/whatsapp/graph";
import { readWhatsappConfig } from "@/modules/whatsapp/config";
import { requireMembership } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";
import type { InboundMessage } from "@/modules/whatsapp/webhooks";

export type ConnectionRecord = {
  id: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  coexistence: boolean;
};

export type RecordedInbound = { connection: ConnectionRecord; duplicate: boolean; conversationId: string };

/** Resolves the CONNECTED connection for a webhook payload's phone-number id, or null. */
export async function resolveConnection(phoneNumberId: string): Promise<ConnectionRecord | null> {
  const row = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId },
    select: { id: true, businessId: true, wabaId: true, phoneNumberId: true, displayPhoneNumber: true, coexistence: true, status: true },
  });
  if (!row || row.status !== "CONNECTED") return null;
  return row;
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Idempotent per wamid: webhook retries from Meta are stored exactly once. First message on a
 * (connection, customer) pair creates (or reuses) a conversation in OWNER_ONLY mode.
 */
export async function recordInboundMessage(msg: InboundMessage): Promise<RecordedInbound | null> {
  const connection = await resolveConnection(msg.phoneNumberId);
  if (!connection) return null;
  const sentAt = msg.timestamp !== null ? new Date(msg.timestamp * 1000) : null;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await tx.whatsAppConversation.upsert({
        where: { connectionId_customerPhone: { connectionId: connection.id, customerPhone: msg.fromPhone } },
        create: { connectionId: connection.id, businessId: connection.businessId, customerPhone: msg.fromPhone, customerName: msg.profileName },
        update: { ...(msg.profileName ? { customerName: msg.profileName } : {}), ...(sentAt || now ? { lastMessageAt: sentAt ?? now } : {}) },
      });
      const existing = await tx.whatsAppMessage.findUnique({ where: { wamid: msg.wamid }, select: { id: true } });
      if (existing) return { duplicate: true, conversationId: existing.id };
      const created = await tx.whatsAppMessage.create({
        data: {
          conversationId: conversation.id, connectionId: connection.id, direction: "INBOUND", wamid: msg.wamid,
          text: msg.text, type: msg.type, status: "RECEIVED",
          ...(sentAt ? { timestampSent: sentAt } : {}),
        },
      });
      await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: sentAt ?? now } });
      await recordAudit(tx, {
        action: "whatsapp.message.received",
        businessId: connection.businessId,
        targetType: "WhatsAppMessage",
        targetId: created.id,
        metadata: { conversationId: conversation.id, type: msg.type, name: "inbound" },
      });
      return { duplicate: false, conversationId: conversation.id };
    });
    return { connection, duplicate: result.duplicate, conversationId: result.conversationId };
  } catch (err) {
    if (isUnique(err)) {
      // A concurrent delivery of the same wamid raced us; treat as stored-once.
      const message = await prisma.whatsAppMessage.findUnique({ where: { wamid: msg.wamid }, select: { conversationId: true } });
      if (message) return { connection, duplicate: true, conversationId: message.conversationId };
    }
    throw err;
  }
}

// ---- M6d: outbound send gate (owner-approved replies only) ----------------------------------------------

export const FREE_SERVICE_MESSAGES_PER_MONTH = 1000;
export const SERVICE_WINDOW_MS = 24 * 3_600_000;
const MAX_OUTBOUND_TEXT_CHARS = 4000;

export type SendDeps = { fetchImpl?: typeof fetch; now?: () => Date };

/** Meter expiry boundary: the 1,000-free-message tier resets each calendar month. */
function firstOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function cleanReplyText(raw: unknown): string {
  if (typeof raw !== "string") throw new ValidationError("Invalid input");
  const v = raw.replace(/\r\n?/g, "\n").trim();
  if (v.length === 0 || v.length > MAX_OUTBOUND_TEXT_CHARS) {
    throw new ValidationError("Invalid input");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) {
    throw new ValidationError("Invalid input");
  }
  return v;
}

function windowOpensFrom(a: { timestampSent: Date | null; createdAt: Date }): Date {
  return a.timestampSent ?? a.createdAt;
}

/** What the owner needs before sending: 24h-window state and the monthly free-tier meter. */
export async function getSendReadiness(businessId: string, conversationId: string) {
  const conv = await prisma.whatsAppConversation.findFirst({ where: { id: conversationId, businessId } });
  if (!conv) throw new NotFoundError("Conversation not found");
  const now = new Date();
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: [{ timestampSent: "desc" }, { createdAt: "desc" }],
    select: { timestampSent: true, createdAt: true },
  });
  const windowOpen = lastInbound !== null && now.getTime() - windowOpensFrom(lastInbound).getTime() <= SERVICE_WINDOW_MS;
  const meterUsed = await prisma.whatsAppMessage.count({
    where: { connectionId: conv.connectionId, direction: "OUTBOUND", createdAt: { gte: firstOfMonth(now) } },
  });
  return {
    mode: conv.mode as string,
    status: conv.status as string,
    windowOpen,
    windowClosesAt: lastInbound ? new Date(windowOpensFrom(lastInbound).getTime() + SERVICE_WINDOW_MS) : null,
    meterUsed,
    meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0),
  };
}

export type SendOutcome =
  | { sent: true; wamid: string; meterUsed: number; meterFree: number }
  | { sent: false; reason: string; meterUsed: number; meterFree: number };

/**
 * Sends a free-form text reply. Every path is deliberately guarded:
 * the send needs `whatsapp:send` (owner/admin, individually audited), an open 24-hour
 * customer service window measured from the customer's LAST inbound message, the connection
 * must be attached, the stored token must decrypt, and the 1,000/month free-service tier is
 * surfaced — never silently exceeded without the caller knowing the meter value.
 */
export async function sendOwnerReply(
  actorId: string, businessId: string, conversationId: string,
  input: { text: unknown }, deps: SendDeps = {},
): Promise<SendOutcome> {
  const membership = await requireMembership(actorId, businessId);
  if (!can(membership.role, "whatsapp:send")) throw new ForbiddenError();
  const text = cleanReplyText(input.text);

  const now = (deps.now ?? (() => new Date()))();
  const conv = await prisma.whatsAppConversation.findFirst({ where: { id: conversationId, businessId } });
  if (!conv) throw new NotFoundError("Conversation not found");
  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: conv.connectionId } });
  if (!connection || connection.status !== "CONNECTED") {
    throw new NotFoundError("The WhatsApp connection is not active.");
  }

  const meterUsed0 = await prisma.whatsAppMessage.count({
    where: { connectionId: conv.connectionId, direction: "OUTBOUND", createdAt: { gte: firstOfMonth(now) } },
  });
  const meterFree = Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed0, 0);

  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: [{ timestampSent: "desc" }, { createdAt: "desc" }],
    select: { wamid: true, timestampSent: true, createdAt: true },
  });
  const windowOpen = lastInbound !== null && now.getTime() - windowOpensFrom(lastInbound).getTime() <= SERVICE_WINDOW_MS;
  if (!windowOpen) {
    return {
      sent: false,
      reason: "The 24-hour customer service window is closed. Reply from your own WhatsApp Business app, or wait for the customer to message again.",
      meterUsed: meterUsed0, meterFree,
    };
  }

  const key = readSecretBoxKey();
  const plaintextToken = key && connection.tokenCiphertext ? decryptSecret(connection.tokenCiphertext, key) : null;
  if (!plaintextToken) {
    await recordAudit(prisma, {
      action: "whatsapp.send.failed", actorUserId: actorId, businessId,
      targetType: "WhatsAppConversation", targetId: conversationId, metadata: { error: "token_unavailable" },
    });
    throw new ValidationError("The stored WhatsApp token could not be read. Reconnect the number in settings.");
  }

  const result = await sendWhatsAppText({
    accessToken: plaintextToken,
    phoneNumberId: connection.phoneNumberId,
    graphApiVersion: readWhatsappConfig().graphApiVersion,
    toPhone: conv.customerPhone,
    text,
    replyToWamid: lastInbound?.wamid ?? null,
  }, { fetchImpl: deps.fetchImpl });

  if (!result.ok) {
    await recordAudit(prisma, {
      action: "whatsapp.send.failed", actorUserId: actorId, businessId,
      targetType: "WhatsAppConversation", targetId: conversationId, metadata: { error: "send_error" },
    });
    return { sent: false, reason: `The WhatsApp send failed: ${result.message}`, meterUsed: meterUsed0, meterFree };
  }

  let recordedDuplicate = false;
  try {
    await prisma.whatsAppMessage.create({
      data: {
        conversationId: conv.id, connectionId: conv.connectionId, direction: "OUTBOUND",
        wamid: result.wamid, text, type: "text", status: "SENT", timestampSent: now,
      },
    });
  } catch (err) {
    if (isUnique(err)) {
      recordedDuplicate = true; // Graph already recorded this send (retry race); do not duplicate rows.
    } else {
      throw err;
    }
  }
  await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { lastMessageAt: now } });
  const meterUsed = meterUsed0 + (recordedDuplicate ? 0 : 1);
  await recordAudit(prisma, {
    action: "whatsapp.message.sent", actorUserId: actorId, businessId,
    targetType: "WhatsAppConversation", targetId: conversationId,
    metadata: { meterUsed, meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0) },
  });
  return { sent: true, wamid: result.wamid, meterUsed, meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0) };
}
