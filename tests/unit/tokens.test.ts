import { describe, expect, it } from "vitest";
import { generateToken, hashToken, TOKEN_PATTERN } from "@/lib/security/tokens";

describe("tokens", () => {
  it("generates unique, well-formed 256-bit tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(TOKEN_PATTERN);
  });
  it("hashes deterministically to 64 hex chars and never equals the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toBe(t);
  });
  it("rejects malformed tokens", () => {
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", "../etc/passwd"]) {
      expect(TOKEN_PATTERN.test(bad)).toBe(false);
    }
  });
});
