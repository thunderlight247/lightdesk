import { Prisma } from "@prisma/client";
import type { LabDraftState, LabResultStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import { getApprovedProfileSnapshot } from "@/modules/business-profile/service"; // readiness checks keep using it
import type { AiProvider } from "@/modules/lab/ai/types";
import { providerProblem, readLabConfig, type LabConfig } from "@/modules/lab/config";
import { asEvidence, asStrings, computeDraft, evidenceJson, type DraftErrorKind } from "@/modules/lab/pipeline";
import type { HistoryTurn } from "@/modules/lab/prompt";
import { MAX_CUSTOMER_CHARS, MAX_REPLY_CHARS, type DraftStatus } from "@/modules/lab/types";
import { requireMembership } from "@/modules/permissions/access";
import { can } from "@/modules/permissions/roles";

/** Server-side seams for tests. They are never populated from a request. */
export type LabDeps = { provider?: AiProvider; config?: LabConfig; now?: () => Date };

export const MAX_CONVERSATIONS_PER_BUSINESS = 100;
export const MAX_CUSTOMER_MESSAGES_PER_CONVERSATION = 50;
const STALE_RUNNING_MS = 120_000;

type Tx = Prisma.TransactionClient;
type ErrorKind = DraftErrorKind;

export function failureMessage(kind: string | null): string {
  switch (kind) {
    case "CONFIG": return "AI drafting is not configured on this server. Ask the platform administrator to check the Gemini settings.";
    case "RATE_LIMIT": return "The AI provider is busy or its limit was reached. Try again in a minute.";
    case "TIMEOUT": return "The AI provider took too long to respond. Try again.";
    case "PROVIDER": return "The AI provider returned an error. Try again later.";
    default: return "Something went wrong while generating the draft. Try again.";
  }
}

const toDbStatus = (s: DraftStatus): LabResultStatus => s.toUpperCase() as LabResultStatus;
const fromDbStatus = (s: LabResultStatus | null): DraftStatus | null => (s ? (s.toLowerCase() as DraftStatus) : null);

async function ctx(actorId: string, businessId: string, permission: string) {
  const membership = await requireMembership(actorId, businessId);
  if (!can(membership.role, permission)) throw new ForbiddenError();
  return membership;
}

// ---- validation -----------------------------------------------------------------------------------------
const CONTROL_SINGLE = /[\u0000-\u001f\u007f]/;
const CONTROL_MULTI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function cleanText(raw: unknown, field: string, max: number, multiline: boolean): string {
  if (typeof raw !== "string") throw new ValidationError("Invalid input", { [field]: ["Enter some text"] });
  const v = multiline ? raw.replace(/\r\n?/g, "\n").trim() : raw.trim();
  if (v.length === 0) throw new ValidationError("Invalid input", { [field]: ["Enter some text"] });
  if (v.length > max) throw new ValidationError("Invalid input", { [field]: [`Use at most ${max} characters`] });
  if ((multiline ? CONTROL_MULTI : CONTROL_SINGLE).test(v)) throw new ValidationError("Invalid input", { [field]: ["Contains invalid characters"] });
  return v;
}
function cleanKey(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(raw)) {
    throw new ValidationError("Invalid request", { idempotencyKey: ["Invalid request key. Reload the page and try again."] });
  }
  return raw;
}

// ---- rate limiting (database-backed; no extra infrastructure) --------------------------------------------
export async function enforceRateLimits(actorId: string, businessId: string, config: LabConfig, now: Date) {
  const [perUser, perBusiness] = await Promise.all([
    prisma.labGeneration.count({ where: { requestedById: actorId, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
    prisma.labGeneration.count({ where: { businessId, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } }),
  ]);
  if (perUser >= config.rateUserPerMinute) throw new RateLimitError("You're requesting drafts too quickly. Wait a minute and try again.");
  if (perBusiness >= config.rateBusinessPerHour) throw new RateLimitError("This business has reached its hourly limit for test drafts. Try again later.");
}

// ---- readiness ------------------------------------------------------------------------------------------
export async function getLabReadiness(actorId: string, businessId: string, deps: LabDeps = {}) {
  const membership = await ctx(actorId, businessId, "lab:read");
  const config = deps.config ?? readLabConfig();
  const problem = providerProblem(config);
  const profile = await prisma.businessProfile.findUnique({ where: { businessId }, select: { status: true } });
  const snapshot = profile?.status === "ACTIVE" ? await getApprovedProfileSnapshot(businessId) : null;
  const caps = snapshot?.capabilities ?? null;
  const blockers: string[] = [];
  if (problem) blockers.push(`${problem} Drafts that need the AI are unavailable; rules-based replies still work.`);
  if (!profile) blockers.push("The business profile has not been started. The lab will only produce holding replies.");
  else if (profile.status !== "ACTIVE") blockers.push(`The business profile is ${profile.status.toLowerCase().replace("_", " ")}. Only an active profile's approved information can be used.`);
  if (caps && !caps.use_approved_knowledge) blockers.push("“Use approved business knowledge” is not enabled in AI permissions.");
  if (caps && !caps.prepare_suggested_response) blockers.push("“Prepare suggested responses” is not enabled in AI permissions.");
  return {
    role: membership.role,
    canUse: can(membership.role, "lab:use"),
    canApprove: can(membership.role, "lab:approve"),
    canDeleteAny: can(membership.role, "lab:delete-any"),
    provider: { configured: !problem, model: config.model, problem },
    profileStatus: profile?.status ?? null,
    aiReady: !problem && !!caps && caps.use_approved_knowledge === true && caps.prepare_suggested_response === true,
    blockers,
    limits: { userPerMinute: config.rateUserPerMinute, businessPerHour: config.rateBusinessPerHour, timeoutMs: config.timeoutMs },
  };
}

// ---- conversations -------------------------------------------------------------------------------------
export async function createConversation(actorId: string, businessId: string, input: { customerLabel?: unknown } = {}) {
  await ctx(actorId, businessId, "lab:use");
  const label = input.customerLabel === undefined || input.customerLabel === null || input.customerLabel === ""
    ? "Test customer" : cleanText(input.customerLabel, "customerLabel", 40, false);
  return prisma.$transaction(async (tx) => {
    if ((await tx.labConversation.count({ where: { businessId } })) >= MAX_CONVERSATIONS_PER_BUSINESS) {
      throw new ConflictError(`A business can keep at most ${MAX_CONVERSATIONS_PER_BUSINESS} test conversations. Delete some first.`);
    }
    const conv = await tx.labConversation.create({ data: { businessId, createdById: actorId, customerLabel: label } });
    await recordAudit(tx, { action: "lab.conversation.created", actorUserId: actorId, businessId, targetType: "LabConversation", targetId: conv.id });
    return conv;
  });
}

export async function listConversations(actorId: string, businessId: string) {
  await ctx(actorId, businessId, "lab:read");
  const rows = await prisma.labConversation.findMany({
    where: { businessId },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true, title: true, customerLabel: true, status: true, escalationReason: true, lastMessageAt: true, createdAt: true,
      createdById: true, _count: { select: { messages: true } },
    },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, messageCount: r._count.messages, createdByName: names.get(r.createdById) ?? "a former member" }));
}

export async function getConversation(actorId: string, businessId: string, conversationId: string) {
  await ctx(actorId, businessId, "lab:read");
  const conv = await prisma.labConversation.findFirst({ where: { id: conversationId, businessId } }); // scoped: other tenants' ids are "not found"
  if (!conv) throw new NotFoundError("Conversation not found");
  const [messages, generations] = await Promise.all([
    prisma.labMessage.findMany({ where: { conversationId: conv.id }, orderBy: { seq: "asc" } }),
    prisma.labGeneration.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = new Set<string>([conv.createdById]);
  for (const m of messages) if (m.approvedById) ids.add(m.approvedById);
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const genById = new Map(generations.map((g) => [g.id, g]));
  const last = messages.at(-1);
  const lastGen = generations.at(-1);
  const awaitingDraft = last?.role === "CUSTOMER";
  const draftedGenerations = new Set(messages.map((m) => m.generationId).filter((g): g is string => !!g));
  return {
    conversation: {
      id: conv.id, title: conv.title, customerLabel: conv.customerLabel, status: conv.status, escalationReason: conv.escalationReason,
      escalatedAt: conv.escalatedAt, resolvedAt: conv.resolvedAt, createdAt: conv.createdAt, lastMessageAt: conv.lastMessageAt,
      createdById: conv.createdById, createdByName: names.get(conv.createdById) ?? "a former member",
    },
    messages: messages.map((m) => {
      const g = m.generationId ? genById.get(m.generationId) : undefined;
      return {
        id: m.id, seq: m.seq, role: m.role, content: m.content, createdAt: m.createdAt,
        draftState: m.draftState as LabDraftState | null, source: m.source, resultStatus: fromDbStatus(m.resultStatus),
        reason: m.reason, missingInformation: asStrings(m.missingInformation), escalationReason: m.escalationReason,
        evidence: asEvidence(m.evidence), profileRevision: m.profileRevision,
        approvedContent: m.approvedContent, approvedAt: m.approvedAt, approvedByName: m.approvedById ? names.get(m.approvedById) ?? "a former member" : null,
        edited: m.approvedContent !== null && m.approvedContent !== m.content,
        sentToCustomer: false as const, // M3 never sends anything anywhere
        generation: g ? { provider: g.provider, model: g.model, usedAi: g.usedAi, latencyMs: g.latencyMs, promptTokens: g.promptTokens, completionTokens: g.completionTokens, totalTokens: g.totalTokens } : null,
      };
    }),
    awaitingDraft,
    latestDraftId: [...messages].reverse().find((m) => m.role === "ASSISTANT" && m.draftState === "DRAFT")?.id ?? null,
    pendingFailure: lastGen?.status === "FAILED" && !draftedGenerations.has(lastGen.id)
      ? { errorKind: lastGen.errorKind, message: failureMessage(lastGen.errorKind) } : null,
  };
}

export async function deleteConversation(actorId: string, businessId: string, conversationId: string) {
  const membership = await ctx(actorId, businessId, "lab:read");
  const conv = await prisma.labConversation.findFirst({ where: { id: conversationId, businessId } });
  if (!conv) throw new NotFoundError("Conversation not found");
  const mayDelete = can(membership.role, "lab:delete-any") || (can(membership.role, "lab:use") && conv.createdById === actorId);
  if (!mayDelete) throw new ForbiddenError();
  await prisma.$transaction(async (tx) => {
    await tx.labConversation.delete({ where: { id: conv.id } }); // cascades messages + generations
    await recordAudit(tx, { action: "lab.conversation.deleted", actorUserId: actorId, businessId, targetType: "LabConversation", targetId: conv.id });
  });
}

// ---- generating drafts -----------------------------------------------------------------------------------
export type GenerationOutcome = {
  duplicate: boolean;
  outcome: "drafted" | "failed" | "duplicate";
  draftStatus?: DraftStatus;
  errorKind?: ErrorKind;
  message?: string;
};

async function expireStale(tx: Tx, conversationId: string, now: Date) {
  await tx.labGeneration.updateMany({
    where: { conversationId, status: "RUNNING", createdAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    data: { status: "FAILED", errorKind: "TIMEOUT", finishedAt: now },
  });
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Customer message + new generation row, atomically. Returns null when this idempotency key was already used. */
async function openGeneration(
  actorId: string, businessId: string, conversationId: string, key: string, now: Date,
  customerText: string | null,
): Promise<{ generationId: string } | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const conv = await tx.labConversation.findFirst({ where: { id: conversationId, businessId } });
      if (!conv) throw new NotFoundError("Conversation not found");
      if (conv.status === "RESOLVED") throw new ConflictError("This conversation is resolved. Start a new test conversation.");
      if (await tx.labGeneration.findUnique({ where: { conversationId_idempotencyKey: { conversationId, idempotencyKey: key } } })) return null;
      await expireStale(tx, conversationId, now);

      const lastMsg = await tx.labMessage.findFirst({ where: { conversationId }, orderBy: { seq: "desc" } });
      let inputChars: number;
      if (customerText !== null) {
        if ((await tx.labMessage.count({ where: { conversationId, role: "CUSTOMER" } })) >= MAX_CUSTOMER_MESSAGES_PER_CONVERSATION) {
          throw new ConflictError("This conversation has reached its message limit. Start a new test conversation.");
        }
        await tx.labMessage.updateMany({ where: { conversationId, role: "ASSISTANT", draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
        await tx.labMessage.create({ data: { conversationId, seq: (lastMsg?.seq ?? 0) + 1, role: "CUSTOMER", content: customerText, createdById: actorId } });
        await tx.labConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, title: conv.title ?? customerText.slice(0, 60) } });
        inputChars = customerText.length;
      } else {
        // regenerate: only when the conversation is waiting for a reply (no draft, or a draft not yet approved)
        const waiting = lastMsg?.role === "CUSTOMER" || (lastMsg?.role === "ASSISTANT" && lastMsg.draftState === "DRAFT");
        if (!waiting) throw new ConflictError("There is nothing to redraft. Send a new customer message first.");
        const lastCustomer = await tx.labMessage.findFirst({ where: { conversationId, role: "CUSTOMER" }, orderBy: { seq: "desc" } });
        inputChars = lastCustomer?.content.length ?? 0;
      }
      const gen = await tx.labGeneration.create({ data: { conversationId, businessId, requestedById: actorId, idempotencyKey: key, inputChars } });
      return { generationId: gen.id };
    });
  } catch (err) {
    if (isUnique(err)) {
      const existing = await prisma.labGeneration.findUnique({ where: { conversationId_idempotencyKey: { conversationId, idempotencyKey: key } } });
      if (existing) return null; // identical request raced with itself
      throw new ConflictError("A draft is already being generated for this conversation. Wait for it to finish.");
    }
    throw err;
  }
}

/** Customer message + draft. Idempotent per `idempotencyKey`; at most one generation in flight per conversation. */
export async function submitCustomerMessage(
  actorId: string, businessId: string, conversationId: string,
  input: { text: unknown; idempotencyKey: unknown }, deps: LabDeps = {},
): Promise<GenerationOutcome> {
  await ctx(actorId, businessId, "lab:use");
  const text = cleanText(input.text, "text", MAX_CUSTOMER_CHARS, true);
  const key = cleanKey(input.idempotencyKey);
  const config = deps.config ?? readLabConfig();
  const now = (deps.now ?? (() => new Date()))();
  await enforceRateLimits(actorId, businessId, config, now);
  const opened = await openGeneration(actorId, businessId, conversationId, key, now, text);
  if (!opened) return { duplicate: true, outcome: "duplicate" };
  return runGeneration({ actorId, businessId, conversationId, generationId: opened.generationId, config, deps });
}

/** "Request another draft" (also the retry after a provider failure). */
export async function regenerateDraft(
  actorId: string, businessId: string, conversationId: string, input: { idempotencyKey: unknown }, deps: LabDeps = {},
): Promise<GenerationOutcome> {
  await ctx(actorId, businessId, "lab:use");
  const key = cleanKey(input.idempotencyKey);
  const config = deps.config ?? readLabConfig();
  const now = (deps.now ?? (() => new Date()))();
  await enforceRateLimits(actorId, businessId, config, now);
  const opened = await openGeneration(actorId, businessId, conversationId, key, now, null);
  if (!opened) return { duplicate: true, outcome: "duplicate" };
  return runGeneration({ actorId, businessId, conversationId, generationId: opened.generationId, config, deps });
}

async function runGeneration(a: {
  actorId: string; businessId: string; conversationId: string; generationId: string; config: LabConfig; deps: LabDeps;
}): Promise<GenerationOutcome> {
  const { actorId, businessId, conversationId, generationId } = a;

  const [business, rows] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    prisma.labMessage.findMany({
      where: { conversationId }, orderBy: { seq: "asc" },
      select: { role: true, content: true, draftState: true, approvedContent: true },
    }),
  ]);
  // Context for the model = customer messages + APPROVED replies only. Unapproved drafts are never fed back.
  const turns: HistoryTurn[] = rows.flatMap((r): HistoryTurn[] =>
    r.role === "CUSTOMER" ? [{ from: "customer", text: r.content }]
    : r.draftState === "APPROVED" && r.approvedContent ? [{ from: "assistant", text: r.approvedContent }] : []);
  const current = turns.pop();
  if (!current || current.from !== "customer") throw new ConflictError("There is no customer message to answer.");

  // The whole M3 generation + M4 pre-check + M5 grounding pipeline lives in one shared module,
  // so this lab path and the M6c live WhatsApp assist behave identically by construction.
  const { result, errorKind, usedAi, providerName, modelName, usage, latencyMs, profileRevision } = await computeDraft({
    businessId,
    businessName: business?.name ?? "this business",
    customerText: current.text,
    priorTurns: turns,
    config: a.config,
    provider: a.deps.provider,
  });

  const now = (a.deps.now ?? (() => new Date()))();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.labGeneration.update({
        where: { id: generationId },
        data: {
          status: errorKind ? "FAILED" : "SUCCEEDED",
          usedAi, provider: providerName, model: modelName, errorKind, latencyMs, finishedAt: now,
          promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null, totalTokens: usage?.totalTokens ?? null,
        },
      });
      const conv = result ? await tx.labConversation.findUniqueOrThrow({ where: { id: conversationId } }) : null;
      const last = result ? await tx.labMessage.findFirst({ where: { conversationId }, orderBy: { seq: "desc" } }) : null;
      // If a person approved a reply or resolved the conversation while this was generating, discard the late draft.
      const attachable = !!conv && conv.status !== "RESOLVED" && !(last?.role === "ASSISTANT" && last.draftState === "APPROVED");
      if (result && conv && attachable) {
        await tx.labMessage.updateMany({ where: { conversationId, role: "ASSISTANT", draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
        const draft = await tx.labMessage.create({
          data: {
            conversationId, seq: (last?.seq ?? 0) + 1, role: "ASSISTANT", content: result.replyDraft,
            draftState: "DRAFT", source: result.source, resultStatus: toDbStatus(result.status), reason: result.reason,
            missingInformation: result.missingInformation, escalationReason: result.escalationReason,
            evidence: evidenceJson(result), profileRevision, generationId,
          },
        });
        const escalate = result.status !== "answerable" && conv.status === "ACTIVE";
        await tx.labConversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: now,
            ...(escalate ? { status: "ESCALATED" as const, escalationReason: (result.escalationReason ?? result.reason).slice(0, 400), escalatedAt: now } : {}),
          },
        });
        await recordAudit(tx, {
          action: "lab.draft.generated", actorUserId: actorId, businessId, targetType: "LabMessage", targetId: draft.id,
          metadata: { status: result.status, source: result.source, evidenceCount: result.evidence.length, usedAi, ...(escalate ? { escalated: true } : {}) },
        });
      } else if (!result) {
        await recordAudit(tx, {
          action: "lab.draft.failed", actorUserId: actorId, businessId, targetType: "LabConversation", targetId: conversationId,
          metadata: { errorKind: errorKind ?? "INTERNAL" },
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2025"].includes(err.code)) {
      throw new NotFoundError("The conversation no longer exists");
    }
    throw err;
  }

  if (!result) {
    const kind = errorKind ?? "INTERNAL";
    return { duplicate: false, outcome: "failed", errorKind: kind, message: failureMessage(kind) };
  }
  return { duplicate: false, outcome: "drafted", draftStatus: result.status };
}

// ---- review and escalation ---------------------------------------------------------------------------------
/** Owner-only. Records the text actually used in the simulation; the original AI draft is never overwritten. */
export async function approveDraft(
  actorId: string, businessId: string, conversationId: string, messageId: string, input: { editedText?: unknown } = {},
) {
  await ctx(actorId, businessId, "lab:approve");
  const edited = input.editedText === undefined || input.editedText === null || input.editedText === ""
    ? null : cleanText(input.editedText, "editedText", MAX_REPLY_CHARS, true);
  return prisma.$transaction(async (tx) => {
    const conv = await tx.labConversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conv) throw new NotFoundError("Conversation not found");
    if (conv.status === "RESOLVED") throw new ConflictError("This conversation is resolved.");
    const msg = await tx.labMessage.findFirst({ where: { id: messageId, conversationId: conv.id, role: "ASSISTANT" } });
    if (!msg) throw new NotFoundError("Draft not found");
    if (msg.draftState !== "DRAFT") throw new ConflictError("This draft was already used or replaced.");
    const finalText = edited ?? msg.content;
    const { count } = await tx.labMessage.updateMany({
      where: { id: msg.id, draftState: "DRAFT" }, // race guard
      data: { draftState: "APPROVED", approvedContent: finalText, approvedById: actorId, approvedAt: new Date() },
    });
    if (count !== 1) throw new ConflictError("This draft was already used or replaced.");
    await tx.labConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
    await recordAudit(tx, {
      action: "lab.draft.approved", actorUserId: actorId, businessId, targetType: "LabMessage", targetId: msg.id,
      metadata: { edited: finalText !== msg.content, source: msg.source ?? "AI" },
    });
    return { messageId: msg.id, edited: finalText !== msg.content };
  });
}

export async function markForFollowUp(actorId: string, businessId: string, conversationId: string, input: { reason: unknown }) {
  await ctx(actorId, businessId, "lab:use");
  const reason = cleanText(input.reason, "reason", 300, false);
  return prisma.$transaction(async (tx) => {
    const conv = await tx.labConversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conv) throw new NotFoundError("Conversation not found");
    if (conv.status === "RESOLVED") throw new ConflictError("This conversation is resolved.");
    await tx.labConversation.update({
      where: { id: conv.id },
      data: { status: "ESCALATED", escalationReason: `Marked for human follow-up: ${reason}`.slice(0, 400), escalatedAt: new Date() },
    });
    await recordAudit(tx, { action: "lab.conversation.escalated", actorUserId: actorId, businessId, targetType: "LabConversation", targetId: conv.id, metadata: { by: "user" } });
  });
}

export async function resolveEscalation(actorId: string, businessId: string, conversationId: string) {
  await ctx(actorId, businessId, "lab:approve");
  return prisma.$transaction(async (tx) => {
    const conv = await tx.labConversation.findFirst({ where: { id: conversationId, businessId } });
    if (!conv) throw new NotFoundError("Conversation not found");
    if (conv.status !== "ESCALATED") throw new ConflictError("This conversation is not escalated.");
    await tx.labMessage.updateMany({ where: { conversationId: conv.id, role: "ASSISTANT", draftState: "DRAFT" }, data: { draftState: "SUPERSEDED" } });
    await tx.labConversation.update({ where: { id: conv.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actorId } });
    await recordAudit(tx, { action: "lab.conversation.resolved", actorUserId: actorId, businessId, targetType: "LabConversation", targetId: conv.id });
  });
}
