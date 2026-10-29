/**
 * M6c: the AI-assist draft pipeline for LIVE WhatsApp conversations (spec §3.3 state 2 and §4
 * phase M6c). It deliberately REUSES the M3 generation + M4 deterministic pre-checks + M5
 * retrieval via `computeDraft` (modules/lab/pipeline.ts), so a live draft is produced exactly
 * the way a simulated lab draft is — including every guardrail.
 *
 * Hard boundaries, re-tested by integration tests:
 * - Nothing in this module can SEND anything. Graph HTTP is not even imported here; the only
 *   writer of outbound traffic is `sendOwnerReply` after an explicit human send action.
 * - A draft is only produced while the conversation mode is AI_ASSIST, stored with status
 *   DRAFT / draftState DRAFT — never SENT.
 * - Escalation-required results mark the conversation ESCALATED so the owner sees danger
 *   from the inbox; they still never send anything.
 * - The M3 meters apply to live drafts too: usage (tokens/latency) is recorded per attempt in
 *   WhatsAppGeneration, and the SAME per-business hourly cap (LabConfig.rateBusinessPerHour)
 *   throttles webhook-triggered drafting. A throttled message stays visible to the owner;
 *   drafting is skipped and audited — the customer is never auto-replied.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import type { LabResultStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
import type { AiProvider } from "@/modules/lab/ai/types";
import type { LabConfig } from "@/modules/lab/config";
import { readLabConfig } from "@/modules/lab/config";
import { computeDraft, evidenceJson, type DraftErrorKind } from "@/modules/lab/pipeline";
import type { HistoryTurn } from "@/modules/lab/prompt";
import type { DraftStatus } from "@/modules/lab/types";
import { isSentLike } from "@/modules/whatsapp/statuses";
import { assertPilotAiCallAllowed } from "@/modules/pilot/service";

export type AssistDeps = { provider?: AiProvider; config?: LabConfig; now?: () => Date };

export type AssistOutcome =
  | { produced: true; draftMessageId: string; status: DraftStatus; usedAi: boolean; escalated: boolean }
  | { produced: false; reason: "not_ai_assist" | "resolved" | "no_text" | "duplicate" | "rate_limited" | "pilot_blocked" | "failed"; errorKind?: DraftErrorKind };

const STALE_RUNNING_MS = 120_000; // same in-flight expiry as the lab

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Runs one attempt to draft a reply for the freshly stored inbound message `wamid`.
 * Idempotent per (conversation, wamid): a webhook retry can never raise a second draft
 * or a second AI call for the same message.
 */
export async function runInboundAssist(
  input: { businessId: string; conversationId: string; wamid: string; text: string | null },
  deps: AssistDeps = {},
): Promise<AssistOutcome> {
  const config = deps.config ?? readLabConfig();
  const now = (deps.now ?? (() => new Date()))();

  const conv = await prisma.whatsAppConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, connectionId: true, businessId: true, mode: true, status: true },
  });
  if (!conv || conv.businessId !== input.businessId) return { produced: false, reason: "not_ai_assist" };
  if (conv.mode !== "AI_ASSIST") return { produced: false, reason: "not_ai_assist" };
  if (conv.status === "RESOLVED") return { produced: false, reason: "resolved" };

  // M7 pilot gate: an enrolled business that is not ACTIVE (consent missing, paused, exited)
  // gets no drafting at all, and the enrolled-ACTIVE case is additionally bounded by the
  // per-business daily AI cap. Checked BEFORE the hourly cap and before any AI call.
  const pilotReasons = await assertPilotAiCallAllowed(input.businessId, now);
  if (pilotReasons) {
    await recordAudit(prisma, {
      action: "pilot.cap.blocked", businessId: input.businessId,
      targetType: "WhatsAppConversation", targetId: input.conversationId,
      metadata: { reason: pilotReasons.join(" ") },
    });
    return { produced: false, reason: "pilot_blocked" };
  }

  // Only text messages are drafted; images/buttons and coexistence echoes are handled elsewhere.
  if (input.text === null) return { produced: false, reason: "no_text" };
  const customerText = input.text;
  if (customerText.length === 0) return { produced: false, reason: "no_text" };

  // Per-business hourly cap, shared with the lab (M3 meters apply to live traffic unchanged).
  const hourlyUsed = await prisma.whatsAppGeneration.count({
    where: { businessId: input.businessId, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
  });
  if (hourlyUsed >= config.rateBusinessPerHour) {
    await recordAudit(prisma, {
      action: "whatsapp.draft.skipped", businessId: input.businessId,
      targetType: "WhatsAppConversation", targetId: input.conversationId, metadata: { reason: "hourly cap reached; drafting skipped" },
    });
    return { produced: false, reason: "rate_limited" };
  }

  let generationId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.whatsAppGeneration.findUnique({
        where: { conversationId_idempotencyKey: { conversationId: input.conversationId, idempotencyKey: input.wamid } },
        select: { id: true },
      });
      if (existing) return null; // webhook retry of a message we already drafted
      await tx.whatsAppGeneration.updateMany({
        where: { conversationId: input.conversationId, status: "RUNNING", createdAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
        data: { status: "FAILED", errorKind: "TIMEOUT", finishedAt: now },
      });
      const gen = await tx.whatsAppGeneration.create({
        data: { conversationId: input.conversationId, businessId: input.businessId, idempotencyKey: input.wamid, inputChars: customerText.length },
      });
      return gen.id;
    });
    if (created === null) return { produced: false, reason: "duplicate" };
    generationId = created;
  } catch (err) {
    if (isUnique(err)) return { produced: false, reason: "duplicate" }; // concurrent webhook delivery of the same wamid
    throw err;
  }

  // Conversation history for the model: customer texts + what the business actually SENT
  // (owner-app replies under coexistence included). Unsent drafts are NEVER fed back.
  const anchor = await prisma.whatsAppMessage.findUnique({ where: { wamid: input.wamid }, select: { createdAt: true } });
  const rows = anchor
    ? await prisma.whatsAppMessage.findMany({
        where: { conversationId: input.conversationId, createdAt: { lt: anchor.createdAt } },
        orderBy: { createdAt: "asc" },
        select: { direction: true, text: true, status: true },
      })
    : [];
  const history: HistoryTurn[] = rows.flatMap((r): HistoryTurn[] => {
    if (r.text === null) return [];
    if (r.direction === "INBOUND") return [{ from: "customer", text: r.text }];
    return r.status !== "DRAFT" && isSentLike(r.status) ? [{ from: "assistant", text: r.text }] : [];
  });

  const computed = await computeDraft({
    businessId: input.businessId,
    businessName: (await prisma.business.findUnique({ where: { id: input.businessId }, select: { name: true } }))?.name ?? "this business",
    customerText,
    priorTurns: history,
    config,
    provider: deps.provider,
  });
  const { result, errorKind, usedAi, providerName, modelName, usage, latencyMs, profileRevision } = computed;

  const finishedAt = (deps.now ?? (() => new Date()))();
  try {
    const stored = await prisma.$transaction(async (tx) => {
      await tx.whatsAppGeneration.update({
        where: { id: generationId },
        data: {
          status: errorKind ? "FAILED" : "SUCCEEDED",
          usedAi, provider: providerName, model: modelName, errorKind, latencyMs, finishedAt,
          promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null, totalTokens: usage?.totalTokens ?? null,
        },
      });
      if (!result) return null;

      // One current draft at a time: an older one becomes SUPERSEDED (never deleted), exactly
      // like the lab and exactly like a takeover marks a draft stale.
      await tx.whatsAppMessage.updateMany({ where: { conversationId: input.conversationId, draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
      const draft = await tx.whatsAppMessage.create({
        data: {
          conversationId: input.conversationId, connectionId: conv.connectionId,
          direction: "OUTBOUND", wamid: null, text: result.replyDraft, type: "text", status: "DRAFT", draftState: "DRAFT",
          source: result.source, resultStatus: result.status.toUpperCase() as LabResultStatus, reason: result.reason,
          missingInformation: result.missingInformation, escalationReason: result.escalationReason,
          evidence: evidenceJson(result), profileRevision, generationId,
        },
      });
      const escalate = result.status !== "answerable" && conv.status === "ACTIVE";
      await tx.whatsAppConversation.update({
        where: { id: input.conversationId },
        data: {
          lastMessageAt: finishedAt,
          ...(escalate ? { status: "ESCALATED" as const, escalationReason: (result.escalationReason ?? result.reason).slice(0, 400) } : {}),
        },
      });
      await recordAudit(tx, {
        action: "whatsapp.draft.generated", businessId: input.businessId, targetType: "WhatsAppMessage", targetId: draft.id,
        metadata: { status: result.status, source: result.source, evidenceCount: result.evidence.length, usedAi, escalated: escalate, triggeredBy: "inbound" },
      });
      return { draftMessageId: draft.id, status: result.status, escalated: escalate };
    });

    if (stored === null) {
      await recordAudit(prisma, {
        action: "whatsapp.draft.failed", businessId: input.businessId, targetType: "WhatsAppConversation", targetId: input.conversationId,
        metadata: { errorKind: errorKind ?? "INTERNAL" },
      });
      return { produced: false, reason: "failed", errorKind: errorKind ?? "INTERNAL" };
    }
    return { produced: true, draftMessageId: stored.draftMessageId, status: stored.status, usedAi, escalated: stored.escalated };
  } catch (err) {
    // The draft must never break webhook processing; the attempt stays auditable.
    await prisma.whatsAppGeneration.update({
      where: { id: generationId },
      data: { status: "FAILED", errorKind: errorKind ?? "INTERNAL", finishedAt, provider: providerName, model: modelName, usedAi, latencyMs },
    }).catch(() => undefined);
    if (!errorKind) {
      console.error("[whatsapp-assist] unexpected error", err instanceof Error ? err.name : typeof err);
      await recordAudit(prisma, {
        action: "whatsapp.draft.failed", businessId: input.businessId, targetType: "WhatsAppConversation", targetId: input.conversationId,
        metadata: { errorKind: "INTERNAL" },
      });
    }
    return { produced: false, reason: "failed", errorKind: errorKind ?? "INTERNAL" };
  }
}

/** Which inbound message (if any) still deserves a draft right after "hand back to AI". */
export async function pendingInboundForAssist(conversationId: string): Promise<{ wamid: string; text: string } | null> {
  const lastMessage = await prisma.whatsAppMessage.findFirst({
    where: { conversationId, wamid: { not: null } },
    orderBy: [{ createdAt: "desc" }, { timestampSent: "desc" }],
    select: { direction: true, text: true, wamid: true, createdAt: true },
  });
  if (!lastMessage || lastMessage.direction !== "INBOUND" || lastMessage.text === null || lastMessage.wamid === null) return null;
  // A draft newer than that message means the owner already has a reply to review.
  const openDraft = await prisma.whatsAppMessage.findFirst({
    where: { conversationId, draftState: { in: ["DRAFT", "SUPERSEDED"] }, createdAt: { gt: lastMessage.createdAt } },
    select: { id: true },
  });
  if (openDraft) return null;
  return { wamid: lastMessage.wamid, text: lastMessage.text };
}
