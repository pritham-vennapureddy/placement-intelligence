-- Potential-list entries are added by job ID: every entry has a job drive, once per month.
ALTER TABLE "MonthlyPipelineEntry" DROP CONSTRAINT "MonthlyPipelineEntry_jobRequestId_fkey";
DELETE FROM "MonthlyPipelineEntry" WHERE "jobRequestId" IS NULL;
ALTER TABLE "MonthlyPipelineEntry" ALTER COLUMN "jobRequestId" SET NOT NULL;
CREATE UNIQUE INDEX "MonthlyPipelineEntry_month_jobRequestId_key" ON "MonthlyPipelineEntry"("month", "jobRequestId");
ALTER TABLE "MonthlyPipelineEntry" ADD CONSTRAINT "MonthlyPipelineEntry_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
