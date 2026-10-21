-- CreateEnum
CREATE TYPE "WhatsAppMessageDraftState" AS ENUM ('DRAFT', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedContent" TEXT,
ADD COLUMN     "draftState" "WhatsAppMessageDraftState",
ADD COLUMN     "escalationReason" TEXT,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "generationId" TEXT,
ADD COLUMN     "missingInformation" JSONB,
ADD COLUMN     "profileRevision" INTEGER,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "resultStatus" "LabResultStatus",
ADD COLUMN     "source" "LabDraftSource",
ALTER COLUMN "wamid" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WhatsAppGeneration" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "LabGenerationStatus" NOT NULL DEFAULT 'RUNNING',
    "usedAi" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "errorKind" TEXT,
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "inputChars" INTEGER NOT NULL,
    "draftMessageId" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppGeneration_businessId_createdAt_idx" ON "WhatsAppGeneration"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppGeneration_conversationId_idempotencyKey_key" ON "WhatsAppGeneration"("conversationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_draftState_idx" ON "WhatsAppMessage"("conversationId", "draftState");

-- AddForeignKey
ALTER TABLE "WhatsAppGeneration" ADD CONSTRAINT "WhatsAppGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
