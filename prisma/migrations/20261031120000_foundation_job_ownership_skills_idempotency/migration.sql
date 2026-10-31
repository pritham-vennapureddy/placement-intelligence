-- DropForeignKey
ALTER TABLE "PSMAssignment" DROP CONSTRAINT "PSMAssignment_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PSMAssignment" DROP CONSTRAINT "PSMAssignment_jobRequestId_companyId_fkey";

-- DropIndex
DROP INDEX "JobRequest_id_companyId_key";

-- DropIndex
DROP INDEX "PSMAssignment_assignedToId_assignedAt_idx";

-- DropIndex
DROP INDEX "PSMAssignment_companyId_endedAt_idx";

-- DropIndex
DROP INDEX "PSMAssignment_jobRequestId_companyId_endedAt_idx";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "hubspotCompanyId" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PSMAssignment" DROP COLUMN "companyId",
ALTER COLUMN "jobRequestId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Skill" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequestSkill" (
    "jobRequestId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobRequestSkill_pkey" PRIMARY KEY ("jobRequestId","skillId")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_normalizedName_key" ON "Skill"("normalizedName");

-- CreateIndex
CREATE INDEX "JobRequestSkill_skillId_idx" ON "JobRequestSkill"("skillId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Company_hubspotCompanyId_key" ON "Company"("hubspotCompanyId");

-- CreateIndex
CREATE INDEX "PSMAssignment_jobRequestId_endedAt_idx" ON "PSMAssignment"("jobRequestId", "endedAt");

-- CreateIndex
CREATE INDEX "PSMAssignment_assignedToId_endedAt_idx" ON "PSMAssignment"("assignedToId", "endedAt");

-- AddForeignKey
ALTER TABLE "JobRequestSkill" ADD CONSTRAINT "JobRequestSkill_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequestSkill" ADD CONSTRAINT "JobRequestSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PSMAssignment" ADD CONSTRAINT "PSMAssignment_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one open (endedAt IS NULL) ownership row per job request.
CREATE UNIQUE INDEX "PSMAssignment_one_open_per_job_key" ON "PSMAssignment"("jobRequestId") WHERE "endedAt" IS NULL;
