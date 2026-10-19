# M1 — Business Workspace

## Behaviour
- **Landing (`/businesses`)**: cards for each business the user belongs to (name, location, role badge); a
  clear empty state when the user has no memberships. Platform admins get a pointer to the separate admin area.
- **Business chrome** (`/businesses/[id]/…` layout): business name + role, "Switch business" list (only when the
  user has more than one), section tabs (Overview, Members, Settings — Settings only if permitted).
- **Overview**: name, status, location, description, member count, workspace ID (slug), created date. Unset
  fields show "Not set" — nothing is invented.
- **Settings**: name (owners only), location, description. Members see an explanation, not a form.
- **Platform admin** stays separate: its own header chip and page ("Platform administration"); it grants no
  access to business data (ADR 0002).
- States: loading skeleton, error boundary (no internals shown), generic 404 (covers "not a member"), pending
  button state, field-level validation errors, success/failure alerts with correct ARIA roles.

## Authorisation (all server-side)
| Capability | OWNER | ADMIN | MEMBER |
|---|---|---|---|
| View overview / members (`business:read`, `members:read`) | ✔ | ✔ | ✔ |
| Edit description, location (`business:update`) | ✔ | ✔ | ✘ |
| Rename business (`business:rename`) | ✔ | ✘ | ✘ |
| Manage invitations (`invitations:manage`) | ✔ | ✔ | ✘ |

- `getBusinessOverview` and `updateBusiness` start with `requireMembership` / `requirePermission`; the business
  id from the client is never trusted. A non-member gets the same 404 as a missing business.
- An unauthorised rename throws **before any write**, so a mixed request (rename + description) changes nothing.
- Inputs: `updateBusinessSchema` is `.strict()` — `slug`, `status`, `id` etc. are rejected; control characters
  are rejected; empty description/location clears the field.
- Capabilities returned to pages are for rendering only; the server action and `PATCH /api/businesses/[id]`
  re-check independently. The API also enforces same-origin.
- Audit: `business.updated` with `metadata.fields` (field names only, never values); no event for no-op saves.

## Data
One additive migration: `20261018000000_business_identity_fields` (nullable `description`, `location` + length
CHECKs). Applied with `npm run db:migrate`; existing data is untouched.

## Decisions
- Only name/location/description are editable: the minimum identity that the current schema supports plus two
  nullable columns. Slug and status are not editable in M1 (slug is a stable workspace ID; status is a platform
  concern). No BIP fields were added.
- Split `business:update` / `business:rename` for least privilege (ADR 0004).

## Verification commands (run from the repo root; do NOT use `docker compose down -v`)
```bash
npm run db:migrate        # applies the additive M1 migration to the dev DB
npm run lint && npm run typecheck && npm run test && npm run build
```
Results: record below once run.

| Command | Result |
|---|---|
| `npm run db:migrate` | Passed (additive migration applied, no drift) |
| `npm run lint` | 0 errors, 1 cosmetic warning |
| `npm run typecheck` | Passed |
| `npm run test:unit` | 20/20 passed |
| `npm run test:integration` | 64/64 passed |
| `npm run build` | Passed |
| Manual browser pass (landing, overview, settings as owner/admin/member, switcher) | Passed: member (no Settings tab, direct URL shows the permission message) and owner (edit saved, visible to member) checked in browser; long-text overflow fixed; over-500-character validation covered by automated tests only; admin not checked |

## Limitations
- No rename/ownership transfer flow, no logo/contact fields, no business status management UI.
- Settings form has no optimistic update or unsaved-changes warning.
- Concurrent edits are last-write-wins.
- Login rate limiting and the other M0 limitations still apply.
