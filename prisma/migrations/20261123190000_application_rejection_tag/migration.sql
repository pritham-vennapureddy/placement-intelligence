-- The RSA team tags why the company did not select a student, per student and drive.
ALTER TABLE "Application" ADD COLUMN "rejectionTagId" UUID;
CREATE INDEX "Application_rejectionTagId_idx" ON "Application"("rejectionTagId");
ALTER TABLE "Application" ADD CONSTRAINT "Application_rejectionTagId_fkey" FOREIGN KEY ("rejectionTagId") REFERENCES "RejectionReasonTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
