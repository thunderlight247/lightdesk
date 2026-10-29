# LightDesk --- Project Memory, Architecture & Roadmap

> **Purpose:** This document is the durable project handoff for
> LightDesk. A developer, Claude Code, or another AI assistant should
> read it before proposing changes or implementing work.
>
> **Repository:** `/media/light/Grace/lightdesk`
>
> **Document status:** Living source of project context. Product direction as of 2026-10-25: service businesses/professionals; LightDesk complements WhatsApp rather than replacing it. Update implementation status and decision log as work progresses. When this
> document conflicts with the actual repository, migrations, tests, or a
> newer explicit owner decision, inspect the evidence and follow the
> newest confirmed decision. Do not invent completion status.

------------------------------------------------------------------------

## 1. Project summary

**LightDesk** is an AI-assisted client relationship and workflow management platform for service businesses and professionals, initially targeting businesses in Ghana. The first pilot audience is a small mixed group of service businesses, potentially including consultants and small agencies, repair/maintenance providers, and other client-facing service operators.

LightDesk is built **on top of WhatsApp, not as a replacement for WhatsApp**. Customers continue using their normal WhatsApp app to contact the business. LightDesk connects through Meta's official WhatsApp Business Platform / Cloud API where supported, and gives the business operator a private workspace for client context, follow-ups, workflow, approved business knowledge, and AI assistance. WhatsApp remains the communication channel; LightDesk is the operational intelligence and workflow layer around the conversations.

LightDesk should not try to recreate WhatsApp Business's existing basic features—such as labels, greeting/away messages, quick replies, and basic contact/chat management—as standalone reasons to use a second product. It should integrate with and complement existing tools where appropriate, and focus on work that otherwise gets lost across conversations: commitments, pending client requests, proposals/quotations, appointments, next actions, and unresolved issues.

LightDesk helps businesses capture and understand client enquiries, maintain client and interaction history, identify unanswered questions, track commitments and follow-ups, and decide what needs attention next. The shared workflow should work across different service businesses, while each workspace configures its own services, approved pricing/rules, required enquiry details, appointments or job practices, and escalation policies.

LightDesk is not intended to be an AI that freely makes business decisions. It should be a dependable assistant that understands how a business operates, uses verified business facts, follows its policies, distinguishes suggestions from verified facts, and knows when it does not know enough to answer.

### Core product promise

> Help service businesses manage client relationships and never lose sight of important enquiries, commitments, or follow-ups—while keeping WhatsApp as the customer communication channel and the business owner in control.

### Current product hypothesis—not yet commercially validated

Service professionals may value a shared workspace that turns conversations into client context, next actions, and follow-up tasks more than they value another basic messaging interface. The mixed-service pilot must validate this hypothesis with real owners. Do not claim market fit or willingness to pay before collecting evidence.

### First-use workflow

1. The business owner configures and approves the workspace's business profile, services, pricing/quotation rules, hours, communication preferences, procedures, and escalation rules.
2. A customer enquiry arrives through the authorized WhatsApp integration and is associated with the correct business, conversation, and existing or new client record, subject to the data Meta actually provides.
3. LightDesk prepares an AI summary, suggested category, relevant details, missing information, and possible next action.
4. LightDesk recommends a next step: ask a clarifying question, arrange a consultation/appointment, prepare a proposal or quotation, escalate an issue, or schedule a follow-up.
5. AI drafts a response using approved business information. The owner reviews, edits if needed, approves, and sends it.
6. The owner confirms the client/request stage, records important commitments, and creates or confirms a task with an owner, due date, and status.
7. A daily action view highlights overdue follow-ups, unanswered requests, upcoming appointments, pending proposals/quotations, and escalations.
8. Conversation history, task changes, approvals, and authorized actions remain traceable.

AI-extracted interpretations must remain separate from verified facts. Unknown or conflicting information must not be silently promoted into authoritative business/client data.

### Shared capabilities versus configurable details

**Shared core:** client records and interaction history; conversation summaries and AI-assisted replies; tasks/reminders; configurable enquiry-to-completion pipeline; daily action view; human approval, escalation, audit history, tenant isolation, and role-based access.

**Per-business configuration:** services and service areas; approved prices and quotation rules; information required to qualify an enquiry; consultation, appointment, or job-handling practices; working hours, communication tone, and escalation policies.

Do not create separate industry-specific application modules for the first pilot. Prove the shared workflow first; add specialization only when pilot evidence shows a genuine unmet need.

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

Before choosing defaults, compare providers on representative service-business conversations: new enquiries, qualification, consultation/appointment requests, proposal or quotation follow-ups, missing client information, complaints, deadlines, and escalation. Retain retail cases only as regression coverage for existing behavior, not as the new primary target market. Evaluate correct use of approved facts, unknown/conflicting information, prompt-injection resistance, structured-output validity, escalation quality, latency, token usage/cost, rate limits, and reliability.

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

**Status:** Completed for the earlier retail-oriented research scope and documented in `docs/m4-feedback.md`; it does **not** validate the newly selected service-business market. Existing test findings remain useful as regression evidence. Re-check any noted payment-claim regex gap against current code and latest reports before treating it as open or fixed.

Historical findings & activities (retail-oriented; not proof of service-business fit):
- Evaluated recurring small-retailer enquiry archetypes in Ghana, including pricing/stock, delivery/location, Mobile Money payments, policies, and bargaining.
- Ran empirical lab tests against the live Google Gemini API; recorded grounding, unknown-data handling, and payment-claim guard behavior in the M4 report.
- Recorded historical latency/token estimates; remeasure current models and prices before using them for cost decisions.
- Identified structured product pricing/inventory as a bottleneck for retail queries.
- Recorded positive owner-approval feedback in the earlier research; do not generalize it to the service-business audience without a new pilot.

New requirement: M4 evidence must be extended with a service-business validation round before making claims about the new target market. Observe how pilot candidates manage enquiries, client commitments, proposals/quotations, appointments, pending documents, and follow-ups. Measure baseline and post-use outcomes where practical.

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

**Product focus:** run a small mixed-service pilot to validate the shared client-management workflow, not to replace WhatsApp or duplicate its basic business features.

Historical implementation note: the 2026-10-21 change log reports that the M7 P0 pilot-control code was implemented and a test/build gate passed. That does not by itself mean a real mixed-service pilot has been recruited, consented, deployed, or completed. Verify the current repository, deployment state, owner consent, and latest test report before updating the status.

Pilot workflow: incoming enquiry → client/conversation context → AI summary and missing information → suggested next action → owner-reviewed draft → owner-approved send → confirmed stage/commitment → dated follow-up task → daily action dashboard.

Requirements include:
- Explicit business-owner consent, onboarding, and a configured/approved business profile.
- A small mixed group of service businesses; keep the same core workflow and configure service-specific details rather than creating separate industry modules.
- Owner approval for outbound messages by default; no autonomous real-world actions during the initial pilot.
- Immediate human takeover that pauses automation and blocks queued sends; resume only after explicit hand-back.
- Per-business usage/spend limits, tenant isolation, auditability, monitoring, support, and incident/disconnect handling.
- Feedback on captured enquiries, next-action usefulness, follow-up completion, AI-draft corrections, time saved, and willingness to continue.
- Clear separation between verified facts and AI suggestions.

Expand only when evidence supports it. Do not label the product-market fit or commercial value validated merely because the technical pilot controls exist.

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
  Target audience         Service businesses     Agreed direction
                          and professionals in    (pilot hypothesis to
                          Ghana; small mixed      validate with users)
                          pilot group             

  WhatsApp relationship   LightDesk is an         Core product decision
                          operational layer on    confirmed by owner
                          top of WhatsApp, not    
                          a WhatsApp replacement; 
                          customers continue to   
                          use WhatsApp            

  Product differentiation Avoid duplicating      Agreed direction
                          basic WhatsApp Business 
                          features; focus on      
                          client context, tasks,  
                          commitments, follow-up, 
                          and action insights    

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

-   Which client-management problems recur across the mixed service-business pilot group?
-   What commitments are most often forgotten: callbacks, proposals, appointments, documents, or status updates?
-   Does a shared client/action workflow save time beyond WhatsApp Business's existing labels and quick replies?
-   Which metrics show a real improvement versus the business's baseline?
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

------------------------------------------------------------------------## 15. Change log
- **2026-10-25 (M8 Phase 4 §3 Cloudflare deploy executed — remote DB blocked by the Prisma-on-workerd engine issue; remaining steps & evidence in `docs/m8-cloudflare-deploy-checklist.md`):**
  The §3 deploy was run end to end against the deploy account — NOT the OAuth (`greatlightgroup247@gmail.com`, account `d0361ec5…`) wrangler login, but the owner-prepared account `7d0c14f60db72152e7e5179fc007133e` authenticated via `CF_TOKEN` from `.env.prod-secrets`. **Deploy commands must export `CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"`** (sourced with `tr -d '\r' < .env.prod-secrets` — the file has CRLF endings; a plain source silently breaks some values). Key facts:
  - Boundaries learned the hard way: the Hyperdrive config `lightdesk-pg` id `9ccd0462…` already existed on that deploy account (the wrangler.jsonc value was right); a stray same-named config (`db605e3c…`) accidentally created via the OAuth account was deleted; the 10-secrets/draft-worker shell the same session also created on the wrong account was deleted.
  - Owner had pre-seeded the deploy account's worker `lightdesk` with 10 secrets incl. `DATABASE_URL` (Neon pooled) and `WHATSAPP_OUTBOX_FLUSH_TOKEN` (ADR 0010); the 2026-10-25 secret puts (`WHATSAPP_TOKEN_ENCRYPTION_KEY` fresh prod value etc.) landed on the wrong account and were discarded. `WHATSAPP_APP_ID` is not stored on the deploy account (embedded-signup blocker surfaces when first used; `DEEPSEEK_MODEL`/`GEMINI_MODEL` omitted deliberately — code defaults apply, `LAB_AI_PROVIDER=deepseek` is a wrangler var).
  - Migrations: all 15 applied (Neon `neondb`, `ep-lucky-dawn-baqmo4c2.eu-central-1`, direct unpooled string; nothing pending).
  - Deployed: `opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion` + `wrangler deploy` → version `ce91e209-3894-4e4e-bff3-14d86f8c5233`, URL `https://lightdesk.lightdesk.workers.dev`, startup 14 ms. First deploy attempt(s) died on `ECONNRESET`/`UND_ERR_CONNECT_TIMEOUT` mid-version-upload to the API (Ghana-path lossiness); a bounded retry loop succeeded on attempt 2 (~150 s upload).
  - Smoke: `GET /api/health` 200 `{"status":"ok"}`; `GET /api/health/ready` 503 — encryption check ok, database unreachable: `PrismaClientInitializationError` "could not locate the Query Engine for runtime debian-openssl-1.1.x". This empirically confirms checklist §1/§4's known risk: the engine-dependent Prisma 6 client can never run in workerd, adapter notwithstanding. **Deploy is therefore NOT yet a usable hosted pilot; the engine-less Prisma path (new `prisma-client` generator + driver adapter, Prisma 7 target per the §4 investigation) remains the required next milestone before §4 acceptance checks can pass.**
- **2026-10-25 (Product direction refined: service businesses; LightDesk sits on top of WhatsApp):** Owner selected a small mixed group of service businesses and professionals for the first pilot. Reframed LightDesk as an AI-assisted client relationship and workflow layer that complements WhatsApp rather than replacing it. Customers continue to use WhatsApp; LightDesk focuses on client context, conversation summaries, commitments, next actions, tasks/follow-ups, and an action dashboard. Basic WhatsApp Business features are not the product's primary differentiator. Added the shared enquiry-to-follow-up workflow, configurable service-specific details, and pilot validation measures. Historical M4 research was retail-oriented and must not be represented as validation of the new service-business target. Existing milestone statuses and technical claims remain evidence-bound and must be checked against the actual repository and latest reports.
- **2026-10-21 (M7 P0 pilot controls implemented; Cloudflare evaluation phase 1 done):** Implemented the M7
  Controlled Pilot's code layer per the new spec `docs/m7-pilot.md` (owner decisions: ALL M7 gaps in code;
  Cloudflare is the hosting path to evaluate now). Additive migrations `20261021110233_m7_pilot_controls` +
  `20261021113044_m7_pilot_feedback_fk` add `PilotEnrollment` (PENDING_CONSENT/ACTIVE/PAUSED/EXITED, explicit
  owner consent with term version + audit), `UsageCaps` (per-business hard caps, floor 0, platform ceilings
  enforced in code: default 50 AI/day + 100 outbound/month, ceiling 200/800) and `PilotFeedback`
  (owner-to-platform feedback, never fed to the AI). New `modules/pilot/service.ts`: platform-admin-only
  enrollment lifecycle; OWNER-only consent/leave/caps (business may only narrow the ceiling); the
  deterministic gate `requirePilotActive` (un-enrolled businesses keep stock M6 behavior); cap counting over
  WhatsAppGeneration (UTC day) and SENT-like outbound (UTC month). Gates wired in server code BEFORE any AI
  call or Graph request: `runInboundAssist` (consent+daily AI cap -> skip + audit `pilot.cap.blocked`),
  `setConversationMode` (AI_ASSIST switch refused while not ACTIVE), `sendOwnerReply` (consent+monthly
  outbound cap -> refuse + `pilot.send.blocked`), and `getSendReadiness` surfaces pilot state + caps.
  Owner console: pilot panel on the WhatsApp settings page (consent terms, caps editor, leave button,
  feedback form). Platform console: `/admin/pilot` (enrollment candidates, per-business counters — AI today,
  outbound this month, open/escalated conversations, failed sends — and recent feedback; counters only, no
  conversation content) + header link. Two early bugs were caught by tests and fixed at cause: the
  duplicate-enrollment check ran after its upsert; an empty reasons-array was truthy (would have blocked
  everything) — both now return/branch correctly. Tests: 12 integration (`tests/integration/pilot-controls.test.ts`:
  admin-only enrollment, consent gate blocking mode switch + send, cross-tenant NOT_FOUND, owner leave,
  admin pause/resume, daily AI cap and monthly outbound cap with zero-Graph/call assertions, cap validation,
  feedback scoping/validation, admin overview with no-content-typing) + 8 unit (cap validation, categories).
  Full gate: lint 0 errors (1 pre-existing warning; `.open-next/**`/`.wrangler/**` added to eslint ignores
  because the Cloudflare build artifacts were blowing up lint memory), typecheck, 98 unit + 210 integration
  tests, production build — all green (staged under NODE_OPTIONS=1024MB after one OOM kill on the small runner).
  Cloudflare evaluation phase 1: `npx vinext check` reports this repo 100% compatible, but vinext 1.3.0 needs
  Vite 8 while Vitest 3.2.7 caps Vite ^7 — blocked pending upstream; the OpenNext adapter build SUCCEEDED on
  the real repo (`--dangerouslyUseUnsupportedNextVersion` only because Next 15.5 is past its own 2-year
  support window — upgrade to Next 16 is now an M8 item), and under `wrangler` (workerd) the app served
  /login + /api/health and executed a real Prisma token lookup through nodejs_compat. Deploy phase needs
  Cloudflare account access + a hosted PostgreSQL (runner inputs). Honest P1 boundary: no deploy has run yet,
  scrypt-under-workerd and the live webhook path are verification items for the deployed step.

-   **2026-10-21 (M6 LIVE end-to-end run + status callbacks):** The full M6 loop ran LIVE:
    Meta's webhook verified against a fresh tunnel, real customer messages from the owner's
    phone (Light, 2335942… ) processed through AI_ASSIST, and the owner send gate SUCCEEDED
    against live Graph: `wamid…RgSN0MxRENEOTJGQjA2RkM5RjlB` accepted, SENT row, meter 1/1000,
    audited with `fromDraftId`. The real Gemini draft for "Do you deliver to kumasi" used
    `gemini-3.5-flash`, 544 tokens (500 prompt / 44 completion, ~12.9s), grounded in the
    approved delivery fact ("Hello, we do not deliver. thank you", ANSWERABLE); message 1
    ("message 1") took the deterministic NEEDS_INFORMATION path with the conversation
    ESCALATED — both per design.
    Runbook caveats learned: BOTH inbound payloads were reconstructed via signed replays of
    Meta's exact body bytes after Meta's direct delivery POSTs only carried a subscription
    ping and status events (and one legit delivery hit during the dev-DB outage); Meta
    redelivery would dedupe by wamid, so the stored state is identical, but the direct wire
    completion should be re-proven in a quieter environment. A transient Meta
    `131031 "Business Account locked"` status was observed on a status event and had
    cleared before the real send. Quick-tunnel URLs change on every restart and the dev
    rig (server + DB container) went down twice during the run — re-registered + restarted
    each time; short pilot deployments should not rely on cloudflared quick tunnels.
    Gap fixed in the same session as part of the follow-up: delivery/read status callbacks
    now UPDATE rows (`processStatusUpdates`: monotonic SENT→DELIVERED→READ, FAILED only
    before READ; tenant-scoped; store the failure reason in `errorInfo`; audit
    `whatsapp.message.failed`; never auto-resend) via grouped typed parsing in
    `parseInboundPayload`; route response gained `statusUpdated`; the console renders the
    failure reason on the message. Tests: 6 integration
    (`tests/integration/whatsapp-status.test.ts`) + 2 unit parse tests.
-   **2026-10-21 (M6d Embedded Signup UI + onboarding service):** Implemented the last M6d
    piece: owner-driven connection of a real WhatsApp number through Meta's Embedded Signup.
    New graph helpers (code exchange, long-lived token upgrade, WABA/number discovery) in
    `modules/whatsapp/graph.ts`; new env `WHATSAPP_SIGNUP_CONFIG_ID` surfaced by
    `readWhatsappConfig`. New `WhatsAppPendingConnection` table (additive migration
    `20261021012917_m6d_embedded_signup_pending`) holds the exchanged
    long-lived token AES-256-GCM-encrypted between the two UI steps with a 10-minute TTL;
    tokens never round-trip through the browser and never reach logs or audit metadata.
    `modules/whatsapp/onboarding.ts` implements the flow: OWNER-only `startEmbeddedSignup`
    (exchange → upgrade → discovery; single number auto-binds after a live pre-flight read +
    WABA ownership cross-check; multiple numbers wait for the owner's encrypted choice via
    `completeEmbeddedSignupChoice`) and owner-only `disconnectWhatsAppConnection` (soft
    disconnect, history kept, pending cleaned, audited). Console page
    `/businesses/[businessId]/whatsapp/settings` renders connection state, token expiry,
    meter and the two flows; the inbox's empty state now links there. Members remain
    read-only. Tests: 10 integration (`tests/integration/whatsapp-connect.test.ts` — owner
    matrix, auto-bind with expiry, choose flow incl. cross-tenant NotFound and TTL, invalid
    code, failure audits, disconnect) + 4 unit graph tests; `tests/helpers/db.ts` now also
    truncates the pending table (its rows are deliberately not FK-cascade-owned). Remaining
    honest boundary: a LIVE signup click-through needs the Tech-Provider app + config id
    bound to a verified Business Portfolio (runner-provided inputs); flow is
    integration-tested with a fake Graph and documented in `docs/m6-whatsapp.md` §9.
-   **2026-10-21 (M6c: AI_ASSIST drafts + takeover state machine):** Implemented the last core
    M6 phase: per-conversation AI assistance, always with a human send gate. Additive migration
    `20261021002937_m6c_whatsapp_drafts`: `WhatsAppMessageStatus` gains `DRAFT`; new
    `WhatsAppMessageDraftState` enum (DRAFT/SUPERSEDED); `WhatsAppMessage` gains the lab-mirroring
    review columns (draftState, source, resultStatus, reason, missingInformation, evidence,
    profileRevision, generationId, approvedContent/id/by/at) and `wamid` is now nullable (drafts
    have no wamid until a person sends); new `WhatsAppGeneration` table mirrors `LabGeneration`
    (usage accounting, per-(conversation, wamid) idempotency, requestedById null = system).
    Architectural change: the M3 generation + M4 pre-check + M5 pipeline was extracted from
    `modules/lab/service.ts` into shared `modules/lab/pipeline.ts` (`computeDraft`), so lab and
    live drafts behave identically by construction; lab behavior/tests unchanged.
    `modules/whatsapp/assist.ts`: `runInboundAssist` drafts ONLY for AI_ASSIST conversations,
    stores status DRAFT/draftState DRAFT (never anything sent), rides the SAME per-business
    hourly cap as the lab (config.rateBusinessPerHour, skip + audit when reached), escalates
    non-answerable results on the conversation (inbox-visible), and never imports the Graph
    client — it physically cannot send. Webhook route triggers assist after storing a signed
    inbound (failures never break the 200 to Meta). `sendOwnerReply` now supersedes drafts on
    send and records `approvedContent` (the text actually sent); the send meter counts only
    SENT-like statuses (drafts never count toward the 1,000/month tier). New
    `setConversationMode` (owner/admin only per the §6 defaults, race-guarded, audited
    `whatsapp.conversation.mode_changed`): takeover marks pending drafts SUPERSEDED (kept, not
    deleted, per §3.3); "hand back to AI" immediately drafts the still-unanswered inbound.
    Console UI: conversation page gains AI draft rendering with status/reason/missing-info,
    control panel (enable AI / take over), and a draft-prefilled review-and-send form
    (`components/whatsapp/mode-controls.tsx`, draft-aware reply form). Tests: new
    `tests/integration/whatsapp-assist.test.ts` (10 tests: OWNER_ONLY default no-draft, webhook
    RULES draft, grounded AI draft with usage + no stale-draft feedback, escalation never
    AI-calls never auto-sends, wamid idempotency incl. webhook retry, hourly cap skip + audit,
    takeover stops drafting and marks drafts stale, hand-back drafts pending inbound,
    OWNER/ADMIN/member permission matrix, invalid-mode rejection, send supersedes + approved
    content + meter). Affected suites green: lab-service (45), whatsapp-webhook (10),
    whatsapp-send (9), whatsapp-assist (10). Full `npm run check` pending at the time of this
    entry — see the M6c report for the final gate result.
-   **2026-10-20 (Owner console UI; WhatsApp remains customer interface):** Owner confirmed that
    customers use only standard WhatsApp mobile/Desktop; LightDesk is backend orchestration; the
    business operator reviews in a private LightDesk console; human approval remains required.
    Documented that decision in `docs/m6-whatsapp.md` §§1, 7–8 (and clarified owner vs customer
    in `docs/m6-live-runbook.md`). Built `/businesses/[businessId]/whatsapp` inbox and
    `/whatsapp/[conversationId]` thread. Inbox surfaces connection status, customer name/phone,
    latest message, mode/state, timestamp. Thread shows inbound/outbound messages, status, service
    window close, free-tier meter, explicit owner/admin send form and closed-window warning; MEMBER
    has read-only console. New authorized service reads in `modules/whatsapp/service.ts` gate on
    `whatsapp:read`, scope by business, and never select token ciphertext; `getSendReadiness` now
    requires actorId, closing a prior auth gap. New server action derives actor from session and
    calls permission-checked `sendOwnerReply`. Workspace navigation only shows WhatsApp to members
    with read permission. Integration tests cover OWNER/ADMIN/MEMBER reads, cross-tenant denial,
    token non-disclosure. Full `npm run check` exit 0: 86 unit + 170 integration, lint,
    typecheck, production build. UI is an operator console only; no customer-facing chat UI was
    added.
-   **2026-10-20 (M6d outbound send gate + live runbook):** Implemented the owner-approved send
    gate. New permission `whatsapp:send` (OWNER/ADMIN per the spec's default decision;
    `whatsapp:read` also added for the upcoming conversation UI). `modules/whatsapp/graph.ts`
    gains `sendWhatsAppText` (POST /{version}/{phoneNumberId}/messages with reply-context wamid,
    fetch-injectable). `modules/whatsapp/service.ts` gains `getSendReadiness` (24h-window state,
    windowClosesAt, free-tier meter) and `sendOwnerReply`: requires `whatsapp:send`, refuses
    outside the 24-hour customer service window with an honest reason and ZERO Graph calls,
    decrypts the stored token (never logging it), surfaces the 1,000/month free service tier,
    records the OUTBOUND message (wamid-unique; retry race tolerated), updates the conversation,
    and audits `whatsapp.message.sent` / `whatsapp.send.failed` individually. Tests: 9 new
    send-gate integration tests (roles, window open/closed, meter across sends, token
    unavailable, Graph failure with safe reason) + 2 Graph-send unit tests. Gate: exit 0 (86
    unit + 167 integration, lint, typecheck, build). `docs/m6-live-runbook.md` documents the
    owner-side steps: public URL choice (hosted / tunnel), Meta dashboard webhook registration
    (callback `/api/whatsapp/webhook`, verify token), real customer inbound test against the
    test number, recipient allowlist before outbound, coexistence pairing + rebind script for
    the REAL number, and the code-verification caveat. Not executed from here (runner-side
    Meta credentials/public URL needed). Also bound the live credentials to the real business
    `light` (`cmvgvqbq30001bl0qxffa5r8g`) after fixing the setup script to distinguish Graph
    cross-check errors from genuine WABA mismatches (commit 7c636eb).
-   **2026-10-20 (Real webhook credentials wired + signature middleware):** The owner added
    WHATSAPP_APP_SECRET and WHATSAPP_TOKEN_ENCRYPTION_KEY to `.env` (only in `.env`, never
    committed). The webhook POST route was restructured into an explicit verify-first middleware
    guard (`verifyWebhookGuard`): it reads the body once (single-use), verifies
    X-Hub-Signature-256 against the app secret before any parsing, and returns the verified body —
    fixing a double-read bug caught while wiring it; a stale leftover block was removed and an
    unused type dropped from the setup script (lint back to the single pre-existing warning).
    Live smoke against the dev server with the real values: GET handshake echoes the challenge for
    `lightdesk_secure_token` (wrong token 403), POST with a bad signature 403, POST with a correct
    HMAC 200 `{received:0,unknown:1}` (no business connection bound to that native payload's
    PN1 yet — expected). Secret-box round-trip with the real key verified: 32-byte key loads,
    encrypt/decrypt round-trip works, tampered ciphertext and wrong-key both rejected.
    Full `npm run check`: exit 0 (84 unit + 158 integration, lint, typecheck, build).
-   **2026-10-20 (M6b core: webhook endpoint + inbound pipeline):** Implemented the M6 inbound
    path end-to-end behind signatures. Prisma migration `m6_whatsapp_core` adds
    `WhatsAppConnection` (token AES-256-GCM encrypted at rest via new
    `lib/security/secret-box.ts`, `WHATSAPP_TOKEN_ENCRYPTION_KEY` required for any token work),
    `WhatsAppConversation` (mode OWNER_ONLY by default — no AI call ever occurs in M6b), and
    `WhatsAppMessage` (wamid globally unique = idempotent webhook dedupe). Documented deliberate
    spec deviation in `docs/m6-whatsapp.md` §3.2: live traffic uses its own conversation table so
    the M3 lab's "simulation only, never real customer data" property survives in data, while the
    draft/approval UX is still shared. New public route `app/api/whatsapp/webhook/route.ts`: GET
    echoes the challenge only for a matching verify token (403 otherwise, challenge now required),
    POST fails closed without the app secret, verifies X-Hub-Signature-256 with
    timing-safe comparison, rejects malformed bodies, records inbound messages and audit events
    (`whatsapp.message.received`), always answers Meta quickly, and ignores messages for unknown/
    DISCONNECTED numbers. `modules/whatsapp/webhooks.ts` parses payload defensively (caps text at
    4000 chars, counts status events for M6d). `scripts/whatsapp-setup-connection.ts` binds
    verified .env credentials to a business (one live read first, never stores an unverified
    token; supports `--coexistence`). Gate: exit 0 with 84 unit + 158 integration tests, lint,
    typecheck, build. NOT yet done: AI_ASSIST mode + takeover (M6c), outbound gate (M6d),
    webhook URL registration in the Meta dashboard (needs a deployment URL), `WHATSAPP_APP_SECRET`
    + `WHATSAPP_TOKEN_ENCRYPTION_KEY` still missing in the owner's `.env`.
-   **2026-10-20 (Real Meta credentials verified live):** The project owner provided real WhatsApp
    Cloud API credentials (into `.env` only, never committed — gitignore verified). Initial run
    caught a real v26.0 drift: the phone-number node no longer exposes `account_id`, so the
    verify script was reworked to the stable two-call design (GET phone-number fields + independent
    WABA ownership cross-check via `GET /{wabaId}/phone_numbers`); tests extended to 9 unit tests
    and typecheck/lint re-passed (exit 0). Live result: token VALID, phone number reachable,
    quality GREEN — but this is Meta's provisioned TEST number ("Test Number", +1 555-677-5612,
    `code_verification_status: NOT_VERIFIED`), not yet a pilot business line; test numbers can
    only message pre-registered recipients. Next runner decisions: a real number strategy
    (coexistence vs. Cloud-only) and recipient allowlist entries for the test number.
-   **2026-10-20 (M6 scaffolding + real-credential gate):** Added the M6 environment scaffold and a
    live credential-verification gate ahead of wiring a real Meta API key. `.env.example` documents
    the full WHATSAPP_* env set (app id/secret, access token, WABA + phone-number ids, webhook
    verify token, Graph version defaulting to v26.0 — current per the Graph API changelog). New
    `modules/whatsapp/` skeleton: `config.ts` (mirrors the lab config pattern — missing settings
    surface as safe `issues`, never break sign-in), `graph.ts` (the only place Graph HTTP calls are
    made, fetch-injectable). New `scripts/whatsapp-verify.ts`: ONE read-only GET on the configured
    phone number proves the token works, shows display number/quality rating/verification status,
    and cross-checks the WABA id. Unit tests (`tests/unit/whatsapp.test.ts`, 6) cover config
    validation and Graph parsing with injected fakes — no network in tests. NOT committed: real
    credentials stay in `.env` only. Awaiting the user's real values in `.env` to run the script.
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
