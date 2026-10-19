import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/security/errors";
import {
  approveAllPending, approveEntry, approveFaq, changeProfileStatus, clearEntry, createFaq, createProfile, deleteFaq,
  discardEntryChange, discardFaqChange, getProfileView, saveEntry, setFaqActive, updateFaq,
} from "@/modules/business-profile/service";
import { makeUser, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

/** Two tenants, each with a profile that has one entry and one FAQ. */
async function world() {
  const t = await twoTenants();
  await createProfile(t.ownerA.id, t.bizA.id);
  await createProfile(t.ownerB.id, t.bizB.id);
  const a = {
    entry: (await saveEntry(t.ownerA.id, t.bizA.id, { key: "delivery", value: "A delivers locally" })).entry,
    faq: await createFaq(t.ownerA.id, t.bizA.id, { question: "A's question?", answer: "A's answer" }),
  };
  const b = {
    entry: (await saveEntry(t.ownerB.id, t.bizB.id, { key: "delivery", value: "B delivers nationwide" })).entry,
    faq: await createFaq(t.ownerB.id, t.bizB.id, { question: "B's question?", answer: "B's answer" }),
  };
  return { ...t, a, b };
}
const bSnapshot = (bizId: string) =>
  Promise.all([
    prisma.profileEntry.findMany({ where: { profile: { businessId: bizId } }, orderBy: { id: "asc" } }),
    prisma.faqEntry.findMany({ where: { profile: { businessId: bizId } }, orderBy: { id: "asc" } }),
    prisma.businessProfile.findUniqueOrThrow({ where: { businessId: bizId } }),
  ]);
const notFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);
const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);

describe("cross-business isolation of the profile", () => {
  it("an owner of business A cannot read or change anything in business B's profile", async () => {
    const w = await world();
    const before = await bSnapshot(w.bizB.id);
    await notFound(getProfileView(w.ownerA.id, w.bizB.id));
    await notFound(createProfile(w.ownerA.id, w.bizB.id));
    await notFound(saveEntry(w.ownerA.id, w.bizB.id, { key: "returns", value: "stolen" }));
    await notFound(createFaq(w.ownerA.id, w.bizB.id, { question: "Injected question?", answer: "x" }));
    await notFound(changeProfileStatus(w.ownerA.id, w.bizB.id, "REVIEW_REQUIRED"));
    await notFound(approveAllPending(w.ownerA.id, w.bizB.id));
    expect(await bSnapshot(w.bizB.id)).toEqual(before);
  });
  it("ids from another business cannot be used through your own business (IDOR)", async () => {
    const w = await world();
    const before = await bSnapshot(w.bizB.id);
    // ownerA is fully authorised for bizA — but supplies bizB's row ids
    await notFound(approveEntry(w.ownerA.id, w.bizA.id, w.b.entry.id));
    await notFound(clearEntry(w.ownerA.id, w.bizA.id, w.b.entry.id));
    await notFound(discardEntryChange(w.ownerA.id, w.bizA.id, w.b.entry.id));
    await notFound(approveFaq(w.ownerA.id, w.bizA.id, w.b.faq.id));
    await notFound(updateFaq(w.ownerA.id, w.bizA.id, w.b.faq.id, { answer: "tampered" }));
    await notFound(setFaqActive(w.ownerA.id, w.bizA.id, w.b.faq.id, false));
    await notFound(deleteFaq(w.ownerA.id, w.bizA.id, w.b.faq.id));
    await notFound(discardFaqChange(w.ownerA.id, w.bizA.id, w.b.faq.id));
    expect(await bSnapshot(w.bizB.id)).toEqual(before);
  });
  it("the view only ever contains the caller's own business data", async () => {
    const w = await world();
    const view = await getProfileView(w.ownerA.id, w.bizA.id);
    if (!view.exists) throw new Error("expected a profile");
    const blob = JSON.stringify(view);
    expect(blob).not.toContain("B delivers");
    expect(blob).not.toContain("B's question");
    expect(view.entries).toHaveLength(1);
    expect(view.faqs).toHaveLength(1);
  });
  it("non-members, platform admins, disabled users and unknown businesses all get the same not-found", async () => {
    const w = await world();
    const stranger = await makeUser("stranger@test.example");
    const root = await makeUser("root@test.example", { isPlatformAdmin: true });
    const messages = new Set<string>();
    for (const [uid, bid] of [[stranger.id, w.bizA.id], [root.id, w.bizA.id], [w.ownerA.id, w.bizB.id], [w.ownerA.id, "doesnotexist00000"]]) {
      const err = await getProfileView(uid, bid).catch((e: Error) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      messages.add((err as Error).message);
    }
    expect(messages.size).toBe(1);
    await prisma.user.update({ where: { id: w.ownerA.id }, data: { status: "DISABLED" } });
    await notFound(getProfileView(w.ownerA.id, w.bizA.id));
    await notFound(saveEntry(w.ownerA.id, w.bizA.id, { key: "returns", value: "x y z" }));
  });
  it("a suspended business's profile cannot be reached or edited", async () => {
    const w = await world();
    await prisma.business.update({ where: { id: w.bizA.id }, data: { status: "SUSPENDED" } });
    await notFound(getProfileView(w.ownerA.id, w.bizA.id));
    await notFound(saveEntry(w.ownerA.id, w.bizA.id, { key: "returns", value: "x y z" }));
  });
});

describe("role boundaries inside a business", () => {
  it("members can read but never mutate", async () => {
    const w = await world();
    const view = await getProfileView(w.memberA.id, w.bizA.id);
    expect(view).toMatchObject({ exists: true, caps: { canEdit: false, canApprove: false } });
    const before = await bSnapshot(w.bizA.id);
    await forbidden(saveEntry(w.memberA.id, w.bizA.id, { key: "returns", value: "x y z" }));
    await forbidden(saveEntry(w.memberA.id, w.bizA.id, { key: "tone", value: "warm" }));
    await forbidden(createFaq(w.memberA.id, w.bizA.id, { question: "Member question?", answer: "x" }));
    await forbidden(updateFaq(w.memberA.id, w.bizA.id, w.a.faq.id, { answer: "x" }));
    await forbidden(setFaqActive(w.memberA.id, w.bizA.id, w.a.faq.id, false));
    await forbidden(deleteFaq(w.memberA.id, w.bizA.id, w.a.faq.id));
    await forbidden(clearEntry(w.memberA.id, w.bizA.id, w.a.entry.id));
    await forbidden(discardEntryChange(w.memberA.id, w.bizA.id, w.a.entry.id));
    await forbidden(approveEntry(w.memberA.id, w.bizA.id, w.a.entry.id));
    await forbidden(approveFaq(w.memberA.id, w.bizA.id, w.a.faq.id));
    await forbidden(approveAllPending(w.memberA.id, w.bizA.id));
    await forbidden(changeProfileStatus(w.memberA.id, w.bizA.id, "REVIEW_REQUIRED"));
    await forbidden(changeProfileStatus(w.memberA.id, w.bizA.id, "ACTIVE"));
    expect(await bSnapshot(w.bizA.id)).toEqual(before);
  });
  it("admins can prepare drafts but cannot approve, activate, suspend or touch AI permissions", async () => {
    const w = await world();
    await forbidden(approveEntry(w.adminA.id, w.bizA.id, w.a.entry.id));
    await forbidden(approveFaq(w.adminA.id, w.bizA.id, w.a.faq.id));
    await forbidden(approveAllPending(w.adminA.id, w.bizA.id));
    await forbidden(changeProfileStatus(w.adminA.id, w.bizA.id, "ACTIVE"));
    await forbidden(saveEntry(w.adminA.id, w.bizA.id, { key: "send_messages_automatically", value: "disabled" }));
    await forbidden(saveEntry(w.adminA.id, w.bizA.id, { key: "answer_routine_enquiries", value: "enabled" }));
    expect((await prisma.profileEntry.findUniqueOrThrow({ where: { id: w.a.entry.id } })).state).toBe("DRAFT");
    // ...but drafting is allowed
    await expect(saveEntry(w.adminA.id, w.bizA.id, { key: "returns", value: "Returns in 7 days" })).resolves.toMatchObject({ outcome: "draft" });
    await expect(createFaq(w.adminA.id, w.bizA.id, { question: "Admin question?", answer: "Drafted by admin" })).resolves.toMatchObject({ state: "DRAFT" });
  });
  it("an admin cannot suspend an active profile", async () => {
    const w = await world();
    for (const [key, value] of [["business_category", "Retail"], ["offerings_summary", "Things"], ["escalation", "Call the owner"]]) {
      const { entry } = await saveEntry(w.ownerA.id, w.bizA.id, { key, value });
      await approveEntry(w.ownerA.id, w.bizA.id, entry.id);
    }
    await changeProfileStatus(w.ownerA.id, w.bizA.id, "ACTIVE");
    await forbidden(changeProfileStatus(w.adminA.id, w.bizA.id, "SUSPENDED", { reason: "no" }));
    expect((await prisma.businessProfile.findUniqueOrThrow({ where: { businessId: w.bizA.id } })).status).toBe("ACTIVE");
  });
});

describe("hostile input", () => {
  it("rejects malformed statuses, keys, ids and payloads without side effects", async () => {
    const w = await world();
    const before = await bSnapshot(w.bizA.id);
    await expect(changeProfileStatus(w.ownerA.id, w.bizA.id, { toString: () => "ACTIVE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(changeProfileStatus(w.ownerA.id, w.bizA.id, undefined)).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(w.ownerA.id, w.bizA.id, { key: { $ne: "x" }, value: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(w.ownerA.id, w.bizA.id, { key: "__proto__", value: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveEntry(w.ownerA.id, w.bizA.id, { key: "delivery", value: { text: "x" } })).rejects.toBeInstanceOf(ValidationError);
    await notFound(approveEntry(w.ownerA.id, w.bizA.id, "not-a-real-id"));
    await notFound(approveFaq(w.ownerA.id, w.bizA.id, ""));
    expect(await bSnapshot(w.bizA.id)).toEqual(before);
  });
});
