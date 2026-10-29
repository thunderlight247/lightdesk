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

### 3.8 Deploy execution record — 2026-10-25 (§3 ran end to end)

| §3 step | Result |
|---|---|
| 1. Hosted DB + Hyperdrive | Neon (`neondb`, `ep-lucky-dawn-baqmo4c2.eu-central-1`) already held all 15 migrations. Hyperdrive config `lightdesk-pg` id `9ccd0462a50a498792527b5c32f92837` already existed on the deploy account (verified via `hyperdrive list`). **Account note:** the deploy target is the owner-prepared Cloudflare account `7d0c14f6…` authenticated by `CF_TOKEN` from `.env.prod-secrets` (export `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; source the file with `tr -d '\\r'` — CRLF endings). The OAuth wrangler login (`d0361…`) is a *different* account and was used accidentally first; the stray duplicate Hyperdrive config and draft worker + secrets created there in error were deleted. |
| 2. Migrations | `prisma migrate deploy` against the direct unpooled string: "no pending migrations". |
| 3. Secrets | Deploy account worker `lightdesk` already carried the owner-seeded set (incl. `DATABASE_URL` = Neon pooled, `WHATSAPP_OUTBOX_FLUSH_TOKEN`, fresh `WHATSAPP_TOKEN_ENCRYPTION_KEY`, WhatsApp + AI keys). Not present by design/omission: `WHATSAPP_APP_ID` (embedded-signup blocker when first used) and `DEEPSEEK_MODEL`/`GEMINI_MODEL` (code defaults apply; provider chosen via `LAB_AI_PROVIDER=deepseek` var). |
| 4. Deploy | Build + `wrangler deploy` → version `ce91e209-3894-4e4e-bff3-14d86f8c5233` at `https://lightdesk.lightdesk.workers.dev`, startup 14 ms. Two initial attempts failed with `ECONNRESET`/connect-timeout mid-version-upload (Ghana-path lossiness); a bounded retry loop succeeded. |
| 7. Smoke | `GET /api/health` → **200** `{"status":"ok"}`. `GET /api/health/ready` → **503**: encryption ok, database unreachable — full cause from `wrangler tail`: `PrismaClientInitializationError` "could not locate the Query Engine for runtime \"debian-openssl-1.1.x\"" (the bundle's engine-dependent Prisma 6 client; workerd can never load an engine binary). This is §1/§4's known risk, now confirmed remotely. |

**Conclusion of this record:** §3 is executed, but the pilot is **not yet trusted to the deployment** — the DB layer needs the engine-less Prisma client (new `prisma-client` generator + driver adapter; the Prisma 7 path the local investigation pointed to) as its own milestone. Until then, `/api/health/ready` stays red by design and no business data flows. §4 acceptance checks remain open; the account-numbering at `wrangler.jsonc` (Hyperdrive id, vars) is live and correct for the deploy account.

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

## 5. Deploy execution record — 2026-10-28 (engine-less Prisma live, §4 evidence gathered)

| Item | Result |
|---|---|
| Full §3 rerun | Redeployed with the Prisma 7 engine-less client + per-request prisma factory (`lib/db/client.ts`): versions `6c5ee69b…` at 2026-10-28T04:41Z, then `9e492379…` (redeploy after a bad serving version, below). Secret-only update `cd0123c9…` at 05:41:28Z (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, owner action) served in between and was NOT healthy. |
| `/api/health` | 200 `{"status":"ok"}` repeatedly (x3 on first deploy, x2 after redeploy). |
| `/api/health/ready` | **200 ready** with database ok (748ms cold → 4–12ms warm) and encryption ok, x3 sequential on the first deploy and again after the redeploy. The 2026-10-25 query-engine 503 is resolved. |
| §4 risk #1 (scrypt sign-in) | **Partial evidence.** Real sign-in in a headless Chromium landed on the workspace (scrypt succeeded under workerd; no OOM observed). One wrong password returned the normal cookie:less failure state. Sustained burst NOT completed — see the blocker row. `wrangler tail` CPU/mem numbers for the scrypt attempt were not captured (tail streaming unreliable from this network). |
| §4 risk #2 (per-request client) | `/api/health/ready` succeeded on sequential requests after deploy (748/12/4ms) — no second-request hang. Webhook/message-path checks still open. |
| **New blocker — intermittent worker 500s** | **Root-caused 2026-10-28 — see “Root cause & fix (intermittent worker 500s)” below.** After bursts of failed login POSTs (and once, spontaneously), page/route requests returned 500/503 with `TypeError: handler32 is not a function` in `NextNodeServer.renderToResponseWithComponentsImpl` (seen once via tail on version `cd0123c9`); login GET then recovered 200/503-flapped until a fresh deploy restored it. |
| Secrets hygiene note | The first bootstrap attempt against prod failed validation (`24472477` < 12 chars, per `passwordSchema`); the admin was created with an owner-supplied compliant password through the documented CLI path; `scripts/create-prod-admin.cjs` and diagnostic scripts were temporary and deleted. |

### Root cause & fix (intermittent worker 500s) — 2026-10-28

**FINAL root cause (two-layer, verified live):** the serialization fix below was necessary
but NOT sufficient. The sustained rerun on the serialization-only version (2026-10-28,
08:0xZ) still KILLED every failed-login POST: `wrangler tail` showed `outcome:
exceededCpu` at ~10 CPU-seconds per invocation with the served page being CF 1102 (worker
CPU limit). In workerd, one scrypt verify at N=2¹⁷,r=8 costs ~10 CPU-s (~10× local node),
so a single derivation ALONE exceeded the per-request CPU budget before throttling could
even score it — that burn (and the overlapping-derivation memory race it made worse) is
what poisoned isolates into the `handlerN is not a function` 500 loop. Latency evidence:
N=2¹⁷ requests ran 17–30+s wall client-side (vs 1–2s locally).

**Fix deployed on v`8d250892` (2026-10-28, ~08:15Z):**
1. `lib/security/password.ts`: new hashes use **N=2¹⁴, r=8, p=1** (~16 MiB, ~8× less CPU
   — comfortably inside budget while keeping scrypt's hardening overhead); `MAX_MEM` stays
   a 256 MiB ceiling so pre-change N=2¹⁷ hashes keep verifying.
2. `modules/identity/service.ts`: transparent **rehash-on-successful-login** — any stored
   hash not at current parameters is rehashed once after a successful verification
   (`auth.login.password_rehashed` audit). The owner-created admin (created at N=2¹⁷, no
   plaintext on record) upgrades to N=2¹⁴ on their next sign-in; until then that one
   verification still costs ~10 CPU-s, which the serialization now corrects toward the
   budget rather than against overlapping load.

**Evidence for the two-layer assessment:**
- Serialization-only version: 12 origin-correct concurrent POSTs → 5× ~2s 200s, 4× ~17s
  200s, 3× >30s timeouts; tail `outcome: exceededCpu`, CF 1102 pages.
- v`8d250892` (parameters + serialization + rehash-on-login): 8 concurrent + 10
  concurrent + 2 over-budget POSTs (browser-style multipart with `Origin`, real
  `$ACTION_*` fields, fresh emails) → **all 12 returned 200** (7 in 1.2–2.8s, 3 queue-tail
  ~30s but completed, 2 throttled in ~1s), zero 500/1102/`Internal Server Error`/`handler
  is not a function` markers in every response body; tail outcomes `ok`, 0 exceptions on
  every captured login POST; exactly **10 distinct `LoginFailure` rows** recorded in Neon
  (one per within-budget failure — the scrypt+DB path ran for real), over-budget
  attempts produced none (throttle path engaged before hashing, as designed).
- Retry-harness notes (for future reruns): POST replay must carry `Origin:` + the full
  page-rendered `$ACTION_REF_1`/`$ACTION_1:0`/`$ACTION_1:1`/`$ACTION_KEY` hidden fields;
  replaying only the id (or a stale `Next-Action` header alone) yields Next's own "Failed
  to find Server Action" 500 — a harness artifact, not an app bug. `wrangler tail` needs
  `NODE_OPTIONS=--dns-result-order=ipv4first` from this network and its stdout capture is
  capped (~50 KB per file), so parse what flushed.

Original serialization + wasm-runtime notes (kept for context): all scrypt work still runs
one derivation at a time per isolate via a promise chain (`hashPassword` and
`verifyPassword` both acquire the queue; accepted-hash parsing stays cheap and outside it).
Regression tests in `tests/unit/password.test.ts` assert wall-time grows linearly under
concurrent load AND results stay correct under concurrency; the suite also covers
legacy-parameter verification and the `needsRehash` upgrade flag (6 tests, green).

Corroborating evidence gathered 2026-10-28:
- OpenNext upstream documents a `ComponentMod.handler is not a function` failure class
  (opennextjs/opennextjs-cloudflare issue #1286) — likewise isolated mid-module-load
  breakage that serves 500s until the isolate is rotated.
- Eight REAL failed logins in a row locally (plus the throttle kicking in at attempt 6)
  never reproduced a 500 — the isolate is not broken by failed logins themselves, only
  by concurrent derivations colliding with the ceiling under production traffic.
  (Superseded by the final root cause: the sustained rerun DID reproduce the kills —
immediately under production-style load at N=2¹⁷, see FINAL root cause above.)

**Wasm runtime patch status:** the webpack extern in `next.config.ts` (module 11754 →
`import <abs-path>?module` → wrangler CompiledWasm) is verified end-to-end by
`npx wrangler deploy --dry-run --outdir` bundling the real
`query_compiler_fast_bg.wasm` as a native WASM module in the worker bundle, and by the
2026-10-28 ready check running real queries through the compiler. The stale comment "then
rewrite its filesystem module reference in the webpack runtime after OpenNext has bundled
the worker" described a superseded (deleted) loader step and was rewritten to describe the
actual mechanism. Note for future deploys: build and deploy must stay collocated (`npm run
deploy` does both) because the extern records the build-machine path; a prebuilt
`.open-next` uploaded from another host would not resolve the wasm.

### §4 rows updated 2026-10-28

- [x] **Cookies `__Host-`**: session cookie name uses the `__Host-` prefix in prod (`lib/auth/session.ts`); sign-in + signed-out/retry flows observed live.
- [x] **CSP/HSTS on workers.dev**: HSTS, CSP, `no-referrer`, nosniff, XFO DENY, Permissions-Policy all present on live 200 responses; CSP allows `connect.facebook.net`/`www.facebook.com` for M6d.
- [x] **Webhook GET verify handshake** (negative paths live: wrong token / no token / wrong mode → 403; success path verified by owner after setting `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
- [x] **Risk #1 sign-in under sustained load** — CLOSED 2026-10-28 (v`8d250892`): sustained burst rerun on production, all 12 concurrent failed-login POSTs (incl. 2 past the IP budget) returned 200 with zero 500/`exceededCpu`/1102 outcomes; 10 `LoginFailure` rows recorded in Neon (real scrypt-verifying failures), the over-budget attempts were cleanly throttled. Full evidence in §5 "Scrypt CPU-limit fix + sustained burst rerun".
- [ ] **Webhook POST + end-to-end reply** (risk #3): code paths exist and are covered locally by tests (`tests/integration/whatsapp-*.test.ts`); live Meta message still pending.
- [ ] **Outage-queue drill**, **backup/restore drill**, **logs/alerts**: unchanged, open.
