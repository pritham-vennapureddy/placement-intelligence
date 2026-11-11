-- Tabs of the internal sheet that belong to each recruitment batch, chosen by the PSM.
ALTER TABLE "RecruitmentBatch" ADD COLUMN "internalTabs" JSONB;

-- A batch's sheet link now overrides the job request's only when it points elsewhere.
-- Batches created so far copied the job's link at creation time, so a later edit of
-- the job's internal sheet was ignored. Clear the copies: those batches follow the job again.
UPDATE "RecruitmentBatch" b
SET "internalSheetUrl" = NULL
FROM "JobRequest" j
WHERE b."jobRequestId" = j."id"
  AND j."internalSheetUrl" IS NOT NULL
  AND b."internalSheetUrl" IS NOT NULL;

UPDATE "RecruitmentBatch" b
SET "companySheetUrl" = NULL
FROM "JobRequest" j
WHERE b."jobRequestId" = j."id"
  AND j."companySheetUrl" IS NOT NULL
  AND b."companySheetUrl" IS NOT NULL;

-- SP rows without a Selection_Basis column: their Remarks are the selection basis.
UPDATE "InternalStageCandidate" c
SET "selectionBasis" = c."remarks"
FROM "InternalProcessStage" s
WHERE c."stageId" = s."id"
  AND s."stage" = 'FINAL_SHORTLIST'
  AND c."selectionBasis" IS NULL
  AND NULLIF(TRIM(c."remarks"), '') IS NOT NULL;
