-- Students already imported get their platform user ID as their ID instead of the
-- generated "GEN-…" code, from the rows saved with committed imports: the UUID on the
-- applications row that belongs to that student's mobile and no one else's (job IDs,
-- also UUIDs, are left out). A student with several such IDs, or an ID another student
-- already has, keeps the generated code.
WITH cells AS (
  SELECT s."normalizedData"->'candidate'->>'mobile' AS mobile, lower(v.value) AS user_id
  FROM "ImportStagingRecord" s
  JOIN "ImportBatch" b ON b.id = s."batchId" AND b.status = 'COMMITTED'
  CROSS JOIN LATERAL jsonb_each_text(s."rawData") AS v
  WHERE s."normalizedData"->>'kind' = 'application'
    AND s."normalizedData"->'candidate'->>'mobile' IS NOT NULL
    AND v.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS (SELECT 1 FROM "JobRequest" j WHERE lower(j."jobId") = lower(v.value))
),
single_owner AS (
  SELECT user_id, MIN(mobile) AS mobile FROM cells GROUP BY user_id HAVING COUNT(DISTINCT mobile) = 1
),
one_id AS (
  SELECT mobile, MIN(user_id) AS user_id FROM single_owner GROUP BY mobile HAVING COUNT(*) = 1
),
targets AS (
  SELECT c.id, o.user_id
  FROM "Candidate" c
  JOIN one_id o ON o.mobile = c.mobile
  WHERE c."candidateCode" LIKE 'GEN-%'
    AND (SELECT COUNT(*) FROM "Candidate" x WHERE x.mobile = c.mobile) = 1
    AND NOT EXISTS (SELECT 1 FROM "Candidate" t WHERE lower(t."candidateCode") = o.user_id)
)
UPDATE "Candidate" c SET "candidateCode" = t.user_id, "updatedAt" = NOW()
FROM targets t
WHERE c.id = t.id;

-- Pool sheets list students by user ID: link memberships that now match a student.
UPDATE "CandidatePoolMembership" m SET "candidateId" = c.id
FROM "Candidate" c
WHERE m."candidateId" IS NULL AND lower(m."candidateCode") = lower(c."candidateCode");
