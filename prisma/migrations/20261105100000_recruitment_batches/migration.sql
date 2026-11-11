CREATE TYPE "RecruitmentBatchStatus" AS ENUM ('ACTIVE', 'CLOSED');

CREATE TABLE "RecruitmentBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobRequestId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "RecruitmentBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "openings" INTEGER,
    "startsAt" DATE,
    "endsAt" DATE,
    "internalSheetUrl" TEXT,
    "companySheetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentBatch_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RecruitmentBatch" ("id", "jobRequestId", "name", "sequence", "status", "internalSheetUrl", "companySheetUrl", "updatedAt")
SELECT gen_random_uuid(), j."id", 'Batch 1', 1, 'ACTIVE', j."internalSheetUrl", j."companySheetUrl", CURRENT_TIMESTAMP FROM "JobRequest" j;

ALTER TABLE "Application" ADD COLUMN "recruitmentBatchId" UUID;
UPDATE "Application" a SET "recruitmentBatchId" = b."id" FROM "RecruitmentBatch" b WHERE b."jobRequestId" = a."jobRequestId" AND b.sequence = 1;
ALTER TABLE "Application" ALTER COLUMN "recruitmentBatchId" SET NOT NULL;
DROP INDEX IF EXISTS "Application_candidateId_jobRequestId_key";
CREATE UNIQUE INDEX "Application_candidateId_jobRequestId_recruitmentBatchId_key" ON "Application"("candidateId", "jobRequestId", "recruitmentBatchId");
CREATE INDEX "Application_recruitmentBatchId_status_idx" ON "Application"("recruitmentBatchId", "status");

ALTER TABLE "ImportBatch" ADD COLUMN "recruitmentBatchId" UUID;
UPDATE "ImportBatch" i SET "recruitmentBatchId" = b."id" FROM "RecruitmentBatch" b WHERE b."jobRequestId" = i."jobRequestId" AND b.sequence = 1;
ALTER TABLE "ImportBatch" ALTER COLUMN "recruitmentBatchId" SET NOT NULL;
CREATE INDEX "ImportBatch_recruitmentBatchId_createdAt_idx" ON "ImportBatch"("recruitmentBatchId", "createdAt");

ALTER TABLE "CandidateResumeAssessment" ADD COLUMN "recruitmentBatchId" UUID;
UPDATE "CandidateResumeAssessment" r SET "recruitmentBatchId" = b."id" FROM "RecruitmentBatch" b WHERE b."jobRequestId" = r."jobRequestId" AND b.sequence = 1;
ALTER TABLE "CandidateResumeAssessment" ALTER COLUMN "recruitmentBatchId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateResumeAssessment_candidateId_jobRequestId_key";
CREATE UNIQUE INDEX "CandidateResumeAssessment_candidateId_jobRequestId_recruitmentBatchId_key" ON "CandidateResumeAssessment"("candidateId", "jobRequestId", "recruitmentBatchId");
CREATE INDEX "CandidateResumeAssessment_recruitmentBatchId_analyzedAt_idx" ON "CandidateResumeAssessment"("recruitmentBatchId", "analyzedAt");

ALTER TABLE "CandidateAdditionalProfile" ADD COLUMN "recruitmentBatchId" UUID;
UPDATE "CandidateAdditionalProfile" p SET "recruitmentBatchId" = b."id" FROM "RecruitmentBatch" b WHERE b."jobRequestId" = p."jobRequestId" AND b.sequence = 1;
ALTER TABLE "CandidateAdditionalProfile" ALTER COLUMN "recruitmentBatchId" SET NOT NULL;
DROP INDEX IF EXISTS "CandidateAdditionalProfile_candidateId_jobRequestId_classification_sourceSheet_key";
CREATE UNIQUE INDEX "CandidateAdditionalProfile_candidateId_jobRequestId_recruitmentBatchId_classification_sourceSheet_key" ON "CandidateAdditionalProfile"("candidateId", "jobRequestId", "recruitmentBatchId", "classification", "sourceSheet");
CREATE INDEX "CandidateAdditionalProfile_recruitmentBatchId_classification_idx" ON "CandidateAdditionalProfile"("recruitmentBatchId", "classification");

ALTER TABLE "CompanyInterviewRound" ADD COLUMN "recruitmentBatchId" UUID;
UPDATE "CompanyInterviewRound" r SET "recruitmentBatchId" = b."id" FROM "RecruitmentBatch" b WHERE b."jobRequestId" = r."jobRequestId" AND b.sequence = 1;
ALTER TABLE "CompanyInterviewRound" ALTER COLUMN "recruitmentBatchId" SET NOT NULL;
DROP INDEX IF EXISTS "CompanyInterviewRound_jobRequestId_name_key";
CREATE UNIQUE INDEX "CompanyInterviewRound_jobRequestId_recruitmentBatchId_name_key" ON "CompanyInterviewRound"("jobRequestId", "recruitmentBatchId", "name");
CREATE INDEX "CompanyInterviewRound_recruitmentBatchId_sequence_idx" ON "CompanyInterviewRound"("recruitmentBatchId", "sequence");

CREATE UNIQUE INDEX "RecruitmentBatch_jobRequestId_sequence_key" ON "RecruitmentBatch"("jobRequestId", "sequence");
CREATE UNIQUE INDEX "RecruitmentBatch_jobRequestId_name_key" ON "RecruitmentBatch"("jobRequestId", "name");
CREATE INDEX "RecruitmentBatch_jobRequestId_status_sequence_idx" ON "RecruitmentBatch"("jobRequestId", "status", "sequence");

ALTER TABLE "RecruitmentBatch" ADD CONSTRAINT "RecruitmentBatch_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_recruitmentBatchId_fkey" FOREIGN KEY ("recruitmentBatchId") REFERENCES "RecruitmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_recruitmentBatchId_fkey" FOREIGN KEY ("recruitmentBatchId") REFERENCES "RecruitmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateResumeAssessment" ADD CONSTRAINT "CandidateResumeAssessment_recruitmentBatchId_fkey" FOREIGN KEY ("recruitmentBatchId") REFERENCES "RecruitmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateAdditionalProfile" ADD CONSTRAINT "CandidateAdditionalProfile_recruitmentBatchId_fkey" FOREIGN KEY ("recruitmentBatchId") REFERENCES "RecruitmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyInterviewRound" ADD CONSTRAINT "CompanyInterviewRound_recruitmentBatchId_fkey" FOREIGN KEY ("recruitmentBatchId") REFERENCES "RecruitmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
