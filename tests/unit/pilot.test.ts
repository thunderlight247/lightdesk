import { describe, expect, it } from "vitest";
import {
  PLATFORM_CEILING_AI_CALLS_PER_DAY,
  PLATFORM_CEILING_OUTBOUND_PER_MONTH,
  isPilotFeedbackCategory,
  validateCapValues,
} from "@/modules/pilot/service";

describe("M7 usage cap validation (pure logic)", () => {
  it("accepts whole numbers within the platform ceilings", () => {
    expect(validateCapValues({ aiCallsPerDay: 0, outboundPerMonth: 0 })).toEqual({ aiCallsPerDay: 0, outboundPerMonth: 0 });
    expect(validateCapValues({ aiCallsPerDay: PLATFORM_CEILING_AI_CALLS_PER_DAY, outboundPerMonth: PLATFORM_CEILING_OUTBOUND_PER_MONTH }))
      .toEqual({ aiCallsPerDay: PLATFORM_CEILING_AI_CALLS_PER_DAY, outboundPerMonth: PLATFORM_CEILING_OUTBOUND_PER_MONTH });
  });

  it("refuses fractional, negative and non-numeric values", () => {
    for (const bad of [-1, 1.5, NaN, "10", null]) {
      expect(() => validateCapValues({ aiCallsPerDay: bad, outboundPerMonth: 5 })).toThrow();
      expect(() => validateCapValues({ aiCallsPerDay: 5, outboundPerMonth: bad })).toThrow();
    }
  });

  it("never accepts a cap above the platform ceilings (a business may only narrow)", () => {
    expect(() => validateCapValues({ aiCallsPerDay: PLATFORM_CEILING_AI_CALLS_PER_DAY + 1, outboundPerMonth: 5 })).toThrow(
      /platform ceiling/,
    );
    expect(() => validateCapValues({ aiCallsPerDay: 5, outboundPerMonth: PLATFORM_CEILING_OUTBOUND_PER_MONTH + 1 })).toThrow(
      /platform ceiling/,
    );
  });
});

describe("M7 feedback categories", () => {
  it("accepts exactly the defined categories and nothing else", () => {
    expect(isPilotFeedbackCategory("worked_well")).toBe(true);
    expect(isPilotFeedbackCategory("wrong_answer")).toBe(true);
    expect(isPilotFeedbackCategory("missed_escalation")).toBe(true);
    expect(isPilotFeedbackCategory("confusing")).toBe(true);
    expect(isPilotFeedbackCategory("other")).toBe(true);
    expect(isPilotFeedbackCategory("")).toBe(false);
    expect(isPilotFeedbackCategory("WORKED_WELL")).toBe(false);
    expect(isPilotFeedbackCategory("plain")).toBe(false);
  });
});
