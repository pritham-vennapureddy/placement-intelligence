CREATE TABLE "AssessedPoolImport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sourceFileName" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "mapping" JSONB NOT NULL,
    "importedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessedPoolImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessedPoolRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mobile" TEXT NOT NULL,
    "sourceUserId" TEXT,
    "candidateId" UUID,
    "category" "CandidateCategory",
    "productValue" TEXT,
    "bucketTier" TEXT,
    "tr1Status" TEXT,
    "tr2Status" TEXT,
    "competencyStatus" TEXT,
    "spReason" TEXT,
    "sourceImportId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessedPoolRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessedPoolRecord_mobile_key" ON "AssessedPoolRecord"("mobile");
CREATE INDEX "AssessedPoolImport_createdAt_idx" ON "AssessedPoolImport"("createdAt");
CREATE INDEX "AssessedPoolImport_importedById_createdAt_idx" ON "AssessedPoolImport"("importedById", "createdAt");
CREATE INDEX "AssessedPoolRecord_candidateId_idx" ON "AssessedPoolRecord"("candidateId");
CREATE INDEX "AssessedPoolRecord_category_idx" ON "AssessedPoolRecord"("category");
CREATE INDEX "AssessedPoolRecord_bucketTier_idx" ON "AssessedPoolRecord"("bucketTier");
CREATE INDEX "AssessedPoolRecord_sourceImportId_idx" ON "AssessedPoolRecord"("sourceImportId");

ALTER TABLE "AssessedPoolImport"
ADD CONSTRAINT "AssessedPoolImport_importedById_fkey"
FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssessedPoolRecord"
ADD CONSTRAINT "AssessedPoolRecord_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssessedPoolRecord"
ADD CONSTRAINT "AssessedPoolRecord_sourceImportId_fkey"
FOREIGN KEY ("sourceImportId") REFERENCES "AssessedPoolImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
