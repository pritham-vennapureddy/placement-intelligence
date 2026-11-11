ALTER TABLE "ImportBatch" RENAME COLUMN "fileSize" TO "snapshotSize";
ALTER TABLE "ImportBatch" ADD COLUMN "sourceSnapshot" JSONB;
DROP TABLE "ImportFile";
