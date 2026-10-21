# M7 — Pilot Operations Runbook (incident, support & monitoring)

Companion to `docs/m7-pilot.md`. The pilot-phase promise to every participating owner is
**honest operation**: no capability is claimed that isn't live, restricted capabilities turn off
deterministically, and every incident maps to a concrete console or CLI action. Where this file
and code disagree, the code is authoritative.

## 1. Monitoring

**Where:** platform console `/admin/pilot` (OWNER of the platform role only). Counters only —
customer message content never leaves the tenant.

Watch these at least **daily during onboarding weeks**, then weekly:

| Signal | Where | Concern threshold |
|---|---|---|
| Open conversations vs escalated | pilot console, "Escalated"/"Open" | a business with many escalated and zero answered sends needs owner contact |
| Failed sends (`whatsapp.message.failed`) | pilot console "Failed sends" | > 3 in a row for one conversation → Meta issue; call owner |
| AI calls today vs cap | pilot console | cap-exhausted businesses: if legitimate workload, raise cap with the owner (owner can also do it themselves up to the ceiling) |
| Outbound this month vs cap / vs 1,000 free tier | pilot console + owner settings page | approaching Meta's 1,000 free service tier = cost boundary; verify volume growth before raising |
| Audit events | per-business `Business → audit` | `pilot.send.blocked` / `pilot.cap.blocked` frequency tells you caps are doing real work |
| Provider health | `whatsapp.draft.failed` audits + Graph errors | clusters of TOKEN/HANDLER/CONFIG errors = integration issue, not AI quality |

## 2. Incident procedures

### 2.1 Emergency degrade (suspected wrong/unsafe behavior)
If the AI is producing wrong answers for a business, or anything unsafe is observed: **set every
conversation of that business to OWNER_ONLY** (owner's console: takeover button per conversation),
**then** set the pilot to PAUSED (`/admin/pilot` → Pause) so no conversation can be handed back
while it is investigated. Wrong-answer reports arrive via the pilot feedback form — pair each
"wrong answer" or "missed escalation" report with the conversation id referenced, reproduce with
the audit trail (`whatsapp.draft.generated` metadata includes status, evidence count, usedAi).

### 2.2 Suspected data incident
Pilot console exposes counters only, so the first step is the audit trail and the report itself:
1. Ask the reporter (via their feedback entry or open conversation) for the exact view they saw.
2. Check the audit log of the *other* tenant for a same-minute `whatsapp.*` event.
3. If cross-tenant exposure is confirmed: PAUSE the pilot globally (admin → Pause each business),
   write the timeline into `remember.md` immediately, and stop all sends until reviewed.

### 2.3 Meta / Graph outage
Owner's own sends from the WhatsApp Business app are unaffected (that is the coexistence
fallback by design). If Graph errors spike: pause drafting (admin Pause), notify owners in
plain language ("Meta is currently failing our requests; you can reply from your normal WhatsApp
app — nothing is lost"), resume after the failure rate drops. Never mass-retry sends; both web
and send controls are idempotent per wamid.

### 2.4 AI provider outage / degraded quality
`whatsapp.draft.failed` + `LabGeneration`/`WhatsAppGeneration` `errorKind` distinguishes
TIMEOUT/CONFIG/HANDLER. CONFIG = our env/keys; HANDLER = provider-side (often rate limits).
Behavior is safe by design: the customer gets nothing, the owner sees the failed attempt.
If a provider must be disabled, changing `AI_PRIMARY_PROVIDER` is a code/config change (§5 of
`remember.md`) — coordinate a window with owners, in OFF hours; no automatic fallback model
switch is permitted without explicit owner authorization.

### 2.5 Cap exhaustion / usage spikes
Cap-exhaustion is audited `pilot.cap.blocked` — it is a FEATURE, not an alarm. Steps: contact the
owner, understand growth (new products? viral customer?), have THEM raise their caps (self-serve,
owner up to the platform ceiling) when the usage is legitimate. Never raise caps silently for
cost reasons the owner didn't accept.

## 3. Support etiquette

- Honest time expectations: LightDesk is an assistant that drafts and a *person* sends.
  Nothing is sent without the business's explicit click; say so plainly to pilot owners.
- No guarantees about WhatsApp delivery times or Meta pricing until verified in the current
  official rules (see M6 runbook caveat): answer pricing questions from the live rate card.
- Privacy: treat conversation access as delegated owner authority — LightDesk users on the
  platform side have NO access to business conversations, and administration is counters-only.
- Feedback loop: every pilot console feedback entry is displayed in `/admin/pilot`; triage
  categories weekly ("wrong_answer" and "missed_escalation" first — they are safety signals).

## 4. Disconnect / offboarding

Owner-side (`/whatsapp/settings` → Disconnect) removes the WhatsApp connection but keeps
conversation history and leaves enrollment intact (owner can reconnect later). Full pilot exit
(OWNER leaves via the pilot panel, or admin → Exit) blocks all restricted capability
immediately; the enrollment row, caps and feedback are kept for evidence. Re-enrollment after
EXITED reopens consent — it never silently reactivates.
