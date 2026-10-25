# ADR 0011 — Hosted PostgreSQL for the Cloudflare pilot

## Status
**Accepted (owner sign-off 2026-10-25 — Neon via Hyperdrive).** (The initial Cloudflare evaluation and
the Next.js hosting notes live in `docs/decisions/0009-nextjs-16-upgrade-evaluation.md` and
`docs/m7-pilot.md §7`; they do not pick a database.)

## Decision
**Neon** (scale-to-zero Postgres), connected to the Worker via Cloudflare **Hyperdrive** using
Neon's **direct (unpooled) TCP connection string** in the Hyperdrive config — the exact pattern
Cloudflare documents for Workers + Prisma on their Neon integration page (hyperdrive needs direct
TCP; Neon's HTTP/websocket serverless driver is *not* the path). Neon's own pgbouncer endpoint can
serve as the fallback if Hyperdrive is dropped.

### Runner-up options, in order
1. **Supabase** — also works with Hyperdrive or its own pooled endpoint; Pro is ~$25/mo plus
   per-project cost. Rejected for now on price for a small pilot whose DB is the only paid piece
   we *need*; revisit if the project later wants its dashboard/auth/storage extras anyway.
2. **PlanetScale Postgres** — fixed clusters from ~$5/mo, always-on (no scale-to-zero);
   official Hyperdrive writeup. Rejected for now only because scale-to-zero matches
   Ghana-time bursty pilot traffic better and Neon's free tier covers it.

## Evidence for the choice (checked 2026-10-25)
- Hyperdrive is **included** in both Free and Paid Workers plans (official pricing page) — the
  connectivity layer adds no bill line item by itself.
- Neon is usage-based (Launch ~$0.106/CU-hour) with a functional free tier; the pilot's traffic
  (business-hours bursts) is exactly what scale-to-zero prices well. Community durability reports
  on the free tier are acceptable for a pilot — production data still gets backup drills (below).
- Prisma 6 keeps working against a direct TCP endpoint via the existing integration tests'
  connection-string model; the Workers-specific Prisma shape (driver adapter vs Accelerate vs
  plain client over Hyperdrive) is the open implementation question the deploy acceptance checks
  are designed to answer empirically (`docs/m8-cloudflare-deploy-checklist.md §1/§4`).

## Conditions this decision carries
- The connection string is stored only in Worker secrets (never committed;
  `docs/m8-cloudflare-deploy-checklist.md §3`).
- A dedicated **branch or separate database** named with `test` in it backs integration test
  runs (`TEST_DATABASE_URL`) so tests never touch the pilot data — Neon branching makes this a
  one-click addition.
- One backup/restore drill happens **before** any pilot business consents, and a second before
  real customer conversations are trusted to it (checklist §1/§4).
- Costs get a first billing-period reading after the pilot's first week so the numbers are real.

## Sign-off
Recorded as accepted on 2026-10-25. The §1 gate in `docs/m8-cloudflare-deploy-checklist.md`
for the hosting platform is clear. Provider creation of the Neon project + provisioning of the
`DATABASE_URL` / Hyperdrive binding remain the remaining pre-requisites before §3 step 1.
