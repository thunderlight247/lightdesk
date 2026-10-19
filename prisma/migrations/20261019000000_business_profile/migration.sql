-- M2: Business Intelligence Profile. Additive only: new enums and tables, no existing table is altered.

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProfileModule" AS ENUM ('IDENTITY', 'OFFERINGS', 'COMMUNICATION', 'POLICY', 'PERMISSION');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedById" TEXT,
    "statusReason" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileEntry" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "module" "ProfileModule" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "approvedValue" TEXT,
    "state" "ReviewState" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "normalizedQuestion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "state" "ReviewState" NOT NULL DEFAULT 'DRAFT',
    "approvedQuestion" TEXT,
    "approvedAnswer" TEXT,
    "approvedCategory" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_businessId_key" ON "BusinessProfile"("businessId");

-- CreateIndex
CREATE INDEX "ProfileEntry_profileId_idx" ON "ProfileEntry"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileEntry_profileId_module_key_key" ON "ProfileEntry"("profileId", "module", "key");

-- CreateIndex
CREATE INDEX "FaqEntry_profileId_normalizedQuestion_idx" ON "FaqEntry"("profileId", "normalizedQuestion");

-- CreateIndex
CREATE INDEX "FaqEntry_profileId_isActive_idx" ON "FaqEntry"("profileId", "isActive");

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileEntry" ADD CONSTRAINT "ProfileEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
