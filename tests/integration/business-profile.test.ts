import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/security/errors";
import {
  approveAllPending, approveEntry, approveFaq, changeProfileStatus, clearEntry, createFaq, createProfile, deleteFaq,
  discardEntryChange, discardFaqChange, getApprovedProfileSnapshot, getProfileView, saveEntry, setFaqActive, updateFaq,
} from "@/modules/business-profile/service";
import { resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type T = Awaited<ReturnType<typeof twoTenants>>;
async function start(): Promise<T> {
  const t = await twoTenants();
  await createProfile(t.ownerA.id, t.bizA.id);
  return t;
}
async function saveApprove(t: T, key: string, value: string) {
  const { entry } = await saveEntry(t.ownerA.id, t.bizA.id, { key, value });
  if (entry.state === "DRAFT") await approveEntry(t.ownerA.id, t.bizA.id, entry.id);
}
async function makeActivatable(t: T) {
  await saveApprove(t, "business_category", "Phone retailer");
  await saveApprove(t, "offerings_summary", "We sell phones and accessories.");
  await saveApprove(t, "escalation", "Call the owner on the public number.");
}
const row = (t: T, key: string) => prisma.profileEntry.findFirstOrThrow({ where: { key, profile: { businessId: t.bizA.id } } });
const profile = (t: T) => prisma.businessProfile.findUniqueOrThrow({ where: { businessId: t.bizA.id } });
const audit = (action: string) => prisma.auditEvent.findMany({ where: { action } });

describe("profile creation", () => {
  it("starts as DRAFT with nothing pre-filled; idempotent; members cannot create", async () => {
    const t = await twoTenants();
    const r = await createProfile(t.adminA.id, t.bizA.id);
    expect(r).toMatchObject({ created: true, profile: { status: "DRAFT", businessId: t.bizA.id } });
    expect(await prisma.profileEntry.count()).toBe(0);
    expect(await prisma.faqEntry.count()).toBe(0);
    expect((await createProfile(t.ownerA.id, t.bizA.id)).created).toBe(false);
    await expect(createProfile(t.memberA.id, t.bizA.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.businessProfile.count()).toBe(1);
    expect(await audit("profile.created")).toHaveLength(1);
  });
  it("every business gets its own independent profile", async () => {
    const t = await start();
    await createProfile(t.ownerB.id, t.bizB.id);
    await saveEntry(t.ownerA.id, t.bizA.id, { key: "delivery", value: "A delivers" });
    expect(await prisma.businessProfile.count()).toBe(2);
    expect(await prisma.profileEntry.count({ where: { profile: { businessId: t.bizB.id } } })).toBe(0);
  });
});

describe("entry approval rules by data type", () => {
  it("material entries are drafts until the owner approves; admins/members cannot approve", async () => {
    const t = await start();
    const { entry, outcome } = await saveEntry(t.adminA.id, t.bizA.id, { key: "delivery", value: "We deliver in Kumasi" });
    expect(outcome).toBe("draft");
    expect(entry).toMatchObject({ state: "DRAFT", approvedValue: null, approvedById: null });
    await expect(approveEntry(t.adminA.id, t.bizA.id, entry.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveEntry(t.memberA.id, t.bizA.id, entry.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(t, "delivery")).state).toBe("DRAFT");
    const approved = await approveEntry(t.ownerA.id, t.bizA.id, entry.id);
    expect(approved).toMatchObject({ state: "APPROVED", approvedValue: "We deliver in Kumasi", approvedById: t.ownerA.id });
    await expect(approveEntry(t.ownerA.id, t.bizA.id, entry.id)).rejects.toBeInstanceOf(ConflictError);
  });
  it("editing an approved material value keeps the approved value in force until re-approved", async () => {
    const t = await start();
    await saveApprove(t, "delivery", "We deliver in Kumasi");
    const r = await saveEntry(t.adminA.id, t.bizA.id, { key: "delivery", value: "We deliver nationwide" });
    expect(r.outcome).toBe("draft");
    expect(await row(t, "delivery")).toMatchObject({ value: "We deliver nationwide", approvedValue: "We deliver in Kumasi", state: "DRAFT" });
    const back = await saveEntry(t.adminA.id, t.bizA.id, { key: "delivery", value: "We deliver in Kumasi" });
    expect(back.outcome).toBe("reverted_to_approved");
    expect((await row(t, "delivery")).state).toBe("APPROVED");
  });
  it("cosmetic (case/whitespace) edits to approved values apply directly; numeric/punctuation edits do not", async () => {
    const t = await start();
    await saveApprove(t, "returns", "Returns within 7 days. Price GH₵10.50");
    const cosmetic = await saveEntry(t.adminA.id, t.bizA.id, { key: "returns", value: "returns within 7  DAYS. price gh₵10.50" });
    expect(cosmetic.outcome).toBe("cosmetic_applied");
    expect(await row(t, "returns")).toMatchObject({ state: "APPROVED", approvedValue: "returns within 7  DAYS. price gh₵10.50" });
    const material = await saveEntry(t.adminA.id, t.bizA.id, { key: "returns", value: "returns within 7 days. price gh₵1050" });
    expect(material.outcome).toBe("draft");
  });
  it("communication preferences are instructions: applied on save by an admin, but still validated", async () => {
    const t = await start();
    const r = await saveEntry(t.adminA.id, t.bizA.id, { key: "tone", value: "warm" });
    expect(r.outcome).toBe("auto_approved");
    expect(r.entry).toMatchObject({ state: "APPROVED", approvedValue: "warm", approvedById: t.adminA.id });
    await expect(saveEntry(t.adminA.id, t.bizA.id, { key: "tone", value: "rude" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(t.memberA.id, t.bizA.id, { key: "tone", value: "warm" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("rejects unknown keys and invalid values; unknown stays unknown (no defaults)", async () => {
    const t = await start();
    await expect(saveEntry(t.ownerA.id, t.bizA.id, { key: "made_up", value: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(t.ownerA.id, t.bizA.id, { key: "delivery", value: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(t.ownerA.id, t.bizA.id, { key: "public_phone", value: "call me" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(t.ownerA.id, t.bizA.id, { key: "constructor", value: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.profileEntry.count()).toBe(0);
  });
  it("client-supplied state/approval fields are ignored", async () => {
    const t = await start();
    const hostile = { key: "delivery", value: "We deliver", state: "APPROVED", approvedValue: "We deliver", approvedById: t.ownerA.id } as unknown as { key: unknown; value: unknown };
    const { entry } = await saveEntry(t.adminA.id, t.bizA.id, hostile);
    expect(entry).toMatchObject({ state: "DRAFT", approvedValue: null, approvedById: null });
  });
});

describe("clear and discard", () => {
  it("admins can clear drafts but not approved values; owners can; discard restores the approved value", async () => {
    const t = await start();
    const { entry: draft } = await saveEntry(t.adminA.id, t.bizA.id, { key: "opening_hours", value: "9 to 5" });
    await clearEntry(t.adminA.id, t.bizA.id, draft.id);
    expect(await prisma.profileEntry.count()).toBe(0);

    await saveApprove(t, "opening_hours", "9 to 5");
    const approved = await row(t, "opening_hours");
    await expect(clearEntry(t.adminA.id, t.bizA.id, approved.id)).rejects.toBeInstanceOf(ForbiddenError);
    await saveEntry(t.adminA.id, t.bizA.id, { key: "opening_hours", value: "8 to 6" });
    await discardEntryChange(t.adminA.id, t.bizA.id, approved.id);
    expect(await row(t, "opening_hours")).toMatchObject({ value: "9 to 5", state: "APPROVED" });
    await expect(discardEntryChange(t.adminA.id, t.bizA.id, approved.id)).rejects.toBeInstanceOf(ConflictError);
    await clearEntry(t.ownerA.id, t.bizA.id, approved.id);
    expect(await prisma.profileEntry.count()).toBe(0);
  });
  it("an active profile's required approved items cannot be cleared", async () => {
    const t = await start();
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    const req = await row(t, "business_category");
    await expect(clearEntry(t.ownerA.id, t.bizA.id, req.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.profileEntry.count({ where: { key: "business_category" } })).toBe(1);
  });
});

describe("FAQ knowledge entries", () => {
  it("create → draft → approve; question/answer edits are drafts, category edits are not", async () => {
    const t = await start();
    const faq = await createFaq(t.adminA.id, t.bizA.id, { question: "Do you sell used phones?", answer: "No, new only.", category: "Products" });
    expect(faq).toMatchObject({ state: "DRAFT", approvedAt: null, isActive: true });
    await expect(approveFaq(t.adminA.id, t.bizA.id, faq.id)).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await approveFaq(t.ownerA.id, t.bizA.id, faq.id);
    expect(ok).toMatchObject({ state: "APPROVED", approvedAnswer: "No, new only.", approvedById: t.ownerA.id });

    const edited = await updateFaq(t.adminA.id, t.bizA.id, faq.id, { answer: "Yes, refurbished too." });
    expect(edited.outcome).toBe("draft");
    expect(edited.faq).toMatchObject({ state: "DRAFT", answer: "Yes, refurbished too.", approvedAnswer: "No, new only." });

    await discardFaqChange(t.adminA.id, t.bizA.id, faq.id);
    const cat = await updateFaq(t.adminA.id, t.bizA.id, faq.id, { category: "Stock" });
    expect(cat.faq).toMatchObject({ state: "APPROVED", category: "Stock", approvedCategory: "Stock" });
    const cosmetic = await updateFaq(t.adminA.id, t.bizA.id, faq.id, { question: "do you sell USED phones?" });
    expect(cosmetic.faq.state).toBe("APPROVED");
  });
  it("validates input", async () => {
    const t = await start();
    const err = await createFaq(t.adminA.id, t.bizA.id, { question: "hey", answer: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors.question).toBeTruthy();
    await expect(createFaq(t.adminA.id, t.bizA.id, { question: "A fine question?", answer: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createFaq(t.adminA.id, t.bizA.id, "nonsense")).rejects.toBeInstanceOf(ValidationError);
  });
  it("conflicting answers are surfaced, block approval and activation, and are never auto-resolved", async () => {
    const t = await start();
    await makeActivatable(t);
    const a = await createFaq(t.ownerA.id, t.bizA.id, { question: "What are your hours?", answer: "8am to 5pm" });
    const b = await createFaq(t.ownerA.id, t.bizA.id, { question: "what are your hours", answer: "9am to 6pm" });
    const view = await getProfileView(t.ownerA.id, t.bizA.id);
    if (!view.exists) throw new Error("expected profile");
    expect(view.evaluation.conflicts).toEqual([expect.objectContaining({ faqIds: expect.arrayContaining([a.id, b.id]) })]);
    await expect(approveFaq(t.ownerA.id, t.bizA.id, a.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE")).rejects.toThrow(/Conflicting answers/);
    expect(await prisma.faqEntry.findMany({ where: { state: "APPROVED" } })).toHaveLength(0); // nothing silently chosen

    await setFaqActive(t.ownerA.id, t.bizA.id, b.id, false);
    await approveFaq(t.ownerA.id, t.bizA.id, a.id);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    expect((await profile(t)).status).toBe("ACTIVE");
  });
  it("deleting approved knowledge is owner-only; drafts can be deleted by editors", async () => {
    const t = await start();
    const draft = await createFaq(t.adminA.id, t.bizA.id, { question: "Draft question?", answer: "Draft" });
    await deleteFaq(t.adminA.id, t.bizA.id, draft.id);
    const f = await createFaq(t.adminA.id, t.bizA.id, { question: "Approved question?", answer: "Yes" });
    await approveFaq(t.ownerA.id, t.bizA.id, f.id);
    await expect(deleteFaq(t.adminA.id, t.bizA.id, f.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteFaq(t.ownerA.id, t.bizA.id, f.id);
    expect(await prisma.faqEntry.count()).toBe(0);
  });
  it("approve-all approves what passes and reports what it skipped", async () => {
    const t = await start();
    await saveEntry(t.ownerA.id, t.bizA.id, { key: "delivery", value: "We deliver" });
    const x = await createFaq(t.ownerA.id, t.bizA.id, { question: "Same question?", answer: "Answer one" });
    await createFaq(t.ownerA.id, t.bizA.id, { question: "same question", answer: "Answer two" });
    const r = await approveAllPending(t.ownerA.id, t.bizA.id);
    expect(r.approved).toBe(1);
    expect(r.skipped).toHaveLength(2);
    expect((await prisma.faqEntry.findUniqueOrThrow({ where: { id: x.id } })).state).toBe("DRAFT");
    await expect(approveAllPending(t.adminA.id, t.bizA.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("profile lifecycle", () => {
  it("enforces the permitted transitions and who may perform them", async () => {
    const t = await start();
    await expect(changeProfileStatus(t.adminA.id, t.bizA.id, "REVIEW_REQUIRED")).rejects.toThrow(/nothing awaiting review/);
    await saveEntry(t.adminA.id, t.bizA.id, { key: "delivery", value: "We deliver" });
    await changeProfileStatus(t.adminA.id, t.bizA.id, "REVIEW_REQUIRED");
    expect((await profile(t)).status).toBe("REVIEW_REQUIRED");
    await changeProfileStatus(t.adminA.id, t.bizA.id, "DRAFT");

    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "SUSPENDED", { reason: "x" })).rejects.toBeInstanceOf(ConflictError); // DRAFT -> SUSPENDED
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "BOGUS")).rejects.toBeInstanceOf(ValidationError);
    await expect(changeProfileStatus(t.adminA.id, t.bizA.id, "ACTIVE")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeProfileStatus(t.memberA.id, t.bizA.id, "REVIEW_REQUIRED")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await profile(t)).status).toBe("DRAFT");
  });
  it("cannot activate while required items are missing or unapproved; can once approved", async () => {
    const t = await start();
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE")).rejects.toThrow(/cannot be activated yet/);
    await saveEntry(t.ownerA.id, t.bizA.id, { key: "business_category", value: "Phone retailer" });
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE")).rejects.toThrow(/not yet approved|not been provided/);
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    const p = await profile(t);
    expect(p).toMatchObject({ status: "ACTIVE", statusChangedById: t.ownerA.id });
    expect(p.activatedAt).not.toBeNull();
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "DRAFT")).rejects.toBeInstanceOf(ConflictError);
  });
  it("suspension needs a reason and an owner; suspended profiles are not consumable; reactivation re-validates", async () => {
    const t = await start();
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    expect(await getApprovedProfileSnapshot(t.bizA.id)).not.toBeNull();
    await expect(changeProfileStatus(t.adminA.id, t.bizA.id, "SUSPENDED", { reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeProfileStatus(t.ownerA.id, t.bizA.id, "SUSPENDED")).rejects.toBeInstanceOf(ValidationError);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "SUSPENDED", { reason: "Prices under review" });
    expect(await profile(t)).toMatchObject({ status: "SUSPENDED", statusReason: "Prices under review" });
    expect(await getApprovedProfileSnapshot(t.bizA.id)).toBeNull();

    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    expect((await profile(t)).statusReason).toBeNull();
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "SUSPENDED", { reason: "again" });
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "DRAFT");
    expect((await profile(t)).status).toBe("DRAFT");
  });
});

describe("AI permissions and platform restrictions", () => {
  it("everything defaults to disabled; owner changes are drafts until approved; only owners can change them", async () => {
    const t = await start();
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    expect(Object.values((await getApprovedProfileSnapshot(t.bizA.id))!.capabilities).every((v) => v === false)).toBe(true);

    await expect(saveEntry(t.adminA.id, t.bizA.id, { key: "answer_routine_enquiries", value: "enabled" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveEntry(t.memberA.id, t.bizA.id, { key: "answer_routine_enquiries", value: "enabled" })).rejects.toBeInstanceOf(ForbiddenError);
    const { entry, outcome } = await saveEntry(t.ownerA.id, t.bizA.id, { key: "answer_routine_enquiries", value: "enabled" });
    expect(outcome).toBe("draft");
    expect((await getApprovedProfileSnapshot(t.bizA.id))!.capabilities.answer_routine_enquiries).toBe(false);
    await approveEntry(t.ownerA.id, t.bizA.id, entry.id);
    expect((await getApprovedProfileSnapshot(t.bizA.id))!.capabilities.answer_routine_enquiries).toBe(true);
    await expect(clearEntry(t.adminA.id, t.bizA.id, entry.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("a business can never enable automatic sending, even via the owner workflow or a forced row", async () => {
    const t = await start();
    await expect(saveEntry(t.ownerA.id, t.bizA.id, { key: "send_messages_automatically", value: "enabled" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await saveEntry(t.ownerA.id, t.bizA.id, { key: "send_messages_automatically", value: "disabled" })).outcome).toBe("draft");

    const p = await profile(t);
    await prisma.profileEntry.deleteMany({ where: { key: "send_messages_automatically" } });
    const forced = await prisma.profileEntry.create({
      data: { profileId: p.id, module: "PERMISSION", key: "send_messages_automatically", value: "enabled", createdById: t.ownerA.id, updatedById: t.ownerA.id },
    });
    await expect(approveEntry(t.ownerA.id, t.bizA.id, forced.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.profileEntry.findUniqueOrThrow({ where: { id: forced.id } })).state).toBe("DRAFT");

    // even a hand-approved database value cannot produce an effective permission
    await prisma.profileEntry.update({ where: { id: forced.id }, data: { approvedValue: "enabled", approvedAt: new Date(), approvedById: t.ownerA.id, state: "APPROVED" } });
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");
    expect((await getApprovedProfileSnapshot(t.bizA.id))!.capabilities.send_messages_automatically).toBe(false);
  });
});

describe("approved snapshot for future milestones", () => {
  it("is null without a profile or unless ACTIVE", async () => {
    const t = await twoTenants();
    expect(await getApprovedProfileSnapshot(t.bizA.id)).toBeNull();
    await createProfile(t.ownerA.id, t.bizA.id);
    expect(await getApprovedProfileSnapshot(t.bizA.id)).toBeNull();
  });
  it("contains only approved, active knowledge — never drafts, pending changes or inactive FAQs", async () => {
    const t = await start();
    await makeActivatable(t);
    await saveApprove(t, "delivery", "Approved delivery text");
    await saveEntry(t.adminA.id, t.bizA.id, { key: "delivery", value: "Unapproved new delivery text" });
    await saveEntry(t.adminA.id, t.bizA.id, { key: "returns", value: "Draft-only returns" });
    await saveEntry(t.adminA.id, t.bizA.id, { key: "tone", value: "friendly" });
    const ok = await createFaq(t.ownerA.id, t.bizA.id, { question: "Approved FAQ?", answer: "Yes." });
    await approveFaq(t.ownerA.id, t.bizA.id, ok.id);
    const off = await createFaq(t.ownerA.id, t.bizA.id, { question: "Deactivated FAQ?", answer: "Yes." });
    await approveFaq(t.ownerA.id, t.bizA.id, off.id);
    await setFaqActive(t.ownerA.id, t.bizA.id, off.id, false);
    await createFaq(t.ownerA.id, t.bizA.id, { question: "Draft FAQ?", answer: "Maybe." });
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");

    const snap = (await getApprovedProfileSnapshot(t.bizA.id))!;
    expect(snap.values.delivery).toBe("Approved delivery text");
    expect(snap.values.returns).toBeUndefined();
    expect(snap.values.tone).toBe("friendly");
    expect(snap.values.opening_hours).toBeUndefined(); // unknown stays unknown
    expect(snap.faqs.map((f) => f.question)).toEqual(["Approved FAQ?"]);
    expect(JSON.stringify(snap)).not.toContain("Unapproved new delivery text");
  });
});

describe("audit and provenance", () => {
  it("records who/what/when without leaking values or secrets", async () => {
    const t = await start();
    const { entry } = await saveEntry(t.adminA.id, t.bizA.id, { key: "public_phone", value: "+233 24 123 4567" });
    await approveEntry(t.ownerA.id, t.bizA.id, entry.id);
    await saveEntry(t.ownerA.id, t.bizA.id, { key: "answer_routine_enquiries", value: "enabled" });
    await createFaq(t.adminA.id, t.bizA.id, { question: "Secret question text?", answer: "Secret answer text" });
    await makeActivatable(t);
    await changeProfileStatus(t.ownerA.id, t.bizA.id, "ACTIVE");

    const events = await prisma.auditEvent.findMany({ where: { businessId: t.bizA.id, action: { startsWith: "profile." } } });
    const actions = events.map((e) => e.action);
    for (const a of ["profile.created", "profile.entry.saved", "profile.entry.approved", "profile.faq.created", "profile.status_changed"]) expect(actions).toContain(a);
    expect(events.find((e) => e.action === "profile.entry.saved" && (e.metadata as { key?: string })?.key === "public_phone")).toMatchObject({ actorUserId: t.adminA.id });
    expect(events.find((e) => e.action === "profile.status_changed")?.metadata).toEqual({ from: "DRAFT", to: "ACTIVE" });
    expect(events.find((e) => (e.metadata as { key?: string })?.key === "answer_routine_enquiries")?.metadata).toMatchObject({ enabled: true });
    const blob = JSON.stringify(events);
    for (const secret of ["233 24 123", "Secret question", "Secret answer", "Phone retailer"]) expect(blob).not.toContain(secret);

    const approved = await row(t, "public_phone");
    expect(approved).toMatchObject({ createdById: t.adminA.id, approvedById: t.ownerA.id });
    expect(approved.approvedAt).not.toBeNull();
    expect((await profile(t)).revision).toBeGreaterThan(5);
  });
});

describe("database constraints back the rules", () => {
  it("reject inconsistent approval, suspension and activation states, bad keys and duplicates", async () => {
    const t = await start();
    const p = await profile(t);
    const base = { profileId: p.id, module: "POLICY" as const, createdById: t.ownerA.id, updatedById: t.ownerA.id };
    const when = { approvedAt: new Date(), approvedById: t.ownerA.id };
    await expect(prisma.profileEntry.create({ data: { ...base, key: "delivery", value: "a", state: "APPROVED", approvedValue: "b", ...when } })).rejects.toThrow();
    await expect(prisma.profileEntry.create({ data: { ...base, key: "delivery", value: "a", state: "APPROVED" } })).rejects.toThrow();
    await expect(prisma.profileEntry.create({ data: { ...base, key: "delivery", value: "a", approvedValue: "a" } })).rejects.toThrow(); // approvedValue without approvedAt
    await expect(prisma.profileEntry.create({ data: { ...base, key: "Bad Key", value: "a" } })).rejects.toThrow();
    await prisma.profileEntry.create({ data: { ...base, key: "delivery", value: "a" } });
    await expect(prisma.profileEntry.create({ data: { ...base, key: "delivery", value: "again" } })).rejects.toThrow(); // unique

    await expect(prisma.businessProfile.update({ where: { id: p.id }, data: { status: "SUSPENDED" } })).rejects.toThrow();
    await expect(prisma.businessProfile.update({ where: { id: p.id }, data: { status: "ACTIVE" } })).rejects.toThrow();
    await expect(
      prisma.faqEntry.create({
        data: { profileId: p.id, question: "Valid question?", answer: "a", normalizedQuestion: "valid question", createdById: t.ownerA.id, updatedById: t.ownerA.id, state: "APPROVED" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.faqEntry.create({
        data: { profileId: p.id, question: "no", answer: "a", normalizedQuestion: "no", createdById: t.ownerA.id, updatedById: t.ownerA.id },
      }),
    ).rejects.toThrow();
  });
  it("deleting a business removes its profile data (cascade) and nothing else", async () => {
    const t = await start();
    await createProfile(t.ownerB.id, t.bizB.id);
    await saveEntry(t.ownerA.id, t.bizA.id, { key: "delivery", value: "x y z" });
    await createFaq(t.ownerA.id, t.bizA.id, { question: "Some question?", answer: "Some answer" });
    await prisma.business.delete({ where: { id: t.bizA.id } });
    expect(await prisma.businessProfile.count()).toBe(1);
    expect(await prisma.profileEntry.count()).toBe(0);
    expect(await prisma.faqEntry.count()).toBe(0);
  });
});
