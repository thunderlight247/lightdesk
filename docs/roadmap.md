# Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 — Foundation | Repo, auth, tenancy, invitations, tests, docs | **Approved** by the project owner |
| M1 — Business Workspace | Workspace landing, business overview, settings with server-enforced permissions, audit, tests, docs | **Implemented — verification pending** (run the commands in `docs/m1-workspace.md`) |
| M2 — Business Intelligence Profile | Structured, versioned, owner-governed business knowledge: identity, offerings overview, FAQs, communication preferences, policies, AI permission settings, lifecycle + approval, completeness checklist, audit | **Complete** — automated checks passed (98 integration/security, 33 unit, build); owner browser pass done; admin and member views covered by automated tests only (see `docs/m2-bip.md`) |
| M3 — AI Conversation Laboratory | Simulated conversations, approved-BIP-grounded AI drafts, evidence, escalation, owner approval in the simulation, usage tracking | **Complete** — all 60 unit tests, 145 integration/security tests, typecheck, lint, build, and live Gemini API verification passed (see `docs/m3-lab.md`) |
| M4 — Real-User Feedback | Validate product with real business owners: test lab with realistic retail enquiries, observe gaps, evaluate trust and time-savings | **Complete** — feedback analysed, retail test battery executed, findings documented (see `docs/m4-feedback.md`) |
| M5 — Data Management Hardening | Structured product/catalogue records, pricing, conflict detection, bulk management, and approval workflows | **Complete** — schema migration applied, service, bulk import, lab retrieval, and UI implemented; 67 unit and 150 integration tests passed (see `docs/m5-catalogue-hardening.md`) |
| M6 — Official WhatsApp Integration | Official Meta WhatsApp Cloud API, account onboarding, webhooks, live customer messaging, and human takeover | **Specification drafted** (see `docs/m6-whatsapp.md`) — implementation not started |

Note: the repository did not contain a written M1 requirements document; M1 was implemented from the
owner's M1 brief. Later-milestone names above are taken from that brief, not from an independent plan.
