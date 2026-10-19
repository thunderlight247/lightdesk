# Data model

| Model | Purpose | Key constraints |
|---|---|---|
| `User` | Person who can sign in | unique `email`; CHECK email lowercase/trimmed, 3–254 chars; `isPlatformAdmin` default false; `status` ACTIVE/DISABLED |
| `Session` | Server-side login session (added beyond the brief; required by DB-backed sessions) | unique `tokenHash`, CHECK 64 hex chars; cascade on user delete; indexes on `userId`, `expiresAt` |
| `Business` | Tenant | unique `slug`, CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤63 chars; `status` ACTIVE/SUSPENDED; M1: optional `description` (CHECK ≤500 chars) and `location` (CHECK ≤120 chars) |
| `BusinessMembership` | User ↔ Business with `role` OWNER/ADMIN/MEMBER | **unique (businessId, userId)**; FKs cascade; index on `userId` |
| `Invitation` | Single-use, expiring invite | unique `tokenHash` (CHECK 64 hex ⇒ plaintext can't be stored by accident); CHECK email normalised; CHECK `expiresAt > createdAt`; CHECK `acceptedAt` and `acceptedById` both null or both set; CHECK not (accepted AND revoked); **partial unique index** one pending invite per (businessId, email) |
| `AuditEvent` | Append-only record of consequential actions | indexes (businessId, createdAt), (actorUserId, createdAt), action; FKs SET NULL so history survives deletions; metadata is secret-stripped JSON |

## M2 — Business Intelligence Profile

| Model | Purpose | Key constraints |
|---|---|---|
| `BusinessProfile` | One per business; lifecycle `status` DRAFT / REVIEW_REQUIRED / ACTIVE / SUSPENDED, `revision`, status provenance | unique `businessId` (FK cascade); CHECK suspended ⇒ non-empty `statusReason` (≤300); CHECK active ⇒ `activatedAt` set |
| `ProfileEntry` | Keyed, validated singleton facts/instructions/policies/permissions. `module` IDENTITY / OFFERINGS / COMMUNICATION / POLICY / PERMISSION, `key`, working `value`, last `approvedValue`, `state` DRAFT / APPROVED, provenance (`createdById`, `updatedById`, `approvedById`, `approvedAt`), `revision` | unique (profileId, module, key); CHECK key format, value length 1–1000; CHECK approval fields all-or-nothing; CHECK `state=APPROVED` ⇒ `approvedValue` present and equal to `value` |
| `FaqEntry` | Repeatable knowledge: question, answer, category, `isActive`, `normalizedQuestion` (conflict detection), working vs approved wording, provenance | indexes (profileId, normalizedQuestion), (profileId, isActive); CHECK lengths; CHECK approval fields all-or-nothing; CHECK `state=APPROVED` ⇒ approved wording present and equal to current |

Design notes:
- **Source of truth per field.** Business name, description and location stay on `Business` (M1). The profile never duplicates them.
- **Working vs approved.** Every content row stores what the editor last saved AND the last approved value. Consumers read only approved values (`getApprovedProfileSnapshot`). A pending change never replaces the approved value until approved.
- **Unknown is absence.** No row = not provided. Nothing is pre-filled; permissions default to disabled by *absence of an approved "enabled"*.
- **Why not one JSON column.** Per-field state, provenance, approval and validation would be unqueryable and unconstrainable. Values are plain TEXT validated per field by the catalogue (`modules/business-profile/catalog.ts`); structure beyond one string per field is intentionally avoided in M2.
- Provenance user ids are plain columns (no FK): users are never hard-deleted, and the authoritative history is the `AuditEvent` log. Revisit if user deletion is introduced.
- Migrations: `20261019000000_business_profile` (enums, tables, indexes, FKs) and `20261019000100_business_profile_constraints` (CHECKs). Both only add objects; no existing table is altered.

Migrations (earlier milestones): `20261017000000_init` (tables, enums, indexes, FKs),
`20261017000100_integrity_constraints` (CHECKs and the partial index, which Prisma cannot model) and
`20261018000000_business_identity_fields` (M1, additive: nullable `description`/`location` + length CHECKs; existing rows untouched).
No customer conversation data is stored in M0.

Not enforced in the database (enforced in services + tests): role-escalation limits, email match at
acceptance, "no membership for suspended business".
