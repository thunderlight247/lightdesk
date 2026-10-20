# LightDesk — Milestone 0 foundation

Multi-tenant AI business conversation assistant for small retailers in Ghana.
**Milestone 0 only**: repository, auth, tenancy, invitations, tests, docs. No WhatsApp, no AI,
no catalogue imports, no billing, no customer conversation data.

> **Status:** M0 (foundation) is approved by the project owner. M1 (business workspace) is complete. M2 (Business Intelligence
> Profile) is implemented but **not yet verified by a test run** — see `docs/roadmap.md` and `docs/m2-bip.md`.

## Stack
Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL 16 · Prisma 6 · Zod · Vitest.
Dependency ranges in `package.json` are caret ranges chosen from memory; commit the lockfile after
the first `npm install` and review versions. See `docs/decisions/` for the one material deviation
(custom session layer instead of a third-party auth library).

## Local setup
Prerequisites: Node ≥ 20.11, npm, Docker (or any PostgreSQL 14+ you can create two databases in).

```bash
cp .env.example .env                 # edit only if you changed docker-compose values
docker compose up -d                 # creates DBs: lightdesk and lightdesk_test
npm install                          # also runs `prisma generate`
npm run db:migrate                   # applies migrations to the dev DB
```

### Bootstrap the first administrator (CLI only — there is no HTTP endpoint)
```bash
read -s BOOTSTRAP_ADMIN_PASSWORD && export BOOTSTRAP_ADMIN_PASSWORD   # type password, min 12 chars
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" npm run bootstrap:admin
unset BOOTSTRAP_ADMIN_PASSWORD
```
It refuses to run if a platform administrator already exists.

### Run
```bash
npm run dev     # http://localhost:3000
```
1. Sign in as the administrator → **Admin** → create a business + owner email.
2. Email is **not** operational in M0. The page shows a one-time invitation link; copy it and send it
   privately. Open it (private window) to register as the owner.
3. The owner can invite admins/members from **Members & invitations** (same one-time-link flow).

## AI conversation lab (M3)
Optional. Without a Gemini key the rest of the app works and the lab shows a configuration state (rules-based replies still work). Add placeholders to `.env`
(never commit real values):
```
GEMINI_API_KEY=""            # server-side only; create one in Google AI Studio
GEMINI_MODEL="gemini-3.5-flash"   # must be in the server-side allowlist (modules/lab/config.ts)
LAB_AI_TIMEOUT_MS=30000
LAB_RATE_USER_PER_MINUTE=6
LAB_RATE_BUSINESS_PER_HOUR=60
```
The test suite never needs a key: it uses a deterministic mock provider. Drafts are **simulation only**; nothing is sent to any customer.

## Quality gates
```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration   # needs Postgres up; uses TEST_DATABASE_URL, applies migrations itself
npm run build
npm run check              # all of the above
```
Integration/security tests **fail (never skip)** if `TEST_DATABASE_URL` is missing. The DB name must
contain `test` because the suite truncates tables. In CI, set the env var directly (the `dotenv -e .env`
wrapper is only for local files).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Invalid environment configuration: DATABASE_URL` | `.env` missing/unloaded; `cp .env.example .env`. |
| `P1001 Can't reach database` | `docker compose ps`; port 5432 busy? change the port in compose + `.env`. |
| `lightdesk_test` does not exist | The init script only runs on first volume creation: `docker compose down -v && docker compose up -d` (**wipes dev data**) or `docker compose exec db createdb -U lightdesk lightdesk_test`. |
| `prisma migrate dev` reports drift / wants a new migration | The two migrations were hand-written. Run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow-url>`; if it only shows differences you didn't intend, regenerate `20261017000000_init` with `prisma migrate dev --create-only` on an empty DB and keep migration 2 (rename it to sort after). Report back before proceeding. |
| `Refusing to run: test database name…` | Safety guard; point `TEST_DATABASE_URL` at a DB whose name contains `test`. |
| `memory limit exceeded` from scrypt | Increase `MAX_MEM` in `lib/security/password.ts` only if you also raise container memory. |
| Login works but you bounce to /login in production | `__Host-` cookies need HTTPS; serve over TLS. |
| `bootstrap:admin` "A platform administrator already exists" | Intentional. Use the UI/invitations for everyone else. |

## Layout
See `docs/architecture.md`. Short version: `modules/*` hold business rules and are the only code that
queries tenant data; `app/*` is thin (pages, actions, route handlers) and always calls those modules.
