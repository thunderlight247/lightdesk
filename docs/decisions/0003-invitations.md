# ADR 0003 — Invitation design

- Token: 256-bit random, shown once, stored as SHA-256; delivery is manual in M0 (documented, not faked).
- TTL: `INVITATION_TTL_HOURS` (default 72).
- Acceptance: one transaction; conditional UPDATE is the single-use gate; failure rolls back any user created.
- New invitation to same business+email revokes the previous pending one (partial unique index guarantees ≤1 pending).
- Invitee email comes from the invitation, never from the client. Existing accounts must sign in as that email.
- Role ceiling: you can grant roles up to your own; ADMIN cannot invite OWNER.
- All failure reasons share one generic message; the specific reason is kept for logs/tests.
