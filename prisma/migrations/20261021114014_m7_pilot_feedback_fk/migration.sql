-- DropForeignKey
ALTER TABLE "PilotFeedback" DROP CONSTRAINT "PilotFeedback_enrollment_fkey";

-- AddForeignKey
ALTER TABLE "PilotFeedback" ADD CONSTRAINT "PilotFeedback_enrollment_fkey" FOREIGN KEY ("businessId") REFERENCES "PilotEnrollment"("businessId") ON DELETE CASCADE ON UPDATE CASCADE;
