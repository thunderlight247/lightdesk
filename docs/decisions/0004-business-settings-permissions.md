# ADR 0004 — Business settings: split update/rename permissions

**Decision.** `business:update` (OWNER, ADMIN) covers description and location; `business:rename` (OWNER only)
covers the name, because the name is the business's public identity and what members/invitees see.
`updateBusiness` checks `business:update` first, then `business:rename` only if the name actually changes, and
refuses before writing anything. Audit records field names, not values (descriptions can be long and free-form).

**Rejected.** Letting admins rename (weaker least-privilege); one all-or-nothing `business:manage` permission
(coarser, harder to extend for M2+); storing before/after values in the audit log (privacy, size).
