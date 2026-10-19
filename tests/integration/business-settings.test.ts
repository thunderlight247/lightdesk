import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { prisma } from "@/lib/db/client";
import { ForbiddenError, ValidationError } from "@/lib/security/errors";
import { getBusinessOverview, listBusinessesForUser, updateBusiness } from "@/modules/businesses/service";
import { resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const business = (id: string) => prisma.business.findUniqueOrThrow({ where: { id } });
const auditCount = () => prisma.auditEvent.count({ where: { action: "business.updated" } });

describe("updateBusiness — permissions", () => {
  it("owner can change name, description and location", async () => {
    const { ownerA, bizA } = await twoTenants();
    const res = await updateBusiness(ownerA.id, bizA.id, { name: "Biz A Ltd", description: "Sells phones", location: "Kumasi" });
    expect(res.changed).toEqual(["name", "description", "location"]);
    expect(await business(bizA.id)).toMatchObject({ name: "Biz A Ltd", description: "Sells phones", location: "Kumasi", slug: "biz-a", status: "ACTIVE" });
  });
  it("admin can change description/location but NOT the name (nothing is written on refusal)", async () => {
    const { adminA, bizA } = await twoTenants();
    await updateBusiness(adminA.id, bizA.id, { location: "Accra" });
    expect((await business(bizA.id)).location).toBe("Accra");

    await expect(updateBusiness(adminA.id, bizA.id, { name: "Hijacked", description: "should not land" })).rejects.toBeInstanceOf(ForbiddenError);
    const after = await business(bizA.id);
    expect(after.name).toBe("Biz A");
    expect(after.description).toBeNull();
  });
  it("admin may resubmit the unchanged name", async () => {
    const { adminA, bizA } = await twoTenants();
    const res = await updateBusiness(adminA.id, bizA.id, { name: "Biz A", location: "Tema" });
    expect(res.changed).toEqual(["location"]);
  });
  it("member cannot update anything; no audit event", async () => {
    const { memberA, bizA } = await twoTenants();
    await expect(updateBusiness(memberA.id, bizA.id, { description: "nope" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await business(bizA.id)).description).toBeNull();
    expect(await auditCount()).toBe(0);
  });
});

describe("updateBusiness — validation and behaviour", () => {
  it("empty strings clear description and location", async () => {
    const { ownerA, bizA } = await twoTenants();
    await updateBusiness(ownerA.id, bizA.id, { description: "d", location: "l" });
    await updateBusiness(ownerA.id, bizA.id, { description: "", location: "  " });
    expect(await business(bizA.id)).toMatchObject({ description: null, location: null });
  });
  it("rejects invalid input and unknown fields without changing anything", async () => {
    const { ownerA, bizA } = await twoTenants();
    for (const bad of [{ name: "x" }, { description: "y".repeat(501) }, { slug: "stolen" }, { status: "SUSPENDED" }, {}, "not-an-object"]) {
      await expect(updateBusiness(ownerA.id, bizA.id, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await business(bizA.id)).toMatchObject({ name: "Biz A", slug: "biz-a", status: "ACTIVE", description: null });
    expect(await auditCount()).toBe(0);
  });
  it("audits which fields changed — never their values — and skips no-op updates", async () => {
    const { ownerA, bizA } = await twoTenants();
    await updateBusiness(ownerA.id, bizA.id, { description: "Very private description text" });
    const events = await prisma.auditEvent.findMany({ where: { action: "business.updated" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: ownerA.id, businessId: bizA.id, targetType: "Business", targetId: bizA.id });
    expect(events[0].metadata).toEqual({ fields: "description" });
    expect(JSON.stringify(events[0])).not.toContain("private description");

    const noop = await updateBusiness(ownerA.id, bizA.id, { description: "Very private description text" });
    expect(noop.changed).toEqual([]);
    expect(await auditCount()).toBe(1);
  });
  it("bumps updatedAt only when something changed", async () => {
    const { ownerA, bizA } = await twoTenants();
    const before = (await business(bizA.id)).updatedAt;
    await updateBusiness(ownerA.id, bizA.id, { description: "same" });
    const mid = (await business(bizA.id)).updatedAt;
    await updateBusiness(ownerA.id, bizA.id, { description: "same" });
    expect(mid.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect((await business(bizA.id)).updatedAt.getTime()).toBe(mid.getTime());
  });
  it("database rejects over-long description/location even if the service were bypassed", async () => {
    const { bizA } = await twoTenants();
    await expect(prisma.business.update({ where: { id: bizA.id }, data: { description: "x".repeat(501) } })).rejects.toThrow();
    await expect(prisma.business.update({ where: { id: bizA.id }, data: { location: "x".repeat(121) } })).rejects.toThrow();
  });
});

describe("getBusinessOverview / listBusinessesForUser", () => {
  it("returns role, capabilities and member count per role", async () => {
    const { ownerA, adminA, memberA, bizA } = await twoTenants();
    const owner = await getBusinessOverview(ownerA.id, bizA.id);
    expect(owner.role).toBe("OWNER");
    expect(owner.memberCount).toBe(3);
    expect(owner.capabilities).toEqual({ canUpdate: true, canRename: true, canManageInvitations: true });
    expect((await getBusinessOverview(adminA.id, bizA.id)).capabilities).toEqual({ canUpdate: true, canRename: false, canManageInvitations: true });
    expect((await getBusinessOverview(memberA.id, bizA.id)).capabilities).toEqual({ canUpdate: false, canRename: false, canManageInvitations: false });
  });
  it("overview exposes only the supported business fields", async () => {
    const { ownerA, bizA } = await twoTenants();
    const { business: b } = await getBusinessOverview(ownerA.id, bizA.id);
    expect(Object.keys(b).sort()).toEqual(["createdAt", "description", "id", "location", "name", "slug", "status", "updatedAt"]);
  });
  it("lists the user's businesses with role and location", async () => {
    const { ownerA, bizA } = await twoTenants();
    await updateBusiness(ownerA.id, bizA.id, { location: "Kumasi" });
    expect(await listBusinessesForUser(ownerA.id)).toEqual([{ id: bizA.id, name: "Biz A", slug: "biz-a", location: "Kumasi", role: "OWNER" }]);
  });
});
