/**
 * WhatsApp inbound recording (spec §3.4). M6b scope: every inbound message is stored and the
 * owning business gets an audit trail; conversations default to OWNER_ONLY mode, so no AI call
 * ever happens here. There is no send path in this module yet — outbound is M6d by design.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import type { WhatsAppMessageStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { readSecretBoxKey, decryptSecret } from "@/lib/security/secret-box";
import type { AiProvider } from "@/modules/lab/ai/types";
import { sendWhatsAppText } from "@/modules/whatsapp/graph";
import { readWhatsappConfig } from "@/modules/whatsapp/config";
import { pendingInboundForAssist, runInboundAssist } from "@/modules/whatsapp/assist";
import { SENT_LIKE_STATUSES } from "@/modules/whatsapp/statuses";
import { flushDueMessages, recordSendFailure, recordSendSuccess } from "@/modules/whatsapp/outbox";
import {
  QUEUE_MAX_ATTEMPTS,
  QUEUE_UNKNOWN_MAX_ATTEMPTS,
  SERVICE_WINDOW_MS,
  queueBackoffDelayMs,
} from "@/modules/whatsapp/queue-policy";
import { requireMembership, requirePermission } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";
import type { InboundMessage } from "@/modules/whatsapp/webhooks";
import { assertPilotOutboundAllowed, requirePilotActive, checkUsageCaps } from "@/modules/pilot/service";
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
    // ADR 0010 trigger 1: the customer just messaged — this is the most natural moment to
    // drain the outage queue (a talking customer has a due reply flushed by their own message).
    // Best-effort: a flush problem must never drop the inbound message which was already stored.
    try {
      await flushDueMessages(connection.id, { limit: 10 });
    } catch (flushErr) {
      if (!(flushErr instanceof NotFoundError)) console.warn("outbox flush failed after inbound record", flushErr);
    }
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
// Re-exported so existing callers of this module keep working (ADR 0010 moved the
// shared window constant into queue-policy.ts, which the outbox flush also uses).
export { SERVICE_WINDOW_MS } from "@/modules/whatsapp/queue-policy";
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
export async function getSendReadiness(actorId: string, businessId: string, conversationId: string) {
  await requirePermission(actorId, businessId, "whatsapp:read");
  const conv = await prisma.whatsAppConversation.findFirst({ where: { id: conversationId, businessId } });
  if (!conv) throw new NotFoundError("Conversation not found");
  const now = new Date();
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: [{ timestampSent: "desc" }, { createdAt: "desc" }],
    select: { timestampSent: true, createdAt: true },
  });
  const windowOpen = lastInbound !== null && now.getTime() - windowOpensFrom(lastInbound).getTime() <= SERVICE_WINDOW_MS;
  // DRAFT rows are not sends: the monthly free-tier meter counts sent traffic only.
  const meterUsed = await prisma.whatsAppMessage.count({
    where: { connectionId: conv.connectionId, direction: "OUTBOUND", status: { in: SENT_LIKE_STATUSES }, createdAt: { gte: firstOfMonth(now) } },
  });
  // M7: pilot caps and consent state ride along so every console shows the truth.
  const caps = await checkUsageCaps(businessId, now);
  const pilot = await requirePilotActive(businessId);
  // M8 (ADR 0010): outage-queue and provider-health facts, so every console shows the truth.
  const connectionState = await prisma.whatsAppConnection.findUnique({
    where: { id: conv.connectionId },
    select: { providerDownSince: true, consecutiveSendFailures: true },
  });
  const queuedRows = await prisma.whatsAppMessage.findMany({
    where: { conversationId, connectionId: conv.connectionId, status: "QUEUED" },
    orderBy: [{ nextAttemptAt: "asc" }, { queuedAt: "asc" }],
    select: { queuedAt: true, nextAttemptAt: true },
  });
  return {
    mode: conv.mode as string,
    status: conv.status as string,
    windowOpen,
    windowClosesAt: lastInbound ? new Date(windowOpensFrom(lastInbound).getTime() + SERVICE_WINDOW_MS) : null,
    meterUsed,
    meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0),
    pilotOk: pilot.ok,
    pilotCapped: caps.outboundCap !== null && caps.outboundUsed >= caps.outboundCap,
    // One approved reply at a time: the send gate while a queued row is retrying.
    queued: queuedRows.length > 0
      ? { count: queuedRows.length, oldestQueuedAt: queuedRows[0].queuedAt, nextRetryAt: queuedRows[0].nextAttemptAt }
      : null,
    // Derived evidence only: the breaker never blocks a send by itself (ADR 0010 §6).
    providerDegraded: connectionState?.providerDownSince
      ? { since: connectionState.providerDownSince, failures: connectionState.consecutiveSendFailures }
      : null,
  };
}

export type SendOutcome =
  | { sent: true; wamid: string; meterUsed: number; meterFree: number }
  | { sent: false; reason: string; meterUsed: number; meterFree: number; queued?: boolean };

export async function listWhatsAppConversations(actorId: string, businessId: string) {
  await requirePermission(actorId, businessId, "whatsapp:read");
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { businessId, status: "CONNECTED" },
    select: { id: true, displayPhoneNumber: true, coexistence: true,      status: true },
  });
  if (!connection) return { connection: null, conversations: [], queuedCount: 0, providerDegraded: null };
  // ADR 0010 trigger 1: reading the inbox is a chance to drain the outage queue before it renders.
  await flushDueMessages(connection.id, { limit: 10 }).catch((err) => {
    if (!(err instanceof NotFoundError)) throw err; // connection gone mid-flush: just render
  });
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { businessId, connectionId: connection.id },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true, customerPhone: true, customerName: true, mode: true, status: true,
      escalationReason: true, lastMessageAt: true, createdAt: true,
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, type: true, direction: true } },
    },
  });
  const [queuedCount, connState] = await Promise.all([
    prisma.whatsAppMessage.count({ where: { connectionId: connection.id, status: "QUEUED" } }),
    prisma.whatsAppConnection.findUnique({
      where: { id: connection.id },
      select: { providerDownSince: true, consecutiveSendFailures: true },
    }),
  ]);
  return {
    connection,
    queuedCount,
    providerDegraded: connState?.providerDownSince
      ? { since: connState.providerDownSince, failures: connState.consecutiveSendFailures }
      : null,
    conversations: conversations.map(({ _count, messages, ...c }) => ({
      ...c,
      messageCount: _count.messages,
      lastMessagePreview: messages[0]?.text ?? `[${messages[0]?.type ?? "message"}]`,
      lastMessageDirection: messages[0]?.direction ?? null,
    })),
  };
}

export async function getWhatsAppConversation(actorId: string, businessId: string, conversationId: string) {
  await requirePermission(actorId, businessId, "whatsapp:read");
  const conversation = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
    select: {
      id: true, connectionId: true, customerPhone: true, customerName: true, mode: true,
      status: true, escalationReason: true, lastMessageAt: true, createdAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, direction: true, text: true, type: true, status: true, timestampSent: true, createdAt: true, fromOwnerApp: true,
          // M8 (ADR 0010): queue bookkeeping shown on the review surface:
          queuedAt: true, nextAttemptAt: true, attempts: true,
          // M6c review-surface fields + M6d status-callback reason:
          errorInfo: true,
          draftState: true, source: true, resultStatus: true, reason: true, missingInformation: true,
          escalationReason: true, evidence: true, profileRevision: true, approvedContent: true,
        },
      },
    },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  // ADR 0010 trigger 1: opening the conversation may first deliver a due queued reply.
  await flushDueMessages(conversation.connectionId, { limit: 10 }).catch((err) => {
    if (!(err instanceof NotFoundError)) throw err; // connection gone mid-flush: just render
  });
  const readiness = await getSendReadiness(actorId, businessId, conversationId);
  const latestDraft = [...conversation.messages].reverse().find((m) => m.draftState === "DRAFT") ?? null;
  return { conversation, readiness, latestDraft };
}

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

  // ADR 0010 trigger 1: every owner send attempt first drains the outage queue for this
  // connection — an earlier approved reply may still be deliverable.
  await flushDueMessages(connection.id, { now: () => now, fetchImpl: deps.fetchImpl, limit: 10 }).catch((err) => {
    if (!(err instanceof NotFoundError)) throw err;
  });

  const meterUsed0 = await prisma.whatsAppMessage.count({
    where: { connectionId: conv.connectionId, direction: "OUTBOUND", status: { in: SENT_LIKE_STATUSES }, createdAt: { gte: firstOfMonth(now) } },
  });
  const meterFree = Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed0, 0);

  // ADR 0010: one approved reply at a time for a conversation — a queued row blocks new sends
  // until it sends, is cancelled or expires (the console disables the form for the same reason).
  const pendingQueued = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conv.id, status: "QUEUED" },
    select: { id: true },
  });
  if (pendingQueued) {
    return {
      sent: false,
      reason: "An earlier approved reply is still queued for retry. Cancel or wait for it to send before composing a new one.",
      meterUsed: meterUsed0, meterFree,
    };
  }

  // M7 pilot control layer: consent gate first (nothing restricted works without an active
  // pilot), then the hard monthly outbound cap — BOTH before the token read and any Graph
  // request, each with a distinct reason and its own audit record.
  const pilotReasons = await assertPilotOutboundAllowed(businessId, now);
  if (pilotReasons) {
    await recordAudit(prisma, {
      action: "pilot.send.blocked", actorUserId: actorId, businessId,
      targetType: "WhatsAppConversation", targetId: conversationId, metadata: { reason: pilotReasons.join(" ") },
    });
    return { sent: false, reason: pilotReasons.join(" "), meterUsed: meterUsed0, meterFree };
  }
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
    if (result.retryable && result.kind !== "PERMANENT") {
      // ADR 0010 §3/§4: a transient outage queues the approved text instead of losing it.
      // QUEUED rows never count toward the meter (statuses.ts), and the owner's reviewed draft
      // is consumed exactly as on a successful send.
      const attempts = 1;
      const maxAttempts = result.kind === "TRANSIENT_ONCE" ? QUEUE_UNKNOWN_MAX_ATTEMPTS : QUEUE_MAX_ATTEMPTS;
      const queuedRow = await prisma.$transaction(async (tx) => {
        const created = await tx.whatsAppMessage.create({
          data: {
            conversationId: conv.id, connectionId: conv.connectionId, direction: "OUTBOUND",
            text, type: "text", status: "QUEUED",
            queuedAt: now,
            nextAttemptAt: new Date(now.getTime() + queueBackoffDelayMs(attempts, result.retryAfterMs, conv.id)),
            attempts: 0, maxAttempts, // jitter seed: the row id does not exist yet; conv id is stable
            lastErrorKind: result.kind, lastErrorAt: now,
            approvedContent: text, approvedById: actorId, approvedAt: now,
          },
        });
        await tx.whatsAppMessage.updateMany({
          where: { conversationId: conv.id, draftState: "DRAFT" },
          data: { draftState: "SUPERSEDED" },
        });
        await tx.whatsAppConversation.update({ where: { id: conv.id }, data: { lastMessageAt: now } });
        await recordAudit(tx, {
          action: "whatsapp.send.queued", actorUserId: actorId, businessId,
          targetType: "WhatsAppMessage", targetId: created.id,
          metadata: {
            errorKind: result.kind, attempts, maxAttempts,
            nextRetryAt: created.nextAttemptAt?.toISOString() ?? null,
          },
        });
        return created;
      });
      await recordSendFailure(connection.id, now);
      return {
        sent: false,
        reason: `Meta's messaging service is temporarily unavailable. Your approved reply is queued and will retry automatically (first attempt around ${queuedRow.nextAttemptAt?.toISOString() ?? "soon"}). Nothing is lost.`,
        meterUsed: meterUsed0, meterFree, queued: true,
      };
    }
    await recordAudit(prisma, {
      action: "whatsapp.send.failed", actorUserId: actorId, businessId,
      targetType: "WhatsAppConversation", targetId: conversationId,
      metadata: { error: "send_error", errorKind: result.kind },
    });
    return { sent: false, reason: `The WhatsApp send failed: ${result.message}`, meterUsed: meterUsed0, meterFree };
  }

  // Any success closes the breaker (ADR 0010 §6): reset the streak, audit once per transition.
  await recordSendSuccess(connection.id);

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

  // M6c review surface: the draft the owner reviewed is now used — the original draft text is
  // never edited; the text actually sent is recorded on it (edited flag), and every older
  // draft becomes SUPERSEDED (kept, not deleted — same rule as the lab).
  const latestDraft = await prisma.whatsAppMessage.findFirst({
    where: { conversationId: conv.id, draftState: "DRAFT" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latestDraft) {
    await prisma.whatsAppMessage.updateMany({ where: { conversationId: conv.id, draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
    await prisma.whatsAppMessage.update({
      where: { id: latestDraft.id },
      data: { approvedContent: text, approvedById: actorId, approvedAt: now },
    });
  }

  const meterUsed = meterUsed0 + (recordedDuplicate ? 0 : 1);
  await recordAudit(prisma, {
    action: "whatsapp.message.sent", actorUserId: actorId, businessId,
    targetType: "WhatsAppConversation", targetId: conversationId,
    metadata: {
      meterUsed, meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0),
      ...(latestDraft ? { fromDraftId: latestDraft.id } : {}),
    },
  });
  return { sent: true, wamid: result.wamid, meterUsed, meterFree: Math.max(FREE_SERVICE_MESSAGES_PER_MONTH - meterUsed, 0) };
}

// ---- M6c: human control model (spec §3.3) -----------------------------------------------------------------
// The AI never controls the mode, only the owner/admin do, and every transition is audited.
// Takeover is switching AI_ASSIST -> OWNER_ONLY: the pending draft is marked SUPERSEDED (kept,
// not deleted) and the very next inbound message drafting stops. "Hand back to AI" is the
// symmetric OWNER_ONLY -> AI_ASSIST switch; the still-unanswered inbound immediately gets a
// draft through the same live assist path the webhook uses.

export type ModeChange = { mode: "OWNER_ONLY" | "AI_ASSIST"; changed: boolean; draft?: { produced: boolean; reason?: string } };

export async function setConversationMode(
  actorId: string, businessId: string, conversationId: string,
  input: { mode: unknown }, deps: { provider?: AiProvider; now?: () => Date } = {},
): Promise<ModeChange> {
  const membership = await requireMembership(actorId, businessId);
  if (!can(membership.role, "whatsapp:send")) throw new ForbiddenError();
  if (typeof input.mode !== "string" || (input.mode !== "OWNER_ONLY" && input.mode !== "AI_ASSIST")) {
    throw new ValidationError("Invalid mode");
  }
  const mode = input.mode;

  // M7 pilot gate: an enrolled business that is not ACTIVE (consent missing, paused, exited)
  // cannot switch a conversation to AI_ASSIST. Takeover (OWNER_ONLY) stays always allowed.
  if (mode === "AI_ASSIST") {
    const pilot = await requirePilotActive(businessId);
    if (!pilot.ok) throw new ForbiddenError(pilot.reason);
  }

  const conv = await prisma.whatsAppConversation.findFirst({ where: { id: conversationId, businessId } });
  if (!conv) throw new NotFoundError("Conversation not found");
  if (conv.status === "RESOLVED") throw new ConflictError("This conversation is resolved.");
  if (conv.mode === mode) return { mode, changed: false };

  return prisma.$transaction(async (tx) => {
    // Race-guard the transition: only change a row still in the expected mode.
    const { count } = await tx.whatsAppConversation.updateMany({
      where: { id: conv.id, mode: conv.mode },
      data: { mode },
    });
    if (count !== 1) throw new ConflictError("The conversation control mode was changed by someone else. Reload and try again.");

    if (mode === "OWNER_ONLY") {
      // Takeover: pending drafts are clearly marked stale, not deleted.
      await tx.whatsAppMessage.updateMany({ where: { conversationId: conv.id, draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
    }
    await recordAudit(tx, {
      action: "whatsapp.conversation.mode_changed", actorUserId: actorId, businessId,
      targetType: "WhatsAppConversation", targetId: conv.id,
      metadata: { from: conv.mode as string, to: mode, takeover: mode === "OWNER_ONLY" && conv.mode === "AI_ASSIST" },
    });
    return { mode, changed: true } as ModeChange;
  }).then(async (change) => {
    if (mode === "AI_ASSIST") {
      // Draft the still-unanswered inbound message (if any) through the same assisted path.
      const pending = await pendingInboundForAssist(conversationId);
      if (pending) {
        const outcome = await runInboundAssist(
          { businessId, conversationId, wamid: pending.wamid, text: pending.text },
          { provider: deps.provider, now: deps.now },
        );
        return { ...change, draft: { produced: outcome.produced, reason: outcome.produced ? undefined : outcome.reason } };
      }
    }
    return change;
  });
}

// ---- M6d: delivery status callbacks -----------------------------------------------------------------------
// Meta reports sent/delivered/read/failed for OUTBOUND rows. Transitions are monotonic
// (SENT -> DELIVERED -> READ; FAILED only before READ), scoped to this connection's rows
// (tenant isolation), failures store the reason and are audited; other statuses just move
// the row so the owner console always shows the freshest truth.

const STATUS_RANK: Readonly<Record<string, number>> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

export type StatusUpdateResult = { updated: number; ignored: number };

export async function processStatusUpdates(
  phoneNumberId: string,
  statuses: { wamid: string; status: string; timestamp: number | null; errors: { code: number | null; title: string | null; message: string | null; details: string | null }[] }[],
): Promise<StatusUpdateResult> {
  const connection = await resolveConnection(phoneNumberId);
  if (!connection) return { updated: 0, ignored: statuses.length };
  let updated = 0;
  let ignored = 0;
  for (const s of statuses) {
    const target = s.status.toUpperCase();
    const rank = STATUS_RANK[target];
    if (rank === undefined) { ignored += 1; continue; }
    const row = await prisma.whatsAppMessage.findUnique({
      where: { wamid: s.wamid },
      select: { id: true, connectionId: true, direction: true, status: true },
    });
    if (!row || row.connectionId !== connection.id || row.direction !== "OUTBOUND") { ignored += 1; continue; }
    const currentRank = STATUS_RANK[row.status] ?? 0;
    if (rank <= currentRank) { ignored += 1; continue; } // monotonic: never move backwards
    const failure = target === "FAILED" ? s.errors.at(-1) : undefined;
    await prisma.whatsAppMessage.update({
      where: { id: row.id },
      data: {
        status: target as WhatsAppMessageStatus, // validated: only these four statuses pass the rank map
        ...(target === "FAILED"
          ? { errorInfo: { code: failure?.code ?? null, title: failure?.title ?? null, details: failure?.details ?? failure?.message ?? null } as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (target === "FAILED") {
      await recordAudit(prisma, {
        action: "whatsapp.message.failed", businessId: connection.businessId,
        targetType: "WhatsAppMessage", targetId: row.id,
        metadata: { reason: failure?.details ?? failure?.title ?? failure?.message ?? "delivery failed" },
      });
    }
    updated += 1;
  }
  return { updated, ignored };
}

// ---- M8 (ADR 0010 §4): owner cancel of a queued, not-yet-sent reply --------------------------
// Cancel is terminal and simple: status -> FAILED with errorInfo.code = CANCELLED_BY_OWNER.
// It never re-opens the row as a draft (that would re-create a second lifecycle on one row).
export async function cancelQueuedSend(
  actorId: string, businessId: string, conversationId: string, messageId: string,
): Promise<{ cancelled: boolean }> {
  const membership = await requireMembership(actorId, businessId);
  if (!can(membership.role, "whatsapp:send")) throw new ForbiddenError();
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
    select: { id: true },
  });
  if (!conv) throw new NotFoundError("Conversation not found");
  const row = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, conversationId: conv.id, status: "QUEUED" },
    select: { id: true },
  });
  if (!row) throw new NotFoundError("Queued reply not found");
  // Race-guard: only a still-queued row can be cancelled (a concurrent flush flush may have sent it).
  const { count } = await prisma.whatsAppMessage.updateMany({
    where: { id: row.id, status: "QUEUED" },
    data: {
      status: "FAILED",
      errorInfo: { code: "CANCELLED_BY_OWNER", title: "Cancelled", details: "The owner cancelled this queued reply before it could be sent." },
      nextAttemptAt: null,
    },
  });
  if (count === 0) throw new ConflictError("The queued reply already left the queue. Reload and try again.");
  await recordAudit(prisma, {
    action: "whatsapp.send.cancelled", actorUserId: actorId, businessId,
    targetType: "WhatsAppMessage", targetId: row.id,
    metadata: { conversationId: conversationId },
  });
  return { cancelled: true };
}
