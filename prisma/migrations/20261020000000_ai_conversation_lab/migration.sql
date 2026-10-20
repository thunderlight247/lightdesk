-- M3: AI Conversation Laboratory. Additive only: new enums and tables; no existing table is altered.

-- CreateEnum
CREATE TYPE "LabConversationStatus" AS ENUM ('ACTIVE', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LabMessageRole" AS ENUM ('CUSTOMER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "LabDraftState" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LabDraftSource" AS ENUM ('AI', 'RULES');

-- CreateEnum
CREATE TYPE "LabResultStatus" AS ENUM ('ANSWERABLE', 'NEEDS_INFORMATION', 'CONFLICT_DETECTED', 'ESCALATION_REQUIRED');

-- CreateEnum
CREATE TYPE "LabGenerationStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "LabConversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT,
    "customerLabel" TEXT NOT NULL DEFAULT 'Test customer',
    "status" "LabConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "escalationReason" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "LabMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftState" "LabDraftState",
    "source" "LabDraftSource",
    "resultStatus" "LabResultStatus",
    "reason" TEXT,
    "missingInformation" JSONB,
    "escalationReason" TEXT,
    "evidence" JSONB,
    "profileRevision" INTEGER,
    "generationId" TEXT,
    "approvedContent" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "LabMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabGeneration" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LabGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabConversation_businessId_lastMessageAt_idx" ON "LabConversation"("businessId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "LabConversation_businessId_createdById_idx" ON "LabConversation"("businessId", "createdById");

-- CreateIndex
CREATE INDEX "LabMessage_conversationId_createdAt_idx" ON "LabMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabMessage_conversationId_seq_key" ON "LabMessage"("conversationId", "seq");

-- CreateIndex
CREATE INDEX "LabGeneration_businessId_createdAt_idx" ON "LabGeneration"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "LabGeneration_requestedById_createdAt_idx" ON "LabGeneration"("requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabGeneration_conversationId_idempotencyKey_key" ON "LabGeneration"("conversationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "LabConversation" ADD CONSTRAINT "LabConversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabMessage" ADD CONSTRAINT "LabMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LabConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabGeneration" ADD CONSTRAINT "LabGeneration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LabConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
