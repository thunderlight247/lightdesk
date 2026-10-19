import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/security/errors";
import {
  ENTRY_DEFS, getEntryDef, normalizeEntryValue, normalizeFaqInput,
} from "@/modules/business-profile/catalog";
import { evaluateProfile, findConflicts, type EntryLite, type FaqLite } from "@/modules/business-profile/evaluate";
import { allowedTransitions, canTransition, requiredPermissionFor } from "@/modules/business-profile/lifecycle";
import { isCosmeticChange, normalizeQuestion } from "@/modules/business-profile/text";
import { CAPABILITIES, platformAllows } from "@/modules/permissions/platform-policy";
import { can } from "@/modules/permissions/roles";

const entry = (key: string, value: string, approved: string | null, state: "DRAFT" | "APPROVED", module = "POLICY"): EntryLite => ({
  id: key, module, key, value, approvedValue: approved, state,
});
const faq = (id: string, q: string, a: string, active = true): FaqLite => ({
  id, question: q, answer: a, normalizedQuestion: normalizeQuestion(q), isActive: active, state: "DRAFT", approvedAt: null,
});
const REQUIRED_OK = [
  entry("business_category", "Retail", "Retail", "APPROVED", "IDENTITY"),
  entry("offerings_summary", "Phones", "Phones", "APPROVED", "OFFERINGS"),
  entry("escalation", "Call the owner", "Call the owner", "APPROVED"),
];

describe("lifecycle", () => {
  it("allows only the defined transitions", () => {
    expect(allowedTransitions("DRAFT")).toEqual(["REVIEW_REQUIRED", "ACTIVE"]);
    expect(canTransition("REVIEW_REQUIRED", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransition("SUSPENDED", "ACTIVE")).toBe(true);
    for (const [a, b] of [["DRAFT", "SUSPENDED"], ["ACTIVE", "DRAFT"], ["ACTIVE", "REVIEW_REQUIRED"], ["ACTIVE", "ACTIVE"], ["DRAFT", "DRAFT"], ["X", "ACTIVE"], ["ACTIVE", "BOGUS"]]) {
      expect(canTransition(a, b)).toBe(false);
    }
  });
  it("only submit/return are editor actions; everything else needs the approver", () => {
    expect(requiredPermissionFor("DRAFT", "REVIEW_REQUIRED")).toBe("profile:edit");
    expect(requiredPermissionFor("REVIEW_REQUIRED", "DRAFT")).toBe("profile:edit");
    expect(requiredPermissionFor("DRAFT", "ACTIVE")).toBe("profile:approve");
    expect(requiredPermissionFor("ACTIVE", "SUSPENDED")).toBe("profile:approve");
    expect(requiredPermissionFor("SUSPENDED", "DRAFT")).toBe("profile:approve");
  });
});

describe("profile permissions and platform policy", () => {
  it("members read, admins edit, only owners approve", () => {
    expect([can("MEMBER", "profile:read"), can("MEMBER", "profile:edit"), can("MEMBER", "profile:approve")]).toEqual([true, false, false]);
    expect([can("ADMIN", "profile:read"), can("ADMIN", "profile:edit"), can("ADMIN", "profile:approve")]).toEqual([true, true, false]);
    expect([can("OWNER", "profile:read"), can("OWNER", "profile:edit"), can("OWNER", "profile:approve")]).toEqual([true, true, true]);
  });
  it("platform forbids automatic sending and denies unknown capabilities", () => {
    expect(platformAllows("send_messages_automatically")).toBe(false);
    expect(platformAllows("escalate_to_human")).toBe(true);
    expect(platformAllows("constructor")).toBe(false);
    expect(CAPABILITIES).toHaveLength(5);
  });
  it("the catalogue has an entry for every capability and unique keys", () => {
    for (const c of CAPABILITIES) expect(getEntryDef(c)?.module).toBe("PERMISSION");
    expect(new Set(ENTRY_DEFS.map((d) => d.key)).size).toBe(ENTRY_DEFS.length);
    expect(ENTRY_DEFS.filter((d) => d.module === "COMMUNICATION").every((d) => !d.material)).toBe(true);
    expect(ENTRY_DEFS.filter((d) => d.module !== "COMMUNICATION").every((d) => d.material)).toBe(true);
  });
});

describe("value validation", () => {
  it("validates options, phone, email, terminology and control characters", () => {
    expect(normalizeEntryValue(getEntryDef("tone")!, " warm ")).toBe("warm");
    expect(() => normalizeEntryValue(getEntryDef("tone")!, "rude")).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("public_phone")!, "abc")).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("public_email")!, "nope")).toThrow(ValidationError);
    expect(normalizeEntryValue(getEntryDef("terminology")!, "cheap => affordable")).toBe("cheap => affordable");
    expect(() => normalizeEntryValue(getEntryDef("terminology")!, "no arrow here")).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("greeting")!, "two\nlines")).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("delivery")!, "   ")).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("delivery")!, "x".repeat(1001))).toThrow(ValidationError);
    expect(() => normalizeEntryValue(getEntryDef("delivery")!, 42)).toThrow(ValidationError);
    expect(normalizeEntryValue(getEntryDef("delivery")!, "line one\r\nline two")).toBe("line one\nline two");
    expect(() => normalizeEntryValue(getEntryDef("answer_routine_enquiries")!, "yes")).toThrow(ValidationError);
  });
  it("validates FAQ fields", () => {
    expect(() => normalizeFaqInput({ question: "hey", answer: "x" }, true)).toThrow(ValidationError);
    expect(() => normalizeFaqInput({ question: "Valid question?", answer: "" }, true)).toThrow(ValidationError);
    expect(normalizeFaqInput({ question: "Valid question?", answer: " ok ", category: "  " }, true)).toEqual({ question: "Valid question?", answer: "ok", category: null });
    expect(normalizeFaqInput({ answer: "only this" }, false)).toEqual({ answer: "only this" });
  });
});

describe("cosmetic changes", () => {
  it("case/whitespace only is cosmetic; digits and punctuation are not", () => {
    expect(isCosmeticChange("Open 8am", "open  8AM")).toBe(true);
    expect(isCosmeticChange("GH₵10.50", "GH₵1050")).toBe(false);
    expect(isCosmeticChange("Yes", "No")).toBe(false);
    expect(isCosmeticChange("same", "same")).toBe(false);
  });
});

describe("evaluateProfile (transparent checklist, no percentage)", () => {
  it("empty profile: three required items missing, nothing pending, cannot activate", () => {
    const ev = evaluateProfile([], []);
    expect(ev.blocking).toHaveLength(3);
    expect(ev.canActivate).toBe(false);
    expect(ev.pending).toHaveLength(0);
    expect(ev.checklist.filter((c) => c.level === "required").every((c) => c.status === "missing")).toBe(true);
  });
  it("saved-but-unapproved required items block activation", () => {
    const ev = evaluateProfile([entry("business_category", "Retail", null, "DRAFT", "IDENTITY"), ...REQUIRED_OK.slice(1)], []);
    expect(ev.canActivate).toBe(false);
    expect(ev.blocking[0]).toMatch(/not yet approved/);
    expect(ev.pending).toEqual([expect.objectContaining({ neverApproved: true, section: "identity" })]);
  });
  it("all required approved => can activate; recommended items may stay missing", () => {
    const ev = evaluateProfile(REQUIRED_OK, []);
    expect(ev.canActivate).toBe(true);
    expect(ev.checklist.filter((c) => c.level === "recommended").some((c) => c.status === "missing")).toBe(true);
  });
  it("a pending change to an approved required item does not block, and is flagged", () => {
    const ev = evaluateProfile([entry("escalation", "New text", "Call the owner", "DRAFT"), ...REQUIRED_OK.slice(0, 2)], []);
    expect(ev.canActivate).toBe(true);
    expect(ev.checklist.find((c) => c.id === "escalation")).toMatchObject({ status: "approved", changePending: true });
  });
  it("conflicting active FAQs are surfaced and block activation; inactive/identical ones are not conflicts", () => {
    expect(findConflicts([faq("1", "Opening hours?", "8-5"), faq("2", "opening hours", "9-6")])).toHaveLength(1);
    expect(findConflicts([faq("1", "Hours?", "8-5"), faq("2", "hours", "8-5")])).toHaveLength(0);
    expect(findConflicts([faq("1", "Hours?", "8-5"), faq("2", "hours", "9-6", false)])).toHaveLength(0);
    expect(evaluateProfile(REQUIRED_OK, [faq("1", "Hours?", "8-5"), faq("2", "hours", "9-6")]).canActivate).toBe(false);
  });
});
