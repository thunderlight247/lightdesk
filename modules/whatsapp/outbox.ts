/**
 * WhatsApp outbox flush engine (ADR 0010 §5). Drains QUEUED outbound rows whose next attempt
 * is due, through guarded Graph calls (graph.ts classification). TRANSIENT re-queues with the
 * next backoff (and feeds the circuit breaker, one fast-fail per pass); PERMANENT, a closed
 * 24-hour window, or exhausted retries go terminal FAILED with an errorInfo code.
 *
 * Gates held-not-failed (per ADR §4): pilot consent/caps, token decryptability, connection
 * state — they keep rows QUEUED. Only the window and retry exhaustion fail a row.
 */
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
import { NotFoundError } from "@/lib/security/errors";
import { decryptSecret, readSecretBoxKey } from "@/lib/security/secret-box";
import { sendWhatsAppText } from "@/modules/whatsapp/graph";
import { readWhatsappConfig } from "@/modules/whatsapp/config";
import { assertPilotOutboundAllowed } from "@/modules/pilot/service";
import {
  QUEUE_MAX_ATTEMPTS,
  SERVICE_WINDOW_MS,
  queueBackoffDelayMs,
} from "@/modules/whatsapp/queue-policy";

const FLUSH_DISCONNECT_REASON = "The WhatsApp connection is not active.";

export type FlushOutcome = {
  found: number; // QUEUED rows due when the pass started
  sent: number;
  failedTerminal: number; // EXPIRED_WINDOW / EXHAUSTED_RETRIES / permanent at flush
  held: number; // still QUEUED: gate held (pilot, token, connection)
  leftDue: number; // skipped because a transient failure stopped this pass
  breakerOpen: boolean;
};

export type FlushDeps = { now?: () => Date; fetchImpl?: typeof fetch; limit?: number };

function windowFloor(a: { timestampSent: Date | null; createdAt: Date }): Date {
  return a.timestampSent ?? a.createdAt;
}

// ---- Circuit breaker (ADR 0010 §6) ---------------------------------------------------

export const BREAKER_OPEN_AFTER = 3;

export type BreakerResult = { failures: number; openSince: Date | null; opened: boolean; closed: boolean };

/** Bump after a transient send/flush failure; opens at >= 3 consecutive; audited once per transition. */
export async function recordSendFailure(connectionId: string, now: Date): Promise<BreakerResult> {
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, businessId: true, consecutiveSendFailures: true, providerDownSince: true },
  });
  if (!conn) throw new NotFoundError(FLUSH_DISCONNECT_REASON);
  const failures = conn.consecutiveSendFailures + 1;
  const openSince = failures >= BREAKER_OPEN_AFTER ? (conn.providerDownSince ?? now) : null;
  // providerDownSince resets whenever a send succeeds again (kept via the recordSendSuccess path);
  // a closure only ever happens there, so this write never re-opens a closed breaker.
  if (openSince) {
    await prisma.whatsAppConnection.update({
      where: { id: connectionId },
      data: { consecutiveSendFailures: failures, providerDownSince: openSince },
    });
    const opened = conn.providerDownSince === null;
    if (opened) {
      await recordAudit(prisma, {
        action: "whatsapp.provider.outage.open",
        businessId: conn.businessId,
        targetType: "WhatsAppConnection",
        targetId: connectionId,
        metadata: { failures, since: openSince.toISOString() },
      });
    }
    return { failures, openSince, opened, closed: false };
  }
  // Still below the threshold: just count the failure.
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { consecutiveSendFailures: failures, providerDownSince: null },
  });
  return { failures, openSince: null, opened: false, closed: false };
}

/** Reset on any successful send: zeroes the streak and closes the breaker once per transition. */
export async function recordSendSuccess(connectionId: string): Promise<BreakerResult> {
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, businessId: true, consecutiveSendFailures: true, providerDownSince: true },
  });
  if (!conn) throw new NotFoundError(FLUSH_DISCONNECT_REASON);
  if (conn.consecutiveSendFailures === 0 && conn.providerDownSince === null) return { failures: 0, openSince: null, opened: false, closed: false };
  const wasOpen = conn.providerDownSince !== null;
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { consecutiveSendFailures: 0, providerDownSince: null },
  });
  if (wasOpen) {
    await recordAudit(prisma, {
      action: "whatsapp.provider.outage.closed",
      businessId: conn.businessId,
      targetType: "WhatsAppConnection",
      targetId: connectionId,
      metadata: { failures: conn.consecutiveSendFailures, since: conn.providerDownSince?.toISOString() ?? null },
    });
  }
  return { failures: 0, openSince: null, opened: false, closed: wasOpen };
}

// ---- Flush engine ---------------------------------------------------------------------

function outcomeFor(found: number): FlushOutcome {
  return { found, sent: 0, failedTerminal: 0, held: 0, leftDue: 0, breakerOpen: false };
}

/**
 * Flushes due QUEUED rows for one connection, oldest attempt first. Sequential Graph calls;
 * a transient failure updates the breaker and stops the pass fast-fail (remaining rows stay
 * correctly due). Retries consult neither the AI nor any model: queued rows are approved text.
 */
export async function flushDueMessages(
  connectionId: string,
  opts: FlushDeps = {},
): Promise<FlushOutcome> {
  const now = opts.now ? opts.now() : new Date();
  const rows = await prisma.whatsAppMessage.findMany({
    where: { connectionId, status: "QUEUED", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { queuedAt: "asc" }],
    take: opts.limit ?? 10,
    select: {
      id: true, conversationId: true, text: true, attempts: true, maxAttempts: true,
      lastErrorKind: true, lastErrorAt: true, queuedAt: true,
      conversation: { select: { businessId: true, customerPhone: true } },
    },
  });
  if (rows.length === 0) return outcomeFor(0);

  const out = outcomeFor(rows.length);

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, businessId: true, phoneNumberId: true, status: true, tokenCiphertext: true },
  });
  const key = readSecretBoxKey();
  const plaintextToken = connection && connection.status === "CONNECTED" && connection.tokenCiphertext && key !== null
    ? decryptSecret(connection.tokenCiphertext, key)
    : null;
  if (!connection || connection.status !== "CONNECTED") {
    return { ...out, held: rows.length, breakerOpen: false }; // connection off → hold, not fail
  }
  if (plaintextToken === null) {
    await recordAudit(prisma, {
      action: "whatsapp.send.failed",
      businessId: connection.businessId,
      targetType: "WhatsAppMessage",
      metadata: { stage: "outbox.flush", hold: true, errorKind: "token_unavailable", queuedCount: rows.length },
    });
    return { ...out, held: rows.length, breakerOpen: false };
  }

  // Pilot gate is business-level: one check per pass, holds (never fails) these rows.
  const pilotReasons = await assertPilotOutboundAllowed(connection.businessId, now);
  if (pilotReasons) {
    await recordAudit(prisma, {
      action: "pilot.send.blocked",
      businessId: connection.businessId,
      targetType: "WhatsAppConnection",
      targetId: connectionId,
      metadata: { stage: "outbox.flush", reason: pilotReasons.join(" "), queuedCount: rows.length },
    });
    return { ...out, held: rows.length, breakerOpen: false };
  }

  const config = readWhatsappConfig();
  for (const row of rows) {
    // A queued row's window came from its conversation's LAST inbound message. Queueing never
    // extends it — the window check runs again at every attempt.
    const lastInbound = await prisma.whatsAppMessage.findFirst({
      where: { conversationId: row.conversationId, direction: "INBOUND" },
      orderBy: [{ timestampSent: "desc" }, { createdAt: "desc" }],
      select: { wamid: true, timestampSent: true, createdAt: true },
    });
    const windowClosesAt = lastInbound
      ? windowFloor(lastInbound).getTime() + SERVICE_WINDOW_MS
      : 0;
    if (windowClosesAt < now.getTime()) {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorInfo: { code: "EXPIRED_WINDOW", title: "Outbound retry expired", details: "The 24-hour service window closed before the queued reply could be sent." },
          nextAttemptAt: null,
        },
      });
      await recordAudit(prisma, {
        action: "whatsapp.send.expired",
        businessId: connection.businessId,
        targetType: "WhatsAppMessage",
        targetId: row.id,
        metadata: { attempts: row.attempts, queuedAt: row.queuedAt?.toISOString() ?? null },
      });
      out.failedTerminal += 1;
      continue;
    }

    const result = await sendWhatsAppText(
      {
        accessToken: plaintextToken,
        phoneNumberId: connection.phoneNumberId,
        graphApiVersion: config.graphApiVersion,
        toPhone: row.conversation.customerPhone,
        text: row.text ?? "",
        replyToWamid: lastInbound?.wamid ?? null,
      },
      { fetchImpl: opts.fetchImpl },
    );

    if (result.ok) {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: { status: "SENT", wamid: result.wamid, timestampSent: now, nextAttemptAt: null },
      });
      await prisma.whatsAppConversation.update({
        where: { id: row.conversationId },
        data: { lastMessageAt: now },
      });
      await recordSendSuccess(connectionId);
      await recordAudit(prisma, {
        action: "whatsapp.message.sent",
        businessId: connection.businessId,
        targetType: "WhatsAppMessage",
        targetId: row.id,
        metadata: { attempts: row.attempts + 1 },
      });
      out.sent += 1;
      continue;
    }

    if (!result.retryable || result.kind === "PERMANENT") {
      // Permanent at flush (e.g. token revoked since queueing): terminal, like direct sends.
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorInfo: { code: result.kind, title: "Permanent delivery failure", details: result.message },
          nextAttemptAt: null,
        },
      });
      await recordAudit(prisma, {
        action: "whatsapp.send.failed",
        businessId: connection.businessId,
        targetType: "WhatsAppMessage",
        targetId: row.id,
        metadata: { stage: "outbox.flush", errorKind: result.kind },
      });
      out.failedTerminal += 1;
      continue;
    }

    // Transient: bump the breaker first (opens at >= 3 consecutive, audited once), then either
    // re-queue with the next backoff step or go terminal after the row's attempt cap.
    const breaker = await recordSendFailure(connectionId, now);
    const attempts = row.attempts + 1;
    const maxAttempts = row.maxAttempts ?? QUEUE_MAX_ATTEMPTS;
    if (attempts >= maxAttempts) {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorInfo: { code: "EXHAUSTED_RETRIES", title: "Retries exhausted", details: result.message },
          attempts,
          lastErrorKind: result.kind,
          lastErrorAt: now,
          nextAttemptAt: null,
        },
      });
      await recordAudit(prisma, {
        action: "whatsapp.send.failed",
        businessId: connection.businessId,
        targetType: "WhatsAppMessage",
        targetId: row.id,
        metadata: { stage: "outbox.flush", errorKind: result.kind, attempts, code: "EXHAUSTED_RETRIES" },
      });
      out.failedTerminal += 1;
      continue;
    }
    await prisma.whatsAppMessage.update({
      where: { id: row.id },
      data: {
        attempts,
        nextAttemptAt: new Date(now.getTime() + queueBackoffDelayMs(attempts, result.retryAfterMs, row.id)),
        lastErrorKind: result.kind,
        lastErrorAt: now,
      },
    });
    // Fast-fail the pass: under a full outage one failure is enough; the rest stay due.
    const processed = out.sent + out.failedTerminal + 1; // this row just re-queued
    out.leftDue = rows.length - processed;
    return { ...out, breakerOpen: breaker.openSince !== null };
  }
  return { ...out, breakerOpen: false };
}

/**
 * Business-level entry point for the cron endpoint (ADR 0010 §5): one connection per business,
 * capped send work. The `businessId` comes from the guarded route; auth is by flush token.
 */
export async function flushOutboxForBusiness(
  businessId: string,
  opts: FlushDeps = {},
): Promise<FlushOutcome | null> {
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { businessId },
    select: { id: true },
  });
  if (!connection) return null;
  // The flush token is a caller-controlled cap: global send limit 50 across the pass.
  return flushDueMessages(connection.id, { ...opts, limit: Math.min(opts.limit ?? 50, 50) });
}
