-- Integrity constraints Prisma's schema language cannot express.
-- Hand-written; see docs/data-model.md.

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_chk"
  CHECK ("email" = lower(btrim("email")) AND char_length("email") BETWEEN 3 AND 254);

ALTER TABLE "Business"
  ADD CONSTRAINT "Business_slug_format_chk"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") <= 63);

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_token_hash_format_chk"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_email_normalized_chk"
  CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "Invitation_token_hash_format_chk"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Invitation_expiry_after_creation_chk"
  CHECK ("expiresAt" > "createdAt"),
  -- accepted state is all-or-nothing
  ADD CONSTRAINT "Invitation_accept_consistency_chk"
  CHECK (("acceptedAt" IS NULL) = ("acceptedById" IS NULL)),
  -- an invitation cannot be both accepted and revoked
  ADD CONSTRAINT "Invitation_not_accepted_and_revoked_chk"
  CHECK (NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));

-- At most one pending (not accepted, not revoked) invitation per business+email.
CREATE UNIQUE INDEX "Invitation_one_pending_per_email_key"
  ON "Invitation"("businessId", "email")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
