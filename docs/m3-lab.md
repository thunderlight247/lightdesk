# M3 — AI Conversation Laboratory

A testing environment where an authorised user simulates a fictional customer, receives an AI-drafted reply built **only from the approved Business Intelligence Profile**,
inspects the evidence, and approves a reply *inside the simulation*. It is not a messaging system: **nothing is ever sent to a real customer or channel.**

## Core principle and how it is enforced
LightDesk must never invent business facts, make unauthorised commitments, or let a model override business rules. Prompt wording is not relied on; the rules below are application code.

| Layer | What it does | Where |
|---|---|---|
| Source of truth | Only `getApprovedProfileSnapshot` (ACTIVE profile, approved values, approved + active FAQs, effective permissions) is ever used. Drafts, pending changes, inactive FAQs and non-active profiles are invisible to the lab. | `service.ts` |
| Owner permissions | Drafting needs the owner-approved AI permissions **Use approved business knowledge** and **Prepare suggested responses**; otherwise the AI is not called. `Send messages automatically` is platform-forbidden and unused. | `service.ts`, M2 platform policy |
| Deterministic pre-checks | Greetings, explicit requests for a person, complaints, payment/refund claims and instruction-override attempts are handled by rules **without calling the AI**. | `rules.ts` |
| Minimal retrieval | Keyword/topic scoring over the approved snapshot (no vector DB): relevant FAQs (max 5), relevant policies, a small baseline. Each item gets a server ref (E1…). No relevant approved info ⇒ **no AI call**, holding reply, "needs information". Prices/stock (not modelled in the BIP) never reach the AI unless an approved FAQ/policy addresses them. | `retrieval.ts` |
| Conflicts | Retrieved FAQs whose approved answers differ ⇒ `conflict_detected`, **no AI call**, holding reply, escalation. Never chosen arbitrarily. | `retrieval.ts`, `rules.ts` |
| Prompt separation | Trusted instructions in `system`; business facts, preferences, history and the customer's words are JSON **data** in `user`. No secrets, env values or other tenants' records are ever included. | `prompt.ts` |
| Output contract | Zod-validated JSON (`replyDraft`, `status`, `reason`, `evidenceRefs`, `missingInformation`, `escalationReason`). Malformed ⇒ a safe holding reply + escalation ("Provider output failed validation"). No model confidence score is requested or used. | `result.ts` |
| Evidence | Model-cited refs are resolved against the records the **server** retrieved; unknown refs are dropped; shown evidence is the server's snapshot, never model text. `answerable` without verified evidence is downgraded. | `result.ts` |
| Grounding guards | Figures in a reply must appear in the approved evidence or the customer's own message; commitment phrases (discount, "% off", free delivery, guarantee, refund approved, payment confirmed…) must be mentioned by approved info. Otherwise the draft is replaced by the holding reply. Heuristic defence in depth, not a proof. | `rules.ts`, `result.ts` |

Holding reply: "I don't have confirmed information about that yet. Let me check with the business owner."

## Statuses and escalation
`answerable`, `needs_information`, `conflict_detected`, `escalation_required`. Any non-answerable result escalates the conversation (reason recorded). Users can also flag a conversation
for human follow-up; **owners** resolve escalations (resolved conversations are closed and read-only). Provider failures (config, rate limit, timeout, provider error) are *not* business escalations:
no draft is created and a retry is offered.

## Review flow
Customer message → draft (state DRAFT, source AI or RULES) → an **owner** approves it for the simulation, optionally editing. The original draft is never overwritten
(`content` vs `approvedContent`, "edited" shown). Only customer messages and **approved** replies are fed back as context; unapproved drafts are not. A new customer message supersedes a pending draft;
"another draft" supersedes it only once a new one exists.

## Authorization
| Action | Owner | Admin | Member |
|---|---|---|---|
| View lab and conversations | ✔ | ✔ | ✔ |
| Create conversation, send message, request/regenerate draft, flag follow-up | ✔ | ✔ | ✘ |
| Approve a draft, resolve an escalation | ✔ | ✘ | ✘ |
| Delete a conversation | any | own only | ✘ |

Roles come from the existing M0/M1 membership model. Every query is scoped by business and conversation id; other tenants' ids resolve to "not found". Provider and model are **never** request inputs.

## Cost, limits and resilience
- Input ≤1000 chars, reply ≤1200, output tokens ≤1024, ≤50 customer messages and ≤100 conversations per business, history ≤10 turns / 4000 chars.
- Per-user (default 6/min) and per-business (60/hour) limits, counted from `LabGeneration` rows (database-backed; no Redis). Slightly racy under heavy concurrency; documented.
- Idempotency key per submission + at most one in-flight generation per conversation (partial unique index); stale in-flight rows expire after 2 minutes.
- At most one retry, only for transient 5xx/network failures; none for rate limits or configuration errors. Timeout default 20 s.
- Usage (tokens, latency, model, provider) is stored per generation; **NULL means "not reported", never zero**. No monetary cost is invented.
- Logs record error classes only; conversation text is never logged. Audit events record what happened, never message content.

## Configuration
Server-side environment variables only (placeholders in README): `GEMINI_API_KEY`, `GEMINI_MODEL` (allowlist in `modules/lab/config.ts`), `LAB_AI_PROVIDER`, `LAB_AI_TIMEOUT_MS`,
`LAB_RATE_USER_PER_MINUTE`, `LAB_RATE_BUSINESS_PER_HOUR`. Invalid or missing AI settings never break the rest of the app: the lab shows a configuration state. The key is sent in a request header
(never a URL) and never appears in responses, logs or errors.
Gemini is called over its REST `generateContent` API with JSON `responseSchema`, via `fetch` (no new dependency; see ADR 0006). Model names change over time: re-check the allowlist against Google's current model list
before relying on it.

## Privacy
Draft requests send the minimum needed (relevant approved facts, preferences, recent turns, the customer message) to the configured **external provider (Google Gemini)**. Review that provider's data-handling terms and your
account's plan before using any real customer information; this milestone uses fictional/anonymised test data only and makes no claim about the provider's retention or training policies. Conversations can be deleted by their creator
(admins) or any owner.

## Out of scope (future)
Live WhatsApp or any channel, sending anything to real customers, channel-level human takeover, autonomous actions, product catalogue/stock/price data, vector retrieval, billing/plan enforcement, multi-provider routing, conflict detection between FAQs and policies.
Dependencies for later work: a real conversation store and channel adapter (M4+), structured price/stock data, and an agreed provider data-processing position.

## Verification (fill in after running; do NOT use `docker compose down -v`)
```bash
npm run db:migrate && npm run check
```
| Command | Result |
|---|---|
| `npm run db:migrate` (2 additive migrations) | PASSED (7 total migrations applied, schema up to date) |
| `npm run lint` / `npm run typecheck` | PASSED (0 errors, 1 warning in config) |
| `npm run test:unit` | PASSED (8 files, 60 tests) |
| `npm run test:integration` (includes lab service + security) | PASSED (10 files, 145 tests) |
| `npm run build` | PASSED (Next.js production build succeeded) |
| Live provider test with `GEMINI_API_KEY` | PASSED (Tested against `gemini-3.5-flash` with structured schema) |

## Known limitations
- Retrieval is keyword-based: paraphrased questions can miss a relevant FAQ (safe failure: "needs information").
- The numeric/commitment guards are heuristics; they can block a legitimate figure the approved text writes differently (e.g. words vs digits).
- Rules-based triggers use English keyword patterns only.
- Gemini behaviour (structured output, usage fields, model names) was written against its public REST documentation but **not exercised against the live API in this environment**.
- Rate limits are approximate under bursty concurrent load.
