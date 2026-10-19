import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { prisma } from "@/lib/db/client";
import { ForbiddenError, NotFoundError } from "@/lib/security/errors";
import { createInvitation, listPendingInvitations, revokeInvitation } from "@/modules/businesses/invitations";
import { createBusinessWithOwnerInvitation, listBusinessesForUser, listMembers } from "@/modules/businesses/service";
import { requireMembership, requirePermission } from "@/modules/permissions/access";
import { makeUser, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("cross-business isolation (service layer)", () => {
  it("a member of business A cannot access business B in any way", async () => {
    const { ownerA, bizB } = await twoTenants();
    await expect(requireMembership(ownerA.id, bizB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requirePermission(ownerA.id, bizB.id, "business:read")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMembers(ownerA.id, bizB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPendingInvitations(ownerA.id, bizB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createInvitation(ownerA.id, bizB.id, { email: "x@test.example", role: "MEMBER" })).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.invitation.count()).toBe(0);
  });
  it("lists only the user's own businesses", async () => {
    const { ownerA, ownerB, bizA, bizB } = await twoTenants();
    expect((await listBusinessesForUser(ownerA.id)).map((b) => b.id)).toEqual([bizA.id]);
    expect((await listBusinessesForUser(ownerB.id)).map((b) => b.id)).toEqual([bizB.id]);
  });
  it("cannot revoke another business's invitation by guessing its id (IDOR)", async () => {
    const { ownerA, ownerB, bizA, bizB } = await twoTenants();
    const victim = await createInvitation(ownerB.id, bizB.id, { email: "v@test.example", role: "MEMBER" });
    // A is authorised for bizA, but supplies B's invitation id
    await expect(revokeInvitation(ownerA.id, bizA.id, victim.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: victim.id } })).revokedAt).toBeNull();
  });
  it("unknown business and not-a-member are indistinguishable", async () => {
    const { ownerA, bizB } = await twoTenants();
    const notMember = await requireMembership(ownerA.id, bizB.id).catch((e: Error) => e);
    const unknown = await requireMembership(ownerA.id, "doesnotexist00000").catch((e: Error) => e);
    expect(notMember).toBeInstanceOf(NotFoundError);
    expect((notMember as Error).message).toBe((unknown as Error).message);
  });
  it("a platform admin has NO implicit access to business data", async () => {
    const { bizA } = await twoTenants();
    const admin = await makeUser("root@test.example", { isPlatformAdmin: true });
    await expect(requireMembership(admin.id, bizA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listMembers(admin.id, bizA.id)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("suspended businesses and disabled users lose access", async () => {
    const { ownerA, bizA } = await twoTenants();
    await prisma.business.update({ where: { id: bizA.id }, data: { status: "SUSPENDED" } });
    await expect(requireMembership(ownerA.id, bizA.id)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.business.update({ where: { id: bizA.id }, data: { status: "ACTIVE" } });
    await prisma.user.update({ where: { id: ownerA.id }, data: { status: "DISABLED" } });
    await expect(requireMembership(ownerA.id, bizA.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("role checks (service layer)", () => {
  it("MEMBER can read but not manage invitations; ADMIN can; ADMIN cannot grant OWNER", async () => {
    const { memberA, adminA, bizA } = await twoTenants();
    await expect(requirePermission(memberA.id, bizA.id, "members:read")).resolves.toBeTruthy();
    await expect(requirePermission(memberA.id, bizA.id, "invitations:manage")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requirePermission(adminA.id, bizA.id, "invitations:manage")).resolves.toBeTruthy();
    await expect(createInvitation(adminA.id, bizA.id, { email: "o@test.example", role: "OWNER" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("only platform administrators can create businesses", async () => {
    const { ownerA } = await twoTenants();
    await expect(createBusinessWithOwnerInvitation(ownerA.id, { name: "Sneaky", ownerEmail: "s@test.example" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.business.count({ where: { name: "Sneaky" } })).toBe(0);

    const root = await makeUser("root@test.example", { isPlatformAdmin: true });
    const { business, invitation } = await createBusinessWithOwnerInvitation(root.id, { name: "Shop Éclair", ownerEmail: "Boss@Test.example" });
    expect(business.slug).toBe("shop-eclair");
    expect(invitation.role).toBe("OWNER");
    expect(invitation.email).toBe("boss@test.example");
    expect(await prisma.businessMembership.count({ where: { businessId: business.id } })).toBe(0);
  });
});
