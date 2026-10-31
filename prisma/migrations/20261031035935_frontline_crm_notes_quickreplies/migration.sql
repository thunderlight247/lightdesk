-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToId" TEXT;

-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationType" TEXT NOT NULL DEFAULT 'whatsapp',
    "content" VARCHAR(1000) NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerName" VARCHAR(120) NOT NULL,
    "customerPhone" VARCHAR(40) NOT NULL,
    "items" JSONB NOT NULL,
    "totalGhs" DECIMAL(10,2) NOT NULL,
    "deliveryAddress" VARCHAR(300),
    "deliveryNotes" VARCHAR(500),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "receiptRef" VARCHAR(100),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "shortcut" VARCHAR(40) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "category" VARCHAR(50),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationNote_businessId_conversationId_idx" ON "ConversationNote"("businessId", "conversationId");

-- CreateIndex
CREATE INDEX "ConversationNote_conversationId_createdAt_idx" ON "ConversationNote"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderLead_businessId_status_idx" ON "OrderLead"("businessId", "status");

-- CreateIndex
CREATE INDEX "OrderLead_businessId_createdAt_idx" ON "OrderLead"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderLead_conversationId_idx" ON "OrderLead"("conversationId");

-- CreateIndex
CREATE INDEX "QuickReply_businessId_category_idx" ON "QuickReply"("businessId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_businessId_shortcut_key" ON "QuickReply"("businessId", "shortcut");

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLead" ADD CONSTRAINT "OrderLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLead" ADD CONSTRAINT "OrderLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLead" ADD CONSTRAINT "OrderLead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
