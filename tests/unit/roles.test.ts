import { describe, expect, it } from "vitest";
import { can, canAssignRole } from "@/modules/permissions/roles";

describe("permission matrix", () => {
  it("grants by role", () => {
    expect(can("OWNER", "invitations:manage")).toBe(true);
    expect(can("ADMIN", "invitations:manage")).toBe(true);
    expect(can("MEMBER", "invitations:manage")).toBe(false);
    expect(can("MEMBER", "business:read")).toBe(true);
  });
  it("denies by default: unknown roles, permissions, prototype keys, empty values", () => {
    expect(can("SUPERUSER", "business:read")).toBe(false);
    expect(can("OWNER", "billing:everything")).toBe(false);
    expect(can("constructor", "business:read")).toBe(false);
    expect(can("__proto__", "business:read")).toBe(false);
    expect(can(undefined, "business:read")).toBe(false);
    expect(can(null, "business:read")).toBe(false);
    expect(can("", "business:read")).toBe(false);
  });
  it("never lets an actor grant a role above their own", () => {
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(true);
    expect(canAssignRole("ADMIN", "OWNER")).toBe(false);
    expect(canAssignRole("MEMBER", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "ROOT")).toBe(false);
  });
});
