import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import {
  approveDraft, createConversation, deleteConversation, getConversation, getLabReadiness, listConversations, markForFollowUp,
  regenerateDraft, resolveEscalation, submitCustomerMessage,
} from "@/modules/lab/service";
import { buildActiveProfile, groundedAnswer, MockProvider, testConfig } from "../helpers/lab";
import { makeUser, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

let n = 0;
const key = () => `sec-${++n}-${Math.random().toString(36).slice(2, 10)}`;
const provider = () => new MockProvider(groundedAnswer("warranty", "Our new phones come with a 12 month warranty."));

/** Two tenants, each with an active profile, one conversation and one AI draft. */
async function world() {
  const t = await twoTenants();
  await buildActiveProfile(t.ownerA.id, t.bizA.id);
  await buildActiveProfile(t.ownerB.id, t.bizB.id);
  const p = provider();
  const mk = async (owner: string, biz: string) => {
    const conv = await createConversation(owner, biz);
    await submitCustomerMessage(owner, biz, conv.id, { text: "Do you offer a warranty on new phones?", idempotencyKey: key() }, { provider: p, config: testConfig() });
    const draft = (await getConversation(owner, biz, conv.id)).messages.at(-1)!;
    return { convId: conv.id, draftId: draft.id };
  };
  return { ...t, a: await mk(t.ownerA.id, t.bizA.id), b: await mk(t.ownerB.id, t.bizB.id), provider: p };
}
const notFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);
const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);
const snapshotB = async (w: Awaited<ReturnType<typeof world>>) => [
  await prisma.labConversation.findUniqueOrThrow({ where: { id: w.b.convId } }),
  await prisma.labMessage.findMany({ where: { conversationId: w.b.convId }, orderBy: { seq: "asc" } }),
  await prisma.labGeneration.count({ where: { conversationId: w.b.convId } }),
];
const deps = (p: MockProvider) => ({ provider: p, config: testConfig() });

describe("tenant isolation of the conversation lab", () => {
  it("an owner of business A cannot touch business B through B's identifiers", async () => {
    const w = await world();
    const before = await snapshotB(w);
    const calls = w.provider.calls.length;
    const d = deps(w.provider);
    await notFound(getConversation(w.ownerA.id, w.bizB.id, w.b.convId));
    await notFound(listConversations(w.ownerA.id, w.bizB.id));
    await notFound(getLabReadiness(w.ownerA.id, w.bizB.id));
    await notFound(createConversation(w.ownerA.id, w.bizB.id));
    await notFound(submitCustomerMessage(w.ownerA.id, w.bizB.id, w.b.convId, { text: "Hello", idempotencyKey: key() }, d));
    await notFound(regenerateDraft(w.ownerA.id, w.bizB.id, w.b.convId, { idempotencyKey: key() }, d));
    await notFound(approveDraft(w.ownerA.id, w.bizB.id, w.b.convId, w.b.draftId));
    await notFound(markForFollowUp(w.ownerA.id, w.bizB.id, w.b.convId, { reason: "x" }));
    await notFound(resolveEscalation(w.ownerA.id, w.bizB.id, w.b.convId));
    await notFound(deleteConversation(w.ownerA.id, w.bizB.id, w.b.convId));
    expect(w.provider.calls.length).toBe(calls); // no AI request was made on anyone's behalf
    expect(await snapshotB(w)).toEqual(before);
  });
  it("B's conversation and message ids cannot be used through A's own business (IDOR)", async () => {
    const w = await world();
    const before = await snapshotB(w);
    const calls = w.provider.calls.length;
    const d = deps(w.provider);
    await notFound(getConversation(w.ownerA.id, w.bizA.id, w.b.convId));
    await notFound(submitCustomerMessage(w.ownerA.id, w.bizA.id, w.b.convId, { text: "Injected message", idempotencyKey: key() }, d));
    await notFound(regenerateDraft(w.ownerA.id, w.bizA.id, w.b.convId, { idempotencyKey: key() }, d));
    await notFound(approveDraft(w.ownerA.id, w.bizA.id, w.b.convId, w.b.draftId));
    await notFound(approveDraft(w.ownerA.id, w.bizA.id, w.a.convId, w.b.draftId)); // right conversation, other tenant's message id
    await notFound(markForFollowUp(w.ownerA.id, w.bizA.id, w.b.convId, { reason: "x" }));
    await notFound(resolveEscalation(w.ownerA.id, w.bizA.id, w.b.convId));
    await notFound(deleteConversation(w.ownerA.id, w.bizA.id, w.b.convId));
    expect(w.provider.calls.length).toBe(calls);
    expect(await snapshotB(w)).toEqual(before);
  });
  it("lists only the caller's own business's conversations", async () => {
    const w = await world();
    expect((await listConversations(w.ownerA.id, w.bizA.id)).map((c) => c.id)).toEqual([w.a.convId]);
    expect((await listConversations(w.ownerB.id, w.bizB.id)).map((c) => c.id)).toEqual([w.b.convId]);
  });
  it("a conversation view contains only its own business's content", async () => {
    const w = await world();
    const blob = JSON.stringify(await getConversation(w.ownerA.id, w.bizA.id, w.a.convId));
    expect(blob).not.toContain(w.b.convId);
    expect(blob).not.toContain(w.b.draftId);
  });
  it("strangers, platform admins, disabled users and unknown ids all get the same not-found", async () => {
    const w = await world();
    const stranger = await makeUser("stranger@test.example");
    const root = await makeUser("root@test.example", { isPlatformAdmin: true });
    const messages = new Set<string>();
    for (const [uid, bid, cid] of [
      [stranger.id, w.bizA.id, w.a.convId], [root.id, w.bizA.id, w.a.convId], [w.ownerB.id, w.bizA.id, w.a.convId],
      [w.ownerA.id, "doesnotexist00000", w.a.convId],
    ]) {
      const err = await getConversation(uid, bid, cid).catch((e: Error) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      messages.add((err as Error).message);
    }
    expect(messages.size).toBe(1);
    await prisma.user.update({ where: { id: w.ownerA.id }, data: { status: "DISABLED" } });
    await notFound(getConversation(w.ownerA.id, w.bizA.id, w.a.convId));
    await notFound(submitCustomerMessage(w.ownerA.id, w.bizA.id, w.a.convId, { text: "Hello", idempotencyKey: key() }, deps(w.provider)));
  });
  it("a suspended business's lab is unreachable", async () => {
    const w = await world();
    await prisma.business.update({ where: { id: w.bizA.id }, data: { status: "SUSPENDED" } });
    await notFound(getConversation(w.ownerA.id, w.bizA.id, w.a.convId));
    await notFound(createConversation(w.ownerA.id, w.bizA.id));
  });
  it("an unknown conversation id inside one's own business is simply not found", async () => {
    const w = await world();
    for (const id of ["", "nonexistent0000", "../../etc/passwd"]) {
      await notFound(getConversation(w.ownerA.id, w.bizA.id, id));
      await notFound(deleteConversation(w.ownerA.id, w.bizA.id, id));
    }
  });
});

describe("roles in the conversation lab", () => {
  it("members can read but never act", async () => {
    const w = await world();
    expect((await getConversation(w.memberA.id, w.bizA.id, w.a.convId)).messages.length).toBeGreaterThan(0);
    expect((await listConversations(w.memberA.id, w.bizA.id)).length).toBe(1);
    expect(await getLabReadiness(w.memberA.id, w.bizA.id)).toMatchObject({ canUse: false, canApprove: false, canDeleteAny: false });
    const before = await prisma.labMessage.count();
    const calls = w.provider.calls.length;
    const d = deps(w.provider);
    await forbidden(createConversation(w.memberA.id, w.bizA.id));
    await forbidden(submitCustomerMessage(w.memberA.id, w.bizA.id, w.a.convId, { text: "Hello", idempotencyKey: key() }, d));
    await forbidden(regenerateDraft(w.memberA.id, w.bizA.id, w.a.convId, { idempotencyKey: key() }, d));
    await forbidden(approveDraft(w.memberA.id, w.bizA.id, w.a.convId, w.a.draftId));
    await forbidden(markForFollowUp(w.memberA.id, w.bizA.id, w.a.convId, { reason: "x" }));
    await forbidden(resolveEscalation(w.memberA.id, w.bizA.id, w.a.convId));
    await forbidden(deleteConversation(w.memberA.id, w.bizA.id, w.a.convId));
    expect(await prisma.labMessage.count()).toBe(before);
    expect(w.provider.calls.length).toBe(calls);
  });
  it("admins can use the lab but cannot approve, resolve or delete others' conversations", async () => {
    const w = await world();
    const mine = await createConversation(w.adminA.id, w.bizA.id);
    await expect(submitCustomerMessage(w.adminA.id, w.bizA.id, mine.id, { text: "Do you offer a warranty on new phones?", idempotencyKey: key() }, deps(w.provider))).resolves.toMatchObject({ outcome: "drafted" });
    await markForFollowUp(w.adminA.id, w.bizA.id, mine.id, { reason: "Check with owner" });
    const draftId = (await getConversation(w.adminA.id, w.bizA.id, mine.id)).latestDraftId!;
    await forbidden(approveDraft(w.adminA.id, w.bizA.id, mine.id, draftId));
    await forbidden(resolveEscalation(w.adminA.id, w.bizA.id, mine.id));
    await forbidden(deleteConversation(w.adminA.id, w.bizA.id, w.a.convId)); // the owner's conversation
    await deleteConversation(w.adminA.id, w.bizA.id, mine.id); // their own
    expect(await prisma.labConversation.count({ where: { businessId: w.bizA.id } })).toBe(1);
  });
  it("only an owner can approve a draft and resolve an escalation", async () => {
    const w = await world();
    await markForFollowUp(w.ownerA.id, w.bizA.id, w.a.convId, { reason: "Needs a person" });
    await expect(approveDraft(w.ownerA.id, w.bizA.id, w.a.convId, w.a.draftId)).resolves.toMatchObject({ edited: false });
    await expect(resolveEscalation(w.ownerA.id, w.bizA.id, w.a.convId)).resolves.toBeUndefined();
  });
});

describe("hostile requests", () => {
  it("rejects client-chosen providers, models and role/state fields: they are simply not inputs", async () => {
    const w = await world();
    const calls = w.provider.calls.length;
    const hostile = { text: "Do you offer a warranty on new phones?", idempotencyKey: key(), provider: "evil", model: "gemini-ultra-max", role: "OWNER", draftState: "APPROVED" };
    await submitCustomerMessage(w.adminA.id, w.bizA.id, w.a.convId, hostile, deps(w.provider));
    expect(w.provider.calls.length).toBe(calls + 1);
    expect(w.provider.calls.at(-1)!.system).not.toMatch(/evil|ultra/);
    const msgs = (await getConversation(w.adminA.id, w.bizA.id, w.a.convId)).messages;
    expect(msgs.at(-1)).toMatchObject({ draftState: "DRAFT", approvedContent: null }); // not approved by a client flag
    expect((await prisma.labGeneration.findMany({ orderBy: { createdAt: "desc" }, take: 1 }))[0]).toMatchObject({ provider: "mock", model: "mock-model" });
  });
  it("rejects malformed ids and payloads without side effects", async () => {
    const w = await world();
    const before = await prisma.labMessage.count();
    const d = deps(w.provider);
    await notFound(approveDraft(w.ownerA.id, w.bizA.id, w.a.convId, "not-a-real-id"));
    await notFound(approveDraft(w.ownerA.id, w.bizA.id, w.a.convId, ""));
    await expect(approveDraft(w.ownerA.id, w.bizA.id, w.a.convId, w.a.draftId, { editedText: "x".repeat(1300) })).rejects.toThrow();
    await expect(markForFollowUp(w.adminA.id, w.bizA.id, w.a.convId, { reason: { $ne: 1 } })).rejects.toThrow();
    await expect(submitCustomerMessage(w.adminA.id, w.bizA.id, w.a.convId, { text: null, idempotencyKey: key() }, d)).rejects.toThrow();
    expect(await prisma.labMessage.count()).toBe(before);
    expect((await getConversation(w.ownerA.id, w.bizA.id, w.a.convId)).latestDraftId).toBe(w.a.draftId);
  });
});
