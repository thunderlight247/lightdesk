import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/security/errors";
import { parseOrThrow, updateBusinessSchema } from "@/lib/validation/schemas";
import { can } from "@/modules/permissions/roles";

describe("updateBusinessSchema", () => {
  it("trims, and maps empty description/location to null (clear)", () => {
    expect(parseOrThrow(updateBusinessSchema, { name: "  Shop  ", description: "  ", location: "" })).toEqual({
      name: "Shop",
      description: null,
      location: null,
    });
  });
  it("leaves omitted fields undefined (unchanged)", () => {
    expect(parseOrThrow(updateBusinessSchema, { location: "Kumasi" })).toEqual({ location: "Kumasi" });
  });
  it("allows line breaks in description but not in name/location", () => {
    expect(parseOrThrow(updateBusinessSchema, { description: "line one\nline two" }).description).toBe("line one\nline two");
    expect(() => parseOrThrow(updateBusinessSchema, { name: "Bad\nName" })).toThrow(ValidationError);
    expect(() => parseOrThrow(updateBusinessSchema, { location: "Bad\tPlace" })).toThrow(ValidationError);
  });
  it("rejects too short/long values and control characters", () => {
    for (const bad of [
      { name: "a" },
      { name: "x".repeat(101) },
      { description: "x".repeat(501) },
      { location: "x".repeat(121) },
      { name: "bad\u0000name" },
      { description: "bell\u0007" },
    ]) {
      expect(() => parseOrThrow(updateBusinessSchema, bad)).toThrow(ValidationError);
    }
  });
  it("rejects unknown keys so slug/status/id can never be set", () => {
    for (const key of ["slug", "status", "id", "businessId", "createdAt", "role"]) {
      expect(() => parseOrThrow(updateBusinessSchema, { name: "Valid Name", [key]: "x" })).toThrow(ValidationError);
    }
  });
  it("rejects an empty update and non-string values", () => {
    expect(() => parseOrThrow(updateBusinessSchema, {})).toThrow(ValidationError);
    expect(() => parseOrThrow(updateBusinessSchema, { name: 123 })).toThrow(ValidationError);
    expect(() => parseOrThrow(updateBusinessSchema, null)).toThrow(ValidationError);
  });
});

describe("M1 permissions (least privilege)", () => {
  it("only owners can rename; owners and admins can update; members cannot", () => {
    expect(can("OWNER", "business:rename")).toBe(true);
    expect(can("ADMIN", "business:rename")).toBe(false);
    expect(can("MEMBER", "business:rename")).toBe(false);
    expect(can("OWNER", "business:update")).toBe(true);
    expect(can("ADMIN", "business:update")).toBe(true);
    expect(can("MEMBER", "business:update")).toBe(false);
  });
});
