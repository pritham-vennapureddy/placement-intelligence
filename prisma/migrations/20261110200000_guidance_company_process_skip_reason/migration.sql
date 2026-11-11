-- Company process status per job, guidance tracking, and a reason category for skipped screening. Additive only.

-- CreateEnum
CREATE TYPE "ScreeningSkipReason" AS ENUM ('TIME_CONSTRAINT', 'COMPANY_REQUESTED_DIRECT', 'REPEAT_DRIVE', 'PRE_ASSESSED_PROFILES', 'LOW_APPLICATIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyProcessPhase" AS ENUM ('YET_TO_SHARE_CVS', 'CVS_SHARED', 'HIRING_IN_PROGRESS', 'ROUND_YET_TO_START', 'ROUND_IN_PROGRESS', 'ON_HOLD', 'OFFERS_RELEASED', 'COMPLETED');

-- AlterTable
ALTER TABLE "InternalProcessStage" ADD COLUMN     "skipReason" "ScreeningSkipReason";

-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "processPhase" "CompanyProcessPhase" NOT NULL DEFAULT 'YET_TO_SHARE_CVS',
ADD COLUMN     "processPhaseAt" TIMESTAMP(3),
ADD COLUMN     "processRoundId" UUID;

-- CreateTable
CREATE TABLE "CompanyProcessHistory" (
    "id" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "fromPhase" "CompanyProcessPhase",
    "toPhase" "CompanyProcessPhase" NOT NULL,
    "roundId" UUID,
    "roundName" TEXT,
    "notes" TEXT,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyProcessHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidanceSession" (
    "id" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "givenById" UUID NOT NULL,
    "givenOn" DATE NOT NULL,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuidanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateGuidance" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "givenById" UUID NOT NULL,
    "givenOn" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyProcessHistory_jobRequestId_changedAt_idx" ON "CompanyProcessHistory"("jobRequestId", "changedAt");

-- CreateIndex
CREATE INDEX "GuidanceSession_jobRequestId_givenOn_idx" ON "GuidanceSession"("jobRequestId", "givenOn");

-- CreateIndex
CREATE INDEX "GuidanceSession_givenById_givenOn_idx" ON "GuidanceSession"("givenById", "givenOn");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateGuidance_applicationId_key" ON "CandidateGuidance"("applicationId");

-- CreateIndex
CREATE INDEX "CandidateGuidance_jobRequestId_idx" ON "CandidateGuidance"("jobRequestId");

-- CreateIndex
CREATE INDEX "CandidateGuidance_givenById_givenOn_idx" ON "CandidateGuidance"("givenById", "givenOn");

-- AddForeignKey
ALTER TABLE "JobRequest" ADD CONSTRAINT "JobRequest_processRoundId_fkey" FOREIGN KEY ("processRoundId") REFERENCES "CompanyInterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProcessHistory" ADD CONSTRAINT "CompanyProcessHistory_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProcessHistory" ADD CONSTRAINT "CompanyProcessHistory_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CompanyInterviewRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProcessHistory" ADD CONSTRAINT "CompanyProcessHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceSession" ADD CONSTRAINT "GuidanceSession_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceSession" ADD CONSTRAINT "GuidanceSession_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidanceSession" ADD CONSTRAINT "GuidanceSession_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateGuidance" ADD CONSTRAINT "CandidateGuidance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateGuidance" ADD CONSTRAINT "CandidateGuidance_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateGuidance" ADD CONSTRAINT "CandidateGuidance_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
