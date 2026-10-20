# M6 — Official WhatsApp Integration (Specification)

Status: **Specification drafted — implementation not started.** This document is the
implementation plan for M6; it records the platform facts the design depends on (verified
from Meta's documentation on 2026-10-20) and the architectural decisions that connect the
WhatsApp Cloud API to LightDesk's existing M3/M4/M5 building blocks.

---

## 1. Goal and non-goals

**Goal.** Let a business owner connect their real WhatsApp presence to LightDesk so that
live customer messages arrive in the workspace, AI drafts replies grounded in the approved
business profile, and **the owner always retains control**: every outbound message requires
explicit owner action by default, the owner can take over a conversation at any moment, and
the AI's ability to send anything automatic is capped by a per-business permission flag.

**Non-goals for M6.**

- No automatic AI replies to customers in production. The M6 default is
  *AI drafts → human reviews → human sends*. (Automatic sending can be layered on later and
  reuses everything built here; it must never be the default.)
- No bulk/broadcast campaigns. Cloud API marketing templates exist, but M6 only needs
  **service-session replies inside an open 24-hour window**, which needs no templates at all.
- No payments invoice generation, no phone-number purchase inside LightDesk (the owner
  brings their number; M6 wires it up).

The premise of the plagiarism sentence in the brief is also addressed head-on: nothing in
M6 uses WhatsApp, its data, Meta trademarks or brand assets to misrepresent LightDesk as
official. LightDesk builds on the *officially supported* Cloud API — the same API Meta
documents for business messaging — and the product copy will make clear it is not WhatsApp
itself.

---

## 2. Verified platform facts (Meta documentation, checked 2026-10-20)

These are the facts the architecture below assumes. They are re-verifiable at the URLs in
§2.6; if any changes before implementation, this section gets amended, not silently
overridden.

### 2.1 Accounts, tokens and onboarding

- A business's WhatsApp presence is organised as: **WhatsApp Business Account (WAAC,
  "waba") → messaging "phone number ID"**, inside a **Meta Business Portfolio** behind the
  owner's Meta login. The Cloud API is driven with a **system user access token scoped to
  the WAAC/phone number** via the Graph API.
- The supported way for a third-party product like LightDesk to onboard many businesses is
  **Embedded Signup**: LightDesk becomes a **Tech Provider / Solution Partner**, hosts a
  signup screen in an iframe that the business owner logs into with their Facebook
  credentials and either registers a new number or shares an existing one, and the
  product then **exchanges a short-lived code for a business token** which must be
  upgraded to a long-lived token within 24 hours.
- The API's identity is a Graph API **webhook subscription + `messages` webhook** for
  inbound traffic and out-of-band status callbacks; **rate limits** for webhooks are a
  fixed 20 messages/second (mps) per messaging account.

### 2.2 Coexistence (owner keeps using the WhatsApp Business app)

- WhatsApp now supports **coexistence** — the business keeps using the *WhatsApp Business
  app* with the **same number**, and the Cloud API works alongside the app.
- Enabled during Embedded Signup with the **`whatsapp_business_app_onboarding`** feature
  type; there is a 24-hour history-sync period during which webhooks deliver
  `account_update`, `history`, `smb_app_state_sync` and `smb_message_echoes` topics; the
  **minimum app version for the business app is 2.24.17**; after coexistence is enabled,
  app-based companion clients can no longer be used to unlink the coexistence setup from
  their side. Cloud API throughput in coexistence is limited to 20 mps (per-account).
- **Coexistence is the assumed default for M6** at the pilot stage; many Ghanaian small
  businesses already run the WhatsApp Business app on a personal phone and cannot switch
  to the Cloud API only. This choice directly drives the UX in §3.3.

### 2.3 Pricing (effective 1 October 2026 — per-message model)

- The old "per-conversation" pricing is gone; **every business-initiated delivered message
  is now billed individually** (marketing / utility / authentication / service /
  "Meta Business Agent" categories), while **messages customers send to the business are
  free**.
- **Service** messages (free-form replies inside an open customer service window) got
  re-introduced into billing after 1 October 2026, but carry a **permanent free tier of
  1,000 service messages per messaging account per calendar month**, resetting monthly
  with **no rollover**.
- **Free-form (non-template) messages may only be sent inside a 24-hour customer service
  window** that opens when the *customer* last messaged the business; template messages
  (marketing/utility/authentication) can be sent any time but require template approval
  and cost money from the first delivered message. **M6 is designed to stay inside the
  24-hour service window with replies only** — which is the natural shape of unattended
  retail enquiries — and therefore qualifies for the 1,000 free messages/month tier,
  which comfortably covers the pilot scale.
- Ghana (Africa region) has its own pricing row in Meta's published rate-card CSVs; the
  exact cost of an out-of-free-tier **service** message for a Ghanaian number must be
  read from that rate card at implementation, not hardcoded here.
- The business selects **one billing currency for its messaging account, chosen at signup
  and not changeable later** (16 options, USD included). LightDesk will present this
  choice to the owner and default to USD.
- Meta updates pricing periodically with prior notice; the runner must surface a pricing-
  calendar notice in the UI when relevant changes affect the business.

### 2.4 Rate limits and quality

- Incoming/outgoing webhook-free per-account throttle: **20 mps (fixed)** in coexistence;
  **200 or 5,000 API calls per hour** per app per messaging account for API calls. This is
  far above a pilot's needs.
- Messaging limits (how many **unique customers** per day a number may message) start at
  1,000 and grow with **quality rating** (green/yellow/red bands) — quality is hurt mainly
  by blocks. Because M6 never sends unsolicited template messages, and replies only occur
  inside the customer-opened window, the quality risk is minimal; nevertheless a
  long-hand rating display will be shown in the business overview when available.

### 2.5 Webhooks and message delivery

- Inbound customer messages, message statuses (sent / delivered / read / failed) and
  CTA-link tracking all arrive on the Cloud API **webhook**; Meta requires webhook
  verification + signature digests (X-Hub-Signature-256 against the app's webhook secret)
  — the runner must verify at implementation-time per current docs, but the architecture
  assumes signed webhooks.
- Outbound message sending is a Graph API `POST /{phone-number-id}/messages` with
  `messaging_product: "whatsapp"`, and replies can be threaded via the inbound message's
  `id` (message context) so the WhatsApp thread stays coherent.

### 2.6 Source URLs used for this section

- `https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform`
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing`
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users`
- (implementation-time re-checks) Webhook reference, Cloud API reference, rate-limit
  reference, coexistence reference, and the current rate-card CSV for the Africa region.

---

## 3. Architecture

### 3.1 New module: `modules/whatsapp`

Mirrors the M3 module structure (`config`, `types`, `service`, plus a thin Graph API
client):

- `modules/whatsapp/config.ts` — env-driven app-level settings; missing-critical-secret
  detection via the M3 pattern (`issues: []`).
- `modules/whatsapp/graph.ts` — the ONLY place the Graph API is called. Thin, typed,
  injectable so tests can pass a fake graph like the M3 `MockProvider`.
- `modules/whatsapp/service.ts` — tenant-facing logic: connection lifecycle, inbound
  pipeline, takeover state machine, outbound sending gate.
- `modules/whatsapp/webhooks.ts` — payload parsing, X-Hub-Signature-256 verification,
  topic dispatch.

**Token security.** Business tokens are secrets: stored **encrypted at rest** (reuse the
M2/M3 secret-encryption helpers), never logged, rotatable in the UI, deleted on
disconnect. A leaked token must never reach an AI prompt.

### 3.2 Data model (additive Prisma migration — no destructive change)

```
WhatsAppConnection  one per business: wabaId, phoneNumberId, displayPhoneNumber,
                    tokenCiphertext, tokenExpiresAt, status CONNECTED|DISCONNECTED,
                    coexistence bool, connectedAt
WhatsAppMessage     one per inbound or outbound message: direction, WhatsApp wamid,
                    conversationId (FK → the same conversation table the lab uses),
                    text, type, status SENT|DELIVERED|READ|FAILED|RECEIVED,
                    category (service for free-form), costEstimate, timestampSent
InboundPipeline     whether the message was routed to AI (draft produced) or NOT
                    (owner-only conversation — see 3.3 takeover state)
```

`LabConversation`/`LabTurn` stay exactly as they are in M3/M4 — a live WhatsApp
conversation is represented by **the same draft/approval surface the owner already uses in
the lab**, so the UI work in the pre-M6 redesign pays off immediately: a live conversation
and a simulated one look and behave alike from the owner's perspective.

### 3.3 Human control model (the core of M6)

Three conversation states, controlled by the owner (never the AI):

1. **OWNER_ONLY** (default for brand-new live conversations). Inbound messages are
   displayed to the owner; no AI call happens at all. The owner drafts and sends replies
   themselves. This is the **safest default** and honours the M4 finding that small retail
   owners want to see what's happening before delegating.
2. **AI_ASSIST** (opt-in per conversation). Inbound messages additionally call the M3/M5
   retrieval + generation pipeline — the **same currency-limited code path** as the lab —
   and produce a **draft**, held in the review surface. Nothing is sent anywhere without a
   literal owner "Send" click (or the owner's assistant pressing send on their behalf in a
   later iteration). Escalation-required drafts jump straight to the mystical **escalation
   banner** so the owner sees danger even without opening the conversation.
3. **TAKEOVER** (owner action, any time). Switches a conversation from AI_ASSIST to
   OWNER_ONLY immediately; pending draft is not deleted, just clearly marked superseded.
   A one-click **"Hand back to AI"** is symmetric.

**Guardrails, reusing the M4 findings directly:**

- The **deterministic `detectTrigger` pre-check (M4 hardening) runs against every inbound
  message before any AI call**, so payment/refund/escalation claims can never silently
  produce an AI draft in production either.
- The **currency meters and per-business rate caps from M3** apply unchanged to live
  inbound traffic.
- **Every state transition** (connect, disconnect, takeover, AI-assist toggle, send) writes
  an **AuditEvent**, using the same M2 audit machinery.

### 3.4 Inbound pipeline

```
WhatsApp webhook POST
  ├─ verify X-Hub-Signature-256 (app secret)     → 403 on miss
  ├─ parse + dedupe by wamid                      → idempotent
  ├─ resolve businessId via phoneNumberId → WhatsAppConnection
  ├─ upsert conversation (mapped to owner + status OWNER_ONLY by default)
  ├─ M4 detectTrigger(message) — escalation? log + stop (no AI)
  └─ (if conversation is AI_ASSIST) run lab generation, persist as draft, notify owner
```

`wait — what if the owner replies from inside the WhatsApp Business app while coexistence
is on?` The Cloud API will echo that message as a `smb_message_echoes`/status event during
and after history sync; these echoes must be stored as outbound-but-not-via-LightDesk
facts so the owner's own WhatsApp app replies appear in the LightDesk thread view too,
without being attributed to the AI. This is a direct consequence of coexistence and is a
requirement on the pipeline, not an edge case to skip.

### 3.5 Outbound pipeline

```
Owner clicks "Send draft" (or "Edit & send")
  ├─ check conversation has open 24h customer service window (last inbound timestamp + 24h)
  ├─ if out of window → hard stop with clear UI explanation
  │     (offering a one-click template suggestion is DEFERRED, see Open questions)
  ├─ Graph API POST /{phoneNumberId}/messages (reply context = last inbound wamid)
  ├─ record WhatsAppMessage (category SERVICE, status SENT)
  ├─ metering: increment monthly service-message counter; if the 1,000-free tier for
  │  this messaging account is exhausted, show a cost warning before actually sending
  └─ audit event
```

Status callbacks (delivered / read / failed with error payload) update the
`WhatsAppMessage` record; failures surface to the owner in the conversation view with the
error reason, never raw Graph codes.

### 3.6 Onboarding UX (Embedded Signup)

Two flows, one page (`/businesses/[businessId]/whatsapp`):

1. **Connect** — Open Embedded Signup iframe (Tech-Provider-enabled app), collect the
   token exchange, verify what we got (phone number ID, expected capabilities), run a
   **live "can we send to this number" pre-flight check** against the connected test
   number where possible, then present the **billing-currency choice** and a summary of
   the numbers LightDesk will hold.

2. **Settings** — display connection status, token state (expiry + rotate button),
   disconnect, per-conversation takeover/AI-assist controls explained in plain language,
   and the monthly service-message meter.

### 3.7 Testability

- `modules/whatsapp/graph.ts` is dependency-injected; all unit tests use a `FakeGraph`
  that records graph calls the way `MockProvider` records AI calls (M3 pattern).
- Integration tests cover: webhook signature verification, inbound dedupe, automatic
  OWNER_ONLY default, AI_ASSIST producing a *draft* and **never auto-sending**, takeover
  hand-off mid conversation, 24-hour-window enforcement on send, meter increments, audit
  completeness, token unavailability producing a safe no-send failure and an audit event.
- Live smoke script `scripts/m6-live-verify.ts` — runs the real Embedded-Signup-provided
  test number in the developer app, wires one conversation, and sends/receives
  round-trips once the runner provides real credentials (same trust level as the M3 live
  script).

---

## 4. Phased implementation plan (inside M6)

| Phase | Delivers | Gate before next |
|---|---|---|
| **M6a** | Data-model migration + `modules/whatsapp` skeleton + `FakeGraph` unit tests + audit hooks | typecheck/lint/tests green |
| **M6b** | Webhook endpoint with signature verification + inbound graph-echo handling + OWNER_ONLY default + draft/approval reuse | integration tests incl. signature failure, dedupe |
| **M6c** | AI_ASSIST + takeover state machine, reusing the M3 generation + M4 pre-check + meters | integration tests incl. escalation never auto-sends |
| **M6d** | Outbound send gate (24h window, metering, status callbacks) + Embedded Signup UI + onboarding docs | full `npm run check` + live smoke script with runner-provided credentials |

---

## 5. Runner prerequisites (before M6b/M6d can be truly live)

LightDesk's operator (the project owner) must, outside the codebase:

- Create/verify a **Meta developer app** with WhatsApp product access and **Tech
  Provider / Solution Partner** status in a **verified Business Portfolio** (required for
  Embedded Signup to show to end businesses).
- Configure a webhook URL + verify token on the required Cloud API topics after the
  endpoint goes live; set the required env values (`WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`,
  and the two `CRYPTO` secret envs needed by the decryption helpers).
- Decide the **pilot phone number strategy** with the pilot business: their existing
  WhatsApp Business app number under coexistence, or a dedicated new Cloud API number.

Until those exist, Phase M6d's Embedded Signup and the live smoke tests are necessarily
script-prepared but **not executed**; that is an honest limitation recorded in
`remember.md`, not something the code should paper over.

---

## 6. Open questions (to settle with the project owner before M6c)

1. **Notifications** — when a new live message or escalation draft lands, does the owner
   want an in-app bell, an email, or a WhatsApp message to the owner (out-of-band, via
   their own number, requiring another WAAC)? Defaults chosen: in-app only in M6c;
   email is the first likely follow-up.
2. **Multi-admin messaging** — if the business has more than one LightDesk member the
   to see live conversations, can any member send the draft (with the same owner-level
   approval), or is sending strictly owner-only? Default chosen: OWNER/ADMIN can send,
   audited individually.
3. **Off-window handling** — when a customer messages at hour 25 after their last inbound,
   the 24-hour free-form window is closed. Default chosen for M6: LightDesk marks the
   conversation *window closed* in the UI, adds a "you can reply from your own WhatsApp
   app under coexistence" callout, and does NOT send anything automatically. Template
   sending (which costs money) is deliberately deferred to a later milestone.
4. **Image/location products** — M6's core is text; images a customer sends are stored by
   reference (media-ID) and shown as a placeholder. Supporting image replies
   (catalogue-photo answers!) needs M5's already-built catalogue photos in the
   graph payload — a natural follow-up inside this milestone if time allows.

---

## 7. Assistant communication & escalation policy (owner-provided, 2026-10-20)

The project owner supplied a persona brief for the assistant core. It is recorded here as
M6 product material, mapped onto the building blocks that already exist; parts describing
the owner's own operational ecosystem (internal org, client-outreach pipelines) are
*excluded from the codebase on purpose* — LightDesk ships as a product for arbitrary
businesses, so it must not encode one company's internal identity.

| Owner requirement | Implemented through |
|---|---|
| Direct, professional, peer-level tone; **no generic fluff** (no "Hello! I'm an AI…") | M2 approved `greeting` / `tone` / `sign_off` entries + a system-prompt instruction that assistant drafts are to-the-point; drafts rendering in the lab review panel enforce scannable, mobile-friendly short paragraphs |
| Concise, WhatsApp-optimized formatting (short paragraphs, minimal bullets) | Reply-draft prompt rule: no heavy markdown (WhatsApp plain text), short paragraphs; the draft length cap already in the M3 generation config applies to live replies too |
| Never assume pricing/timelines/architecture; ask targeted questions when underspecified | Structural enforcement, not just a prompt rule: prices may only come from approved M5 catalogue items with evidence; underspecified asks land in `NEEDS_INFORMATION` with `missingInformation` listed, asking the customer a targeted question |
| Instantly escalate on: complex custom-engineering sign-off, customer frustration, requests for founder/human intervention | Extends the M4 deterministic pre-check: new trigger classes (sign-off requests: "custom build", "bespoke", "quote/approval for a project"; frustration/insults; "talk to a human/boss/owner") escalate to the owner BEFORE any AI call — same RULES path, zero tokens |
| Route to human review for anything sensitive | Already the M6 default: OWNER_ONLY conversations + explicit owner send gate (§3.3); the pre-check above only widens what never reaches the AI |

Implementation notes: the escalation-phrases list is per-business config (owner-editable in
the BIP escalation entry) merged with safe *floor* triggers that ship enabled for every
business; everything decisive stays deterministic so no AI token is ever spent on a
message that was always going to a human.
