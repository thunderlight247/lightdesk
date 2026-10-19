import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { prisma } from "@/lib/db/client";
import { ConflictError, ForbiddenError, InvalidInvitationError, NotFoundError } from "@/lib/security/errors";
import { hashToken } from "@/lib/security/tokens";
import {
  acceptInvitation,
  createInvitation,
  listPendingInvitations,
  previewInvitation,
  revokeInvitation,
} from "@/modules/businesses/invitations";
import { addMember, makeUser, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const reg = { name: "New Person", password: "a-decent-passphrase-1" };

async function invite(email = "new@test.example", role: "MEMBER" | "ADMIN" | "OWNER" = "MEMBER") {
  const t = await twoTenants();
  const inv = await createInvitation(t.ownerA.id, t.bizA.id, { email, role });
  return { ...t, inv };
}

async function rejectionReason(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof InvalidInvitationError) return e.reason;
    throw e;
  }
  throw new Error("expected InvalidInvitationError");
}

describe("invitation creation and token handling", () => {
  it("stores only the token hash; link token is not recoverable from the DB", async () => {
    const { inv } = await invite();
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.tokenHash).toBe(hashToken(inv.token));
    expect(JSON.stringify(row)).not.toContain(inv.token);
    const audit = await prisma.auditEvent.findMany();
    expect(JSON.stringify(audit)).not.toContain(inv.token);
    const listed = await listPendingInvitations((await prisma.user.findFirstOrThrow({ where: { email: "owner-a@test.example" } })).id, row.businessId);
    expect(JSON.stringify(listed)).not.toContain(row.tokenHash);
  });
  it("sets an expiry in the future", async () => {
    const { inv } = await invite();
    expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("re-inviting the same email revokes the earlier token", async () => {
    const { ownerA, bizA, inv } = await invite();
    const second = await createInvitation(ownerA.id, bizA.id, { email: "new@test.example", role: "MEMBER" });
    expect(await rejectionReason(acceptInvitation({ token: inv.token, actorUserId: null, registration: reg }))).toBe("revoked");
    expect((await acceptInvitation({ token: second.token, actorUserId: null, registration: reg })).createdUser).toBe(true);
  });
  it("refuses to invite someone who is already a member", async () => {
    const { ownerA, bizA } = await twoTenants();
    await expect(createInvitation(ownerA.id, bizA.id, { email: "member-a@test.example", role: "MEMBER" })).rejects.toBeInstanceOf(ConflictError);
  });
  it("blocks privilege escalation and unprivileged invitation creation", async () => {
    const { adminA, memberA, bizA } = await twoTenants();
    await expect(createInvitation(adminA.id, bizA.id, { email: "x@test.example", role: "OWNER" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation(memberA.id, bizA.id, { email: "x@test.example", role: "MEMBER" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.invitation.count()).toBe(0);
  });
});

describe("acceptance", () => {
  it("registers a new user with the invited email and role", async () => {
    const { inv, bizA } = await invite("new@test.example", "ADMIN");
    const res = await acceptInvitation({ token: inv.token, actorUserId: null, registration: reg });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: res.userId } });
    expect(user.email).toBe("new@test.example");
    expect(user.isPlatformAdmin).toBe(false);
    const m = await prisma.businessMembership.findUniqueOrThrow({ where: { businessId_userId: { businessId: bizA.id, userId: user.id } } });
    expect(m.role).toBe("ADMIN");
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.acceptedAt).not.toBeNull();
    expect(row.acceptedById).toBe(user.id);
  });
  it("lets an existing, authenticated user with the matching email join", async () => {
    const { ownerA, bizB } = await twoTenants();
    const inv = await createInvitation((await prisma.user.findFirstOrThrow({ where: { email: "owner-b@test.example" } })).id, bizB.id, { email: "owner-a@test.example", role: "MEMBER" });
    const res = await acceptInvitation({ token: inv.token, actorUserId: ownerA.id });
    expect(res.createdUser).toBe(false);
    expect(await prisma.businessMembership.count({ where: { businessId: bizB.id, userId: ownerA.id } })).toBe(1);
  });
  it("previews only usable invitations", async () => {
    const { inv } = await invite();
    expect(await previewInvitation(inv.token)).toMatchObject({ email: "new@test.example", role: "MEMBER", accountExists: false });
    expect(await previewInvitation("garbage")).toBeNull();
  });
});

describe("single use, expiry, revocation, wrong account", () => {
  it("rejects reuse and creates no second membership", async () => {
    const { inv, bizA } = await invite();
    await acceptInvitation({ token: inv.token, actorUserId: null, registration: reg });
    expect(await rejectionReason(acceptInvitation({ token: inv.token, actorUserId: null, registration: reg }))).toBe("already_used");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.example" } });
    expect(await prisma.businessMembership.count({ where: { businessId: bizA.id, userId: user.id } })).toBe(1);
    expect(await previewInvitation(inv.token)).toBeNull();
  });
  it("rejects an expired invitation and leaves no user or membership behind", async () => {
    const { inv } = await invite();
    const now = Date.now();
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { createdAt: new Date(now - 7_200_000), expiresAt: new Date(now - 3_600_000) },
    });
    const usersBefore = await prisma.user.count();
    const membershipsBefore = await prisma.businessMembership.count();
    expect(await rejectionReason(acceptInvitation({ token: inv.token, actorUserId: null, registration: reg }))).toBe("expired");
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.businessMembership.count()).toBe(membershipsBefore);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt).toBeNull();
    expect(await previewInvitation(inv.token)).toBeNull();
  });
  it("rejects a revoked invitation", async () => {
    const { ownerA, bizA, inv } = await invite();
    await revokeInvitation(ownerA.id, bizA.id, inv.id);
    expect(await rejectionReason(acceptInvitation({ token: inv.token, actorUserId: null, registration: reg }))).toBe("revoked");
  });
  it("rejects unknown tokens", async () => {
    const bogus = "A".repeat(43);
    expect(await rejectionReason(acceptInvitation({ token: bogus, actorUserId: null, registration: reg }))).toBe("not_found");
  });
  it("rejects a logged-in user whose email does not match; invitation stays usable", async () => {
    const { memberA, inv } = await invite();
    expect(await rejectionReason(acceptInvitation({ token: inv.token, actorUserId: memberA.id }))).toBe("email_mismatch");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt).toBeNull();
  });
  it("won't register over an existing account; invitation stays pending", async () => {
    const t = await twoTenants();
    const inv = await createInvitation(t.ownerA.id, t.bizA.id, { email: "owner-b@test.example", role: "MEMBER" });
    await expect(acceptInvitation({ token: inv.token, actorUserId: null, registration: reg })).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).acceptedAt).toBeNull();
  });
  it("is atomic under concurrent acceptance: exactly one succeeds", async () => {
    const { inv, bizA } = await invite();
    const results = await Promise.allSettled([
      acceptInvitation({ token: inv.token, actorUserId: null, registration: reg }),
      acceptInvitation({ token: inv.token, actorUserId: null, registration: { ...reg, name: "Second" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.businessMembership.count({ where: { businessId: bizA.id, role: "MEMBER", user: { email: "new@test.example" } } })).toBe(1);
    expect(await prisma.user.count({ where: { email: "new@test.example" } })).toBe(1);
  });
});

describe("database constraints", () => {
  it("rejects two pending invitations for the same business+email", async () => {
    const { ownerA, bizA } = await twoTenants();
    const data = { businessId: bizA.id, email: "dup@test.example", role: "MEMBER" as const, invitedById: ownerA.id, expiresAt: new Date(Date.now() + 1e6) };
    await prisma.invitation.create({ data: { ...data, tokenHash: "a".repeat(64) } });
    await expect(prisma.invitation.create({ data: { ...data, tokenHash: "b".repeat(64) } })).rejects.toThrow();
  });
  it("rejects invalid invitation states", async () => {
    const { ownerA, bizA } = await twoTenants();
    const base = { businessId: bizA.id, role: "MEMBER" as const, invitedById: ownerA.id, expiresAt: new Date(Date.now() + 1e6) };
    // accepted without acceptedById
    await expect(prisma.invitation.create({ data: { ...base, email: "1@test.example", tokenHash: "1".repeat(64), acceptedAt: new Date() } })).rejects.toThrow();
    // accepted AND revoked
    await expect(prisma.invitation.create({ data: { ...base, email: "2@test.example", tokenHash: "2".repeat(64), acceptedAt: new Date(), acceptedById: ownerA.id, revokedAt: new Date() } })).rejects.toThrow();
    // expiry before creation
    await expect(prisma.invitation.create({ data: { ...base, email: "3@test.example", tokenHash: "3".repeat(64), expiresAt: new Date(Date.now() - 1e6) } })).rejects.toThrow();
    // non-hash token value (plaintext-looking)
    await expect(prisma.invitation.create({ data: { ...base, email: "4@test.example", tokenHash: "plaintext-token" } })).rejects.toThrow();
    // non-normalised email
    await expect(prisma.invitation.create({ data: { ...base, email: "UPPER@test.example", tokenHash: "5".repeat(64) } })).rejects.toThrow();
  });
  it("rejects duplicate memberships, bad slugs and non-normalised user emails", async () => {
    const { ownerA, bizA } = await twoTenants();
    await expect(addMember(bizA.id, ownerA.id, "MEMBER")).rejects.toThrow();
    await expect(prisma.business.create({ data: { name: "x", slug: "Bad Slug!" } })).rejects.toThrow();
    await expect(makeUser("MixedCase@test.example")).rejects.toThrow();
  });
  it("does not allow revoking an already-accepted invitation via the service", async () => {
    const { ownerA, bizA, inv } = await invite();
    await acceptInvitation({ token: inv.token, actorUserId: null, registration: reg });
    await expect(revokeInvitation(ownerA.id, bizA.id, inv.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
