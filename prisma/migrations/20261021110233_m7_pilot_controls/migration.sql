-- CreateEnum
CREATE TYPE "PilotEnrollmentStatus" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'PAUSED', 'EXITED');

-- CreateTable
CREATE TABLE "PilotEnrollment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "PilotEnrollmentStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "consentTextVersion" VARCHAR(40) NOT NULL DEFAULT 'v1',
    "consentById" TEXT,
    "consentAt" TIMESTAMP(3),
    "pausedReason" VARCHAR(200),
    "note" VARCHAR(500),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCaps" (
    "businessId" TEXT NOT NULL,
    "aiCallsPerDay" INTEGER NOT NULL,
    "outboundPerMonth" INTEGER NOT NULL,

    CONSTRAINT "UsageCaps_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "PilotFeedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "comment" VARCHAR(1000) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotEnrollment_businessId_key" ON "PilotEnrollment"("businessId");

-- CreateIndex
CREATE INDEX "PilotFeedback_businessId_createdAt_idx" ON "PilotFeedback"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "PilotEnrollment" ADD CONSTRAINT "PilotEnrollment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCaps" ADD CONSTRAINT "UsageCaps_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFeedback" ADD CONSTRAINT "PilotFeedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFeedback" ADD CONSTRAINT "PilotFeedback_enrollment_fkey" FOREIGN KEY ("businessId") REFERENCES "PilotEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotFeedback" ADD CONSTRAINT "PilotFeedback_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
