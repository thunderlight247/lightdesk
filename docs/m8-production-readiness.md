# Milestone 8: Production Readiness & Launch

**Target:** Prepare LightDesk for general production deployment following the M7 controlled pilot.
**Focus areas:** Security hardening, tenant data lifecycle (export/deletion), operational reliability, provider outage resilience, and launch verification.

---

## 1. Objectives & Scope

### In Scope
1. **Security & Tenant Isolation Audit**:
   - Comprehensive cross-tenant verification across all service endpoints and database queries.
   - Session lifetime enforcement and cookie security policies (HTTPS `__Host-` prefixes).
   - Secret box audit and key rotation runbooks.

2. **Data Protection & Privacy (Ghana DPA & GDPR Alignment)**:
   - Self-service data export for business owners (CSV/JSON archive of conversations, catalog, and audit logs).
   - Business account deletion / right-to-be-forgotten pipeline with cascading cleanup or anonymization.
   - Retention policy enforcement (e.g. automatic pruning or archiving of aged audit logs and raw payload logs).

3. **Operational Reliability & Resilience**:
   - Outage handling and circuit breaking for external providers (Meta WhatsApp Graph API and Google Gemini).
   - Rate limiting at platform boundaries (abuse prevention, per-IP login throttling, DDoS defense).
   - Health check endpoints distinguishing shallow liveness (`/api/health`) from deep readiness (`/api/health/ready`).

4. **Framework & Hosting Modernization**:
   - Evaluation of Next.js 16 upgrade to remove legacy build warnings and unblock native Cloudflare adapter optimizations.
   - Production deployment verification with hosted PostgreSQL and connection pooling (Hyperdrive / PgBouncer).

### Out of Scope
- **Milestone 9 Billing & Monetization**: Payment gateway integration, subscription tiers, automated billing invoices.
- **Autonomous Outbound Marketing**: Broadcast marketing campaigns or automated template outreach.

---

## 2. Technical Architecture & Invariants

### 2.1 Data Subject Requests (Export & Deletion)
- **Data Export (`modules/privacy/export.ts`)**:
  - Accessible only by users with role `OWNER`.
  - Aggregates business profile, approved catalog, WhatsApp conversation histories, and audit records into an encrypted zip or structured JSON archive.
- **Business Deletion (`modules/privacy/deletion.ts`)**:
  - Requires explicit confirmation with 2FA or multi-step re-authentication.
  - Cascades deletions across `WhatsAppMessage`, `WhatsAppConversation`, `CatalogueItem`, `BusinessProfile`, `PilotEnrollment`, and membership bindings.
  - Audit events retain minimal anonymized metadata for compliance while purging PII.

### 2.2 Provider Circuit Breaking & Graceful Degradation
- **Meta Graph API Outage**:
  - If WhatsApp Graph API returns 5xx or repeated timeouts:
    - Queue outbound messages locally with exponential backoff up to the 24-hour service window limit.
    - Surface provider status banners in the owner console (`/businesses/[businessId]/whatsapp`).
- **Gemini AI Outage**:
  - Automatic fallback to deterministic rules-based drafts (`source: "RULES"`).
  - Explicit warning badge displayed on conversation drafts indicating AI service unavailability.

### 2.3 Deep Readiness & Monitoring
- **Deep Health Check (`GET /api/health/ready`)**:
  - Verifies read/write access to PostgreSQL database.
  - Verifies presence and valid formatting of required runtime encryption keys (`WHATSAPP_TOKEN_ENCRYPTION_KEY`, etc.).
  - Returns `503 Service Unavailable` with sanitized status indicators if core infrastructure is unreachable.

---

## 3. Implementation Plan

| Phase | Description | Deliverables |
|---|---|---|
| **Phase 1** | Privacy & Data Management | Owner export module, account closure / business deletion workflow, unit & integration tests. **Complete** (`modules/privacy/export.ts`, `modules/privacy/deletion.ts`). |
| **Phase 2** | Production Health & Resilience | `/api/health/ready` deep checks **implemented and tested**; Gemini degradation verified (rules-based fallback with no unhandled exceptions); WhatsApp outbound outage queue + circuit breaker **complete** (ADR 0010: `QUEUED` status with backoff/expiry on `WhatsAppMessage`, `flushDueMessages` triggered by console reads + `POST /api/whatsapp/outbox/flush` cron endpoint guarded by `WHATSAPP_OUTBOX_FLUSH_TOKEN`, connection-level `providerDownSince`/`consecutiveSendFailures` breaker, outage/queued/expired banners in the owner console). |
| **Phase 3** | Rate Limiting & Edge Hardening | **Complete.** Per-IP + per-email login throttling (`modules/identity/throttle.ts`, `lib/security/login-throttle.ts`, `LoginFailure` table via additive migration `20261024000000_m8_login_throttle`), CSP and prod-only HSTS in `next.config.ts`. |
| **Phase 4** | Hosting & Framework Modernization | Cloudflare deployment with managed PostgreSQL (**pending owner inputs** — Cloudflare token, staging URL, Neon project; the full step-by-step is in `docs/m8-cloudflare-deploy-checklist.md` — OpenNext adapter build re-verified 2026-10-25, hosted-DB = Neon via Hyperdrive per accepted `docs/decisions/0011-hosted-postgres-for-cloudflare.md`, remote acceptance checks listed); Next.js 16 upgrade **evaluated** — see `docs/decisions/0009-nextjs-16-upgrade-evaluation.md`. |

---

## 4. Acceptance Criteria
- [x] Business owner can initiate and download a complete export of their business data.
- [x] Business owner can completely delete their workspace with clean tenant purging.
- [x] Deep health check route validates system readiness without exposing sensitive internals.
- [x] Provider timeouts degrade gracefully to rules-based fallback without unhandled exceptions (Gemini path; WhatsApp approved replies queue locally and retry up to the 24-hour window with console banners, per ADR 0010).
- [x] Quality gates (typecheck, lint, unit & integration tests, production build) remain fully green.
