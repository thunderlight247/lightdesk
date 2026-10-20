import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/security/password";

describe("password hashing", () => {
  it("verifies the right password, rejects the wrong one, salts uniquely", async () => {
    const h1 = await hashPassword("a-long-test-password");
    const h2 = await hashPassword("a-long-test-password");
    expect(h1).not.toBe(h2);
    expect(h1.startsWith("scrypt$")).toBe(true);
    expect(h1).not.toContain("a-long-test-password");
    expect(await verifyPassword("a-long-test-password", h1)).toBe(true);
    expect(await verifyPassword("a-long-test-passwore", h1)).toBe(false);
  }, 15000);
  it("rejects malformed or hostile stored hashes without throwing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2$3", "scrypt$99999999999$8$1$AAAA$AAAA", "bcrypt$a$b$c$d$e"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});
