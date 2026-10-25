# ADR 0010 — WhatsApp outbound outage queue & circuit breaker (M8 Phase 2 remainder)

## Status
**Accepted and implemented** with the proposed defaults (2026-10-25). The review confirmed all four
open questions as proposed: terminal cancel (`FAILED`/`CANCELLED_BY_OWNER`), takeover keeps queued
owner-approved text, backoff `1m → 5m → 20m → 1h → 6h` with max 5 attempts, and opportunistic-only
flush for now (the cron endpoint ships as the contract; wiring an external Cron Trigger is a deploy-
time ops step, see `docs/m6-live-runbook.md`).

Original goal: fulfil the last unimplemented M8 acceptance area (spec §2.2): during a Meta Graph API
outage, owner-approved outbound replies queue locally and retry with exponential backoff up to the
24-hour service window, a provider status banner appears in the owner console, and the system degrades
gracefully — never losing an approved reply and never silently dropping it after the window closes.

## 1. Current behaviour (the gap)
Today `sendOwnerReply` (modules/whatsapp/service.ts) performs one synchronous Graph call:

- **Transient failure** (5xx, timeout, rate limit): returns `sent: false` with the Graph message,
  audits `whatsapp.send.failed`, and ends. The owner's approved text still exists only inside
  `sendOwnerReply`'s local scope — nothing is persisted, the draft row is not consumed, and the
  owner must notice the failure and re-click send. During a real outage in Ghana-time business
  hours this is the difference between losing and keeping a day of replies.
- **Permanent failure** (invalid recipient, rejected token): same path — correct today, and below
  this proposal deliberately keeps these NON-queued.

## 2. Schema decision: reuse `WhatsAppMessage`, not a new table

**Option A (recommended): add a `QUEUED` status and queue columns to `WhatsAppMessage`.**
```prisma
enum WhatsAppMessageStatus {
  RECEIVED DRAFT QUEUED SENT DELIVERED READ FAILED
}
model WhatsAppMessage {
  // ... existing fields
  queuedAt       DateTime?   // set at queue time; null after sending
  nextAttemptAt  DateTime?   // when the flusher may retry; drives the index
  attempts       Int         @default(0)  // transient attempts made
  lastErrorKind  String?     // TRANSIENT | PERMANENT — never a provider body
  lastErrorAt    DateTime?
}
-- index for the flusher's due-work query
@@index([status, nextAttemptAt])
```

Option B (a separate `OutboundQueue` table referencing a draft row) was **rejected**: outbound
message state already lives in exactly one lifecycle (`RECEIVED/DRAFT/SENT/DELIVERED/READ/FAILED`),
read by the conversation view, the status-callback transition map (`processStatusUpdates`), the
free-tier meter (via `SENT_LIKE_STATUSES`, unchanged — `QUEUED` never joins it, so queueing is
free), and the dedupe-by-`wamid` mechanism. A second table would fork that lifecycle and need a
join for every queue-count and banner query.

Because `wamid` is `null` until Graph accepts a send, the existing uniqueness naturally covers
queued rows: they gain a `wamid` exactly once, on the same site as today's success path.

### Integration with the draft lifecycle (deliberate detail)
On queueing, the row goes through the **same draft-consumption marking as a successful send today**
(all `DRAFT` drafts of the conversation → `SUPERSEDED`; the queued row records `approvedContent` =
the text the owner approved/edited) **plus** `status = QUEUED`. Consequences:
- `latestDraft`-style reads never see a queued row as a still-reviewable draft (no double-send);
- the conversation timeline shows the queued message exactly where the owner approved it;
- cancelling or expiring only moves `status` — the approved text is immutable, mirroring the
  established "the original draft text is never edited" rule.

## 3. Failure classification at send time (in `sendOwnerReply`)
`sendWhatsAppText` (modules/whatsapp/graph.ts) learns exact HTTP statuses; it will return a
`retryable`/`retryAfterMs` hint instead of only a message string.

| Class | Graph signals | Action |
|---|---|---|
| **Transient** | HTTP 5xx, timeouts/network, 429 (respect any `retry-after`), 131056 concurrent-request/other rate-limit codes | **Queue** (Option A flow) + audit `whatsapp.send.queued` |
| **Permanent** | 401/403 (token), 4xx invalid recipient / parameter, message-type rejections | Fail inline exactly as today; **never queued** — a retry could never succeed and would bury the real error. The owner gets the actionable failure immediately. |
| **Unknown status code** | Anything unclassifiable | Treat as transient but cap attempts at 1 (fail on first retry) — safe both ways. |

## 4. Retry policy
- **Backoff:** `1m → 5m → 20m → 1h → 6h` on each row's `nextAttemptAt`, with ±20% deterministic
  jitter (hash of the row id — avoids thundering herd after an outage clears). Max **5 attempts**;
  exhaustion → `FAILED` with `errorInfo.code = "EXHAUSTED_RETRIES"`, audited.
- **24-hour window governs expiry, not attempts.** The window still opens from the customer's
  *last inbound message* — queueing never "extends" it. At each attempt: if
  `now > window closing` → transition the row to `FAILED` with
  `errorInfo.code = "EXPIRED_WINDOW"` (audited `whatsapp.send.expired`). The owner console banner
  explains the customer must message again.
- **Gates re-checked at every attempt, with hold-not-fail semantics:**
  pilot consent/caps (`assertPilotOutboundAllowed`); token decryptability; connection `CONNECTED`.
  If a pilot gate holds, the row **stays QUEUED** (banner says "waiting — pilot paused") — a gate
  is an operator action that can reverse; only the 24h window and retry exhaustion fail a row.
- **Owner takeover does not kill the queue.** Switching a conversation to `OWNER_ONLY` (takeover)
  leaves the owner's own already-approved queued text in place; takeover only stops *future AI*
  drafting. (Rejected alternative: purge queue on takeover — that deletes approved owner intent.)
- **Cancel:** an owner action cancels a queued row: `status → FAILED` with
  `errorInfo.code = "CANCELLED_BY_OWNER"`, audit `whatsapp.send.cancelled`. Terminal and simple.
  (Alternative considered — returning the row to a reviewable `DRAFT` draft — rejected: it
  re-opens the "double lifecycle on one row" problem the QUEUED design exists to avoid.)

## 5. Retry driver: no long-running process exists (Cloudflare Workers)
- **Flush function:** one module-level function,
  `flushDueMessages(connectionId, { now, limit = 10 })` — picks a connection's QUEUED rows with
  `nextAttemptAt <= now`, oldest first, makes **sequential** Graph calls, marks the connection
  degraded (§6) on the first transient failure and **stops the flush fast-fail** for that pass
  (under a full outage one failure is enough — the rest stay correctly due).
- **Trigger 1 (primary, zero infra): opportunistic flush.** Every owner send attempt, every owner
  console read of the WhatsApp surface, and every inbound webhook for that connection calls
  `flushDueMessages` first. Inbound traffic is frequent by definition — a talking customer who
  caused the queue has the next message flush it.
- **Trigger 2 (for silent periods): `POST /api/whatsapp/outbox/flush`,** guarded by
  `WHATSAPP_OUTBOX_FLUSH_TOKEN` (endpoint returns 404 when the token is unset — disabled by
  default), processing all connections with a global cap (e.g. 50 sends). This is what an external
  Cron Trigger (Cloudflare, GitHub Actions, any uptime pinger) calls every 5–10 minutes.
*Out of the code change:* wiring the actual Cron Trigger goes in `docs/m6-live-runbook.md` as an
ops step once a deploy exists — the endpoint is the portable contract either way. (Implemented
detail: with the token unset the endpoint responds **403** — disabled — rather than a route-level
404, keeping the surface discoveryable/routeable while fail-closed.)

## 6. Circuit breaker & status banner
State on `WhatsAppConnection` (no new table):
- `consecutiveSendFailures Int @default(0)`, `providerDownSince DateTime?`.
- **Open** (degraded) at `consecutiveSendFailures >= 3`; **closed** (healthy) on any successful
  Graph call, which resets both fields. Audit `whatsapp.provider.outage.open` / `.closed` once
  per transition, not per failure (no alert spam).
- Breaker state is derived evidence, never a hard gate: sending stays *possible* while degraded
  (owner may want to push one urgent message through), it only drives UX and flush pacing.

Console surface (`/businesses/[businessId]/whatsapp` + `getSendReadiness` extension):
- **Outage banner:** "Meta's messaging service has been unavailable since {time}. {n} approved
  reply/replies are queued and will be sent automatically. Nothing is lost." (only while open).
- **Queued banner (healthy):** "Your approved reply is queued — next send attempt at {nextAttemptAt}"
  per conversation with a Cancel affordance.
- **Expired banner:** "A queued reply expired because the 24-hour service window closed — the
  customer needs to message again next time." (Failed rows with EXPIRED_WINDOW in the last 7 days.)
- `getSendReadiness` gains `queued { count, oldestQueuedAt, nextRetryAt } | null` and
  `providerDegraded { since, failures } | null`; the send button is disabled while an earlier
  queued reply exists for that conversation (reason string explains why).

## 7. Invariants kept (this is what the review should check)
1. **QUEUED never counts toward the monthly meter** (`SENT_LIKE_STATUSES` untouched); the meter
   counts at the moment a send succeeds, so the 1,000 free-tier accounting stays exact.
2. **Status-callback monotonicity** (`STATUS_RANK`) learns `QUEUED` as rank 0 — a webhook status
   can never move a QUEUED row backwards, and Multi-status callbacks for a not-yet-sent wamid
   are already ignored through the wamid lookup.
3. **Approved text immutability** end-to-end: queue/cancel/expire never rewrite `text` or
   `approvedContent`.
4. **No auto-AI in the queue:** a queued reply is a person-approved artifact; retries never
   consult Gemini or the rules engine.
5. **Tenant isolation:** flush and banner reads run inside existing connection-scoped checks;
   the cron endpoint is business-agnostic by design but the per-row Graph calls stay tied to
   their connection's stored token — a token a business can decrypt, decryptable only with the
   connection-scoped read path that exists today.
6. **Audit without secrets:** all new audit events carry error kinds, counts and ids, never
   provider bodies or tokens.

## 8. Migration plan
One additive migration, `m8_outbound_outage_queue`:
`ALTER TYPE ... ADD VALUE 'QUEUED'` + 4 columns on `WhatsAppMessage` + 2 columns on
`WhatsAppConnection` + the flush index. Backward compatible: existing rows keep null queue fields;
Postgres enum-value addition requires commit-order care if run inside a transaction with the
columns (migration SQL will add the enum value first). The `integrity_constraints` migration's
table CHECK constraints will be re-checked and updated if they enumerate statuses.

## 9. Test matrix (planned, integration + unit)
- classification: 5xx/timeout/429 queue; 401/403/400 fail inline without a row;
- queue → opportunistic flush on next inbound → SENT with wamid, meter +1, audits present;
- backoff ordering + jitter bounds; 5-attempt exhaustion → FAILED/EXHAUSTED_RETRIES;
- window expiry path (older-than-24h inbound backup → FAILED/EXPIRED_WINDOW even pre-attempt);
- pilot paused → holds, resumes on consent; takeover left queue intact; cancel → terminal;
- circuit open after 3 failures, closed on success, outage audit exactly once per transition;
- meter/monotonicity guards with QUEUED present (webhook FAILED before queued send, etc.);
- flush endpoint: 404 without token, 403 wrong token, works with token; cap respected.

## 10. Open questions for the reviewer
1. **Cancel UX** — terminal `FAILED`/`CANCELLED_BY_OWNER` (proposed) vs reverting the row to a
   re-reviewable draft.
2. **Takeover semantics** — keep queued owner-approved text through takeover (proposed).
3. **Backoff cadence** — 1m/5m/20m/1h/6h (proposed) suits Ghana power/net realities; tighten or
   loosen?
4. **Do we want the cron hard-wiring (6 attempts/window close reconciliation) inside an external
   cron every 10 minutes for the pilot, or is opportunistic-only acceptable for a small pilot?**
   (Recommended: opportunistic now, wire cron at deploy time.)
