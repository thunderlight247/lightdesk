import { Prisma } from "@prisma/client";
import type { FaqEntry, ProfileEntry } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import { recordAudit } from "@/modules/audit/service";
import {
  getEntryDef,
  MAX_FAQS_PER_PROFILE,
  normalizeEntryValue,
  normalizeFaqInput,
  type EntryDef,
} from "@/modules/business-profile/catalog";
import { evaluateProfile } from "@/modules/business-profile/evaluate";
import {
  allowedTransitions,
  canTransition,
  isProfileStatus,
  requiredPermissionFor,
  STATUS_LABEL,
  type ProfileStatusName,
} from "@/modules/business-profile/lifecycle";
import { compareForm, normalizeQuestion, sameOrCosmetic } from "@/modules/business-profile/text";
import { requireMembership } from "@/modules/permissions/access";
import { CAPABILITIES, PLATFORM_POLICY, platformAllows } from "@/modules/permissions/platform-policy";
import { can } from "@/modules/permissions/roles";

type Tx = Prisma.TransactionClient;
type Role = string;

function assertCan(role: Role, permission: string): void {
  if (!can(role, permission)) throw new ForbiddenError();
}

/** Membership is always derived from the session user + server-side rows; never from the client. */
async function context(actorId: string, businessId: string, permission: string) {
  const membership = await requireMembership(actorId, businessId);
  assertCan(membership.role, permission);
  return membership;
}

async function loadProfile(db: Tx | typeof prisma, businessId: string) {
  const profile = await db.businessProfile.findUnique({ where: { businessId } });
  if (!profile) throw new NotFoundError("The business profile has not been created yet");
  return profile;
}

async function touch(tx: Tx, profileId: string) {
  await tx.businessProfile.update({ where: { id: profileId }, data: { revision: { increment: 1 } } });
}

const permissionNeeded = (def: EntryDef | undefined, approvedBefore: boolean) =>
  def?.module === "PERMISSION" || approvedBefore ? "profile:approve" : "profile:edit";

// ---- reading ------------------------------------------------------------------------------

export async function getProfileView(actorId: string, businessId: string) {
  const membership = await context(actorId, businessId, "profile:read");
  const caps = {
    role: membership.role,
    canEdit: can(membership.role, "profile:edit"),
    canApprove: can(membership.role, "profile:approve"),
  };
  const profile = await prisma.businessProfile.findUnique({ where: { businessId } });
  if (!profile) return { exists: false as const, businessId, caps };

  const [entries, faqs] = await Promise.all([
    prisma.profileEntry.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "asc" } }),
    prisma.faqEntry.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = new Set<string>();
  for (const r of [profile, ...entries, ...faqs]) {
    for (const id of [
      (r as { createdById: string }).createdById,
      (r as { updatedById?: string }).updatedById,
      (r as { approvedById?: string | null }).approvedById,
      (r as { statusChangedById?: string | null }).statusChangedById,
    ]) if (id) ids.add(id);
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const actors = Object.fromEntries(users.map((u) => [u.id, u.name]));

  return {
    exists: true as const,
    businessId,
    caps,
    profile,
    entries,
    faqs,
    actors,
    evaluation: evaluateProfile(entries, faqs),
    nextStatuses: allowedTransitions(profile.status),
  };
}

// ---- creating the profile -----------------------------------------------------------------

/** Idempotent. Starts as DRAFT with NO entries: nothing is pre-filled or assumed. */
export async function createProfile(actorId: string, businessId: string) {
  await context(actorId, businessId, "profile:edit");
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.businessProfile.findUnique({ where: { businessId } });
      if (existing) return { profile: existing, created: false };
      const profile = await tx.businessProfile.create({
        data: { businessId, createdById: actorId, statusChangedById: actorId },
      });
      await recordAudit(tx, {
        action: "profile.created", actorUserId: actorId, businessId, targetType: "BusinessProfile", targetId: profile.id,
      });
      return { profile, created: true };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { profile: await loadProfile(prisma, businessId), created: false };
    }
    throw err;
  }
}

// ---- entries (identity / offerings / communication / policies / permissions) --------------

export type SaveOutcome = "draft" | "auto_approved" | "cosmetic_applied" | "reverted_to_approved" | "unchanged";

/**
 * Save a value. Rules by data type:
 *  - Material (identity, offerings, policies, AI permissions): saved as a DRAFT; the previously
 *    approved value (if any) stays in force until an owner approves. Purely cosmetic edits
 *    (case/whitespace) to an approved value are applied directly.
 *  - Communication preferences are instructions, not facts: applied on save.
 *  - AI permission changes can only be made by an owner, and never beyond platform policy.
 * Only `key` and `value` are read from the input; state/approval fields cannot be client-supplied.
 */
export async function saveEntry(actorId: string, businessId: string, input: { key: unknown; value: unknown }) {
  const membership = await requireMembership(actorId, businessId);
  const def = typeof input.key === "string" ? getEntryDef(input.key) : undefined;
  if (!def) throw new ValidationError("Unknown profile field", { key: ["Unknown field"] });
  assertCan(membership.role, permissionNeeded(def, false));
  const value = normalizeEntryValue(def, input.value);
  if (def.module === "PERMISSION" && value === "enabled" && !platformAllows(def.key)) {
    throw new ForbiddenError("This capability is not permitted by platform policy");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const profile = await loadProfile(tx, businessId);
      const existing = await tx.profileEntry.findUnique({
        where: { profileId_module_key: { profileId: profile.id, module: def.module, key: def.key } },
      });
      if (existing && existing.value === value) return { entry: existing, outcome: "unchanged" as SaveOutcome };

      const now = new Date();
      const hasApproved = existing?.approvedValue != null;
      const revert = hasApproved && existing!.approvedValue === value;
      const approveNow = !def.material || (hasApproved && sameOrCosmetic(existing!.approvedValue!, value));

      let outcome: SaveOutcome;
      let data: Prisma.ProfileEntryUncheckedUpdateInput;
      if (revert) {
        outcome = "reverted_to_approved";
        data = { value, state: "APPROVED" };
      } else if (approveNow) {
        outcome = def.material ? "cosmetic_applied" : "auto_approved";
        data = { value, approvedValue: value, state: "APPROVED", approvedAt: now, approvedById: actorId };
      } else {
        outcome = "draft";
        data = { value, state: "DRAFT" };
      }

      const entry = existing
        ? await tx.profileEntry.update({
            where: { id: existing.id },
            data: { ...data, updatedById: actorId, revision: { increment: 1 } },
          })
        : await tx.profileEntry.create({
            data: {
              profileId: profile.id, module: def.module, key: def.key, createdById: actorId, updatedById: actorId,
              value, state: approveNow ? "APPROVED" : "DRAFT",
              approvedValue: approveNow && !revert ? value : null,
              approvedAt: approveNow && !revert ? now : null,
              approvedById: approveNow && !revert ? actorId : null,
            },
          });
      await touch(tx, profile.id);
      await recordAudit(tx, {
        action: "profile.entry.saved", actorUserId: actorId, businessId, targetType: "ProfileEntry", targetId: entry.id,
        // never the value itself (it may be a phone number or email); permissions are non-sensitive booleans
        metadata: { module: def.module, key: def.key, outcome, ...(def.module === "PERMISSION" ? { enabled: value === "enabled" } : {}) },
      });
      return { entry, outcome };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("This field was changed at the same time. Reload and try again.");
    }
    throw err;
  }
}

async function findEntry(tx: Tx, businessId: string, entryId: string) {
  const profile = await loadProfile(tx, businessId);
  // Scoped by profileId: an entry id belonging to another business is simply "not found".
  const entry = await tx.profileEntry.findFirst({ where: { id: entryId, profileId: profile.id } });
  if (!entry) throw new NotFoundError("Profile entry not found");
  return { profile, entry };
}

/** Return a field to "not provided". Removing an approved value (or any AI permission) is owner-only. */
export async function clearEntry(actorId: string, businessId: string, entryId: string) {
  const membership = await context(actorId, businessId, "profile:edit");
  return prisma.$transaction(async (tx) => {
    const { profile, entry } = await findEntry(tx, businessId, entryId);
    const def = getEntryDef(entry.key);
    assertCan(membership.role, permissionNeeded(def, entry.approvedValue !== null));
    if (profile.status === "ACTIVE" && def?.requiredForActivation && entry.approvedValue !== null) {
      throw new ConflictError("Suspend the profile before removing an item it requires");
    }
    await tx.profileEntry.delete({ where: { id: entry.id } });
    await touch(tx, profile.id);
    await recordAudit(tx, {
      action: "profile.entry.cleared", actorUserId: actorId, businessId, targetType: "ProfileEntry", targetId: entry.id,
      metadata: { module: entry.module, key: entry.key, wasApproved: entry.approvedValue !== null },
    });
  });
}

/** Drop a pending change: back to the approved value, or removed if it was never approved. */
export async function discardEntryChange(actorId: string, businessId: string, entryId: string) {
  const membership = await context(actorId, businessId, "profile:edit");
  return prisma.$transaction(async (tx) => {
    const { profile, entry } = await findEntry(tx, businessId, entryId);
    assertCan(membership.role, permissionNeeded(getEntryDef(entry.key), false));
    if (entry.state === "APPROVED") throw new ConflictError("There is no pending change to discard");
    if (entry.approvedValue === null) await tx.profileEntry.delete({ where: { id: entry.id } });
    else {
      await tx.profileEntry.update({
        where: { id: entry.id },
        data: { value: entry.approvedValue, state: "APPROVED", updatedById: actorId, revision: { increment: 1 } },
      });
    }
    await touch(tx, profile.id);
    await recordAudit(tx, {
      action: "profile.entry.discarded", actorUserId: actorId, businessId, targetType: "ProfileEntry", targetId: entry.id,
      metadata: { module: entry.module, key: entry.key },
    });
  });
}

async function approveEntryTx(tx: Tx, profile: { id: string; businessId: string }, entry: ProfileEntry, actorId: string) {
  if (entry.state === "APPROVED") throw new ConflictError("Nothing to approve");
  // Re-checked at approval time: a business can never approve what the platform forbids.
  if (entry.module === "PERMISSION" && entry.value === "enabled" && !platformAllows(entry.key)) {
    throw new ForbiddenError("This capability is not permitted by platform policy");
  }
  const updated = await tx.profileEntry.update({
    where: { id: entry.id },
    data: {
      approvedValue: entry.value, state: "APPROVED", approvedAt: new Date(), approvedById: actorId,
      revision: { increment: 1 },
    },
  });
  await touch(tx, profile.id);
  await recordAudit(tx, {
    action: "profile.entry.approved", actorUserId: actorId, businessId: profile.businessId,
    targetType: "ProfileEntry", targetId: entry.id,
    metadata: { module: entry.module, key: entry.key, ...(entry.module === "PERMISSION" ? { enabled: entry.value === "enabled" } : {}) },
  });
  return updated;
}

export async function approveEntry(actorId: string, businessId: string, entryId: string) {
  await context(actorId, businessId, "profile:approve");
  return prisma.$transaction(async (tx) => {
    const { profile, entry } = await findEntry(tx, businessId, entryId);
    return approveEntryTx(tx, profile, entry, actorId);
  });
}

// ---- FAQs ---------------------------------------------------------------------------------

async function findFaq(tx: Tx, businessId: string, faqId: string) {
  const profile = await loadProfile(tx, businessId);
  const faq = await tx.faqEntry.findFirst({ where: { id: faqId, profileId: profile.id } });
  if (!faq) throw new NotFoundError("FAQ entry not found");
  return { profile, faq };
}

async function conflictingFaq(tx: Tx, profileId: string, faq: Pick<FaqEntry, "id" | "isActive" | "normalizedQuestion" | "answer">) {
  if (!faq.isActive) return null;
  const others = await tx.faqEntry.findMany({
    where: { profileId, isActive: true, normalizedQuestion: faq.normalizedQuestion, id: { not: faq.id } },
    select: { id: true, answer: true },
  });
  return others.find((o) => compareForm(o.answer) !== compareForm(faq.answer)) ?? null;
}

export async function createFaq(actorId: string, businessId: string, input: unknown) {
  await context(actorId, businessId, "profile:edit");
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const data = normalizeFaqInput(raw, true);
  return prisma.$transaction(async (tx) => {
    const profile = await loadProfile(tx, businessId);
    if ((await tx.faqEntry.count({ where: { profileId: profile.id } })) >= MAX_FAQS_PER_PROFILE) {
      throw new ConflictError(`A profile can hold at most ${MAX_FAQS_PER_PROFILE} FAQ entries`);
    }
    const faq = await tx.faqEntry.create({
      data: {
        profileId: profile.id, question: data.question!, answer: data.answer!, category: data.category ?? null,
        normalizedQuestion: normalizeQuestion(data.question!), createdById: actorId, updatedById: actorId,
      },
    });
    await touch(tx, profile.id);
    await recordAudit(tx, { action: "profile.faq.created", actorUserId: actorId, businessId, targetType: "FaqEntry", targetId: faq.id });
    return faq;
  });
}

/**
 * Question/answer edits are material: saved as a draft while the approved wording stays in force
 * (cosmetic case/whitespace edits are applied directly). Category edits are not material.
 */
export async function updateFaq(actorId: string, businessId: string, faqId: string, input: unknown) {
  await context(actorId, businessId, "profile:edit");
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const data = normalizeFaqInput({ question: raw.question, answer: raw.answer, category: raw.category }, false);
  return prisma.$transaction(async (tx) => {
    const { profile, faq: cur } = await findFaq(tx, businessId, faqId);
    const q = data.question ?? cur.question;
    const a = data.answer ?? cur.answer;
    const c = data.category !== undefined ? data.category : cur.category;
    if (q === cur.question && a === cur.answer && c === cur.category) return { faq: cur, outcome: "unchanged" as const };

    const base = { question: q, answer: a, category: c, normalizedQuestion: normalizeQuestion(q), updatedById: actorId, revision: { increment: 1 } };
    let outcome: "draft" | "applied";
    let faq: FaqEntry;
    if (cur.approvedAt !== null && sameOrCosmetic(cur.approvedQuestion!, q) && sameOrCosmetic(cur.approvedAnswer!, a)) {
      outcome = "applied";
      faq = await tx.faqEntry.update({
        where: { id: cur.id },
        data: { ...base, approvedQuestion: q, approvedAnswer: a, approvedCategory: c, state: "APPROVED" },
      });
    } else {
      outcome = "draft";
      faq = await tx.faqEntry.update({
        where: { id: cur.id },
        data: { ...base, state: "DRAFT", ...(cur.approvedAt !== null ? { approvedCategory: c } : {}) },
      });
    }
    await touch(tx, profile.id);
    await recordAudit(tx, {
      action: "profile.faq.updated", actorUserId: actorId, businessId, targetType: "FaqEntry", targetId: faq.id,
      metadata: {
        outcome,
        fields: [q !== cur.question && "question", a !== cur.answer && "answer", c !== cur.category && "category"].filter(Boolean).join(","),
      },
    });
    return { faq, outcome };
  });
}

/** Deactivating/activating never makes anything usable by itself: only approved content is ever used. */
export async function setFaqActive(actorId: string, businessId: string, faqId: string, isActive: boolean) {
  await context(actorId, businessId, "profile:edit");
  return prisma.$transaction(async (tx) => {
    const { profile, faq } = await findFaq(tx, businessId, faqId);
    if (faq.isActive === isActive) return faq;
    const updated = await tx.faqEntry.update({ where: { id: faq.id }, data: { isActive, updatedById: actorId, revision: { increment: 1 } } });
    await touch(tx, profile.id);
    await recordAudit(tx, {
      action: isActive ? "profile.faq.activated" : "profile.faq.deactivated", actorUserId: actorId, businessId,
      targetType: "FaqEntry", targetId: faq.id,
    });
    return updated;
  });
}

export async function deleteFaq(actorId: string, businessId: string, faqId: string) {
  const membership = await context(actorId, businessId, "profile:edit");
  return prisma.$transaction(async (tx) => {
    const { profile, faq } = await findFaq(tx, businessId, faqId);
    if (faq.approvedAt !== null) assertCan(membership.role, "profile:approve"); // removing approved knowledge: owner only
    await tx.faqEntry.delete({ where: { id: faq.id } });
    await touch(tx, profile.id);
    await recordAudit(tx, {
      action: "profile.faq.deleted", actorUserId: actorId, businessId, targetType: "FaqEntry", targetId: faq.id,
      metadata: { wasApproved: faq.approvedAt !== null },
    });
  });
}

export async function discardFaqChange(actorId: string, businessId: string, faqId: string) {
  await context(actorId, businessId, "profile:edit");
  return prisma.$transaction(async (tx) => {
    const { profile, faq } = await findFaq(tx, businessId, faqId);
    if (faq.state === "APPROVED") throw new ConflictError("There is no pending change to discard");
    if (faq.approvedAt === null) await tx.faqEntry.delete({ where: { id: faq.id } });
    else {
      await tx.faqEntry.update({
        where: { id: faq.id },
        data: {
          question: faq.approvedQuestion!, answer: faq.approvedAnswer!, category: faq.approvedCategory,
          normalizedQuestion: normalizeQuestion(faq.approvedQuestion!), state: "APPROVED",
          updatedById: actorId, revision: { increment: 1 },
        },
      });
    }
    await touch(tx, profile.id);
    await recordAudit(tx, { action: "profile.faq.discarded", actorUserId: actorId, businessId, targetType: "FaqEntry", targetId: faq.id });
  });
}

async function approveFaqTx(tx: Tx, profile: { id: string; businessId: string }, faq: FaqEntry, actorId: string) {
  if (faq.state === "APPROVED") throw new ConflictError("Nothing to approve");
  if (await conflictingFaq(tx, profile.id, faq)) {
    throw new ConflictError("This answer conflicts with another active FAQ for the same question. Resolve the conflict first.");
  }
  const updated = await tx.faqEntry.update({
    where: { id: faq.id },
    data: {
      approvedQuestion: faq.question, approvedAnswer: faq.answer, approvedCategory: faq.category, state: "APPROVED",
      approvedAt: new Date(), approvedById: actorId, revision: { increment: 1 },
    },
  });
  await touch(tx, profile.id);
  await recordAudit(tx, {
    action: "profile.faq.approved", actorUserId: actorId, businessId: profile.businessId, targetType: "FaqEntry", targetId: faq.id,
  });
  return updated;
}

export async function approveFaq(actorId: string, businessId: string, faqId: string) {
  await context(actorId, businessId, "profile:approve");
  return prisma.$transaction(async (tx) => {
    const { profile, faq } = await findFaq(tx, businessId, faqId);
    return approveFaqTx(tx, profile, faq, actorId);
  });
}

/** Approves every pending item that passes its checks; reports (never forces) the ones that do not. */
export async function approveAllPending(actorId: string, businessId: string) {
  await context(actorId, businessId, "profile:approve");
  return prisma.$transaction(async (tx) => {
    const profile = await loadProfile(tx, businessId);
    const [entries, faqs] = await Promise.all([
      tx.profileEntry.findMany({ where: { profileId: profile.id, state: "DRAFT" } }),
      tx.faqEntry.findMany({ where: { profileId: profile.id, state: "DRAFT" } }),
    ]);
    let approved = 0;
    const skipped: string[] = [];
    for (const e of entries) {
      try { await approveEntryTx(tx, profile, e, actorId); approved++; }
      catch (err) { if (err instanceof ConflictError || err instanceof ForbiddenError) skipped.push(getEntryDef(e.key)?.label ?? e.key); else throw err; }
    }
    for (const f of faqs) {
      try { await approveFaqTx(tx, profile, f, actorId); approved++; }
      catch (err) { if (err instanceof ConflictError) skipped.push(f.question.slice(0, 60)); else throw err; }
    }
    return { approved, skipped };
  });
}

// ---- lifecycle ----------------------------------------------------------------------------

export async function changeProfileStatus(actorId: string, businessId: string, target: unknown, opts: { reason?: unknown } = {}) {
  const membership = await context(actorId, businessId, "profile:read");
  if (!isProfileStatus(target)) throw new ValidationError("Unknown profile status", { to: ["Unknown status"] });
  const to: ProfileStatusName = target;

  return prisma.$transaction(async (tx) => {
    const profile = await loadProfile(tx, businessId);
    const from = profile.status as ProfileStatusName;
    assertCan(membership.role, requiredPermissionFor(from, to));
    if (!canTransition(from, to)) {
      throw new ConflictError(`A ${STATUS_LABEL[from].toLowerCase()} profile cannot move to “${STATUS_LABEL[to]}”`);
    }

    let reason: string | null = null;
    const [entries, faqs] = await Promise.all([
      tx.profileEntry.findMany({ where: { profileId: profile.id } }),
      tx.faqEntry.findMany({ where: { profileId: profile.id } }),
    ]);
    const evaluation = evaluateProfile(entries, faqs);

    if (to === "ACTIVE" && !evaluation.canActivate) {
      const shown = evaluation.blocking.slice(0, 3).join("; ");
      throw new ConflictError(`The profile cannot be activated yet: ${shown}${evaluation.blocking.length > 3 ? "…" : ""}`);
    }
    if (to === "REVIEW_REQUIRED" && evaluation.pending.length === 0) {
      throw new ConflictError("There is nothing awaiting review");
    }
    if (to === "SUSPENDED") {
      const r = typeof opts.reason === "string" ? opts.reason.trim() : "";
      if (r.length < 1 || r.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r)) {
        throw new ValidationError("A reason is required", { reason: ["Give a short reason (up to 300 characters)"] });
      }
      reason = r;
    }

    const now = new Date();
    const { count } = await tx.businessProfile.updateMany({
      where: { id: profile.id, status: from }, // race guard: only if nobody changed it meanwhile
      data: {
        status: to, statusChangedAt: now, statusChangedById: actorId, statusReason: reason,
        activatedAt: to === "ACTIVE" ? now : profile.activatedAt, revision: { increment: 1 },
      },
    });
    if (count !== 1) throw new ConflictError("The profile was changed at the same time. Reload and try again.");

    await recordAudit(tx, {
      action: "profile.status_changed", actorUserId: actorId, businessId, targetType: "BusinessProfile", targetId: profile.id,
      metadata: { from, to },
    });
    return { from, to };
  });
}

// ---- consumption API for future milestones (system use only) ------------------------------

/**
 * What a future conversation engine may rely on. Returns null unless the profile is ACTIVE.
 * Contains ONLY approved values: drafts, pending changes and inactive FAQs are excluded, and
 * every capability is `platform allowed AND owner approved` (default false).
 *
 * NOT user-scoped: it takes no actor, so it must only be called by trusted server code that has
 * already determined which business it is acting for — never from a client-controlled path.
 */
export async function getApprovedProfileSnapshot(businessId: string) {
  const profile = await prisma.businessProfile.findUnique({ where: { businessId } });
  if (!profile || profile.status !== "ACTIVE") return null;
  const [entries, faqs, catalogueItems] = await Promise.all([
    prisma.profileEntry.findMany({ where: { profileId: profile.id, approvedValue: { not: null } } }),
    prisma.faqEntry.findMany({ where: { profileId: profile.id, isActive: true, approvedAt: { not: null } }, orderBy: { createdAt: "asc" } }),
    prisma.catalogueItem.findMany({ where: { profileId: profile.id, state: "APPROVED" }, orderBy: { name: "asc" } }),
  ]);
  const values: Record<string, string> = {};
  const approvedCap = new Map<string, boolean>();
  for (const e of entries) {
    if (e.module === "PERMISSION") approvedCap.set(e.key, e.approvedValue === "enabled");
    else values[e.key] = e.approvedValue!;
  }
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((c) => [c, PLATFORM_POLICY[c].allowed && approvedCap.get(c) === true]),
  ) as Record<(typeof CAPABILITIES)[number], boolean>;
  return {
    profileId: profile.id,
    revision: profile.revision,
    values, // approved identity / offerings / communication / policy values; absent key = unknown
    faqs: faqs.map((f) => ({ id: f.id, question: f.approvedQuestion!, answer: f.approvedAnswer!, category: f.approvedCategory })),
    capabilities,
    catalogue: catalogueItems.map((c) => ({
      id: c.id,
      name: c.approvedName ?? c.name,
      description: c.approvedDescription,
      category: c.approvedCategory,
      priceGhs: Number(c.approvedPriceGhs ?? c.priceGhs),
      currency: c.currency,
      inStock: c.approvedInStock ?? c.inStock,
      variants: c.approvedVariants,
    })),
  };
}
