# Milestone 5 — Data Management Hardening & Structured Catalogue

## Overview

Milestone 5 builds directly upon the findings from Milestone 4:
1. Small retailers need a **structured product catalogue** (name, price, stock status, variants) rather than relying solely on free-text descriptions.
2. Businesses in Ghana need **structured Mobile Money (MoMo) and payment instructions** to prevent customer fraud and streamline payment queries.
3. The system needs **duplicate detection, conflict detection, and safe bulk import** while upholding the invariant: **never silently overwrite approved business facts**.
4. The AI Conversation Laboratory must retrieve approved catalogue items and verify that price quotes match approved records.

---

## 1. Schema Additions (Additive Migration)

Add the `CatalogueItem` model to `prisma/schema.prisma`:

```prisma
model CatalogueItem {
  id                  String      @id @default(cuid())
  profileId           String
  name                String      @db.VarChar(120)
  description         String?     @db.VarChar(500)
  category            String?     @db.VarChar(80)
  priceGhs            Decimal     @db.Decimal(10, 2)
  currency            String      @default("GHS") @db.VarChar(10)
  inStock             Boolean     @default(true)
  variants            String?     @db.VarChar(200) // e.g. "Sizes: 38-44 | Colors: Red, Black"
  sku                 String?     @db.VarChar(50)
  normalizedName      String      @db.VarChar(120) // for duplicate detection
  
  // Review & governance (mirrors M2 ProfileEntry/FaqEntry)
  state               ReviewState @default(DRAFT)
  approvedName        String?     @db.VarChar(120)
  approvedDescription String?     @db.VarChar(500)
  approvedCategory    String?     @db.VarChar(80)
  approvedPriceGhs    Decimal?    @db.Decimal(10, 2)
  approvedInStock     Boolean?
  approvedVariants    String?     @db.VarChar(200)
  revision            Int         @default(1)
  
  createdById         String
  updatedById         String
  approvedById        String?
  approvedAt          DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  profile BusinessProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, normalizedName])
  @@index([profileId, state])
  @@index([profileId, category])
}
```

Update `BusinessProfile` relation:
```prisma
model BusinessProfile {
  // ... existing fields ...
  catalogueItems CatalogueItem[]
}
```

---

## 2. BIP Catalog Policy Updates

Add payment procedures to `modules/business-profile/catalog.ts` under the `POLICY` module:
- `payment_methods`: Approved payment channels (e.g. "MTN MoMo, Telecel Cash, Cash on Delivery").
- `momo_details`: Official registered merchant name and account number.
- `payment_terms`: Rules for when payment is expected (e.g. "Payment on delivery in Accra; advance payment for regional bus delivery").

---

## 3. Service Layer & Hardening

### 3.1 Catalogue Management Service (`modules/catalogue/service.ts`)
- `listCatalogueItems(businessId, actor, filters)`: Returns catalogue items for the business with role filtering.
- `saveCatalogueItem(businessId, actor, input)`: Creates or updates a working catalogue item in `DRAFT` state. Validates duplicate names and returns warnings.
- `approveCatalogueItem(businessId, actor, itemId)`: **Owner-only**. Promotes working fields to approved fields, increments revision, records audit event.
- `deleteCatalogueItem(businessId, actor, itemId)`: **Owner or creator**. Removes item and records audit event.

### 3.2 Duplicate & Conflict Detection
- `detectDuplicates(profileId, name, excludeItemId?)`: Checks if `normalizedName` already exists in working or approved items.
- `detectPriceConflicts(profileId)`: Cross-references FAQ texts against catalogue items. If an FAQ mentions a price differing from an approved catalogue item for the same item name, flags a conflict.

### 3.3 Safe Staged Bulk Import (`modules/catalogue/import.ts`)
- Accepts CSV or JSON data (name, category, price, inStock, variants, sku).
- Validates rows using Zod schema.
- **Staging rule:** All imported items are saved in `DRAFT` review state. Never silently overwrite existing approved items.
- Provides a summary: `created`, `updatedDrafts`, `conflictsDetected`.

---

## 4. Laboratory Integration

### 4.1 Retrieval Engine (`modules/lab/retrieval.ts`)
- Query approved catalogue items where `state = APPROVED` and `approvedInStock = true`.
- Match against customer enquiry tokens.
- Add evidence items:
  ```ts
  {
    kind: "catalogue",
    sourceId: item.id,
    label: `Product: ${item.approvedName}`,
    text: `Product: ${item.approvedName}\nPrice: ${item.approvedPriceGhs} GHS\nStatus: In Stock\nVariants: ${item.approvedVariants ?? "Standard"}`
  }
  ```

### 4.2 Grounding Guards (`modules/lab/rules.ts` & `result.ts`)
- If the assistant draft quotes a price (e.g. "450 GHS"), verify the figure exists in the retrieved catalogue evidence or customer's message.
- If unverified, fall back to holding reply.

---

## 5. Quality Gates & Verification

| Check | Result |
|---|---|
| `npm run db:migrate` (additive `CatalogueItem` migration) | PASSED (8 total migrations, schema up to date) |
| `npm run lint` / `npm run typecheck` | PASSED (0 errors) |
| `npm run test:unit` | PASSED (9 test files, 67 tests) |
| `npm run test:integration` | PASSED (11 test files, 150 tests) |
| `npm run build` | PASSED (Next.js production build succeeded) |
| Price conflict detection & lab retrieval | PASSED (Verified end-to-end) |
