# Architecture (Milestone 0)

A single Next.js application (modular monolith) backed by PostgreSQL via Prisma. No microservices,
no separate Go backend.

## Layers
- `app/` — pages, server actions, route handlers. Parse input, call a module, render/return. No
  business rules, no direct tenant queries.
- `modules/` — business logic. `permissions` (roles, membership checks), `identity` (credentials,
  bootstrap), `businesses` (businesses, invitations), `audit`, `business-profile` (Business Intelligence Profile: catalogue, lifecycle, evaluator, service).
- `lib/` — cross-cutting: `auth` (sessions, guards), `db` (Prisma client), `security` (tokens,
  passwords, errors, origin, redirects), `validation` (Zod schemas).

## Route boundaries
| Area | Rule |
|---|---|
| `/login`, `/invite/[token]`, `/api/health` | Unauthenticated allowed. |
| `/businesses/**`, `/admin/**` | Middleware redirects cookie-less visitors (UX only). `(workspace)/layout` requires a valid session server-side. Each page then requires membership / platform-admin. |
| `/businesses/[id]/settings` | Page needs `business:update` (members see an explanation); the server action and `PATCH /api/businesses/[id]` re-check; renaming needs `business:rename` (owner). |
| `/businesses/[id]/profile/**` | Read for every member (`profile:read`); edits need `profile:edit` (owner, admin); approvals, activation, suspension and AI-permission changes need `profile:approve` (owner). Every server action re-derives membership; layouts are navigation only. |
| `/api/businesses/**` | Session required; membership + permission checked per request; mutating routes also check `Origin`. |

## Security boundaries
1. **Deny by default.** `can()` allows only listed (role, permission) pairs; unknown input → false.
2. **Server-side authorisation.** Every business resource is reached through
   `requireMembership/requirePermission(userId, businessId, …)`. Client-supplied business ids are
   never trusted; queries that take a second id (e.g. invitation id) are also scoped by `businessId`.
3. **No existence oracle.** Non-member and non-existent business both yield 404 with identical text.
4. **Tenant isolation.** No code path grants cross-tenant reads. Platform administrators create
   businesses but have no implicit access to business data.
5. **Secrets.** Session and invitation tokens are 256-bit random, stored only as SHA-256 hashes.
   Passwords use scrypt (N=2^17, r=8, p=1). Audit metadata strips secret-looking keys. Error
   handlers log error class only.
6. **Single-use invitations.** Acceptance is one transaction whose conditional `UPDATE … WHERE
   acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > now` is the gate.
7. **Admin bootstrap.** CLI only, advisory-locked, refuses if an admin exists.
8. **Transport/headers.** `Referrer-Policy: no-referrer` (tokens live in invite URLs), nosniff,
   frame deny. Cookies: HttpOnly, SameSite=Lax, Secure + `__Host-` prefix in production.

## Platform vs business policy
`modules/permissions/platform-policy.ts` is code-level policy that sits above anything a business can store.
A business can only narrow what the platform allows: enabling a prohibited capability is refused at save,
refused again at approval, and ignored when effective permissions are computed.

## Invitation delivery
No email provider is selected, so **email is not sent**. The creator sees a one-time link (UI) or
receives it in the API response (`POST /api/businesses/:id/invitations`) and must pass it on privately.

## Known limitations (honest list)
- No login rate limiting / lockout yet (needs shared store; add before any public exposure).
- No password reset, email verification, MFA, or session listing/revocation UI.
- No CSP header (needs nonce plumbing with Next.js); only the headers above.
- Next.js middleware is advisory only; authorisation does not depend on it.
- Last-owner protection (cannot remove/demote the final OWNER) is not implemented because M0 has no
  membership removal or role change.
- Expired sessions/invitations are filtered at read time; no scheduled purge yet
  (`purgeExpiredSessions()` exists, unscheduled).
- scrypt uses ~128 MiB per hash; concurrent logins can pressure memory without rate limiting.
