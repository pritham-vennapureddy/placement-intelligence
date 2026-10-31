-- CreateEnum
CREATE TYPE "AssessedPoolStatus" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('MANUAL', 'IMPORT', 'SYSTEM', 'CARRIED_OVER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "InternalStage" AS ENUM ('TOTAL_APPLICATIONS', 'RESUME_SHORTLIST', 'SCREENING_SHORTLIST', 'ASSIGNMENT_SHORTLIST', 'FINAL_SHORTLIST');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_CONDUCTED');

-- CreateEnum
CREATE TYPE "StageCandidateOutcome" AS ENUM ('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD', 'NO_SHOW', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ScreeningPriority" AS ENUM ('P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "NominationStatus" AS ENUM ('NOMINATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CompanyPipelineStatus" AS ENUM ('NOT_SUBMITTED', 'IN_PROCESS', 'ON_HOLD', 'REJECTED', 'SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED', 'DROPPED');

-- CreateEnum
CREATE TYPE "InterviewRoundType" AS ENUM ('RESUME_SCREENING', 'ASSIGNMENT', 'TECHNICAL', 'MANAGERIAL', 'HR', 'CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewOutcome" AS ENUM ('SCHEDULED', 'CLEARED', 'REJECTED', 'ON_HOLD', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportSourceType" AS ENUM ('EXCEL', 'CSV', 'GOOGLE_SHEETS');

-- CreateEnum
CREATE TYPE "ImportTarget" AS ENUM ('INTERNAL_SCREENING', 'COMPANY_PIPELINE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'WARNING', 'INVALID');

-- CreateEnum
CREATE TYPE "RecordApprovalStatus" AS ENUM ('INCLUDED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "StagingAction" AS ENUM ('CREATE', 'UPDATE', 'NO_CHANGE', 'CONFLICT', 'SKIP');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('ERROR', 'WARNING', 'INFO');

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL,
    "candidateCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "gender" TEXT,
    "currentCity" TEXT,
    "state" TEXT,
    "college" TEXT,
    "degree" TEXT,
    "department" TEXT,
    "graduationYear" INTEGER,
    "academicScore" DECIMAL(5,2),
    "resumeUrl" TEXT,
    "category" "CandidateCategory",
    "assessedPool" "AssessedPoolStatus" NOT NULL DEFAULT 'UNKNOWN',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProduct" (
    "candidateId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateProduct_pkey" PRIMARY KEY ("candidateId","productId")
);

-- CreateTable
CREATE TABLE "CandidateSkill" (
    "candidateId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("candidateId","skillId")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "productId" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "importBatchId" UUID,
    "sourceApplicationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalProcess" (
    "id" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "shortlistingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalProcessStage" (
    "id" UUID NOT NULL,
    "processId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "stage" "InternalStage" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "ownerId" UUID,
    "completedAt" TIMESTAMP(3),
    "nextPlannedDate" DATE,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalProcessStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalStageCandidate" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "outcome" "StageCandidateOutcome" NOT NULL DEFAULT 'PENDING',
    "priority" "ScreeningPriority",
    "techScore" DECIMAL(4,1),
    "commScore" DECIMAL(4,1),
    "rejectionReason" TEXT,
    "remarks" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "importBatchId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalStageCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageCompletionRecord" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "fromStatus" "StageStatus" NOT NULL,
    "toStatus" "StageStatus" NOT NULL,
    "remarks" TEXT,
    "recordedById" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageCompletionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyNomination" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "status" "NominationStatus" NOT NULL DEFAULT 'NOMINATED',
    "pipelineStatus" "CompanyPipelineStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "source" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "nominatedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "offerReleasedAt" TIMESTAMP(3),
    "offerAcceptedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyNomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInterviewRound" (
    "id" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "roundType" "InterviewRoundType" NOT NULL DEFAULT 'OTHER',
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInterview" (
    "id" UUID NOT NULL,
    "nominationId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "outcome" "InterviewOutcome" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "interviewerName" TEXT,
    "feedback" TEXT,
    "rejectionReason" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyStageHistory" (
    "id" UUID NOT NULL,
    "nominationId" UUID NOT NULL,
    "fromStatus" "CompanyPipelineStatus",
    "toStatus" "CompanyPipelineStatus" NOT NULL,
    "notes" TEXT,
    "source" "ChangeSource" NOT NULL DEFAULT 'MANUAL',
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "batchCode" TEXT NOT NULL,
    "target" "ImportTarget" NOT NULL,
    "sourceType" "ImportSourceType" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "jobRequestId" UUID NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sheets" JSONB NOT NULL,
    "mapping" JSONB,
    "summary" JSONB,
    "importedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "batchId" UUID NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("batchId")
);

-- CreateTable
CREATE TABLE "ImportSheetMapping" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "worksheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportSheetMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportStagingRecord" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sheetMappingId" UUID NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceRowRef" TEXT,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL,
    "approvalStatus" "RecordApprovalStatus" NOT NULL DEFAULT 'INCLUDED',
    "action" "StagingAction" NOT NULL,
    "matchedEntityType" TEXT,
    "matchedEntityId" UUID,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportStagingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "stagingRecordId" UUID,
    "severity" "IssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportApproval" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "notes" TEXT,
    "counts" JSONB,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_candidateCode_key" ON "Candidate"("candidateCode");

-- CreateIndex
CREATE INDEX "Candidate_email_idx" ON "Candidate"("email");

-- CreateIndex
CREATE INDEX "Candidate_mobile_idx" ON "Candidate"("mobile");

-- CreateIndex
CREATE INDEX "Candidate_fullName_idx" ON "Candidate"("fullName");

-- CreateIndex
CREATE INDEX "Candidate_category_idx" ON "Candidate"("category");

-- CreateIndex
CREATE INDEX "CandidateProduct_productId_idx" ON "CandidateProduct"("productId");

-- CreateIndex
CREATE INDEX "CandidateSkill_skillId_idx" ON "CandidateSkill"("skillId");

-- CreateIndex
CREATE INDEX "Application_jobRequestId_status_idx" ON "Application"("jobRequestId", "status");

-- CreateIndex
CREATE INDEX "Application_productId_idx" ON "Application"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_candidateId_jobRequestId_key" ON "Application"("candidateId", "jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_id_jobRequestId_key" ON "Application"("id", "jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalProcess_jobRequestId_key" ON "InternalProcess"("jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalProcess_id_jobRequestId_key" ON "InternalProcess"("id", "jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalProcessStage_processId_stage_key" ON "InternalProcessStage"("processId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "InternalProcessStage_id_jobRequestId_key" ON "InternalProcessStage"("id", "jobRequestId");

-- CreateIndex
CREATE INDEX "InternalStageCandidate_applicationId_idx" ON "InternalStageCandidate"("applicationId");

-- CreateIndex
CREATE INDEX "InternalStageCandidate_stageId_outcome_idx" ON "InternalStageCandidate"("stageId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "InternalStageCandidate_stageId_applicationId_key" ON "InternalStageCandidate"("stageId", "applicationId");

-- CreateIndex
CREATE INDEX "StageCompletionRecord_stageId_recordedAt_idx" ON "StageCompletionRecord"("stageId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyNomination_applicationId_key" ON "CompanyNomination"("applicationId");

-- CreateIndex
CREATE INDEX "CompanyNomination_jobRequestId_pipelineStatus_idx" ON "CompanyNomination"("jobRequestId", "pipelineStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyNomination_id_jobRequestId_key" ON "CompanyNomination"("id", "jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyNomination_applicationId_jobRequestId_key" ON "CompanyNomination"("applicationId", "jobRequestId");

-- CreateIndex
CREATE INDEX "CompanyInterviewRound_jobRequestId_sequence_idx" ON "CompanyInterviewRound"("jobRequestId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInterviewRound_jobRequestId_name_key" ON "CompanyInterviewRound"("jobRequestId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInterviewRound_id_jobRequestId_key" ON "CompanyInterviewRound"("id", "jobRequestId");

-- CreateIndex
CREATE INDEX "CompanyInterview_roundId_outcome_idx" ON "CompanyInterview"("roundId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInterview_nominationId_roundId_key" ON "CompanyInterview"("nominationId", "roundId");

-- CreateIndex
CREATE INDEX "CompanyStageHistory_nominationId_changedAt_idx" ON "CompanyStageHistory"("nominationId", "changedAt");

-- CreateIndex
CREATE INDEX "CompanyStageHistory_toStatus_changedAt_idx" ON "CompanyStageHistory"("toStatus", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_batchCode_key" ON "ImportBatch"("batchCode");

-- CreateIndex
CREATE INDEX "ImportBatch_jobRequestId_createdAt_idx" ON "ImportBatch"("jobRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_sourceChecksum_idx" ON "ImportBatch"("sourceChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSheetMapping_batchId_role_worksheetName_key" ON "ImportSheetMapping"("batchId", "role", "worksheetName");

-- CreateIndex
CREATE INDEX "ImportStagingRecord_batchId_validationStatus_idx" ON "ImportStagingRecord"("batchId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ImportStagingRecord_sheetMappingId_sourceRowNumber_key" ON "ImportStagingRecord"("sheetMappingId", "sourceRowNumber");

-- CreateIndex
CREATE INDEX "DataQualityIssue_batchId_severity_idx" ON "DataQualityIssue"("batchId", "severity");

-- CreateIndex
CREATE INDEX "DataQualityIssue_stagingRecordId_idx" ON "DataQualityIssue"("stagingRecordId");

-- CreateIndex
CREATE INDEX "ImportApproval_batchId_idx" ON "ImportApproval"("batchId");

-- AddForeignKey
ALTER TABLE "CandidateProduct" ADD CONSTRAINT "CandidateProduct_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProduct" ADD CONSTRAINT "CandidateProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_sourceApplicationId_fkey" FOREIGN KEY ("sourceApplicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalProcess" ADD CONSTRAINT "InternalProcess_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalProcessStage" ADD CONSTRAINT "InternalProcessStage_processId_jobRequestId_fkey" FOREIGN KEY ("processId", "jobRequestId") REFERENCES "InternalProcess"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalProcessStage" ADD CONSTRAINT "InternalProcessStage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalStageCandidate" ADD CONSTRAINT "InternalStageCandidate_stageId_jobRequestId_fkey" FOREIGN KEY ("stageId", "jobRequestId") REFERENCES "InternalProcessStage"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalStageCandidate" ADD CONSTRAINT "InternalStageCandidate_applicationId_jobRequestId_fkey" FOREIGN KEY ("applicationId", "jobRequestId") REFERENCES "Application"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalStageCandidate" ADD CONSTRAINT "InternalStageCandidate_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalStageCandidate" ADD CONSTRAINT "InternalStageCandidate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageCompletionRecord" ADD CONSTRAINT "StageCompletionRecord_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InternalProcessStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageCompletionRecord" ADD CONSTRAINT "StageCompletionRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyNomination" ADD CONSTRAINT "CompanyNomination_applicationId_jobRequestId_fkey" FOREIGN KEY ("applicationId", "jobRequestId") REFERENCES "Application"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyNomination" ADD CONSTRAINT "CompanyNomination_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInterviewRound" ADD CONSTRAINT "CompanyInterviewRound_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInterview" ADD CONSTRAINT "CompanyInterview_nominationId_jobRequestId_fkey" FOREIGN KEY ("nominationId", "jobRequestId") REFERENCES "CompanyNomination"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyInterview" ADD CONSTRAINT "CompanyInterview_roundId_jobRequestId_fkey" FOREIGN KEY ("roundId", "jobRequestId") REFERENCES "CompanyInterviewRound"("id", "jobRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStageHistory" ADD CONSTRAINT "CompanyStageHistory_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "CompanyNomination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyStageHistory" ADD CONSTRAINT "CompanyStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSheetMapping" ADD CONSTRAINT "ImportSheetMapping_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportStagingRecord" ADD CONSTRAINT "ImportStagingRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportStagingRecord" ADD CONSTRAINT "ImportStagingRecord_sheetMappingId_fkey" FOREIGN KEY ("sheetMappingId") REFERENCES "ImportSheetMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_stagingRecordId_fkey" FOREIGN KEY ("stagingRecordId") REFERENCES "ImportStagingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApproval" ADD CONSTRAINT "ImportApproval_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApproval" ADD CONSTRAINT "ImportApproval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
