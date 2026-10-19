# M2 — Business Intelligence Profile (BIP)

The BIP is the structured, owner-governed source of truth for one business. It is **not** a prompt:
facts, instructions, procedures and AI permissions are separate modules with different rules.
M2 builds the management experience and the governed data; it does not answer anyone or send anything.

## Modules
| Module | Content | Kind | Rule |
|---|---|---|---|
| Identity | business category, service area, public phone, public email | fact | material |
| Products & services | one descriptive summary (not a price list, not stock) | fact | material |
| FAQs | question, approved answer, category, active flag | fact | question/answer material; category/active not |
| Communication | tone, formality, response length, primary + other languages, greeting, sign-off, preferred wording | **instruction** | applied on save |
| Policies | opening hours, delivery, returns, appointments, handing over to a person | policy | material |
| AI permissions | answer routine enquiries, use approved knowledge, prepare suggested responses, send automatically, escalate to a human | permission | material, owner-only |

Name, description and location are *not* duplicated: they stay on the business record (Settings).
Fixed keys keep M2 bounded; custom policies are a known limitation.

## Draft vs approved
Each row has a working value and an approved value. Consumers only ever read approved values.
- **Material** change → saved as `DRAFT`; the previous approved value stays in force until an owner approves.
- **Cosmetic** edit (case/whitespace only) to an approved value → applied directly. Digits and punctuation are never cosmetic.
- **Communication** preferences → applied on save (they are instructions, not facts). Still unused until the profile is ACTIVE.
- **Unknown** = no row. It is shown as "Not provided" and never filled in. Clearing returns a field to unknown.
- Approving a FAQ is refused while another active FAQ for the same question has a different answer. Nothing is auto-resolved.

## Lifecycle
`DRAFT → REVIEW_REQUIRED | ACTIVE`, `REVIEW_REQUIRED → DRAFT | ACTIVE`, `ACTIVE → SUSPENDED`, `SUSPENDED → ACTIVE | DRAFT`.
Anything else is rejected by the server (`lifecycle.ts`).
- Submit for review / return to draft: owner or admin. Activate, reactivate, suspend, move suspended → draft: **owner only**.
- Activation requires: business category, products & services summary and the handing-over policy all **approved**, and **no unresolved FAQ conflicts**. (Required items were chosen as the minimum a conversation needs: what the business is, what it offers, and a route to a human.)
- Suspending requires a reason (stored on the profile). A suspended or non-active profile yields **no** approved snapshot.
- An active profile's required approved items cannot be cleared; suspend first.
- Pending changes on an ACTIVE profile do not interrupt it; the approved values stay in force.

## Completeness
A transparent checklist, not a percentage: **required** items, **recommended** items (hours, delivery, returns, appointments, tone, one approved FAQ — each may stay unknown),
conflicts, and everything awaiting approval, each linking to its section.

## Authorization
| Action | Owner | Admin | Member |
|---|---|---|---|
| View profile | ✔ | ✔ | ✔ |
| Create profile, save drafts, FAQ create/edit/(de)activate, communication prefs, submit/return, discard pending change, delete/clear *unapproved* items | ✔ | ✔ | ✘ |
| Approve entries/FAQs, approve all, activate/reactivate/suspend, clear/delete *approved* items, **any AI-permission change** | ✔ | ✘ | ✘ |

All checks run in `modules/business-profile/service.ts` from the session user's server-side membership. Entry/FAQ ids are always looked up
*within the business's own profile*, so another business's ids resolve to "not found". Roles, states, approval flags and actor ids are never read from the client.

## Platform restrictions
`modules/permissions/platform-policy.ts` forbids `send_messages_automatically` in this release. A business cannot enable it (refused on save and on approval),
and `getApprovedProfileSnapshot` computes each capability as `platform allowed AND owner-approved enabled` (default false), so even a manually edited row has no effect.

## Provenance and audit
Rows record created/updated/approved by + at and a revision counter; the profile records who last changed its status. Audit events (`profile.created`,
`profile.entry.saved|approved|cleared|discarded`, `profile.faq.*`, `profile.status_changed`) record *what kind* of change, never values (phone, email, answers).
Permission changes record the capability and the enabled flag only.

## For later milestones
`getApprovedProfileSnapshot(businessId)` returns `null` unless the profile is ACTIVE; otherwise only approved values, approved + active FAQs and effective capabilities.
It is not user-scoped: call it only from trusted server code that has already decided which business it is acting for.

## Verification (fill in after running; do NOT use `docker compose down -v`)
```bash
npm run db:migrate && npm run check
```
| Command | Result |
|---|---|
| `npm run db:migrate` (2 additive migrations) | Passed: 5 migrations applied, already in sync, no drift |
| `npm run lint` / `npm run typecheck` | Passed: 0 errors (1 cosmetic warning); typecheck clean |
| `npm run test:unit` | 33/33 passed |
| `npm run test:integration` | 98/98 passed (includes 25 profile service and 9 profile security) |
| `npm run build` | Passed (profile routes present) |
| Manual browser pass (owner / admin / member) | Passed for the owner, as reported by the project owner: empty-profile blockers, approving required items, activation, checklist, pending-change display, FAQ conflict handling, AI permissions page with the platform restriction. Admin and member views were not checked in the browser (covered by the automated security tests) |

## Limitations
- Fixed catalogue of keys; no custom policies, no per-weekday opening-hours structure, no multi-language content per entry.
- Opening hours and policies are free text, so conflicts are only detected between FAQ entries, not between FAQs and policies.
- No version history viewer: history is the audit log plus per-row provenance; there is no "restore previous version".
- Approve-all is best-effort per item; concurrent edits are last-write-wins with a revision counter (no optimistic lock UI).
- Provenance user ids have no FK (see `data-model.md`).
- Conversational onboarding is not implemented; guided forms write the same structured rows it would.
