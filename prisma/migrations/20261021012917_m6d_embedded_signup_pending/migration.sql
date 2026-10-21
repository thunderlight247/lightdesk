-- CreateTable
CREATE TABLE "WhatsAppPendingConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppPendingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPendingConnection_businessId_key" ON "WhatsAppPendingConnection"("businessId");

-- CreateIndex
CREATE INDEX "WhatsAppPendingConnection_createdAt_idx" ON "WhatsAppPendingConnection"("createdAt");
