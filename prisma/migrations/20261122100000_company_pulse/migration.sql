-- CreateEnum
CREATE TYPE "PotentialCompanyStatus" AS ENUM ('POTENTIAL', 'IN_DISCUSSION', 'CONFIRMED', 'PROCESS_STARTED', 'ON_HOLD', 'NO_RESPONSE', 'DROPPED');

-- CreateEnum
CREATE TYPE "CrmChannel" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'OTHER');

-- AlterTable
ALTER TABLE "StudentSupport" ADD COLUMN     "reportSummary" TEXT,
ADD COLUMN     "reportUrl" TEXT;

-- CreateTable
CREATE TABLE "MonthlyPipelineEntry" (
    "id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "companyId" UUID NOT NULL,
    "jobRequestId" UUID,
    "roleHint" TEXT,
    "expectedOpenings" INTEGER,
    "expectedStartDate" DATE,
    "status" "PotentialCompanyStatus" NOT NULL DEFAULT 'POTENTIAL',
    "crmOwnerId" UUID,
    "remarks" TEXT,
    "carriedFromId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyPipelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPipelineHistory" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "fromStatus" "PotentialCompanyStatus",
    "toStatus" "PotentialCompanyStatus" NOT NULL,
    "note" TEXT,
    "changedById" UUID NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyPipelineHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCrmRemark" (
    "id" UUID NOT NULL,
    "jobRequestId" UUID NOT NULL,
    "interactionOn" DATE NOT NULL,
    "channel" "CrmChannel" NOT NULL DEFAULT 'CALL',
    "remark" TEXT NOT NULL,
    "nextStep" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCrmRemark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRsaReview" (
    "jobRequestId" UUID NOT NULL,
    "wentRight" TEXT,
    "wentWrong" TEXT,
    "actionItems" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRsaReview_pkey" PRIMARY KEY ("jobRequestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPipelineEntry_carriedFromId_key" ON "MonthlyPipelineEntry"("carriedFromId");

-- CreateIndex
CREATE INDEX "MonthlyPipelineEntry_month_status_idx" ON "MonthlyPipelineEntry"("month", "status");

-- CreateIndex
CREATE INDEX "MonthlyPipelineEntry_companyId_month_idx" ON "MonthlyPipelineEntry"("companyId", "month");

-- CreateIndex
CREATE INDEX "MonthlyPipelineHistory_entryId_changedAt_idx" ON "MonthlyPipelineHistory"("entryId", "changedAt");

-- CreateIndex
CREATE INDEX "JobCrmRemark_jobRequestId_interactionOn_idx" ON "JobCrmRemark"("jobRequestId", "interactionOn");

-- AddForeignKey
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_crmOwnerId_fkey" FOREIGN KEY ("crmOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "MonthlyPipelineEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineHistory" ADD CONSTRAINT "MonthlyPipelineHistory_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MonthlyPipelineEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPipelineHistory" ADD CONSTRAINT "MonthlyPipelineHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCrmRemark" ADD CONSTRAINT "JobCrmRemark_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCrmRemark" ADD CONSTRAINT "JobCrmRemark_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRsaReview" ADD CONSTRAINT "JobRsaReview_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRsaReview" ADD CONSTRAINT "JobRsaReview_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every assessed-pool student is an Academy student: fix profiles left without a
-- category (or marked External) whose mobile is in the pool.
UPDATE "Candidate" c
SET "category" = 'ACADEMY'::"CandidateCategory", "updatedAt" = NOW()
WHERE (c."category" IS NULL OR c."category" = 'EXTERNAL'::"CandidateCategory")
  AND c.mobile IS NOT NULL
  AND EXISTS (SELECT 1 FROM "AssessedPoolRecord" r WHERE r.mobile = c.mobile);
