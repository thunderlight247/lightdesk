# LightDesk --- Project Memory, Architecture & Roadmap

> **Purpose:** This document is the durable project handoff for
> LightDesk. A developer, Claude Code, or another AI assistant should
> read it before proposing changes or implementing work.
>
> **Repository:** `/media/light/Grace/lightdesk`
>
> **Document status:** Living source of project context. Update the
> implementation status and decision log as work progresses. When this
> document conflicts with the actual repository, migrations, tests, or a
> newer explicit owner decision, inspect the evidence and follow the
> newest confirmed decision. Do not invent completion status.

------------------------------------------------------------------------

## 1. Project summary

**LightDesk** is an AI-powered conversation assistant for small
retailers and product-selling businesses, initially targeting businesses
in Ghana.

Its purpose is to help businesses handle customer enquiries, answer
repeated questions using approved business information, retain relevant
conversation context, identify enquiries needing human attention, and
eventually improve enquiry conversion.

LightDesk is not intended to be an AI that freely makes business
decisions. It should be a dependable assistant that understands how a
business operates, uses verified business facts, follows its policies,
and knows when it does not know enough to answer.

### Core product promise

> Help small businesses respond to customer enquiries more consistently
> and efficiently, without inventing facts or taking control away from
> the business owner.

### Product philosophy

The project follows a problem-first approach: - Build to solve real
problems, not merely to compete with existing products. - Research
existing approaches and adopt or integrate them when they solve the
problem well. - Keep the product useful and simple for small
businesses. - Avoid unnecessary infrastructure, features, dependencies,
and recurring costs. - Validate the value with real business owners
before expanding the product. - Design for sustainable operating
economics. A free tier must not imply unlimited or permanently free AI
or messaging usage.

------------------------------------------------------------------------

## 2. Who does what

The owner wants the AI assistant in the project workflow to act as a
**senior software architect and engineering lead**: help make product
and architectural decisions, identify risks early, and prepare
comprehensive implementation prompts.

**Claude Code** is used as the implementation engineer. It should
inspect the real repository, implement the specified milestone, run
tests, fix regressions, update documentation, and report what actually
happened.

### Collaboration rules

1.  Read this file and relevant repository documentation before changing
    code.
2.  Inspect the actual implementation; do not assume previous prompts
    describe the current code exactly.
3.  Do not rebuild existing functionality or reopen approved milestones
    without concrete evidence of a problem.
4.  Do not ask the owner to review every minor decision or every
    milestone repeatedly. Use engineering judgment within the agreed
    scope.
5.  Ask for clarification only when a material product/security/cost
    decision cannot be resolved from project context.
6.  Work one milestone at a time. Do not quietly begin later milestones.
7.  Do not claim tests, builds, migrations, or integrations succeeded
    unless they were actually run and observed.
8.  Keep final reports concise but specific: changes, migrations, tests
    and results, configuration, known issues, and scope boundaries.
9.  Preserve unrelated local changes. Inspect `git status` before
    editing and before finishing.
10. Never delete the development database or Docker volume to make a
    migration or test pass.

------------------------------------------------------------------------

## 3. Current technical baseline

The known project stack is:

-   Next.js 15 App Router
-   TypeScript
-   Tailwind CSS 4
-   PostgreSQL 16
-   Prisma 6
-   Zod
-   Vitest
-   Existing custom session/authentication implementation
-   Existing business workspace, memberships, roles, and authorization
    model
-   Local PostgreSQL Docker configuration with port mapping
    `127.0.0.1:55433:5432`

Repository location:

``` text
/media/light/Grace/lightdesk
```

### Repository verification is mandatory

These details describe the known baseline and may change. Before
implementation, inspect: - `package.json` and lockfile - Prisma schema
and migrations - authentication/session modules -
business/workspace/membership/role models - BIP modules and approval
workflows - tests and scripts - `.env.example` and configuration
validation - current roadmap, README, and any existing `remember.md` -
current Git branch, status, and diff

Do not assume filenames, routes, model names, or commands until
verified.

### Database safety

-   Preserve existing local data.
-   Use additive migrations where possible.
-   Do not run `docker compose down -v`.
-   Do not use destructive reset commands as a shortcut.
-   Do not overwrite `.env.local` or real secrets.
-   If migration state is unexpected, investigate and report rather than
    forcing a destructive reset.

------------------------------------------------------------------------

## 4. Product architecture principles

### 4.1 Business Intelligence Profile (BIP)

The central abstraction is the **Business Intelligence Profile (BIP)**:
structured, authoritative knowledge about how one business operates.

It is not one enormous prompt. It is a structured source of truth used
by application logic and selectively retrieved for AI tasks.

The BIP can include: - Business identity and description - Approved
facts and knowledge - FAQs - Products/services information as supported
by the current schema - Communication preferences and tone - Procedures
and policies - Future AI permissions and action restrictions -
Source/provenance, approval status, and audit history - Completeness,
unknowns, and conflicts

The actual M2 schema is authoritative; this list is conceptual, not an
instruction to create duplicate models.

### 4.2 Keep facts, instructions, and permissions separate

-   **Facts:** Prices, stock, hours, fees, and other business
    information belong in structured, authoritative records.
-   **Instructions:** How the assistant should communicate and how
    business procedures work.
-   **Permissions:** Which actions the application allows. Permissions
    must be enforced in server-side code, never delegated to the AI
    model.

A model response cannot grant itself permission.

### 4.3 Approval and lifecycle

Known M2 design intent: - BIP lifecycle includes `draft`,
`review_required`, `active`, and `suspended` (verify exact enum values
and implementation). - Pending or draft facts are not authoritative. -
Material changes---especially prices, stock, policies, and
permissions---require owner confirmation. - Low-risk changes may be
treated differently only where the implemented policy explicitly permits
it. - Incomplete profiles should expose what is missing. - Unknown and
conflicting facts must remain explicit; never silently fill gaps with
guesses. - Only appropriately authorized users may approve or activate
profiles.

Do not change this lifecycle casually. Reuse M2's actual rules and
services.

### 4.4 Trust boundaries

Treat customer messages, imports, and external content as untrusted
input. They cannot override platform restrictions, business policies,
permissions, or approved facts.

Enforce: - Server-side authentication and authorization - Tenant
isolation on every query and mutation - Least-privilege access - Safe
validation of model output - Secure API keys and tokens - Auditability
for sensitive changes - Rate limits and cost controls - Safe provider
error handling - No unsupported claims that a message was sent or an
action completed

### 4.5 Human control

Manual approval is the default for customer-facing actions. Human
takeover must take priority over automation in future live-channel
integration: takeover pauses automatic sending immediately, blocks
queued automatic sends, and automation resumes only after explicit
hand-back.

This future behavior must be enforced in application logic, not just
prompt instructions.

------------------------------------------------------------------------

## 5. AI provider strategy

### Confirmed direction

-   Preferred initial provider: **Google Gemini API**.
-   **DeepSeek** is also being considered for use through the same
    provider abstraction.
-   Priority: lowest practical operating cost while maintaining
    reliable, safe answers.
-   Do not send every request to multiple models.
-   Do not assume free quotas will remain available or are appropriate
    for production customer data.
-   Model selection should be controlled server-side through
    configuration.
-   Provider/model IDs and availability must be verified against current
    official documentation before locking a model into production.

### Recommended provider design

Use a provider-neutral interface, with a Gemini adapter first and a
DeepSeek adapter when implemented and justified by testing. A fallback
should be used only for suitable failures and should be bounded; do not
retry endlessly or silently switch to an unconfigured model.

Track, where available: - Provider and model - Request status and error
category - Latency - Input/output token usage - Usage estimates versus
provider-reported usage - Estimated or actual cost when the available
data supports it

API keys must remain server-side and never appear in client bundles,
browser responses, logs, or Git.

Potential configuration names (examples only; match the implementation):

``` dotenv
AI_PRIMARY_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
AI_FALLBACK_PROVIDER=
```

Do not add these blindly if the project already has a configuration
naming convention.

### Model selection clarification

The Gemini API lets an application specify a model ID in its API
request. The Gemini consumer chat app and the developer API are
different products. The application should explicitly configure the
model rather than assume the provider will choose one.

### Model evaluation

Before choosing defaults, compare providers on representative retail
enquiries: - Correct use of approved facts - Handling of unknown prices,
stock, and policies - Resistance to customer prompt injection -
Structured output validity - Escalation quality - Latency - Actual token
usage and cost - Rate limits and operational reliability

Do not treat fluent language as proof of correctness.

### Privacy caution

Review the provider's current terms and data-handling settings before
sending real customer information. Do not claim that a provider offers
zero retention, zero training, or particular privacy guarantees unless
confirmed for the actual account, model, and plan. Use fictional or
anonymized data during early testing.

### Retrieval and vector search

Start with structured PostgreSQL records and relevant approved facts. Do
not add a vector database solely because the application uses AI. Add
embeddings/semantic search only when real retrieval tests show a clear
need.

------------------------------------------------------------------------

## 6. WhatsApp integration strategy

### Important decision

The owner considered QR-based, unofficial WhatsApp Web protocol
projects, including: - `go-whatsapp-web-multidevice` (Go + REST API) -
`whatsapp-multi-tenant` (NestJS/React, using a WAHA-style engine) -
`Simple-Whatsapp-API` (Node.js)

The product goal was to validate LightDesk with real businesses before
taking on official API setup and messaging costs.

After discussing account continuity, policy, reliability, and business
risk, the recommended direction is:

**Use the official Meta WhatsApp Business Platform / Cloud API for the
production integration. Do not build the production product around
unofficial WhatsApp Web QR libraries.**

QR pairing does not itself make an integration officially supported.
Unofficial integrations can create account restrictions/disconnection
risk, and would put LightDesk's business reliability on a fragile
foundation.

This is a strategic decision, not a claim that every unofficial library
necessarily fails technically.

### Integration is deferred to M6

Do not add WhatsApp dependencies, QR login, live sending, or webhooks
during M2/M3. Keep the current milestones focused on the BIP and
simulated conversation lab.

Before M6, verify from current official Meta documentation: - Developer
account, app, business portfolio, and permissions - Access and
onboarding requirements for serving multiple businesses - Embedded
Signup availability/eligibility - Existing WhatsApp Business app number
eligibility and coexistence rules - Dedicated-number alternative,
registration, and recovery - Customer opt-in requirements - Customer
service windows and message template requirements - Current message
categories and Ghana rate card - Webhook signature verification,
duplicate events, retries, and status updates - Secure token storage,
rotation/revocation, disconnect flow - Provider outages, rejected
messages, and delivery failures - Tenant isolation and per-business
usage metering

Do not promise that all existing WhatsApp Business numbers qualify for
coexistence or that all app features remain unchanged. Test eligibility
and the actual supported flow.

### Messaging control

-   Owner approval is the default.
-   AI should draft; the owner reviews and sends.
-   Optional restricted automatic replies may be introduced later only
    with explicit authorization, narrow rules, monitoring, and usage
    limits.
-   Human takeover immediately pauses automated sending; queued sends
    must be blocked; resume only after explicit hand-back.
-   Do not implement refunds, payment confirmation, financial
    transactions, unbounded discounts, or bulk marketing as autonomous
    actions.

### Meta cost distinction

Connecting an account is not the same thing as incurring API messaging
charges. The pricing rules apply according to how messages are sent and
current Meta rules. App-sent messages and API-sent messages may be
treated differently, particularly in eligible coexistence setups.

Previous discussion noted Meta pricing changes effective around October
1, 2026, including service-message pricing changes. **Do not hardcode or
rely on remembered price/allowance claims. Verify the current official
Ghana rate card and rules immediately before M6 and launch.**

Budget separately for: - Meta messaging - AI provider usage -
Hosting/database - Monitoring, support, and operational overhead

Use official Meta test resources during development where available. Do
not rely on unofficial QR integrations to avoid Meta pricing.

------------------------------------------------------------------------

## 7. Hosting and deployment direction

### Current direction: Cloudflare is the preferred candidate to evaluate

The owner has experience hosting the Great Light Group website using
**Cloudflare Pages** and asked why LightDesk could not use Cloudflare.
Cloudflare should therefore be evaluated seriously rather than
defaulting to Vercel.

No final production-hosting commitment should be treated as complete
until compatibility and costs are verified.

### Likely architecture to evaluate

-   Next.js frontend/full-stack application on a suitable Cloudflare
    deployment path
-   Existing PostgreSQL database architecture retained where practical
-   Prisma compatibility verified for the selected runtime
-   PostgreSQL connectivity evaluated through an appropriate connection
    solution (e.g., Hyperdrive where suitable)
-   Durable background jobs/queues introduced when required by real
    integrations
-   Secrets managed in the hosting environment, never in client code
-   Logging, monitoring, backup, restore, and incident handling planned
    before production

Cloudflare Pages is suitable for many static sites, but LightDesk uses
server-side application functionality. Do not assume a static Pages
deployment alone will support the entire application. Evaluate the
appropriate Workers/Next.js deployment path against the actual Next.js
15 app, runtime APIs, Prisma usage, auth/session code, and build.

Cloudflare's newer Next.js options and frameworks may change. Verify
current official docs and maturity; do not adopt a beta deployment
adapter blindly for a production business platform.

### Hosting evaluation checklist

Before selecting the production setup, test: - Build and deploy from the
actual repository - Authentication and cookie/session behavior - API
routes and server-side modules - Prisma query and migration workflow -
PostgreSQL connection pooling and limits - Runtime compatibility of
Node-specific dependencies - Environment/secrets configuration -
Background job durability, retry, and idempotency - Logs and alerts -
Database backups and restore - Expected cost at realistic usage levels

Avoid premature microservices or a separately hosted worker unless
needed. Prefer simple, reliable operations and predictable costs.

------------------------------------------------------------------------

## 8. Roadmap: M0--M9

The agreed roadmap is milestone-based. Work on one milestone at a time
and preserve the exclusions for later milestones.

### M0 --- Foundation

**Status:** Owner tested and approved.

Known foundation includes core app setup, authentication/session layer,
business workspace foundations, PostgreSQL/Prisma, validation, and
automated checks. Exact files and final acceptance details must be
confirmed from the repository rather than reconstructed from memory.

Do not reopen M0 unless there is concrete evidence of a regression or
security defect.

### M1 --- Business Workspace

**Status:** Owner tested and approved.

Known manual checks included: - Admin login - Creating a business -
Inviting an owner and accepting the invitation - Owner inviting a
member - Member accepting the invitation - Roles displayed appropriately

Do not re-review M1 unnecessarily. Verify current code when integrating
later milestones.

### M2 --- Business Intelligence Profile (BIP)

**Status:** M2 prompt was provided and M3 work has been requested. Check
the repository and latest Claude report to confirm exact
completion/acceptance status before claiming M2 is fully complete.

Scope: - Structured business identity, knowledge/FAQs, communication
preferences, procedures/policies, permission-related settings,
provenance and audit - Lifecycle and completeness - Draft versus
approved information - Material changes requiring approval - Unknown and
conflicting facts - Owner-authorized approval/activation - Server-side
authz and tenant isolation - Additive migrations and tests

Explicitly excluded from M2: - AI conversation engine - WhatsApp - Full
catalogue/import system - Billing

### M3 --- AI Conversation Laboratory

**Status:** Complete and verified. All quality gates passed (60 unit
tests, 145 integration/security tests, typecheck, lint, build, live
Gemini API verification using `gemini-3.5-flash`).

Scope: - Simulated customer conversations - AI-generated reply drafts
grounded in approved BIP information - Context across turns -
Unknown/conflicting fact handling - Escalation recommendations -
Explicit review/approval inside the simulation - Gemini provider
integration and provider abstraction - DeepSeek adapter when implemented
and justified - Usage/error tracking - Security, tenant isolation,
tests, and documentation

Rules: - No live WhatsApp, webhooks, or real customer messages - No
autonomous real-world actions - No billing implementation - Mock
provider for default tests; live provider tests opt-in only - Do not
claim a simulated message was sent externally

### M4 --- Real-User Feedback

**Status:** Completed and documented (see `docs/m4-feedback.md`). Re-verified on 2026-10-20
against the post-M5 code with the live Gemini provider: catalogue-grounded price/stock answers now
work with evidence; the deterministic payment-claim pre-check has a regex gap (AI still escalated
safely) — fix + regression test recommended before M7.

Key findings & activities:
- Evaluated recurring enquiry archetypes for small retailers in Ghana (pricing/stock, delivery/location, MoMo payments, policies, and bargaining).
- Ran empirical lab tests against the live Google Gemini API (`gemini-3.5-flash`); verified grounded drafts, safe holding replies on unknown data, and deterministic blocking of payment claims.
- Validated unit economics: ~110–190 tokens per turn (< $0.05 / 1,000 turns) and 1.5s–2.2s latency.
- Identified primary BIP bottleneck: lack of structured product pricing/inventory models causes ~50% of retail queries to hit holding replies.
- Confirmed human-in-the-loop approval workflow provides high trust and saves 70–80% of typing time.
- Prepared requirements for M5 (Data Management Hardening).

### M5 --- Data Management Hardening

**Status:** Complete and verified (see `docs/m5-catalogue-hardening.md` and `docs/decisions/0008-catalogue-and-data-management-hardening.md`).

Scope & deliverables completed:
- Structured product/catalogue model (`CatalogueItem`) with dual working vs approved state and database integrity constraints.
- Mobile Money (MoMo) and payment procedure entries under the `POLICY` module (`payment_methods`, `momo_details`, `payment_terms`).
- Duplicate detection on normalized item names; cross-record price conflict detection with FAQs.
- Safe bulk import (CSV/JSON) into `DRAFT` staging without silent overwrites.
- Laboratory retrieval and price-grounding guards for catalogue products.
- All 67 unit tests, 150 integration/security tests, typecheck, lint, and production build passed.

### M6 --- Official WhatsApp Integration

Implement the official Meta WhatsApp Business Platform / Cloud API after
verifying current access, onboarding, pricing, and eligibility.

Scope may include: - Account/number onboarding - Secure token handling -
Webhooks and signature verification - Incoming messages and status
events - Outbound messaging - Duplicate event handling and retries -
Message templates and service-window rules - Human approval flow -
Immediate human takeover and explicit hand-back - Per-business messaging
usage/cost metering - Failure states, disconnect/revoke, monitoring, and
audit

Do not start M6 during M3. Verify all current Meta rules rather than
relying on this document for live pricing or eligibility.

### M7 --- Controlled Pilot

Pilot with a limited number of real businesses.

Requirements include: - Explicit owner consent and onboarding -
Restricted functionality and automation - Human approval by default -
Usage/spend limits - Human takeover controls - Monitoring and support
procedures - Feedback collection - Incident and disconnect handling -
Verification that customer-facing claims and responses remain grounded

Expand only when evidence supports it.

### M8 --- Production Readiness and Launch

Before broad release: - Security and tenant-isolation review -
Privacy/data-handling review, including applicable Ghana data protection
obligations - Reliability and failure-mode review - Monitoring, alerts,
logs, backups, and restore drills - Deployment and rollback process -
Provider outage handling - Rate limiting and abuse prevention - AI and
messaging cost controls - User support and operational ownership - Data
export/deletion/retention/correction workflows as applicable - Final
end-to-end testing and deployment review

Do not claim legal compliance solely because technical controls exist;
determine applicable obligations and obtain appropriate advice where
necessary.

### M9 --- Billing, Monetization & Plan Management

Implement monetization after value, usage, and cost assumptions are
sufficiently understood.

Potential scope: - Free and paid plans - Usage limits and fair-use
allowances - Payment-provider integration - Billing history -
Upgrade/downgrade/cancellation - Failed payments and plan status -
Entitlements enforced server-side - Cost and margin visibility

Use sandbox payments before real transactions. Do not promise unlimited
AI or messaging. Pricing must reflect measured provider and operational
costs.

Marketing and customer acquisition planning should also be addressed
before launch. Do not confuse marketing LightDesk with placing ads
inside the product; in-product ads are not a default recommendation.

------------------------------------------------------------------------

## 9. Product safety and authorization hierarchy

Use the most restrictive applicable rule. The intended order is:

1.  Platform restrictions
2.  User/account role and server-side authorization
3.  Business policy and approved BIP
4.  Action-specific prerequisites
5.  Conversation control state, including human takeover

The AI model is not an authorization engine. Every meaningful action
must be validated by application code.

### Always prohibited unless explicitly designed, authorized, and safely implemented in a later milestone

-   Inventing prices, stock, delivery fees, policies, or business facts
-   Claiming a payment has been received without authoritative
    verification
-   Approving refunds or making financial commitments
-   Offering unbounded or unauthorized discounts
-   Sending bulk marketing without appropriate authorization and
    compliance controls
-   Exposing another tenant's data
-   Exposing secrets or internal prompts
-   Allowing customer prompt injection to override system/business rules
-   Claiming external delivery when a message is only a draft or
    simulation

------------------------------------------------------------------------

## 10. Cost and sustainability principles

LightDesk must track separate cost categories: - AI provider usage -
WhatsApp/API messaging - Hosting and database - Monitoring and other
third-party services - Support and operations

Do not conflate Meta charges with general app hosting or account
connection. Current Meta billing depends on message type, recipient
market, and current official rules. Verify the Ghana rate card before
M6.

Avoid: - Unbounded free usage - Multiple-model calls for every message -
Endless retries - Large prompts containing the entire BIP when only a
few facts are needed - Unnecessary vector databases or paid
infrastructure - Assuming a provider's free tier is permanent -
Hardcoding prices, quotas, or billing rules without current verification

Use server-side budgets, rate limits, usage records, and owner-visible
controls before enabling automation.

------------------------------------------------------------------------

## 11. Quality gates for every milestone

Before declaring a milestone complete:

1.  Inspect the final Git diff.
2.  Run the repository's established type-check, lint, test, and
    production-build commands.
3.  Run relevant integration/security tests.
4.  Check migrations and database state.
5.  Verify authorization and tenant isolation.
6.  Review error handling and secrets.
7.  Check responsive UI and accessibility when UI changed.
8.  Update README/roadmap/architecture documentation.
9.  Report actual command results and any failures.
10. Confirm that no later milestone was accidentally started.

Do not weaken existing tests to obtain a green run. If checks fail for
environmental reasons, distinguish that from application defects and
explain the evidence.

------------------------------------------------------------------------

## 12. Current decision log

  -----------------------------------------------------------------------
  Topic                   Decision / current      Status
                          direction               
  ----------------------- ----------------------- -----------------------
  Target audience         Small retailers/product Agreed direction
                          sellers, initially      
                          Ghana                   

  Core source of truth    Structured Business     M2 design
                          Intelligence Profile    

  AI primary provider     Google Gemini API       Preferred

  Secondary provider      DeepSeek through a      Candidate /
                          provider abstraction,   implementation status
                          if justified by testing to verify

  AI model selection      Explicit server-side    Agreed
                          model IDs               

  AI behavior             Ground answers in       Required
                          approved facts; admit   
                          unknowns; escalate when 
                          needed                  

  Default customer-facing Manual approval         Agreed
  control                                         

  Initial conversation    Simulated laboratory    Agreed
  testing                 before live messaging   

  WhatsApp production     Official Meta WhatsApp  M6 direction
  integration             Business Platform /     
                          Cloud API               

  Unofficial QR libraries Not recommended as the  Strategic decision
                          production foundation   

  Existing WhatsApp       Prioritize where        M6 validation
  Business app numbers    Meta-supported          
                          coexistence eligibility 
                          is verified             

  Hosting                 Cloudflare is the       Not fully finalized
                          preferred candidate to  
                          evaluate because the    
                          owner has used          
                          Cloudflare Pages for    
                          Great Light Group       

  Database                Retain                  Preferred
                          PostgreSQL/Prisma       
                          unless a demonstrated   
                          requirement justifies a 
                          change                  

  Pricing                 Decide from measured    Future work
                          usage and cost, not     
                          assumptions             

  Billing                 M9                      Deferred

  Final review            One comprehensive       Owner preference
                          pre-deployment review   
                          rather than repeated    
                          review of every         
                          milestone               
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 13. Open questions to resolve at the appropriate milestone

Do not interrupt current milestone work to answer every future question.
Resolve them when they materially affect implementation.

### M3

-   Confirm the actual M2 schema, BIP approval rules, and M3
    implementation status.
-   Confirm current supported Gemini model ID and cost/usage reporting.
-   Decide whether DeepSeek is implemented now or after a fair
    benchmark; do not add it just because it is listed as a candidate.
-   Confirm output contract and safe failure behavior.

### M4

-   What business-owner workflows create the most repetitive enquiries?
-   Which replies are most valuable and most error-sensitive?
-   What level of owner control is practical?
-   What usage patterns and costs appear in real tests?

### M5

-   Which catalogue/import sources are genuinely needed?
-   How should duplicates, provenance, and conflicting facts be
    reviewed?

### M6

-   Current official Meta access and onboarding path
-   Multi-business onboarding eligibility
-   Coexistence and number eligibility
-   Current Ghana rate card and message rules
-   Opt-in, templates, and customer service windows
-   Webhook verification, retry, duplicate and status handling
-   Secure token lifecycle and disconnect/revoke
-   Usage limits and owner approval

### M8

-   Final Cloudflare deployment path versus alternatives
-   Actual production database/provider and backup plan
-   Data protection, retention, export/deletion and incident process
-   Support and operational responsibilities

### M9

-   Measured unit economics
-   Free-tier limits and paid plan structure
-   Payment provider and billing lifecycle
-   Fair-use and abuse prevention

------------------------------------------------------------------------

## 14. Instructions for a new AI assistant or developer

When you start work on LightDesk:

1.  Read this entire document.
2.  Inspect the repository and the most recent Git changes.
3.  Read the current README, roadmap, schema, migrations, tests, and the
    latest milestone report.
4.  Establish the exact current milestone and what has genuinely been
    completed.
5.  Preserve explicit owner decisions in this file.
6.  If the repository contradicts the status in this document, report
    the discrepancy and update the document only after confirming the
    actual state.
7.  Do not invent credentials, API access, provider capabilities, costs,
    or successful test results.
8.  Use official current documentation for changing external services
    such as Gemini, DeepSeek, Cloudflare, and Meta.
9.  Do not implement future milestones without authorization.
10. At the end of a milestone, update the milestone status and decision
    log with evidence from the actual implementation.

### First task for any new session

**Inspect the repository and determine the actual current state. Do not
assume M3 is complete merely because its prompt exists.** Read the
latest implementation report, run the appropriate safe checks, and
continue only with the next explicitly requested task.

------------------------------------------------------------------------

## 15. Change log

-   **2026-10-20 (M6 specification):** Authored `docs/m6-whatsapp.md` — the implementation
    spec for the Official WhatsApp Integration milestone — after verifying current Meta
    platform facts from primary sources (about-the-platform, per-message pricing pages,
    Embedded Signup / coexistence onboarding docs, checked 2026-10-20). Key design
    decisions: coexistence is the assumed default so owners keep their WhatsApp Business
    app number; conversation states OWNER_ONLY (default) / AI_ASSIST (opt-in) / TAKEOVER
    with every outbound message requiring an explicit owner send; the M4 deterministic
    pre-check and M3 rate caps apply to live inbound traffic; free-form replies stay
    inside the 24-hour service window and thus the 1,000-free-service-messages/month
    tier; the Ghana out-of-tier service rate is not hardcoded, it must be read from
    Meta's rate card at implementation. Phased as M6a (schema + skeleton), M6b (webhook
    + inbound), M6c (takeover state machine), M6d (outbound + Embedded Signup UI).
    Runner prerequisites (Meta dev app, Tech Provider status, webhook env values,
    encryption keys) are listed in the spec; Embedded Signup and live smoke cannot run
    without those. Roadmap M6 status updated to "Specification drafted".
- **2026-10-20 (Post-fix live re-run of M4 battery):** Re-ran the full M4 scenario battery live
    (`scripts/m4-live-verify.ts`, isolated tenant) after the pre-check hardening. Scenario C now
    uses the deterministic path: `source: RULES`, `usedAi: false`, 0 tokens, safe payment-holding
    reply, conversation escalated — the M4 regex-gap finding is closed end-to-end. All other
    scenarios (A, B1/B2/B3, D) behaved identically to the earlier runs.
-   **2026-10-20 (Payment-claim pre-check hardening):** Extended the deterministic
    `PAYMENT_CLAIM` regex in `modules/lab/rules.ts` to close the gap found during the M4
    re-verification: adverbs in any order ("I just sent", "I have already paid"), contractions
    ("I've sent"), `we`-paid phrasing, "money sent", `did you confirm`, and
    "confirm ... dispatch" within 25 characters. Regression tests added in
    `tests/unit/lab-logic.test.ts`; full quality gate passes (68 unit + 150 integration
    tests, typecheck, lint, build).
-   **2026-10-20 (Pre-M6 UI/UX redesign):** Professional redesign pass across the workspace UI to
    prepare for M6 integration. Added a shared design system (brand color tokens, `Card`, `Chip`,
    `PageHeading`, variant-aware `Button`, focus-ring form controls, pill navigation, sticky header,
    loading/error states). Restructured the lab conversation page as a chat transcript where draft
    review is a distinct "Review & approve" panel — deliberately shaped as the future M6
    review-and-send surface for WhatsApp, with simulation-only notices kept verbatim. Catalogue items
    are now scannable cards with state/stock chips. No actions, validation, permissions, or service
    logic changed; all 67 unit + 150 integration tests, typecheck, lint, and production build pass.
-   **Initial project handoff:** Consolidated LightDesk's product idea,
    architecture principles, AI-provider direction, WhatsApp strategy,
    hosting evaluation, milestone roadmap, and collaboration rules.
-   **2026-10-20 (M3 Verification & M4 Transition):** Completed full verification
    of M3 (AI Conversation Laboratory). Tested live Gemini API key integration;
    updated model configuration to `gemini-3.5-flash` after Google deprecated
    2.5-flash for new keys; confirmed all 60 unit tests, 145 integration/security
    tests, typecheck, lint, and production build pass. Transitioned to M4
    (Real-User Feedback & Scenario Validation).
-   **2026-10-20 (M4 Completion & M5 Architecture):** Synthesized M4 retail
    feedback (`docs/m4-feedback.md`); authored ADR 0008 and M5 specification
    (`docs/m5-catalogue-hardening.md`) covering structured catalogue items,
    MoMo payment procedures, duplicate and conflict detection, safe staged CSV
    imports, and catalogue-grounded lab retrieval.
-   **2026-10-20 (M4 re-verification against post-M5 code):** Re-ran the full M4 scenario
    battery through the real lab pipeline with the live Gemini provider (`gemini-3.5-flash`) using
    the new `scripts/m4-live-verify.ts` (isolated seeded tenant). Confirmed: 67 unit + 150
    integration/security tests, typecheck pass; catalogue-grounded price/stock answers now succeed
    with evidence (M4's #1 gap closed); AI turns measure 523-625 tokens / 1.3s-2.9s with catalogue
    facts in the prompt; discount guard intact. **Finding:** the deterministic `PAYMENT_CLAIM`
    pre-check regex missed "I just sent 500 GHS... confirm and dispatch" — outcome was still safe
    (escalated, no confirmation) but the zero-AI block claim no longer holds for that phrasing;
    regex hardening + regression test recommended before M7. Updated `docs/m4-feedback.md`
    (section 5) with the re-run results.
-   **2026-10-20 (M5 Implementation & Verification):** Implemented Milestone 5
    (Data Management Hardening). Generated and applied additive migration
    `20261020041553_catalogue_items` with database integrity constraints; built
    `modules/catalogue` service, duplicate detection, price conflict detector,
    and safe bulk import; integrated catalogue items and payment procedures into
    laboratory retrieval; created workspace catalogue UI and server actions;
    verified all 67 unit tests, 150 integration tests, typecheck, lint, and
    production build pass.
