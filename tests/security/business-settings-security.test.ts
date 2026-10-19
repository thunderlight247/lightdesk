import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { GET, PATCH } from "@/app/api/businesses/[businessId]/route";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/security/errors";
import { getBusinessOverview, updateBusiness } from "@/modules/businesses/service";
import { loginAs, logout, makeUser, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("settings: tenant isolation (service layer)", () => {
  it("a member of business A cannot read or modify business B", async () => {
    const { ownerA, bizB } = await twoTenants();
    await expect(updateBusiness(ownerA.id, bizB.id, { name: "Stolen", description: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBusinessOverview(ownerA.id, bizB.id)).rejects.toBeInstanceOf(NotFoundError);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: bizB.id } });
    expect(after).toMatchObject({ name: "Biz B", description: null });
    expect(await prisma.auditEvent.count({ where: { action: "business.updated" } })).toBe(0);
  });
  it("platform admins and disabled users cannot update businesses they do not belong to / lost access to", async () => {
    const { ownerA, bizA } = await twoTenants();
    const root = await makeUser("root@test.example", { isPlatformAdmin: true });
    await expect(updateBusiness(root.id, bizA.id, { description: "admin override" })).rejects.toBeInstanceOf(NotFoundError);
    await prisma.user.update({ where: { id: ownerA.id }, data: { status: "DISABLED" } });
    await expect(updateBusiness(ownerA.id, bizA.id, { description: "disabled" })).rejects.toBeInstanceOf(NotFoundError);
  });
  it("suspended businesses cannot be edited", async () => {
    const { ownerA, bizA } = await twoTenants();
    await prisma.business.update({ where: { id: bizA.id }, data: { status: "SUSPENDED" } });
    await expect(updateBusiness(ownerA.id, bizA.id, { description: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

const ctx = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const patch = (id: string, body: unknown, origin: string | null = "http://localhost:3000") =>
  PATCH(
    new Request(`http://localhost:3000/api/businesses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

describe("PATCH /api/businesses/[id]", () => {
  it("401 without a session; 403 for cross-origin or missing Origin", async () => {
    const { ownerA, bizA } = await twoTenants();
    logout();
    expect((await patch(bizA.id, { description: "x" })).status).toBe(401);
    await loginAs(ownerA.id);
    expect((await patch(bizA.id, { description: "x" }, "https://evil.example")).status).toBe(403);
    expect((await patch(bizA.id, { description: "x" }, null)).status).toBe(403);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: bizA.id } })).description).toBeNull();
  });
  it("404 for another tenant's business; nothing leaks or changes", async () => {
    const { ownerA, bizB } = await twoTenants();
    await loginAs(ownerA.id);
    const res = await patch(bizB.id, { name: "Stolen" });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("Biz B");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: bizB.id } })).name).toBe("Biz B");
  });
  it("403 for a member; 403 for an admin renaming; 200 for an admin editing location", async () => {
    const { memberA, adminA, bizA } = await twoTenants();
    await loginAs(memberA.id);
    expect((await patch(bizA.id, { description: "x" })).status).toBe(403);
    await loginAs(adminA.id);
    expect((await patch(bizA.id, { name: "Renamed" })).status).toBe(403);
    const ok = await patch(bizA.id, { location: "Takoradi" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ business: { location: "Takoradi", name: "Biz A" }, changed: ["location"] });
  });
  it("200 for an owner renaming; GET then reflects it", async () => {
    const { ownerA, bizA } = await twoTenants();
    await loginAs(ownerA.id);
    const res = await patch(bizA.id, { name: "Biz A Renamed", description: "Hi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: ["name", "description"] });
    const got = await GET(new Request("http://localhost:3000/x"), ctx(bizA.id));
    expect(await got.json()).toMatchObject({ business: { name: "Biz A Renamed", description: "Hi", slug: "biz-a" }, role: "OWNER" });
  });
  it("400 for bad JSON, unknown/immutable fields and invalid values — nothing changes", async () => {
    const { ownerA, bizA } = await twoTenants();
    await loginAs(ownerA.id);
    expect((await patch(bizA.id, "{not json")).status).toBe(400);
    expect((await patch(bizA.id, { slug: "taken-over" })).status).toBe(400);
    expect((await patch(bizA.id, { status: "SUSPENDED" })).status).toBe(400);
    expect((await patch(bizA.id, { id: "other" })).status).toBe(400);
    expect((await patch(bizA.id, { name: "x" })).status).toBe(400);
    expect((await patch("../../etc", { name: "Valid Name" })).status).toBe(400);
    expect(await prisma.business.findUniqueOrThrow({ where: { id: bizA.id } })).toMatchObject({ slug: "biz-a", status: "ACTIVE", name: "Biz A" });
  });
});
