# ADR 0006 — Provider-independent AI interface; Gemini over REST

**Decision.** `modules/lab/ai/types.ts` defines `AiProvider.generate(system, user, limits) → {text, usage, model, latencyMs}` and a `ProviderError` with kinds
CONFIG / RATE_LIMIT / TIMEOUT / PROVIDER. Conversation logic depends only on that. Gemini is implemented with `fetch` against the public `generateContent` REST endpoint
(`x-goog-api-key` header, `responseMimeType: application/json` + `responseSchema`, thinking disabled for 2.5 Flash models to save cost and output budget).

**Why REST, not an SDK.** No new dependency to install or audit, trivially mockable in unit tests (injected `fetch`), and the surface used is one endpoint. Trade-off: we own request/response mapping;
swap to the official SDK later behind the same interface if it adds value.
**Selection.** Provider and model come from server configuration and a code-level allowlist; there is no request input for either. A misconfiguration fails with CONFIG — nothing is substituted.
**Rejected.** Multi-provider routing, automatic model fallback, response streaming, background workers (none needed for M3).
