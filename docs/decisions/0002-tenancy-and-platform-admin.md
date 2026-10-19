# ADR 0002 — Tenancy via membership; platform admin has no data access

**Decision.** Shared database, shared schema; isolation by mandatory membership checks in
`modules/permissions/access.ts`. Platform admins can create businesses and see their names, but the
first owner joins by OWNER invitation and admins hold no membership, so they cannot read tenant data.
Non-members receive 404 (not 403) to avoid revealing which businesses exist.

**Alternatives rejected for M0.** Row-level security (good defence in depth; deferred because Prisma
pooling + per-request `SET LOCAL` needs design and verification — candidate for M1); schema-per-tenant (operational cost).
