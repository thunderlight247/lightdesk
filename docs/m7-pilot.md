# Milestone 7 — Controlled Pilot

## Overview

M7 pilots LightDesk with a **limited number of real businesses** on the official WhatsApp
integration built in M6 (see `remember.md` §8 M7 and `docs/m6-whatsapp.md`). The owner has made
two scoping decisions for this milestone (2026-10-21):

1. **All M7 gaps are implemented in code, not just documented procedures.** Pilot consent and
   onboarding, usage/spend caps, monitoring, and feedback capture are DB-backed application
   features with tests.
2. **Cloudflare is now the hosting path to evaluate.** A real deployment of *this* application
   is attempted and verified against the `remember.md` §7 hosting checklist before any pilot
   business is onboarded.

Pre-existing safety controls — OWNER_ONLY conversation default, the owner send gate, the takeover
state machine, deterministic pre-checks, grounding guards, per-business hourly AI cap, and the
1,000/month send meter — are all already live (M6); M7 does not rebuild them, it wraps a pilot
control layer around them.

---

## 1. Pilot enrollment & consent gate (DB-backed)

Additive migration introducing a one-row-per-business pilot state:

```prisma
model PilotEnrollment {   // naming per existing schema conventions, confirmed at implementation
  id                 String   @id @default(cuid())
  businessId         String   @unique
  status             String   @db.VarChar(20)   // PENDING_CONSENT | ACTIVE | PAUSED | EXITED
  consentTextVersion String   @db.VarChar(40)   // version of the pilot terms accepted
  consentById        String   @db.VarChar(30)   // the owner who consented
  consentAt          DateTime?
  pausedReason       String?  @db.VarChar(200)
  categoryId?        String?                    // short pilot category note (optional)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

Rules:

- **Enrollment is platform-admin-only** (`scripts`/admin console), never self-serve in M7: a
  business enters `PENDING_CONSENT`, and **no restricted capability activates until an OWNER of
  that business explicitly consents in the console**, recording `consentById`/`consentAt` and the
  terms version shown. Consent is revocable by the owner at any time (→ `EXITED`, audited).
- **Gate behavior:** while `status != ACTIVE`, `setConversationMode` refuses AI_ASSIST and the
  send gate reports "pilot not active" as its reason. OWNER_ONLY takeover and every manual
  owner send remain possible only after consent — conservatively, nothing restricted works
  without consent.
- Tenant isolation identical to the rest of the app: enrollment records are scoped by
  `businessId`; non-members get the identical no-existence response. Platform admins can list
 /diagnose but **never access business conversation content** (§4 architecture rule).
- Every lifecycle change is audited (`pilot.consented`, `pilot.paused`, `pilot.exited`).

## 2. Usage / spend limits (hard, configurable)

M6 already meters AI calls (per-business hourly cap) and sends (1,000/month tier). M7 adds a
**hard, per-business, owner-visible cap layer** that cannot be outgrown silently:

```prisma
model UsageCaps {
  businessId        String @id
  aiCallsPerDay     Int                       // default from platform policy
  outboundPerMonth  Int                       // default under the free 1,000 message tier
}
```

- Enforced **in server code** at both enforcement points (assist generation and the send gate):
  when a cap is reached, the action is refused *before* any AI call or Graph request, with a
  distinct honest reason, and audited (`cap.blocked.*`).
- Caps default to conservative pilot values set at enrollment; OWNER can raise them up to a
  platform policy ceiling (`modules/permissions/platform-policy.ts` pattern — a business can
  only narrow, never exceed, what the platform allows). Every change is audited.
- Both caps are surfaced on the owner console next to the existing meters.

## 3. Cross-business monitoring surface (platform admin)

A read-only `/admin/pilot` console for platform admins:

- Enrollment list + status, consent state, consent date/version.
- Per-business cap usage (AI calls today, sends this month vs caps).
- Conversation health: open conversations, escalated/unanswered counts, drafts pending.
- Failure indicators: `whatsapp.message.failed` counts, provider error categories, recent
  audit events (no message *content*).
- **No conversation content crosses tenant boundaries** — counters and metadata only.

## 4. Feedback capture

- A small owner-facing feedback form on the pilot console: category (worked well / wrong answer /
  missed escalation / confusion / other), optional free text, one entry per submission, stored
  per business and listed for platform admins in the monitoring surface.
- Feedback is never auto-suggested to the AI; it is an owner→platform channel only.

## 5. Incident & support runbook (`docs/m7-pilot-ops.md`)

Procedures for: emergency degrade (set all conversations OWNER_ONLY), disconnection/reconnection,
Meta or Graph outage, AI provider outage/error spikes, suspected data incident, cap exhaustion,
and support etiquette with a pilot owner (time expectations, no promises about delivery).
The runbook maps each incident to the exact console action that resolves it.

## 6. Grounded-claims verification during the pilot

- Pipeline guards already block ungrounded figures/commitments (M3/M5). During the pilot this is
  **verified, not rebuilt**: the monitoring console shows escalations and blocked-draft counts so
  the weekly pilot review answers, per business: Were customer-facing replies grounded? What was
  escalated and why? Findings land in the pilot log in `remember.md`.

---

## 7. Deployment: Cloudflare evaluation (owner decision: evaluate now)

> Status herein reflects research on **2026-10-21** against official docs; the actual deploy
> attempt narrated and appended below the line as it happens.

### Current official paths (Cloudflare Workers docs, Aug/Oct 2026)

| Path | Status | Fit |
|---|---|---|
| **vinext** (new CF-recommended default) | **beta**; targets Next.js 16 apps; `npx vinext check` for compatibility | Repo is Next 15.5 — must run the check and review the compatibility dashboard |
| **OpenNext adapter** (`@opennextjs/cloudflare` ~1.20) | Documented for existing apps with compatibility gaps | Closest match for an existing Next 15 app; formerly the preferred adapter |
| Static Pages | static-export only | **Not usable** — this app is server-side |

### Risks already identified (must be verified empirically)

1. **scrypt password hashing vs. the 128 MB per-isolate memory limit.**
   `lib/security/password.ts` uses OWASP params (N=2¹⁷, r=8 ⇒ ~128 MiB working memory per hash),
   exactly at the hard Workers memory ceiling (128 MB, unchanged on the paid plan). Community
   reports confirm password hashing OOM/limits are a real pain point on Workers. Mitigations if
   it fails: an extract auth-hashing microservice, or the "boring Node host" fallback. **Login
   must be measured for memory and CPU, not assumed to work.**
2. **Prisma client lifecycle.** The Workers guide (verified 2026-10-21) is explicit: a
   module-level shared client hangs the second request; Workers requires a per-request client
   (or a serverless client variant). Our `lib/db/client.ts` is a module-level PrismaClient, so a
   deployment either swaps in a Workers-aware client factory behind the same import or accepts
   Accelerate-style proxying. Migration flow (`prisma migrate deploy`) runs from CI/CLI, not the
   Worker.
3. **node:crypto surface** (HMAC webhook verification, AES-GCM token box, hashing): available
   under `nodejs_compat`, but exercising the *live webhook path* (signature + token decrypt)
   from a real deployed Worker is part of the acceptance.

### Evaluation checklist (from `remember.md` §7)

Build & deploy from the actual repo → auth/session/cookies → server actions & API routes →
Prisma queries & migration deploy → external Postgres connectivity + pooling (Hyperdrive or
direct driver adapter; the local Docker DB is not reachable in production) → env/secrets → webhook
durability & idempotency → logs/alerts → backup/restore for a hosted DB → cost at pilot scale.

### Local evaluation results (2026-10-21, real repo, repo untouched except adapter scaffold)

| Check | Result |
|---|---|
| `vinext check` static compatibility | **100% compatible** (18/18 supported, 0 issues). But `vinext@1.3.0` requires **Vite 8** while this repo's Vitest 3.2.7 caps Vite at ^7 — peer conflict, `npm install` refuses. vinext stays blocked until either vinext relaxes, Vitest updates, or the test stack is split. |
| OpenNext adapter build (`opennextjs-cloudflare build`) | **Succeeded** on the first corrected run: full route bundle + middleware (34 kB) → `.open-next/worker.js`. Required the `--dangerouslyUseUnsupportedNextVersion` override only because Next.js 15.5 is now past its own support window (see last row). The OpenNext scaffold (`open-next.config.ts`, `wrangler.jsonc`, dev-only `initOpenNextCloudflareForDev` import in `next.config.ts`, `public/_headers`) stays as the working deployment vehicle; build artifacts are gitignored. || Prisma queries inside workerd | **Verified empirically**: `previewInvitation` token lookup executed through the module-level PrismaClient inside `wrangler` (workerd + `nodejs_compat`), rendering the invalid-invite page (nonexistent token → null path). Multiple sequential DB-backed requests completed without the documented shared-client hang in local dev. The production behavior must be re-verified remotely (Hyperdrive/direct TLS, per-request client considerations). |
| Login POST exercise with wrong credentials | Server-action POST without the Next-Action header only re-renders the form; real scrypt verification under workerd is **not yet exercised** — needs a live login (owner-provided dev credentials or a seeded eval user). |
| Webhook path under workerd | Not yet exercised locally; part of the deployed acceptance (HMAC + secret-box decrypt under `nodejs_compat`). |
| Next.js 15.5 support status | `next build` on its own policy warns 15.5.28 is past the 2-year major support window (Next 15 support ends Oct 2026). The repo now relies on the override flag. **Upgrade to Next 16 belongs on the M8 list** (and would unblock vinext peers possibly). |

### Remaining runner inputs for the deployed phase

- Cloudflare account access (`wrangler login` or an API token; account/zone IDs).
- A hosted PostgreSQL for the pilot (decision recorded in ADR 0009 once evaluated; connection
  string supplied into `.env` only, never committed).

---

## 8. Phasing & gates

| Phase | Content | Gate |
|---|---|---|
| P0 | §1–§6 code + tests + `npm run check` | full suite green; tenant-isolation tests included |
| P1 | Cloudflare deploy of the real app to a staged workers.dev URL; hosting checklist results live | checklist observed, ADR 0009 records the pilot-hosting decision |
| P2 | First pilot business onboarded (consent recorded, caps set), monitored | §3 console shows the business; ops runbook dry-run |

**Out of scope for M7:** billing (M9), M8 full security review, unbounded automation, template
marketing sends. Expand only when pilot evidence supports it.
