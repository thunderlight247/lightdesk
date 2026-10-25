# ADR 0009 — Next.js 16 upgrade evaluation (M8 Phase 4)

## Status
**Evaluated — approved, to be executed as the first step of the Phase 4 deploy.**
Researched 2026-10-24 against Next.js 16.4.3 (current minor), the Next.js 16 upgrade guide,
and `@opennextjs/cloudflare` 1.20.12 (the version installed in this repository).

## Context
The M8 specification lists "Evaluation of Next.js 16 upgrade to remove legacy build warnings and
unblock native Cloudflare adapter optimizations" (Phase 4). The app currently runs:

| Package | This repo (current) | Next 16 requirement |
|---|---|---|
| next | ^15.5.0 (15.5.28) | 16.4.x target |
| react / react-dom | 19.1 | 19.2 (Next 16 App Router requires 19.2) |
| @types/react, @types/react-dom | ^22 / 19.x | bump to 19.2 line |
| TypeScript | 5.6 | ≥ 5.1 — satisfied |
| Node | ≥ 20.11 (engines) | ≥ 20.9 — satisfied |
| @opennextjs/cloudflare | 1.20.12 | peer range `>=15.5.28 <16 \|\| >=16.4.1` — covers our exact version into 16.4.1+ |

The adapter peer range is the decisive compatibility fact: **no adapter upgrade and no interim
Next minor are needed** — 15.5.28 jumps straight to 16.4.1+ with the installed 1.20.12.
The adapter docs state all minor/patch versions of Next.js 16 are supported, **including
Turbopack builds**, and (per docs, May 2026) Next 14 support is dropped.

## Codebase assessment: what the breaking changes actually touch

Verified against the current code — most Next 16 breaking changes are already handled or absent:

| Next 16 change | Impact here |
|---|---|
| **Async Request APIs: synchronous access fully removed** (`cookies()`, `headers()`, `params`, `searchParams`) | **None.** Every usage is already awaited and params are `Promise`-typed (M0 was built that way; no sync-compat leftovers). No codemod needed. |
| **Turbopack becomes the default bundler for `next dev` AND `next build`; a custom webpack config fails the build** | **None blocking.** `next.config.ts` defines no `webpack` key, so the default Turbopack build is legal. Turbopack builds are explicitly supported by the Cloudflare adapter. Benefit: the legacy-build deprecation warnings from 15.x disappear. |
| **`middleware.ts` → `proxy.ts` rename** (edge runtime is NOT supported in `proxy`; runtime is nodejs and non-configurable) | **Trivial migration.** Our `middleware.ts` is a Node-compatible cookie bounce only. Rename file + `middleware` export to `proxy`, keep `config.matcher`. Note: OpenNext lists Node Middleware (15.2) as unsupported, but our file uses neither `runtime` API nor middleware functions beyond the basic proxy contract. |
| **`revalidateTag` requires a cacheLife profile; `updateTag`/`refresh`/`cacheLife`/`cacheTag` stabilize** | **None.** We use only `revalidatePath` (settings/lab/profile actions), which is unchanged. |
| **`cacheComponents` (PPR) replaces `experimental_ppr`** | **None.** We do not use PPR. Everything dynamic is `force-dynamic` today; PPR is a later optional optimization, not part of this upgrade. |
| **next/image defaults** (minimumCacheTTL 4h, qualities [75], localPatterns for query strings, maxRedirects 3, local-IP restriction) | **None.** The codebase never imports `next/image` or `next/legacy/image`. |
| **Parallel route slots require `default.js`** | **None.** No `@slot` conventions in `app/`. |
| **ESLint plugin defaults to flat config** | **Already aligned.** We use `eslint.config.mjs` flat config with the bare ESLint CLI (`npm run lint` never calls `next lint`). |
| **Concurrent dev/build output split (`.next/dev`), lockfile against concurrent instances; build metrics removed from output** | **Low impact.** One discipline note: don't run `next dev` and `next build` expecting shared output. The removed First Load JS metrics only affect build-report cosmetics. |
| **`next.config` loaded once in dev** (`process.argv` no longer contains `dev`) | **None.** Our config-file bottom line calls `initOpenNextCloudflareForDev()` unconditionally and does not inspect `process.argv`. |
| **Turbopack filesystem caching enabled by default (dev + build artifacts on disk)** | **Watch CI disk/persistence.** Disable via `experimental.turbopackFileSystemCache*` if it causes CI churn. |
| **React 19.2 features (View Transitions, Activity, useEffectEvent)** | Available, none used; no action. |

### Residual risks (things to verify at upgrade time, not blocking findings)
1. **Turbopack + Prisma server bundling.** Server-only dependency graph (prisma, `node:crypto`,
   scrypt) must stay external in server bundles under Turbopack the way webpack did. Verify by
   `npm run build` + an OpenNext preview smoke test hitting `/login`, one business page, and the
   webhook route before deploying. If Turbopack misinterprets the module graph, the documented
   escape hatch is `next build --webpack` (adapter still supports it) while a proper config is found.
2. **React 19.2 + `@types/react` bump.** Minor type fallout is possible; standard `npm run typecheck` gate covers it.
3. **Adapter surface.** 1.20.12 is the same version already validated locally in M7
   (`docs/m7-pilot.md`); only the Next major changes underneath it.

## Decision
**Upgrade to Next.js 16.4.x ahead of the production deploy, staying on `@opennextjs/cloudflare`
1.20.12 unchanged.** Justification:

- Direct peer-compatible path, zero new adapter version risk.
- The upgrade is *almost* mechanical for this codebase: dependency bumps + the middleware rename
  + reinstalling typegen types. Every hard breaking change (async APIs, webpack, cache APIs,
  image defaults) is already in the "already handled / not used" column.
- It removes the legacy build warnings flagged in the M8 spec and lands us on the runtime the
  adapter now invests in (Next 14 support dropped Q1 2026; 15.5 is the last 15.x line).
- Cheap and reversible: the change set is `package.json` + lockfile + one file rename — a single
  revert restores 15.5.

### Execution plan (~half a day including full quality gates)
1. Bump the framework packages: `next@16.4.x`, `react@19.2`, `react-dom@19.2`, matching `@types/react*`;
   run the official codemod as a cross-check (`npx @next/codemod@canary upgrade latest`) — it
   renames middleware → proxy and updates config flags we don't customise.
2. Manual rename: `mv middleware.ts proxy.ts`, rename export `middleware` → `proxy` (same matcher).
3. Full gates: `npm run lint && npm run typecheck && npm run test && npm run build`
   (this now exercises the Turbopack default build).
4. `npm run preview` (OpenNext local preview) — smoke-test: login, one `force-dynamic` workspace
   page, `/api/health`, `/api/health/ready`, and the WhatsApp webhook signature path against a
   local Postgres. Only then mark Phase 4's framework task done.
5. If Turbopack chokes on server bundle externals (risk #1): fallback to `next build --webpack`
   temporarily and file the follow-up; do NOT block the deploy on upstreaming a fix.

## Rejected alternatives
- **Stay on 15.5.** Works today with the adapter (`<16` branch of the peer range), but leaves the
  known deprecation warnings and collects upgrade debt while upstream moves on; re-enters the same
  evaluation every minor. No remaining blocker justifies carrying the debt.
- **Migrate to `vinext`.** Cloudflare now recommends it *for new apps*, but OpenNext remains the
  supported maintenance path for existing Next 15/16 apps, and this repo's M7 evaluation, config
  (`wrangler.jsonc`, `open-next.config.ts`, `public/_headers`) and preview workflow are all
  OpenNext-based. Not worth re-platforming the deploy layer alongside a framework upgrade.
- **Enable `cacheComponents`/PPR in the same change.** Different profile of caching semantics and
  a behavior-time risk stack; deferred until after the upgrade is stable, if ever needed.
