-- Integrity rules Prisma's schema language cannot express (additive; new tables are empty).

ALTER TABLE "BusinessProfile"
  ADD CONSTRAINT "BusinessProfile_revision_positive_chk" CHECK ("revision" >= 1),
  -- a suspended profile always records why
  ADD CONSTRAINT "BusinessProfile_suspended_requires_reason_chk"
    CHECK ("status" <> 'SUSPENDED' OR ("statusReason" IS NOT NULL AND char_length("statusReason") BETWEEN 1 AND 300)),
  -- an active profile has been activated by someone
  ADD CONSTRAINT "BusinessProfile_active_requires_activation_chk"
    CHECK ("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL);

ALTER TABLE "ProfileEntry"
  ADD CONSTRAINT "ProfileEntry_key_format_chk" CHECK ("key" ~ '^[a-z][a-z_]{1,48}$'),
  ADD CONSTRAINT "ProfileEntry_value_length_chk" CHECK (char_length("value") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "ProfileEntry_approved_length_chk"
    CHECK ("approvedValue" IS NULL OR char_length("approvedValue") BETWEEN 1 AND 1000),
  -- approval provenance is all-or-nothing
  ADD CONSTRAINT "ProfileEntry_approval_consistency_chk"
    CHECK (("approvedValue" IS NULL) = ("approvedAt" IS NULL) AND ("approvedAt" IS NULL) = ("approvedById" IS NULL)),
  -- APPROVED means: there is an approved value and it equals the working value
  ADD CONSTRAINT "ProfileEntry_approved_state_chk"
    CHECK ("state" <> 'APPROVED' OR ("approvedValue" IS NOT NULL AND "approvedValue" = "value"));

ALTER TABLE "FaqEntry"
  ADD CONSTRAINT "FaqEntry_length_chk"
    CHECK (char_length("question") BETWEEN 5 AND 300
       AND char_length("answer") BETWEEN 1 AND 1500
       AND ("category" IS NULL OR char_length("category") BETWEEN 1 AND 60)),
  ADD CONSTRAINT "FaqEntry_approval_consistency_chk"
    CHECK (("approvedQuestion" IS NULL) = ("approvedAnswer" IS NULL)
       AND ("approvedQuestion" IS NULL) = ("approvedAt" IS NULL)
       AND ("approvedAt" IS NULL) = ("approvedById" IS NULL)),
  ADD CONSTRAINT "FaqEntry_approved_state_chk"
    CHECK ("state" <> 'APPROVED'
       OR ("approvedQuestion" IS NOT NULL AND "approvedQuestion" = "question"
           AND "approvedAnswer" IS NOT NULL AND "approvedAnswer" = "answer"));
