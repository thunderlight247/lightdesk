import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../helpers/cookie-mock")).nextHeadersMock);

import { createSession, destroyCurrentSession, getCurrentUser, sessionCookieName } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { ConflictError, ValidationError } from "@/lib/security/errors";
import { hashToken } from "@/lib/security/tokens";
import { bootstrapPlatformAdmin } from "@/modules/identity/bootstrap";
import { authenticate } from "@/modules/identity/service";
import { cookieStore } from "../helpers/cookie-mock";
import { makeUser, resetDb, TEST_PASSWORD } from "../helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("authenticate", () => {
  it("accepts valid credentials (email case-insensitive)", async () => {
    const u = await makeUser("a@test.example");
    expect((await authenticate("A@Test.example", TEST_PASSWORD))?.id).toBe(u.id);
  });
  it("rejects wrong password, unknown user and disabled user", async () => {
    await makeUser("a@test.example");
    await makeUser("off@test.example", { status: "DISABLED" });
    expect(await authenticate("a@test.example", "wrong-password-123")).toBeNull();
    expect(await authenticate("nobody@test.example", TEST_PASSWORD)).toBeNull();
    expect(await authenticate("off@test.example", TEST_PASSWORD)).toBeNull();
  });
});

describe("sessions", () => {
  it("stores only a hash of the session token and resolves the user", async () => {
    const u = await makeUser("a@test.example");
    await createSession(u.id);
    const raw = cookieStore.get(sessionCookieName())!;
    const row = await prisma.session.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashToken(raw));
    expect(row.tokenHash).not.toBe(raw);
    expect((await getCurrentUser())?.id).toBe(u.id);
  });
  it("issues a fresh session id on every login", async () => {
    const u = await makeUser("a@test.example");
    await createSession(u.id);
    const first = cookieStore.get(sessionCookieName());
    await createSession(u.id);
    expect(cookieStore.get(sessionCookieName())).not.toBe(first);
  });
  it("rejects expired sessions, disabled users, malformed and missing cookies", async () => {
    const u = await makeUser("a@test.example");
    await createSession(u.id);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentUser()).toBeNull();

    await prisma.session.deleteMany();
    await createSession(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    expect(await getCurrentUser()).toBeNull();

    cookieStore.set(sessionCookieName(), "not-a-token");
    expect(await getCurrentUser()).toBeNull();
    cookieStore.clear();
    expect(await getCurrentUser()).toBeNull();
  });
  it("logout invalidates the session server-side (a replayed cookie fails)", async () => {
    const u = await makeUser("a@test.example");
    await createSession(u.id);
    const raw = cookieStore.get(sessionCookieName())!;
    await destroyCurrentSession();
    cookieStore.set(sessionCookieName(), raw);
    expect(await getCurrentUser()).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });
});

describe("bootstrap of the first administrator", () => {
  const input = { email: "Admin@Test.example", name: "Root", password: "a-strong-bootstrap-pass" };

  it("creates a hashed platform admin and audits it without secrets", async () => {
    const admin = await bootstrapPlatformAdmin(input);
    expect(admin.isPlatformAdmin).toBe(true);
    expect(admin.email).toBe("admin@test.example");
    expect(admin.passwordHash).not.toContain(input.password);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "platform.admin_bootstrapped" } });
    expect(JSON.stringify(audit)).not.toContain(input.password);
  });
  it("refuses a second bootstrap", async () => {
    await bootstrapPlatformAdmin(input);
    await expect(bootstrapPlatformAdmin({ ...input, email: "other@test.example" })).rejects.toBeInstanceOf(ConflictError);
  });
  it("is safe under concurrent invocation: exactly one wins", async () => {
    const results = await Promise.allSettled([
      bootstrapPlatformAdmin(input),
      bootstrapPlatformAdmin({ ...input, email: "second@test.example" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { isPlatformAdmin: true } })).toBe(1);
  });
  it("rejects weak passwords", async () => {
    await expect(bootstrapPlatformAdmin({ ...input, password: "short" })).rejects.toBeInstanceOf(ValidationError);
  });
});
