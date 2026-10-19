# ADR 0005 — BIP: per-row working + approved values, rules by data type

**Decision.** Each profile row stores the working value and the last approved value, plus a state (DRAFT/APPROVED). Consumers read only approved values.
Materiality is decided by data type (facts/policies/permissions material; communication instructions not), with a narrow cosmetic exception (case/whitespace).

**Why not whole-profile versions (publish a snapshot).** Simpler to reason about, but every harmless edit would need re-publishing, approving one FAQ would require approving
everything else, and a pending change would hide the approved state. Per-row approval keeps approved knowledge in force while a change is reviewed.
**Why not one JSON document.** No per-field constraints, provenance, approval state or querying.
**Why TEXT values.** Every M2 field is one bounded string; richer structure (hours per weekday, price lists) belongs to later, explicitly scoped work.
**Trade-off.** No full "restore previous version"; history lives in the audit log. Acceptable for M2; revisit when conversational setup needs diffing.

**Invariants enforced in the database as well as the service:** APPROVED ⇒ approved value exists and equals the working value; approval provenance is all-or-nothing;
SUSPENDED ⇒ reason; ACTIVE ⇒ activation timestamp.
