import { describe, expect, it } from "vitest";
import {
  LOGIN_THROTTLE_MESSAGE,
  UNKNOWN_IP,
  clientIpFromHeaders,
  loginThrottleDecision,
} from "@/lib/security/login-throttle";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("login throttle decision (pure policy)", () => {
  const limits = { ipLimit: 10, emailLimit: 5 };

  it("allows below the limits", () => {
    expect(loginThrottleDecision({ ipFailures: 9, emailFailures: 4 }, limits)).toEqual({ allowed: true, reason: null });
  });

  it("blocks AT the limit, not after it", () => {
    expect(loginThrottleDecision({ ipFailures: 10, emailFailures: 0 }, limits)).toMatchObject({ allowed: false, reason: "ip" });
    expect(loginThrottleDecision({ ipFailures: 0, emailFailures: 5 }, limits)).toMatchObject({ allowed: false, reason: "email" });
  });

  it("the ip budget wins over the email budget when both are exceeded", () => {
    expect(loginThrottleDecision({ ipFailures: 10, emailFailures: 5 }, limits)).toMatchObject({ reason: "ip" });
  });

  it("a failed-email budget only blocks that address, and vice versa", () => {
    expect(loginThrottleDecision({ ipFailures: 0, emailFailures: 999 }, { ipLimit: 10, emailLimit: 1 })).toMatchObject({ reason: "email" });
  });

  it("the user-facing message never interpolates user data", () => {
    expect(LOGIN_THROTTLE_MESSAGE).not.toMatch(/\{|\}|\$/);
  });
});

describe("client ip extraction from proxy headers", () => {
  it("prefers the verified Cloudflare header", () => {
    expect(clientIpFromHeaders(h({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("falls back to the leftmost x-forwarded-for value", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "198.51.100.7, 10.1.2.3" }))).toBe("198.51.100.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "  198.51.100.7  " }))).toBe("198.51.100.7");
  });

  it("supports ipv6", () => {
    expect(clientIpFromHeaders(h({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("buckets untrusted formats as unknown, never verbatim", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "; DROP TABLE users; --" }))).toBe(UNKNOWN_IP);
    expect(clientIpFromHeaders(h({ "cf-connecting-ip": "a".repeat(60) }))).toBe(UNKNOWN_IP);
  });

  it("buckets headerless requests (direct dev access) as unknown", () => {
    expect(clientIpFromHeaders(h({}))).toBe(UNKNOWN_IP);
  });
});
