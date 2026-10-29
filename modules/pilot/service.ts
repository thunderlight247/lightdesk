/**
 * M7 Controlled Pilot (docs/m7-pilot.md): pilot enrollment, explicit owner consent, hard
 * per-business usage caps, owner feedback and the platform-admin monitoring view.
 *
 * Trust boundaries (unchanged from the rest of the app):
 * - Enrollment is platform-admin-only; consent is OWNER-only; both are audited.
 * - A business that is enrolled but not ACTIVE must never reach a restricted capability.
 *   `requirePilotActive` is the single gate; the AI-assist path and the send gate consult it
 *   in server code before any AI call or Graph request. A business without an enrollment
 *   record is not part of the pilot and keeps the stock M6 behaviour.
 * - Caps are hard limits checked before the act they limit, with the breach audited. A
 *   business can only cap itself lower than the platform ceilings; a stored cap above a
 *   violated ceiling is impossible to write.
 * - The monitoring view exposes counters only — never conversation or message content.
 */
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/modules/audit/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import type { PilotEnrollment, UsageCaps } from "@/lib/generated/prisma/client";
import { requireMembership } from "@/modules/permissions/access";
import { SENT_LIKE_STATUSES } from "@/modules/whatsapp/statuses";

// ---- Pilot policy constants ------------------------------------------------------------------------------------

export const PILOT_CONSENT_TEXT_VERSION = "2026-10-21.v1";

export const PILOT_CONSENT_TEXT = [
  "I am the owner of this business and I agree that LightDesk acts as my AI conversation assistant during the",
  "controlled pilot: it drafts replies from my APPROVED business information only, while a person on my team",
  "reviews and sends every WhatsApp message. I understand my customers use their normal WhatsApp app; a person",
  "must always approve anything sent, automatic sending is not possible, I can pause or leave the pilot at any",
  "time from this console, and my usage limits can be changed by the platform and by me below their ceilings.",
].join(" ");

export const PILOT_FEEDBACK_CATEGORIES = [
  "worked_well",
  "wrong_answer",
  "missed_escalation",
  "confusing",
  "other",
] as const;
export type PilotFeedbackCategory = (typeof PILOT_FEEDBACK_CATEGORIES)[number];

export function isPilotFeedbackCategory(value: string): value is PilotFeedbackCategory {
  return (PILOT_FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

/** Conservative pilot defaults; an owner may lower them and may raise them, at most to the ceilings. */
export const PLAN_DEFAULT_AI_CALLS_PER_DAY = 50;
export const PLAN_DEFAULT_OUTBOUND_PER_MONTH = 100;
export const PLATFORM_CEILING_AI_CALLS_PER_DAY = 200;
export const PLATFORM_CEILING_OUTBOUND_PER_MONTH = 800;

export type UsageCapValues = { aiCallsPerDay: number; outboundPerMonth: number };

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function validateCapValues(input: { aiCallsPerDay: unknown; outboundPerMonth: unknown }): UsageCapValues {
  const aiCallsPerDay = input.aiCallsPerDay;
  const outboundPerMonth = input.outboundPerMonth;
  if (!isNonNegInt(aiCallsPerDay) || !isNonNegInt(outboundPerMonth)) {
    throw new ValidationError("Usage caps must be whole numbers of 0 or more.");
  }
  if (aiCallsPerDay > PLATFORM_CEILING_AI_CALLS_PER_DAY) {
    throw new ValidationError(`AI calls per day may not exceed the platform ceiling of ${PLATFORM_CEILING_AI_CALLS_PER_DAY}.`);
  }
  if (outboundPerMonth > PLATFORM_CEILING_OUTBOUND_PER_MONTH) {
    throw new ValidationError(`Outbound messages per month may not exceed the platform ceiling of ${PLATFORM_CEILING_OUTBOUND_PER_MONTH}.`);
  }
  return { aiCallsPerDay, outboundPerMonth };
}

// ---- Platform-admin enrollment lifecycle ----------------------------------------------------------------------

async function requirePlatformAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
  if (!user?.isPlatformAdmin) throw new ForbiddenError("Only a platform administrator can manage pilot enrollment.");
}

export type PilotEnrollmentRow = PilotEnrollment & { caps: UsageCaps | null };

export async function enrollBusinessInPilot(
  adminUserId: string,
  rawBusinessId: string,
  input: { note?: unknown; caps?: { aiCallsPerDay: unknown; outboundPerMonth: unknown } } = {},
): Promise<PilotEnrollmentRow> {
  const business = await prisma.business.findUnique({ where: { id: rawBusinessId }, select: { id: true, name: true, status: true } });
  if (!business || business.status !== "ACTIVE") throw new NotFoundError("Business not found");
  if (!validCapsInput(input)) throw new ValidationError("Usage caps must be whole numbers of 0 or more");
  const caps = validateCapValues(input.caps ?? { aiCallsPerDay: PLAN_DEFAULT_AI_CALLS_PER_DAY, outboundPerMonth: PLAN_DEFAULT_OUTBOUND_PER_MONTH });
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : undefined;
  await requirePlatformAdmin(adminUserId);

  const existing = await prisma.pilotEnrollment.findUnique({ where: { businessId: business.id } });
  if (existing && existing.status !== "EXITED") {
    throw new ValidationError("This business is already enrolled in the pilot.");
  }
  const enrollment = await prisma.pilotEnrollment.upsert({
    where: { businessId: business.id },
    create: {
      businessId: business.id,
      status: "PENDING_CONSENT",
      createdById: adminUserId,
      ...(note ? { note } : {}),
    },
    // Re-enrolling an EXITED business reopens consent.
    update: { status: "PENDING_CONSENT", consentAt: null, consentById: null },
  });
  const capsRow = await upsertCaps(business.id, caps);
  await recordAudit(prisma, {
    action: "pilot.enrolled", actorUserId: adminUserId, businessId: business.id,
    targetType: "PilotEnrollment", targetId: enrollment.id,
    metadata: { status: enrollment.status, ...caps },
  });
  return { ...enrollment, status: "PENDING_CONSENT", caps: capsRow };
}

function validCapsInput(input: { caps?: { aiCallsPerDay: unknown; outboundPerMonth: unknown } }): boolean {
  const c = input.caps;
  return !c || (isNonNegInt(c.aiCallsPerDay) && isNonNegInt(c.outboundPerMonth));
}

async function upsertCaps(businessId: string, caps: UsageCapValues): Promise<UsageCaps> {
  return prisma.usageCaps.upsert({
    where: { businessId },
    create: { businessId, aiCallsPerDay: caps.aiCallsPerDay, outboundPerMonth: caps.outboundPerMonth },
    update: { aiCallsPerDay: caps.aiCallsPerDay, outboundPerMonth: caps.outboundPerMonth },
  });
}

export async function setPilotStatus(
  adminUserId: string,
  businessId: string,
  action: "pause" | "resume" | "exit",
  reason?: string,
): Promise<PilotEnrollmentRow> {
  const enrollment = await prisma.pilotEnrollment.findUnique({
    where: { businessId },
  });
  if (!enrollment) throw new NotFoundError("This business is not enrolled in the pilot.");

  let next: PilotEnrollment["status"];
  if (action === "pause") {
    if (enrollment.status === "PAUSED" || enrollment.status === "EXITED") {
      throw new ValidationError(`Cannot pause a pilot that is ${enrollment.status.toLowerCase().replace("_", " ")}.`);
    }
    next = "PAUSED";
  } else if (action === "resume") {
    if (enrollment.status !== "PAUSED" && enrollment.status !== "PENDING_CONSENT" && enrollment.status !== "EXITED") {
      throw new ValidationError("Cannot resume a pilot that is already active.");
    }
    // Resume restores exactly what consent produced: an owner who already consented goes
    // straight back to ACTIVE; otherwise consent is needed again.
    next = enrollment.consentAt ? "ACTIVE" : "PENDING_CONSENT";
  } else {
    if (enrollment.status === "EXITED") {
      throw new ValidationError("This pilot is already exited.");
    }
    next = "EXITED";
  }

  const updated = await prisma.pilotEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: next,
      ...(action === "pause" || action === "exit" ? { pausedReason: (reason ?? "").trim().slice(0, 200) || null } : {}),
    },
  });
  const capsRow = await prisma.usageCaps.findUnique({ where: { businessId } });
  await recordAudit(prisma, {
    action: `pilot.${action}`, actorUserId: adminUserId, businessId,
    targetType: "PilotEnrollment", targetId: enrollment.id,
    metadata: { from: enrollment.status, to: next, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) },
  });
  return { ...updated, caps: capsRow };
}

// ---- Owner côté: status, consent, caps, feedback ------------------------------------------------------------------------------------------------------------------

async function requireOwner(actorId: string, businessId: string) {
  const membership = await requireMembership(actorId, businessId);
  if (membership.role !== "OWNER") {
    throw new ForbiddenError("Only the business owner can manage the pilot enrollment.");
  }
  return membership;
}

async function loadEnrollmentRow(businessId: string): Promise<PilotEnrollmentRow | null> {
  const [row, caps] = await Promise.all([
    prisma.pilotEnrollment.findUnique({ where: { businessId } }),
    prisma.usageCaps.findUnique({ where: { businessId } }),
  ]);
  return row ? { ...row, caps } : null;
}

export type PilotStatusView = {
  enrolled: boolean;
  status: PilotEnrollment["status"] | null;
  note: string | null;
  consentAt: Date | null;
  consentText: string;
  consentTextVersion: string;
  caps: UsageCapValues | null;
  usage: { aiCallsToday: number; outboundThisMonth: number };
};export async function getPilotStatus(actorId: string, businessId: string): Promise<PilotStatusView> {
  await requireMembership(actorId, businessId);
  const now = new Date();
  const row = await loadEnrollmentRow(businessId);
  const usage = await checkUsageCaps(businessId, now);
  return {
    enrolled: row !== null,
    status: row?.status ?? null,
    note: row?.note ?? null,
    consentAt: row?.consentAt ?? null,
    consentText: PILOT_CONSENT_TEXT,
    consentTextVersion: PILOT_CONSENT_TEXT_VERSION,
    caps: row?.caps ?? null,
    usage: { aiCallsToday: usage.aiUsed, outboundThisMonth: usage.outboundUsed },
  };
}

/** Owner consent turns an enrolled business ACTIVE. Idempotent-conservative: only OWNER-only. */
export async function consentToPilot(actorId: string, businessId: string): Promise<PilotStatusView> {
  await requireOwner(actorId, businessId);
  const row = await loadEnrollmentRow(businessId);
  if (!row) throw new NotFoundError("This business is not enrolled in the pilot.");
  if (row.status === "ACTIVE") throw new ValidationError("The pilot is already active for this business.");
  if (row.status === "EXITED") throw new ValidationError("The pilot enrollment was closed. A platform administrator must re-invite the business.");

  const now = new Date();
  const updated = await prisma.pilotEnrollment.update({
    where: { id: row.id },
    data: { status: "ACTIVE", consentById: actorId, consentAt: now, consentTextVersion: PILOT_CONSENT_TEXT_VERSION },
  });
  await recordAudit(prisma, {
    action: "pilot.consented", actorUserId: actorId, businessId,
    targetType: "PilotEnrollment", targetId: row.id,
    metadata: { consentTextVersion: PILOT_CONSENT_TEXT_VERSION, from: row.status },
  });
  return await getPilotStatus(actorId, businessId).then((view) => ({ ...view, status: updated.status }));
}

export async function revokePilotConsent(actorId: string, businessId: string): Promise<PilotStatusView> {
  await requireOwner(actorId, businessId);
  const row = await loadEnrollmentRow(businessId);
  if (!row || row.status === "EXITED") throw new NotFoundError("No active pilot enrollment to leave.");
  // Leaving is always the owner's right — even while PAUSED (consent withdrawn but state tracked).
  const takeOwnership = row.consentById !== actorId;
  await prisma.pilotEnrollment.update({
    where: { id: row.id },
    data: { status: "EXITED" },
  });
  await recordAudit(prisma, {
    action: "pilot.exited", actorUserId: actorId, businessId,
    targetType: "PilotEnrollment", targetId: row.id,
    metadata: { from: row.status, ...(takeOwnership ? { note: "left by owner without prior consent" } : {}) },
  });
  return getPilotStatus(actorId, businessId);
}

export async function updateUsageCaps(actorId: string, businessId: string, input: { aiCallsPerDay: unknown; outboundPerMonth: unknown }): Promise<PilotStatusView> {
  await requireOwner(actorId, businessId);
  if (!validCapsInput({ caps: input })) throw new ValidationError("Usage caps must be whole numbers of 0 or more.");
  const values = validateCapValues(input);
  const row = await loadEnrollmentRow(businessId);
  if (!row) throw new NotFoundError("This business is not enrolled in the pilot.");
  const before = row.caps;
  await upsertCaps(businessId, values);
  await recordAudit(prisma, {
    action: "pilot.caps_changed", actorUserId: actorId, businessId,
    targetType: "UsageCaps", targetId: businessId,
    metadata: {
      fromAiPerDay: before?.aiCallsPerDay ?? null, toAiPerDay: values.aiCallsPerDay,
      fromOutboundPerMonth: before?.outboundPerMonth ?? null, toOutboundPerMonth: values.outboundPerMonth,
    },
  });
  return getPilotStatus(actorId, businessId);
}

export async function submitPilotFeedback(
  actorId: string,
  businessId: string,
  input: { category: unknown; comment: unknown },
): Promise<{ id: string }> {
  await requireMembership(actorId, businessId);
  const row = await loadEnrollmentRow(businessId);
  if (!row || row.status === "EXITED") throw new NotFoundError("Feedback is collected for enrolled pilot businesses only.");
  if (typeof input.category !== "string" || !isPilotFeedbackCategory(input.category)) {
    throw new ValidationError("Choose a feedback category.");
  }
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 1000) : "";
  if (comment.length === 0) throw new ValidationError("Feedback comment is required.");

  const created = await prisma.pilotFeedback.create({
    data: { businessId, category: input.category, comment, createdById: actorId },
    select: { id: true },
  });
  await recordAudit(prisma, {
    action: "pilot.feedback", actorUserId: actorId, businessId,
    targetType: "PilotFeedback", targetId: created.id,
    metadata: { category: input.category },
  });
  return created;
}

// ---- The gate itself --------------------------------------------------------------------------------------------

export type PilotGate = { ok: true } | { ok: false; reason: string };

/** Single source of truth for "may this business use a restricted (pilot) capability right now?" */
export async function requirePilotActive(businessId: string): Promise<PilotGate> {
  const row = await prisma.pilotEnrollment.findUnique({ where: { businessId }, select: { status: true } });
  if (!row) return { ok: true }; // not part of the pilot: stock M6 rules apply
  switch (row.status) {
    case "ACTIVE":
      return { ok: true };
    case "PENDING_CONSENT":
      return { ok: false, reason: "The pilot has not been activated yet: the business owner must accept the pilot terms first." };
    case "PAUSED":
      return { ok: false, reason: "The pilot is paused. Contact the platform team to resume it." };
    case "EXITED":
      return { ok: false, reason: "This pilot enrollment has ended." };
  }
}

// ---- Usage caps: counting + enforcement ------------------------------------------------------------------------

export type CapUsage = {
  aiCap: number | null;
  aiUsed: number;
  aiRemaining: number | null;
  outboundCap: number | null;
  outboundUsed: number;
  outboundRemaining: number | null;
};

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Reads the caps and counts actual usage this (UTC) day / this (UTC) month. No enrollment => null caps, 0 usage. */
export async function checkUsageCaps(businessId: string, now: Date = new Date()): Promise<CapUsage> {
  const caps = await prisma.usageCaps.findUnique({ where: { businessId } });
  const [aiUsed, outboundUsed] = await Promise.all([
    prisma.whatsAppGeneration.count({ where: { businessId, createdAt: { gte: startOfUtcDay(now) } } }),
    prisma.whatsAppMessage.count({
      where: { connection: { businessId }, direction: "OUTBOUND", status: { in: SENT_LIKE_STATUSES }, createdAt: { gte: startOfUtcMonth(now) } },
    }),
  ]);
  return {
    aiCap: caps?.aiCallsPerDay ?? null,
    aiUsed,
    aiRemaining: caps ? Math.max(caps.aiCallsPerDay - aiUsed, 0) : null,
    outboundCap: caps?.outboundPerMonth ?? null,
    outboundUsed,
    outboundRemaining: caps ? Math.max(caps.outboundPerMonth - outboundUsed, 0) : null,
  };
}

/** Wire-up: a drafted AI call needs pilot consent (active) and a remaining daily AI allowance. */
export async function assertPilotAiCallAllowed(businessId: string, now: Date = new Date()): Promise<string[] | null> {
  const gate = await requirePilotActive(businessId);
  const reasons: string[] = [];
  if (!gate.ok) reasons.push(gate.reason);
  const usage = await checkUsageCaps(businessId, now);
  if (usage.aiCap !== null && usage.aiUsed >= usage.aiCap) {
    reasons.push(`Daily AI drafting limit reached (${usage.aiUsed}/${usage.aiCap}). No further AI calls until tomorrow.`);
  }
  return reasons.length > 0 ? reasons : null;
}

/** Wire-up: an owner send needs pilot consent (active) and a remaining monthly outbound allowance. */
export async function assertPilotOutboundAllowed(businessId: string, now: Date = new Date()): Promise<string[] | null> {
  const gate = await requirePilotActive(businessId);
  const reasons: string[] = [];
  if (!gate.ok) reasons.push(gate.reason);
  const usage = await checkUsageCaps(businessId, now);
  if (usage.outboundCap !== null && usage.outboundUsed >= usage.outboundCap) {
    reasons.push(`Monthly outbound limit reached (${usage.outboundUsed}/${usage.outboundCap}). No further sends until next month.`);
  }
  return reasons.length > 0 ? reasons : null;
}

/** Businesses that can be enrolled (ACTIVE, no enrollment row yet). Platform-admin only. */
export async function listPilotCandidates(adminUserId: string): Promise<{ id: string; name: string }[]> {
  await requirePlatformAdmin(adminUserId);
  const rows = await prisma.business.findMany({
    where: { status: "ACTIVE", pilotEnrollment: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

// ---- Platform-admin monitoring view ---------------------------------------------------------------------------

export type PilotOverviewRow = {
  businessId: string;
  businessName: string;
  status: PilotEnrollment["status"];
  consentAt: Date | null;
  caps: UsageCapValues | null;
  usage: { aiCallsToday: number; outboundThisMonth: number; escalated: number; openConversations: number; failedSends: number };
  feedbackCount: number;
};

export type PilotOverview = { rows: PilotOverviewRow[] };

export async function getPilotOverview(adminUserId: string): Promise<{ rows: PilotOverviewRow[]; recentFeedback: { id: string; businessName: string; category: string; comment: string; createdAt: Date }[] }> {
  await requirePlatformAdmin(adminUserId);
  const now = new Date();

  const enrollments = await prisma.pilotEnrollment.findMany({
    include: { business: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const capsRows = await prisma.usageCaps.findMany();
  const capsMap = new Map(capsRows.map((c) => [c.businessId, c]));

  const [aiToday, outboundMonth, conversations, failedMessages, feedbackCounts, feedbackRows] = await Promise.all([
    prisma.whatsAppGeneration.groupBy({ by: ["businessId"], where: { createdAt: { gte: startOfUtcDay(now) } }, _count: { _all: true } }),
    prisma.whatsAppMessage.findMany({
      where: { direction: "OUTBOUND", status: { in: SENT_LIKE_STATUSES }, createdAt: { gte: startOfUtcMonth(now) } },
      select: { conversation: { select: { businessId: true } } },
    }),
    prisma.whatsAppConversation.groupBy({ by: ["businessId", "status"], _count: { _all: true } }),
    prisma.whatsAppMessage.findMany({
      where: { direction: "OUTBOUND", status: "FAILED" },
      select: { conversation: { select: { businessId: true } } },
    }),
    prisma.pilotFeedback.groupBy({ by: ["businessId"], _count: { _all: true } }),
    prisma.pilotFeedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { business: { select: { name: true } } },
    }),
  ]);

  const aiMap = new Map(aiToday.map((e) => [e.businessId, e._count._all]));
  const outMap = new Map<string, number>();
  for (const row of outboundMonth) outMap.set(row.conversation.businessId, (outMap.get(row.conversation.businessId) ?? 0) + 1);
  const failedMap = new Map<string, number>();
  for (const row of failedMessages) failedMap.set(row.conversation.businessId, (failedMap.get(row.conversation.businessId) ?? 0) + 1);
  const escMap = new Map(conversations.filter((c) => c.status === "ESCALATED").map((c) => [c.businessId, c._count._all]));
  const openMap = new Map(conversations.filter((c) => c.status !== "RESOLVED").map((c) => [c.businessId, c._count._all]));
  const fbMap = new Map(feedbackCounts.map((c) => [c.businessId, c._count._all]));

  const rows: PilotOverviewRow[] = enrollments.map((e) => ({
    businessId: e.businessId,
    businessName: e.business.name,
    status: e.status,
    consentAt: e.consentAt,
    caps: capsMap.get(e.businessId) ?? null,
    usage: {
      aiCallsToday: aiMap.get(e.businessId) ?? 0,
      outboundThisMonth: outMap.get(e.businessId) ?? 0,
      escalated: escMap.get(e.businessId) ?? 0,
      openConversations: openMap.get(e.businessId) ?? 0,
      failedSends: failedMap.get(e.businessId) ?? 0,
    },
    feedbackCount: fbMap.get(e.businessId) ?? 0,
  }));

  return {
    rows,
    recentFeedback: feedbackRows.map((f) => ({
      id: f.id, businessName: f.business.name, category: f.category, comment: f.comment, createdAt: f.createdAt,
    })),
  };
}
