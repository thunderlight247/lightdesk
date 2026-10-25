/**
 * Shared ADR 0010 retry-policy facts, used by BOTH the send path (modules/whatsapp/service.ts)
 * and the flush engine (modules/whatsapp/outbox.ts). A tiny leaf module so the two never
 * import each other (no cycles: service → outbox → queue-policy → nothing).
 */
import { createHash } from "node:crypto";

/** Backoff cadence between retry attempts: 1m → 5m → 20m → 1h → 6h (ADR 0010 §4). */
export const QUEUE_BACKOFF_STEPS_MS = [60_000, 5 * 60_000, 20 * 60_000, 3_600_000, 6 * 3_600_000] as const;

/** Max transient attempts before a queued row goes terminal FAILED (EXHAUSTED_RETRIES). */
export const QUEUE_MAX_ATTEMPTS = QUEUE_BACKOFF_STEPS_MS.length; // 5

/** Unclassifiable Graph responses get ONE retry at most (safe both ways, ADR 0010 §3). */
export const QUEUE_UNKNOWN_MAX_ATTEMPTS = 1;

/** Deterministic ±20% jitter on the victim row id, so flushes don't thundering-herd. */
function jitterFactor(rowId: string): number {
  const digest = createHash("sha256").update(rowId).digest();
  const sample = digest[0] * 256 + digest[1]; // 0..65535
  return 0.8 + (sample / 65535) * 0.4;
}

/**
 * Delay before the NEXT attempt, given the attempt count that just failed
 * (1-based). A Meta `retry-after` (429) wins when supplied; then the step schedule,
 * each ±20% deterministically jittered.
 */
export function queueBackoffDelayMs(attempts: number, retryAfterMs: number | null, rowId: string): number {
  const step = QUEUE_BACKOFF_STEPS_MS[Math.min(Math.max(attempts - 1, 0), QUEUE_BACKOFF_STEPS_MS.length - 1)];
  const base = retryAfterMs ?? step;
  return Math.round(jitterFactor(rowId) * base);
}

/** One 24-hour customer service window; OUT of scope for queueing to extend. */
export const SERVICE_WINDOW_MS = 24 * 3_600_000;
