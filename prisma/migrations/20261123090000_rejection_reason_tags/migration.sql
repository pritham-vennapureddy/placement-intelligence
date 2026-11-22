-- Company-round rejection reasons: a tag (built-in or team-made), a note and a doc link.
CREATE TABLE "RejectionReasonTag" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "archivedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RejectionReasonTag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RejectionReasonTag_archivedAt_sortOrder_idx" ON "RejectionReasonTag"("archivedAt", "sortOrder");
-- One live tag per label, ignoring case.
CREATE UNIQUE INDEX "RejectionReasonTag_label_live_key" ON "RejectionReasonTag"(LOWER("label")) WHERE "archivedAt" IS NULL;
ALTER TABLE "RejectionReasonTag" ADD CONSTRAINT "RejectionReasonTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyInterview" ADD COLUMN "rejectionTagId" UUID, ADD COLUMN "rejectionDocUrl" TEXT;
CREATE INDEX "CompanyInterview_rejectionTagId_idx" ON "CompanyInterview"("rejectionTagId");
ALTER TABLE "CompanyInterview" ADD CONSTRAINT "CompanyInterview_rejectionTagId_fkey" FOREIGN KEY ("rejectionTagId") REFERENCES "RejectionReasonTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "RejectionReasonTag" ("id", "label", "builtIn", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'Technical / coding', TRUE, 0, NOW()),
  (gen_random_uuid(), 'Communication', TRUE, 10, NOW()),
  (gen_random_uuid(), 'Aptitude / test score', TRUE, 20, NOW()),
  (gen_random_uuid(), 'Resume / profile not a fit', TRUE, 30, NOW()),
  (gen_random_uuid(), 'Eligibility (marks, batch, location)', TRUE, 40, NOW()),
  (gen_random_uuid(), 'Did not attend / no response', TRUE, 50, NOW()),
  (gen_random_uuid(), 'Not interested / withdrew', TRUE, 60, NOW()),
  (gen_random_uuid(), 'Attitude / seriousness', TRUE, 70, NOW()),
  (gen_random_uuid(), 'Salary / location mismatch', TRUE, 80, NOW()),
  (gen_random_uuid(), 'Company closed / role on hold', TRUE, 90, NOW()),
  (gen_random_uuid(), 'Other', TRUE, 100, NOW());
