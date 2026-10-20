-- Integrity rules Prisma cannot express. New tables are empty, so these are safe to add.

ALTER TABLE "LabConversation"
  ADD CONSTRAINT "LabConversation_label_length_chk" CHECK (char_length("customerLabel") BETWEEN 1 AND 40),
  ADD CONSTRAINT "LabConversation_title_length_chk" CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 80),
  -- an escalated conversation always records why
  ADD CONSTRAINT "LabConversation_escalated_requires_reason_chk"
    CHECK ("status" <> 'ESCALATED' OR ("escalationReason" IS NOT NULL AND char_length("escalationReason") BETWEEN 1 AND 400)),
  ADD CONSTRAINT "LabConversation_resolved_requires_timestamp_chk"
    CHECK ("status" <> 'RESOLVED' OR "resolvedAt" IS NOT NULL);

ALTER TABLE "LabMessage"
  ADD CONSTRAINT "LabMessage_seq_positive_chk" CHECK ("seq" >= 1),
  ADD CONSTRAINT "LabMessage_content_length_chk" CHECK (char_length("content") BETWEEN 1 AND 1500),
  -- customer rows carry no draft metadata; assistant rows always do
  ADD CONSTRAINT "LabMessage_role_shape_chk" CHECK (
    ("role" = 'CUSTOMER' AND "draftState" IS NULL AND "source" IS NULL AND "resultStatus" IS NULL
       AND "approvedContent" IS NULL AND "approvedAt" IS NULL AND "approvedById" IS NULL)
    OR
    ("role" = 'ASSISTANT' AND "draftState" IS NOT NULL AND "source" IS NOT NULL AND "resultStatus" IS NOT NULL)
  ),
  -- approved <=> approved text + who + when are all present
  ADD CONSTRAINT "LabMessage_approval_consistency_chk" CHECK (
    ("draftState" IS DISTINCT FROM 'APPROVED'
       AND "approvedContent" IS NULL AND "approvedAt" IS NULL AND "approvedById" IS NULL)
    OR
    ("draftState" = 'APPROVED'
       AND "approvedContent" IS NOT NULL AND char_length("approvedContent") BETWEEN 1 AND 1500
       AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)
  );

ALTER TABLE "LabGeneration"
  ADD CONSTRAINT "LabGeneration_key_format_chk" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{8,64}$'),
  ADD CONSTRAINT "LabGeneration_usage_nonnegative_chk" CHECK (
    ("promptTokens" IS NULL OR "promptTokens" >= 0)
    AND ("completionTokens" IS NULL OR "completionTokens" >= 0)
    AND ("totalTokens" IS NULL OR "totalTokens" >= 0)
    AND ("latencyMs" IS NULL OR "latencyMs" >= 0)),
  ADD CONSTRAINT "LabGeneration_failed_requires_kind_chk" CHECK ("status" <> 'FAILED' OR "errorKind" IS NOT NULL),
  ADD CONSTRAINT "LabGeneration_finished_requires_timestamp_chk" CHECK ("status" = 'RUNNING' OR "finishedAt" IS NOT NULL);

-- At most ONE in-flight generation per conversation: concurrent submissions cannot pile up AI calls.
CREATE UNIQUE INDEX "LabGeneration_one_running_per_conversation_key"
  ON "LabGeneration"("conversationId")
  WHERE "status" = 'RUNNING';
