# ADR 0001 — Custom database-backed sessions instead of an auth library

**Status:** accepted for M0 — *material deviation from the brief ("a maintained authentication solution")*; needs owner sign-off.

**Context.** Access is invitation-only (no public sign-up, no OAuth, no email delivery). Auth.js v5
credentials flow forces stateless JWT sessions (no server-side revocation); Better Auth owns its own
tables and its sign-up gating could not be verified offline. I could not install or run either library
here, and unverified third-party integration code is the riskier choice for a security foundation.

**Decision.** Minimal session layer built only on Node's `crypto`: 256-bit random session tokens
stored as SHA-256 hashes in `Session`, HttpOnly/SameSite=Lax cookie (`__Host-` in production),
scrypt password hashing (OWASP parameters), new session id on each login, server-side logout.

**Consequences.** Small, auditable, revocable. Missing features (rate limiting, reset, MFA, OAuth)
are listed in architecture.md. **Revisit before M2/public exposure**: migrate to Auth.js or Better Auth
once email/OAuth are needed. `lib/auth/session.ts` is the only integration point, so swapping is local.
