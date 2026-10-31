-- CreateEnum
CREATE TYPE "SheetSourceType" AS ENUM ('COMPANY_PROCESS', 'STUDENT_APPLICATIONS', 'CANDIDATE_PROFILES', 'ASSESSED_POOL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "teamId" UUID;

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "teamLeadId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetConnection" (
    "id" UUID NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "SheetSourceType" NOT NULL,
    "teamId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetTabMapping" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "workflowStage" TEXT NOT NULL,
    "sheetId" INTEGER NOT NULL,
    "sheetTitle" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "columnMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetTabMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_teamLeadId_key" ON "Team"("teamLeadId");

-- CreateIndex
CREATE INDEX "Team_createdById_createdAt_idx" ON "Team"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "SheetConnection_teamId_sourceType_idx" ON "SheetConnection"("teamId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "SheetConnection_spreadsheetId_sourceType_key" ON "SheetConnection"("spreadsheetId", "sourceType");

-- CreateIndex
CREATE INDEX "SheetTabMapping_connectionId_sheetId_idx" ON "SheetTabMapping"("connectionId", "sheetId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetTabMapping_connectionId_workflowStage_key" ON "SheetTabMapping"("connectionId", "workflowStage");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetConnection" ADD CONSTRAINT "SheetConnection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetConnection" ADD CONSTRAINT "SheetConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetTabMapping" ADD CONSTRAINT "SheetTabMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SheetConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
