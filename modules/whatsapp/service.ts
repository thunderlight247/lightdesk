/**
 * WhatsApp inbound recording (spec §3.4). M6b scope: every inbound message is stored and the
 * owning business gets an audit trail; conversations default to OWNER_ONLY mode, so no AI call
 * ever happens here. There is no send path in this module yet — outbound is M6d by design.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
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
