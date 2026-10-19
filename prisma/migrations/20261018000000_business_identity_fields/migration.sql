-- M1: optional business identity fields. Additive only; existing rows and data are untouched.
ALTER TABLE "Business"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "location" TEXT;

ALTER TABLE "Business"
  ADD CONSTRAINT "Business_description_length_chk"
  CHECK ("description" IS NULL OR char_length("description") <= 500),
  ADD CONSTRAINT "Business_location_length_chk"
  CHECK ("location" IS NULL OR char_length("location") <= 120);
