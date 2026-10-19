import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/security/redirect";
import { ValidationError } from "@/lib/security/errors";
import { businessIdSchema, createInvitationSchema, parseOrThrow, passwordSchema } from "@/lib/validation/schemas";
import { sanitizeMetadata } from "@/modules/audit/service";

describe("validation", () => {
  it("normalises emails and rejects bad roles", () => {
    expect(parseOrThrow(createInvitationSchema, { email: "  Foo@Example.COM ", role: "MEMBER" }).email).toBe("foo@example.com");
    expect(() => parseOrThrow(createInvitationSchema, { email: "x@y.com", role: "GOD" })).toThrow(ValidationError);
    expect(() => parseOrThrow(createInvitationSchema, { email: "nope", role: "MEMBER" })).toThrow(ValidationError);
  });
  it("enforces password length", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough-password").success).toBe(true);
  });
  it("rejects malformed business ids", () => {
    for (const bad of ["", "../x", "a b", "A".repeat(20), "x".repeat(41)]) {
      expect(businessIdSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("blocks open redirects", () => {
    expect(safeRedirectPath("/businesses/abc")).toBe("/businesses/abc");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/a\nb", undefined, 5]) {
      expect(safeRedirectPath(bad)).toBe("/businesses");
    }
  });
  it("strips secret-looking keys from audit metadata", () => {
    expect(sanitizeMetadata({ email: "a@b.c", token: "x", passwordHash: "y", tokenHash: "z", role: "ADMIN" })).toEqual({
      email: "a@b.c",
      role: "ADMIN",
    });
  });
});
