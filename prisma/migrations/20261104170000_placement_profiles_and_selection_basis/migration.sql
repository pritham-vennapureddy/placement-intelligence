ALTER TABLE "InternalStageCandidate" ADD COLUMN "selectionBasis" TEXT;

CREATE TABLE "CandidateResumeAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "importBatchId" UUID,
    "analyzedAt" TIMESTAMP(3),
    "scores" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "projects" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateResumeAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateAdditionalProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidateId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "importBatchId" UUID,
    "classification" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateAdditionalProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateResumeAssessment_candidateId_jobRequestId_key" ON "CandidateResumeAssessment"("candidateId", "jobRequestId");
CREATE INDEX "CandidateResumeAssessment_jobRequestId_analyzedAt_idx" ON "CandidateResumeAssessment"("jobRequestId", "analyzedAt");
CREATE UNIQUE INDEX "CandidateAdditionalProfile_candidateId_jobRequestId_classification_sourceSheet_key" ON "CandidateAdditionalProfile"("candidateId", "jobRequestId", "classification", "sourceSheet");
CREATE INDEX "CandidateAdditionalProfile_jobRequestId_classification_idx" ON "CandidateAdditionalProfile"("jobRequestId", "classification");

ALTER TABLE "CandidateResumeAssessment" ADD CONSTRAINT "CandidateResumeAssessment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateResumeAssessment" ADD CONSTRAINT "CandidateResumeAssessment_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateResumeAssessment" ADD CONSTRAINT "CandidateResumeAssessment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateAdditionalProfile" ADD CONSTRAINT "CandidateAdditionalProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateAdditionalProfile" ADD CONSTRAINT "CandidateAdditionalProfile_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateAdditionalProfile" ADD CONSTRAINT "CandidateAdditionalProfile_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
