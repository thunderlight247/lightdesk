/**
 * M8 Phase 3: login throttling — PURE policy layer (no database, no I/O).
 * The database-backed enforcement lives in `modules/identity/throttle.ts`; this file
 * holds only what must be unit-testable without a database.
 *
 * Model: failed sign-in attempts are counted over rolling windows. The client ip
 * budget absorbs distributed guessing; the per-attempted-address budget stops an
 * attacker who rotates ips from locking one account open through it. Both budgets
 * are read from the environment (see lib/env.ts) so they can be tightened for the
 * pilot without a redeploy of logic.
 *
 * The client ip is trusted from the hosting edge: Cloudflare sets a verified
 * `cf-connecting-ip`. A raw `x-forwarded-for` leftmost value is used as a weaker
 * fallback (it may be client-forged when the app is reached directly); with neither
 * header the attempt is bucketed as "unknown" — conservative, since it still counts.
 */
export const UNKNOWN_IP = "unknown";

export const LOGIN_THROTTLE_MESSAGE =
  "Too many failed sign-in attempts. Please wait a few minutes and try again.";

export type LoginThrottleBuckets = {
  /** Failed attempts from this ip inside the ip window. */
  ipFailures: number;
  /** Failed attempts against this email inside the email window. */
  emailFailures: number;
};

export type LoginThrottleLimits = {
  ipLimit: number;
  emailLimit: number;
};

export type LoginThrottleDecision = {
  allowed: boolean;
  /** Which budget was exceeded; null when allowed. The two go through separate audit metadata. */
  reason: "ip" | "email" | null;
};

/** Pure: blocks at the limit (>= limit, not just >) so the Nth failure triggers, not the Nth+1st. */
export function loginThrottleDecision(
  buckets: LoginThrottleBuckets,
  limits: LoginThrottleLimits,
): LoginThrottleDecision {
  if (buckets.ipFailures >= limits.ipLimit) return { allowed: false, reason: "ip" };
  if (buckets.emailFailures >= limits.emailLimit) return { allowed: false, reason: "email" };
  return { allowed: true, reason: null };
}

/** ipv6 "::ffff:255.255.255.255" style addresses max out at 45 characters. */
const MAX_IP_LENGTH = 45;

/**
 * Resolves the bucketing key for a request. Kept tolerant: anything that does not
 * look like an address is bucketed as UNKNOWN_IP rather than trusted verbatim.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf && isAddressLike(cf)) return truncate(cf);
  // Leftmost value = the original client when there are proxies in between.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim() ?? "";
    if (first && isAddressLike(first)) return truncate(first);
  }
  return UNKNOWN_IP;
}

function isAddressLike(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= MAX_IP_LENGTH && /^[0-9a-fA-F.:]+$/.test(v);
}

function truncate(v: string): string {
  const t = v.trim();
  return t.length <= MAX_IP_LENGTH ? t : t.slice(0, MAX_IP_LENGTH);
}

/** The longest rolling window in minutes; housekeeping prunes rows older than this. */
export const LOGIN_FAILURE_RETENTION_MINUTES = 24 * 60;
