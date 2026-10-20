# ADR 0008 — Milestone 5: Structured Catalogue & Data Management Hardening

## Status
Proposed / Approved for Implementation.

## Context
Milestone 4 (Real-User Feedback) demonstrated that ~50% of routine retail enquiries in Ghana concern specific product prices, variants (sizes, colors), and stock availability. 

Under the Milestone 2 BIP architecture, `offerings_summary` is a bounded free-text string without price/stock semantics. Consequently, any specific price or inventory query correctly triggers a safe holding reply (`needs_information`). While safe, this limits the assistant's commercial utility for retail shops.

Furthermore, retail stores frequently manage dozens or hundreds of items. Manually writing individual FAQs for each product is impractical. Retailers need a structured product catalogue, bulk import capabilities, duplicate detection, and Mobile Money (MoMo) payment instructions, while strictly preserving LightDesk's core safety invariant: **never silently overwrite approved business facts**.

---

## Architectural Decisions

### 1. Dedicated `CatalogueItem` Model with Working vs. Approved State
Following ADR 0005, each catalogue item retains both its working state (for draft edits) and its last approved state (consumed by the AI and customer-facing features):
- **Working fields:** `name`, `description`, `category`, `priceGhs` (Decimal), `inStock` (Boolean), `variants` (text summary, e.g. "Sizes: 40-45 | Colors: Black, Blue"), `sku` (optional identifier).
- **Approved fields:** `approvedName`, `approvedDescription`, `approvedCategory`, `approvedPriceGhs`, `approvedInStock`, `approvedVariants`.
- **Governance:** `state` (`DRAFT`, `APPROVED`), `revision`, `createdById`, `updatedById`, `approvedById`, `approvedAt`.
- **Tenancy:** Linked to `BusinessProfile` with cascading tenant isolation on `businessId`.

### 2. Mobile Money & Payment Procedure in BIP
Add structured payment policies to the `POLICY` module in `modules/business-profile/catalog.ts`:
- `payment_methods`: Approved payment options (e.g. "MTN MoMo, Telecel Cash, Cash on Delivery").
- `momo_details`: Official registered merchant name and payment number.
- `payment_terms`: When payment is expected (e.g. "Payment on delivery in Accra; advance payment required for bus delivery to other regions").

### 3. Duplicate & Conflict Detection
- **Duplicate Detection:** Normalizes product names using `compareForm` (ignoring case, punctuation, and whitespace). Warns owners before creating duplicate entries.
- **Cross-Record Conflict Detection:** Flags discrepancies between catalogue prices and FAQ answers mentioning prices for the same product, requiring owner resolution.

### 4. Safe Bulk Import Staging
- Bulk import (CSV / JSON) parses and validates rows using Zod.
- **No silent overwrites:** Imported items enter `DRAFT` review state. They never automatically overwrite active, approved catalogue items.
- Owners must review the staged diff and explicitly approve imported items.

### 5. Laboratory Retrieval Integration
- The retrieval engine (`modules/lab/retrieval.ts`) matches customer tokens against approved catalogue items (`approvedName`, `approvedCategory`, `approvedVariants`).
- Retrieved items provide structured evidence (e.g. `C1: [Product] Nike Air Max — 450.00 GHS (In Stock; Sizes 41-44)`).
- Grounding guards enforce that prices quoted in drafts strictly match approved catalogue figures.
