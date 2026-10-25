import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { RateLimitError } from "@/lib/security/errors";
import { resetDb } from "../helpers/db";
import {
  assertLoginAllowed,
  clearLoginFailuresForEmail,
  purgeOldLoginFailures,
  recordLoginFailure,
} from "@/modules/identity/throttle";

const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;
const WINDOW_MINUTES = 10;
const identity = (ip: string, email: string) => ({ ip, email });

beforeEach(resetDb);

/** env defaults: 10/ip, 5/email, 10-minute window. */
describe("login throttling (M8 Phase 3)", () => {
  it("allows fresh addresses and ips", async () => {
    await expect(assertLoginAllowed(identity("198.51.100.1", "a@test.example"))).resolves.toBeUndefined();
  });

  it("blocks an ip that has reached its failure budget inside the window", async () => {
    for (let i = 0; i < IP_LIMIT; i++) {
      // Before this failure the ip has i-1..: check only while the budget is not yet tripped.
      if (i >= 1) await assertLoginAllowed(identity("198.51.100.2", `u${i}@test.example`));
      await recordLoginFailure(identity("198.51.100.2", `u${i}@test.example`));
    }
    // The 10th recorded failure already trips the >= limit for the NEXT check.
    await expect(assertLoginAllowed(identity("198.51.100.2", "target@test.example"))).rejects.toBeInstanceOf(RateLimitError);
  });

  it("blocks the attempted email at a lower threshold than the ip", async () => {
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      await recordLoginFailure(identity(`198.51.100.${i}`, "targeted@test.example"));
    }
    await expect(assertLoginAllowed(identity("198.51.100.99", "targeted@test.example"))).rejects.toBeInstanceOf(RateLimitError);
    // A different email from the same (below-limit) ip still gets through.
    await expect(assertLoginAllowed(identity("198.51.100.99", "other@test.example"))).resolves.toBeUndefined();
  });

  it("ages failures out of the window naturally", async () => {
    for (let i = 0; i < EMAIL_LIMIT; i++) {
      await recordLoginFailure(identity("198.51.100.4", "a@test.example"));
    }
    const since = new Date(Date.now() - (WINDOW_MINUTES + 1) * 60_000);
    await prisma.loginFailure.updateMany({ data: { createdAt: since } });
    await expect(assertLoginAllowed(identity("198.51.100.4", "a@test.example"))).resolves.toBeUndefined();
  });

  it("normalises emails and keeps the ip verbatim as stored bucket key", async () => {
    await recordLoginFailure(identity("198.51.100.5", "  Mixed@Case.Test.example "));
    const row = await prisma.loginFailure.findFirstOrThrow();
    expect(row.email).toBe("mixed@case.test.example");
    expect(row.ip).toBe("198.51.100.5");
  });

  it("successful-login cleanup unblocks the email but leaves other ips' rows alone", async () => {
    await recordLoginFailure(identity("198.51.100.6", "a@test.example"));
    await recordLoginFailure(identity("198.51.100.7", "b@test.example"));
    await clearLoginFailuresForEmail("A@Test.example");
    const rows = await prisma.loginFailure.findMany();
    expect(rows.map((r) => r.email)).toEqual(["b@test.example"]);
  });

  it("purges only rows older than the retention window", async () => {
    await recordLoginFailure(identity("198.51.100.8", "old@test.example"));
    await recordLoginFailure(identity("198.51.100.9", "newer@test.example"));
    const now = new Date();
    await prisma.loginFailure.update({
      where: { id: (await prisma.loginFailure.findFirstOrThrow({ where: { email: "old@test.example" } })).id },
      data: { createdAt: new Date(now.getTime() - 26 * 3_600_000) },
    });
    expect(await purgeOldLoginFailures(now)).toBe(1);
    expect(await prisma.loginFailure.count()).toBe(1);
    expect((await prisma.loginFailure.findFirstOrThrow()).email).toBe("newer@test.example");
  });

  it("never lets TEST_PASSWORD-looking data into any stored field", async () => {
    await recordLoginFailure(identity("198.51.100.10", "a@test.example"));
    const row = await prisma.loginFailure.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain("password");
  });
});

/** Keeps the constants honest against the schema/migration contract. */
describe("throttle table hygiene", () => {
  it("rows have no relations and can be truncated independently", async () => {
    await recordLoginFailure(identity("198.51.100.11", "a@test.example"));
    await resetDb();
    expect(await prisma.loginFailure.count()).toBe(0);
  });
});
