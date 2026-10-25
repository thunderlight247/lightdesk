/**
 * M8 Phase 3: login throttling — database-backed enforcement (see
 * `lib/security/login-throttle.ts` for the pure policy). Mirrors the lab's
 * database-backed rate limiting (modules/lab/service.ts enforceRateLimits): no
 * extra infrastructure, real counters, no in-memory state to reset per instance.
 *
 * Enforcement contract in the login action:
 *  1. `assertLoginAllowed` runs BEFORE any password hashing — a throttled
 *     client never reaches scrypt (~128 MiB per verification), so failure
 *     floods are also a memory-pressure defence.
 *  2. Every failed authentication adds exactly one `LoginFailure` row
 *     (`recordLoginFailure`) — successes are not throttling data.
 *  3. A successful login clears that email's failure rows
 *     (`clearLoginFailuresForEmail`): a legitimate user who tripped the per-email
 *     budget and then signs in correctly must not stay locked out.
 *
 * Password attempts are never revealed in errors or audit metadata: the client
 * gets one generic message for both exceeded budgets, and audits carry only the
 * bucket reason — no addresses, no attempted credentials.
 */
import { prisma } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { RateLimitError } from "@/lib/security/errors";
import {
  LOGIN_FAILURE_RETENTION_MINUTES,
  LOGIN_THROTTLE_MESSAGE,
  clientIpFromHeaders,
  loginThrottleDecision,
} from "@/lib/security/login-throttle";
import { recordAudit } from "@/modules/audit/service";

export { clientIpFromHeaders, LOGIN_THROTTLE_MESSAGE };

export type LoginIdentity = { ip: string; email: string };

/**
 * Throws RateLimitError when the ip or the attempted email has already reached its
 * failure budget inside the rolling window. Fresh failure rows age out naturally,
 * so "try again in a few minutes" always becomes true.
 */
export async function assertLoginAllowed(identity: LoginIdentity, now: Date = new Date()) {
  const { LOGIN_FAILURE_WINDOW_MINUTES, LOGIN_MAX_FAILURES_PER_IP, LOGIN_MAX_FAILURES_PER_EMAIL } = getEnv();
  const since = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MINUTES * 60_000);
  const [ipFailures, emailFailures] = await Promise.all([
    prisma.loginFailure.count({ where: { ip: identity.ip, createdAt: { gte: since } } }),
    prisma.loginFailure.count({ where: { email: identity.email, createdAt: { gte: since } } }),
  ]);
  const decision = loginThrottleDecision(
    { ipFailures, emailFailures },
    { ipLimit: LOGIN_MAX_FAILURES_PER_IP, emailLimit: LOGIN_MAX_FAILURES_PER_EMAIL },
  );
  if (decision.allowed) return;
  await recordAudit(prisma, {
    action: "auth.login.throttled",
    targetType: "LoginFailure",
    targetId: undefined,
    metadata: { reason: decision.reason, windowMinutes: LOGIN_FAILURE_WINDOW_MINUTES },
  });
  throw new RateLimitError(LOGIN_THROTTLE_MESSAGE);
}

/** Records ONE failed attempt. Call only after a real failed password check. */
export async function recordLoginFailure(identity: LoginIdentity) {
  await prisma.loginFailure.create({
    data: { ip: identity.ip, email: identity.email.trim().toLowerCase() },
  });
}

/** Called after a SUCCESSFUL login: correct credentials are their own proof. */
export async function clearLoginFailuresForEmail(email: string) {
  await prisma.loginFailure.deleteMany({ where: { email: email.trim().toLowerCase() } });
}

/**
 * Housekeeping (like purgeExpiredSessions in lib/auth/session): drops rows that are
 * older than the longest window. Call from a scheduled job; returns the removed count.
 */
export async function purgeOldLoginFailures(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOGIN_FAILURE_RETENTION_MINUTES * 60_000);
  const { count } = await prisma.loginFailure.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
