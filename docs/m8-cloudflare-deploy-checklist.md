# M8 Phase 4 — Cloudflare deploy checklist

**Status of this file (2026-10-25):** the checklist itself. Every item that can be verified
locally **has been re-verified today** (results inline). Everything else is a clear gate the
owner supplies. No deploy has been attempted; this
document is what gets walked through, ticked, and dated at deploy time.

Vehicle: OpenNext adapter (`@opennextjs/cloudflare` 1.x) **on Next.js 15.5**, per the M7
evaluation (`docs/m7-pilot.md §7`) and the ADR-0009 pilot-hosting decision note. The newer
`vinext` path remains blocked on a Vite 8 / Vitest 3 peer conflict seen 2026-10-21.

---

## 0. Owner inputs still outstanding (the actual gate)

| # | Input | Notes |
|---|---|---|
| 1 | Cloudflare account access | `wrangler login` or an API token with Workers + Hyperdrive permissions; account id. |
| 2 | Staging hostname decision | Default: the workers.dev URL (e.g. `https://lightdesk.<account>.workers.dev`) for the pilot. |
| 3 | Hosted PostgreSQL instance | **Provider decided — Neon** (ADR 0011, accepted). Remaining owner action: create the project and supply the **direct TCP** connection string; it goes into secrets only, never committed. |

## 1. Hosted PostgreSQL + connectivity decision (needed before first deploy)

**Decided — Neon via Hyperdrive** (ADR 0011, accepted by the owner 2026-10-25; Neon's
**direct TCP** connection string goes into Hyperdrive, never its serverless HTTPS driver).
Hyperdrive itself is included in both Workers plans (no extra bill). Fallback if the remote
soak test disappoints: Neon's own pgbouncer endpoint instead of Hyperdrive.

The M7 local evaluation proved Prisma queries work inside workerd, but flagged (per the Official
Workers guide) that the production path must be re-verified remotely. Recall the hard facts:

- Hyperdrive needs a **direct TCP** Postgres endpoint, so a provider's normal *serverless*
  HTTPS/WebSocket driver is the wrong knob; use the provider's **direct connection string**
  behind Hyperdrive (Neon documents exactly this pattern on Cloudflare's integration page).
  Alternative: skip Hyperdrive and rely on the provider's own pooled endpoint.
- Prisma on Workers cannot use plain `PrismaClient` + HTTP-based proxying for free forever;
  the two supported shapes are (a) Hyperdrive (+ `postgres.js`/`pg` driver adapter behind
  `prisma`) or (b) Prisma Accelerate. **Decision + evidence belongs in ADR 0009**, per the
  M7 P1 gate row.

Provider evaluation criteria (small pilot, Ghana-time traffic, predictable cost):

- [ ] Provider offers a **direct TCP** Postgres endpoint (Hyperdrive-eligible)
- [ ] Pooling mode confirmed (provider pgbouncer / Hyperdrive pool) with an empirical
      sequential-request soak from a deployed Worker — M7 proved local workerd OK; remote
      behavior (TLS handshake, per-request client hang risk) must be re-observed
- [ ] Backup/restore + PITR documented and **drilled once** before pilot data is trusted to it
- [ ] Costs measured at pilot scale (monthly statement for a low-volume week, not assumed)
- [ ] Region latency acceptable from an Accra VP-hour perspective (or provider region chosen to minimize it)

## 2. Verified locally today (2026-10-25) — rerun at deploy time anyway

| Check | Result today | Note |
|---|---|---|
| `npm run lint` / `typecheck` / `test:unit` (117) / `test:integration` (246) / `next build` | **All green** | Post-ADR-0010 baseline. |
| `opennextjs-cloudflare build` | **Succeeds**, but only with `--dangerouslyUseUnsupportedNextVersion` (Next 15.5.28 is past the 2-year support window) | Unblocks nothing further locally; keep the flag documented in any deploy script until the Next 16 upgrade (ADR 0009) lands. |
| Scaffold inventory | Intact: `wrangler.jsonc` (workerd + `nodejs_compat`, `global_fetch_strictly_public`, ASSETS binding, self-reference `WORKER_SELF_REFERENCE` service binding, IMAGES binding), `open-next.config.ts` (no R2 incremental cache yet), `public/_headers`, `npm run preview` / `deploy` / `upload` / `cf-typegen` scripts | R2 incremental-cache override is **off** — acceptable for pilot scale; revisit if ISR/caching shows as a hot cost or correctness surface. |
| Secrets hygiene | `.env`, `.env.*`, `.dev.vars*`, `.wrangler/`, `.open-next/` **all gitignored** (verified); nothing secret-bearing is tracked | `.dev.vars` currently holds *live-looking* Meta/Gemini/encryption secrets for local testing. Before deploy: (a) decide which values must differ in prod, (b) generate fresh prod values (`WHATSAPP_TOKEN_ENCRYPTION_KEY` must be a **new**, prod-only 32-byte hex), (c) never sync `.dev.vars` into any secret store wholesale |

## 3. Deploy steps (run in order at deploy time)

1. **Hosted DB + Hyperdrive**: create the Postgres instance, note the **direct** connection
   string; `wrangler hyperdrive create lightdesk-pg --connection-string=...`; record the
   Hyperdrive binding id (goes into `wrangler.jsonc` under `hyperdrive`, currently absent).
2. **Migrations**: `DATABASE_URL=<direct-string> npx prisma migrate deploy` (CLI/CI — never
   from the Worker). Migrations up to and including `20261025000000_m8_outbound_outage_queue`
   must be applied.
3. **Secrets/vars on the Worker** (`wrangler secret put` for every secret in `.env.example`),
   minimum set: `DATABASE_URL` (Hyperdrive connection string), `APP_URL` (the staging URL),
   `WHATSAPP_TOKEN_ENCRYPTION_KEY` (fresh prod value),   `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
   `GEMINI_API_KEY`, `WHATSAPP_OUTBOX_FLUSH_TOKEN` (per ADR 0010; unset = cron endpoint is
   fail-closed disabled).
4. **Deploy**: `npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion` +
   `wrangler deploy` (or `npm run deploy` with the flag temporarily passed through).
5. **Webhook registration**: point Meta's callback at `<staging>/api/whatsapp/webhook` with the
   verify token (per `docs/m6-live-runbook.md §2`).
6. **Outbox cron**: wire the external Cron Trigger per `docs/m6-live-runbook.md §7`
   (ADR 0010 deferred step) against the staging URL.
7. Smoke: `GET /api/health` (shallow) and `GET /api/health/ready` (deep DB write + key checks)
   both return healthy.

## 4. Acceptance checks (the M7/M8 risk list, verified remotely)

Each row needs **dated evidence** appended before the pilot is called hosted:

- [ ] **Login under workerd (scrypt risk #1)**: N=2¹⁷, r=8 → ~128 MiB working set, at the
      Workers 128 MB isolate ceiling. Perform a real sign-in (seeded dev credentials), capture
      CPU/ms + memory from `wrangler tail`, and a burst of failed attempts. If it OOMs or
      throttles: escalate (external hashing microservice or, second choice, a boring Node host
      for auth) — do **not** silently weaken the hash parameters.
- [ ] **Module-level PrismaClient (risk #2)**: bump to a second sequential DB request under
      production latency (Hyperdrive or pooled TLS) and confirm no hang; keep the shared-client
      caveat in mind until replaced with a Workers-aware factory if evidence demands it.
- [ ] **Webhook path under nodejs_compat (risk #3)**: receive a *real* Meta message — HMAC
      verification + token decryption + status callbacks — then send an owner reply end-to-end
      (this also exercises the M6d send gate and its approval audit).
- [ ] **CSP/HSTS prod-only behavior**: `next.config.ts` prod CSP applies on the workers.dev URL
      (HSTS is prod-only; confirm it’s set only on a real production host, or explicitly on for
      the pilot hostname), CSP does not block the Embedded Signup SDK (M6D flows).
- [ ] **Cookies**: `__Host-` prefixed session cookie behavior verified against the staging
      scheme (https).
- [ ] **Outage queue live** (optional but recommended drill): block egress / revoke token
      permissions temporarily to force `QUEUED`, confirm the console outage banner appears, the
      queue drains on recovery, `whatsapp.provider.outage.open/closed` audits fire exactly once.
- [ ] **Logs/alerts**: `wrangler tail` observability for (a) cron endpoint auth failures,
      (b) breaker-open audits, wired to an alert channel.
- [ ] **Backup/restore**: one real restore test of the hosted DB (see §1).
- [ ] **Costs**: first billing-period read on Workers + DB costs; pilot-scale envelope noted in
      the pilot log.

## 5. Rollback & incident

- `wrangler versions list` + `wrangler rollback` — rehearse once, before the pilot (do not
  wait for an incident to learn this). The drill is scripted: **`bash scripts/rehearse-rollback.sh`**
  (run after any `wrangler deploy`, with `CLOUDFLARE_API_TOKEN` exported and `HEALTH_URL=<staging-url>`
  set for the smoke check). It captures the live version id, uploads an inert tagged version that is
  never activated, executes a real `wrangler rollback`, verifies `GET /api/health` still returns 200,
  and prints an evidence block for the checklist. Safe to re-run any time; it aborts cleanly (`exit 3`)
  while no deployment exists yet.

### 5.1 Incident surfaces the product shows by default (what "working as intended" looks like)

Incident response is partly "do you recognise the symptom in front of you?". These are the exact
states the product renders during provider or credential incidents, with where each comes from and
what the operator must NOT do about it:

| Surface | Where / default | Operator meaning |
|---|---|---|
| **Outage banner** — "Meta's messaging service has been unavailable since {time}. {n} approved replies are queued and will be sent automatically. Nothing is lost." | Owner WhatsApp inbox and conversation page (`providerDegraded { since, failures }`; ADR 0010 §6). Breaker **opens at ≥ 3 consecutive** transient Graph failures, audited once as `whatsapp.provider.outage.open`. | Provider side, not ours. **Do nothing manual** — the queue unaffected rows keep draining via the cron endpoint and opportunistic flush; check `POST /api/whatsapp/outbox/flush` responses for `breakerOpen` only to confirm, never to "unstick" anything. |
| **Queued banner** — "Your approved reply is queued — next send attempt at {nextAttemptAt}" | Per conversation (healthy backoff state), with a Cancel affordance. The send button stays disabled while an earlier queued reply exists for that conversation. | Normal behaviour under backoff. Cancelling is a deliberate owner choice, not incident response. |
| **Pilot-held banner** — "waiting — pilot paused" | A queued row stays `QUEUED` when a pilot gate holds (paused enrollment). | Business decision needed (resume enrollment), not an outage. |
| **Expired banner** — "The 24-hour service window closed before the queued reply could be sent. The customer needs to message again next time." | Terminal `FAILED` rows with `errorInfo.code = EXPIRED_WINDOW` in the last 7 days, audited as `whatsapp.send.expired`. | Data-equivalent loss avoided by design; outbound expiry is a Meta service-window rule. Tell the operator to expect the customer's next message to re-open the 24-hour window. |
| **Exhausted banner** — "Outbound retry exhausted" | Terminal `FAILED` rows with `errorInfo.code = EXHAUSTED_RETRIES` (5 transient attempts, per ADR 0010 §5). | Owner resend is the recovery; check the breaker first (if still open, resending immediately pushes into the outage again). |
| **Login throttle banner** — "Too many failed sign-in attempts. Please wait a few minutes and try again." (`LOGIN_THROTTLE_MESSAGE`, one generic message for both exceeded budgets) | Sign-in form when the ip or per-email budget trips (M8 Phase 3). Defaults: **10 / ip**, **5 / email**, **10-minute** rolling window, tunable via `LOGIN_MAX_FAILURES_PER_IP` / `LOGIN_MAX_FAILURES_PER_EMAIL` / `LOGIN_FAILURE_WINDOW_MINUTES` — audit action `auth.login.throttled` with the bucket reason only. | Expected at default budgets during repeated failures (including a burst from one shared ip — shared NAT offices can trip the ip budget even with one user). A *successful* login clears that email's history; the ip history always just ages out. Never widen the budgets mid-incident to "let someone in" — wait out the window. |
| **AI degrade to rules** — deterministic statuses (`needs_information`, `conflict_detected`, `escalation_required`) with the holding reply "I don't have confirmed information about that yet. Let me check with the business owner." | Lab/WhatsApp drafts when the AI provider is misconfigured, rate-limited, unreachable or returned invalid output. No unhandled exceptions. | Full human takeover is the correct incident posture; drafts are safely worse, never wrongly confident. |

Alert/observability anchors for these states: `wrangler tail` on `whatsapp.provider.outage.open/closed`
audits (once per transition) and the cron endpoint's auth failures (§4 "Logs/alerts" row);
`GET /api/health/ready` catches configuration/key incidents before they reach the banners.
- If Meta credentials or the encryption key are suspected compromised: rotating
  `WHATSAPP_TOKEN_ENCRYPTION_KEY` is a **key rotation runbook moment** (existing ciphertext rows
  need re-encryption before the old key is destroyed — read `lib/security/secret-box.ts`
  consumers before acting).
- Emergency stop: pause the pilot enrollment (pilot `pause` action) and/or disconnect the
  WhatsApp connection from the console — both are audited, one-click operational pulls.

---

**When every box in §0, §1, §3, §4, §5 is ticked**: record the result (URL, next evidence,
cost figures) in `docs/m7-pilot.md §7` and finalize ADR 0009’s hosting decision; then flip the
M8 Phase 4 row in `docs/m8-production-readiness.md` from “pending account inputs” to “complete”.

**Product note for that pilot (2026-10-25):** per the updated `remember.md`, the first pilot
audience is service businesses/professionals, and LightDesk frames itself as the workflow layer
on top of WhatsApp (client records, commitments, tasks, quotations). None of this changes the
infrastructure checklist above, but the workspace a pilot business signs up with should be the
one whose invitation, consent and capability flows the service-business use cases will rely on.
