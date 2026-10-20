-- CreateTable
CREATE TABLE "CatalogueItem" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priceGhs" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "variants" TEXT,
    "sku" TEXT,
    "normalizedName" TEXT NOT NULL,
    "state" "ReviewState" NOT NULL DEFAULT 'DRAFT',
    "approvedName" TEXT,
    "approvedDescription" TEXT,
    "approvedCategory" TEXT,
    "approvedPriceGhs" DECIMAL(10,2),
    "approvedInStock" BOOLEAN,
    "approvedVariants" TEXT,
    "approvedSku" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogueItem_profileId_normalizedName_idx" ON "CatalogueItem"("profileId", "normalizedName");

-- CreateIndex
CREATE INDEX "CatalogueItem_profileId_state_idx" ON "CatalogueItem"("profileId", "state");

-- CreateIndex
CREATE INDEX "CatalogueItem_profileId_category_idx" ON "CatalogueItem"("profileId", "category");

-- AddForeignKey
ALTER TABLE "CatalogueItem" ADD CONSTRAINT "CatalogueItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity constraints for CatalogueItem
ALTER TABLE "CatalogueItem"
  ADD CONSTRAINT "CatalogueItem_name_length_chk"
    CHECK (char_length("name") BETWEEN 1 AND 120),
  ADD CONSTRAINT "CatalogueItem_price_nonnegative_chk"
    CHECK ("priceGhs" >= 0),
  ADD CONSTRAINT "CatalogueItem_revision_positive_chk"
    CHECK ("revision" >= 1),
  ADD CONSTRAINT "CatalogueItem_approval_consistency_chk"
    CHECK (("approvedName" IS NULL) = ("approvedPriceGhs" IS NULL)
       AND ("approvedName" IS NULL) = ("approvedAt" IS NULL)
       AND ("approvedAt" IS NULL) = ("approvedById" IS NULL)),
  ADD CONSTRAINT "CatalogueItem_approved_state_chk"
    CHECK ("state" <> 'APPROVED'
       OR ("approvedName" IS NOT NULL AND "approvedName" = "name"
           AND "approvedPriceGhs" IS NOT NULL AND "approvedPriceGhs" = "priceGhs"
           AND "approvedInStock" IS NOT NULL AND "approvedInStock" = "inStock"));

