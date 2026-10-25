-- ADR 0010 (M8 Phase 2): WhatsApp outbound outage queue + send-path circuit breaker.
-- Additive: new enum value, nullable/defaulted columns, one flush index. Existing rows keep nulls.

-- AddEnumValue (Postgres allows ADD VALUE in migration order; QUEUED must exist before it is referenced)
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'QUEUED';

-- AddQueueColumns (WhatsAppMessage)
ALTER TABLE "WhatsAppMessage" ADD COLUMN "queuedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessage" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessage" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "maxAttempts" INTEGER;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "lastErrorKind" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "lastErrorAt" TIMESTAMP(3);

-- AddCircuitColumns (WhatsAppConnection)
ALTER TABLE "WhatsAppConnection" ADD COLUMN "consecutiveSendFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppConnection" ADD COLUMN "providerDownSince" TIMESTAMP(3);

-- Flusher due-work index
CREATE INDEX "WhatsAppMessage_status_nextAttemptAt_idx" ON "WhatsAppMessage"("status", "nextAttemptAt");
