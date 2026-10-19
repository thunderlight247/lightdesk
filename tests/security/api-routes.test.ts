import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { GET as getBusiness } from "@/app/api/businesses/[businessId]/route";
import { POST as postInvitation } from "@/app/api/businesses/[businessId]/invitations/route";
import { prisma } from "@/lib/db/client";
import { loginAs, logout, resetDb, twoTenants } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const ctx = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const get = (id: string) => getBusiness(new Request(`http://localhost:3000/api/businesses/${id}`), ctx(id));
const post = (id: string, body: unknown, origin: string | null = "http://localhost:3000") =>
  postInvitation(
    new Request(`http://localhost:3000/api/businesses/${id}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

describe("GET /api/businesses/[id]", () => {
  it("401 without a session", async () => {
    const { bizA } = await twoTenants();
    logout();
    expect((await get(bizA.id)).status).toBe(401);
  });
  it("200 for a member of that business", async () => {
    const { ownerA, bizA } = await twoTenants();
    await loginAs(ownerA.id);
    const res = await get(bizA.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ business: { id: bizA.id }, role: "OWNER" });
  });
  it("404 when a user from business A requests business B (and leaks nothing)", async () => {
    const { ownerA, bizB } = await twoTenants();
    await loginAs(ownerA.id);
    const res = await get(bizB.id);
    expect(res.status).toBe(404);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("Biz B");
    expect(text).not.toContain(bizB.id);
  });
  it("400 for a malformed id", async () => {
    const { ownerA } = await twoTenants();
    await loginAs(ownerA.id);
    expect((await get("../../etc")).status).toBe(400);
  });
});

describe("POST /api/businesses/[id]/invitations", () => {
  it("201 for an owner; returns a one-time link, never a hash", async () => {
    const { ownerA, bizA } = await twoTenants();
    await loginAs(ownerA.id);
    const res = await post(bizA.id, { email: "n@test.example", role: "MEMBER" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.inviteLink).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(json)).not.toMatch(/tokenHash/);
  });
  it("401 without a session, 403 cross-origin or missing Origin, 400 on bad JSON/body", async () => {
    const { ownerA, bizA } = await twoTenants();
    logout();
    expect((await post(bizA.id, { email: "n@test.example", role: "MEMBER" })).status).toBe(401);
    await loginAs(ownerA.id);
    expect((await post(bizA.id, { email: "n@test.example", role: "MEMBER" }, "https://evil.example")).status).toBe(403);
    expect((await post(bizA.id, { email: "n@test.example", role: "MEMBER" }, null)).status).toBe(403);
    expect((await post(bizA.id, "{not json")).status).toBe(400);
    expect((await post(bizA.id, { email: "bad", role: "MEMBER" })).status).toBe(400);
    expect(await prisma.invitation.count()).toBe(0);
  });
  it("404 when targeting another business; 403 for a plain member", async () => {
    const { ownerA, memberA, bizA, bizB } = await twoTenants();
    await loginAs(ownerA.id);
    expect((await post(bizB.id, { email: "n@test.example", role: "MEMBER" })).status).toBe(404);
    await loginAs(memberA.id);
    expect((await post(bizA.id, { email: "n@test.example", role: "MEMBER" })).status).toBe(403);
    expect(await prisma.invitation.count()).toBe(0);
  });
});
