DELETE FROM "AssessedPoolRecord";
DELETE FROM "AssessedPoolImport";

UPDATE "AssessedPoolSource"
SET "lastSyncedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "AssessedPoolRecord"
DROP CONSTRAINT "AssessedPoolRecord_candidateId_fkey";

DROP INDEX "AssessedPoolRecord_candidateId_idx";

ALTER TABLE "AssessedPoolRecord"
DROP COLUMN "candidateId",
DROP COLUMN "productValue",
ADD COLUMN "competencyLevel" TEXT;
