CREATE TYPE "AssessedProcessType" AS ENUM ('OLD', 'NEW', 'UNKNOWN');

ALTER TABLE "AssessedPoolRecord"
ADD COLUMN "processType" "AssessedProcessType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "sourceData" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "AssessedPoolSource"
ADD COLUMN "sheetTitles" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "AssessedPoolImport"
ADD COLUMN "rawRows" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "AssessedPoolSource"
SET "sheetTitles" = jsonb_build_array("sheetTitle")
WHERE "sheetTitles" = '[]'::jsonb;

UPDATE "AssessedPoolSource"
SET "sheetTitles" = '["Offline Pool Main", "Competency Pool Main"]'::jsonb
WHERE "sheetTitle" IN ('Offline Pool Main', 'Competency Pool Main');
