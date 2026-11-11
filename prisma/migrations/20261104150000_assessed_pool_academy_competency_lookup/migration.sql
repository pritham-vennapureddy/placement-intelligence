ALTER TABLE "AssessedPoolRecord"
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "isCompetencyPoolMember" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "AssessedPoolRecord_sourceName_idx" ON "AssessedPoolRecord"("sourceName");
CREATE INDEX "AssessedPoolRecord_sourceUserId_idx" ON "AssessedPoolRecord"("sourceUserId");

UPDATE "AssessedPoolRecord"
SET
    "category" = 'ACADEMY',
    "productValue" = NULL,
    "isCompetencyPoolMember" = "sourceData" ? 'Competency Pool Main';
