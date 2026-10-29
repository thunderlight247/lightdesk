import { describe, expect, it } from "vitest";
import { scrypt } from "node:crypto";
import { promisify } from "node:util";
import { needsRehash, hashParamsOf, hashPassword, verifyPassword } from "@/lib/security/password";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: Record<string, number>) => Promise<Buffer>;

/** Crafts a stored hash at LEGACY parameters (N=2^17) the way pre-upgrade deploys created them. */
async function legacyHash(password: string): Promise<string> {
  const salt = Buffer.from("legacy-salt-fixture-01");
  const key = await scryptAsync(password.normalize("NFKC"), salt, 64, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return ["scrypt", 131072, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
}

describe("password hashing", () => {
  it("verifies the right password, rejects the wrong one, salts uniquely", async () => {
    const h1 = await hashPassword("a-long-test-password");
    const h2 = await hashPassword("a-long-test-password");
    expect(h1).not.toBe(h2);
    // CPU-constrained Workers parameters (see lib/security/password.ts)
    expect(h1.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(h1).not.toContain("a-long-test-password");
    expect(await verifyPassword("a-long-test-password", h1)).toBe(true);
    expect(await verifyPassword("a-long-test-passwore", h1)).toBe(false);
  }, 15000);
  it("rejects malformed or hostile stored hashes without throwing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2$3", "scrypt$99999999999$8$1$AAAA$AAAA", "bcrypt$a$b$c$d$e"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
  it("still verifies hashes created at legacy (N=2^17) parameters", async () => {
    const stored = await legacyHash("a-long-test-password");
    expect(hashParamsOf(stored)).toEqual({ n: 131072, r: 8, p: 1 });
    expect(await verifyPassword("a-long-test-password", stored)).toBe(true);
    expect(await verifyPassword("a-long-test-passwore", stored)).toBe(false);
  }, 20000);
  it("flags legacy and malformed hashes for transparent re-hash", () => {
    expect(needsRehash("scrypt$16384$8$1$AAAA$AAAA")).toBe(false);
    expect(needsRehash("scrypt$131072$8$1$AAAA$AAAA")).toBe(true); // legacy strength
    expect(needsRehash("scrypt$1$2$3")).toBe(true);
    expect(needsRehash("plain")).toBe(true);
  });
  it("serializes concurrent derivations (single scrypt working set per isolate at a time)", async () => {
    const hash = await hashPassword("a-long-test-password");
    const single = Date.now();
    await hashPassword("a-long-test-password");
    const one = Date.now() - single;
    // With the promise-chain serialization the wall time must grow roughly linearly with
    // concurrent load; true parallelism would complete both near `one`.
    const pair = Math.max(...(await Promise.all([
      (async () => { const t = Date.now(); await hashPassword("a-long-test-password"); return Date.now() - t; })(),
      (async () => { const t = Date.now(); await verifyPassword("a-long-test-password", hash); return Date.now() - t; })(),
    ])));
    expect(single).toBeGreaterThan(0);
    expect(pair).toBeGreaterThanOrEqual(Math.floor(one * 1.3)); // generous margin for GC/noise
  }, 30000);
  it("results stay correct under concurrency", async () => {
    const [a, b] = await Promise.all([
      hashPassword("pw-one-1234567890"),
      hashPassword("pw-two-1234567890"),
    ]);
    expect(await verifyPassword("pw-one-1234567890", a)).toBe(true);
    expect(await verifyPassword("pw-one-1234567890", b)).toBe(false);
    expect(await verifyPassword("pw-two-1234567890", b)).toBe(true);
  }, 30000);
});
