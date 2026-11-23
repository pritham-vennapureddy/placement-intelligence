-- Fill students' college, year of graduation, department and percentage from the
-- applications tab rows already imported (the platform's "Applied Users" export),
-- which the import used to skip. Rows are matched to students by mobile number.
-- Only empty values are filled; nothing is overwritten.
WITH src AS (
  SELECT DISTINCT ON (s."normalizedData"->'candidate'->>'mobile')
    s."normalizedData"->'candidate'->>'mobile' AS mobile,
    NULLIF(TRIM(s."rawData"->>'Highest Education Institute Name'), '') AS college,
    CASE WHEN TRIM(s."rawData"->>'Bachelors Year Of Graduation') ~ '^(19|20)[0-9]{2}'
      THEN LEFT(TRIM(s."rawData"->>'Bachelors Year Of Graduation'), 4)::int END AS year,
    NULLIF(TRIM(s."rawData"->>'Bachelors Department Name'), '') AS department,
    CASE WHEN TRIM(s."rawData"->>'Bachelors Percentage') ~ '^[0-9]+(\.[0-9]+)?$'
      AND TRIM(s."rawData"->>'Bachelors Percentage')::numeric BETWEEN 0 AND 100
      THEN TRIM(s."rawData"->>'Bachelors Percentage')::numeric END AS score
  FROM "ImportStagingRecord" s
  JOIN "ImportSheetMapping" sm ON sm.id = s."sheetMappingId"
  WHERE sm.role = 'APPLICATIONS'
    AND s."committedAt" IS NOT NULL
    AND NULLIF(s."normalizedData"->'candidate'->>'mobile', '') IS NOT NULL
    AND (s."rawData" ? 'Bachelors Year Of Graduation' OR s."rawData" ? 'Highest Education Institute Name')
  ORDER BY s."normalizedData"->'candidate'->>'mobile', s."committedAt" DESC
)
UPDATE "Candidate" c SET
  "college" = COALESCE(c."college", src.college),
  "graduationYear" = COALESCE(c."graduationYear", src.year),
  "department" = COALESCE(c."department", src.department),
  "academicScore" = COALESCE(c."academicScore", src.score)
FROM src
WHERE c.mobile = src.mobile
  AND ((c."college" IS NULL AND src.college IS NOT NULL)
    OR (c."graduationYear" IS NULL AND src.year IS NOT NULL)
    OR (c."department" IS NULL AND src.department IS NOT NULL)
    OR (c."academicScore" IS NULL AND src.score IS NOT NULL));

-- Students added from a company sheet: that sheet's "Graduation Year" / college columns,
-- matched by the row's mobile number (last 10 digits). Again only empty values are filled.
WITH rows AS (
  SELECT s."rawData" AS raw, s."committedAt",
    RIGHT(regexp_replace(COALESCE(
      (SELECT v FROM jsonb_each_text(s."rawData") AS e(k, v) WHERE k ~* '(mobile|phone)' AND regexp_replace(v, '\D', '', 'g') ~ '^(91)?[6-9][0-9]{9}$' LIMIT 1), ''), '\D', '', 'g'), 10) AS mobile
  FROM "ImportStagingRecord" s
  JOIN "ImportSheetMapping" sm ON sm.id = s."sheetMappingId"
  WHERE sm.role = 'COMPANY_TAB' AND s."committedAt" IS NOT NULL
), src AS (
  SELECT DISTINCT ON (r.mobile) r.mobile,
    (SELECT NULLIF(TRIM(v), '') FROM jsonb_each_text(r.raw) AS e(k, v) WHERE k ~* '(college|university|institute)' LIMIT 1) AS college,
    (SELECT LEFT(TRIM(v), 4)::int FROM jsonb_each_text(r.raw) AS e(k, v) WHERE k ~* '(graduation year|year of graduation|pass ?out year)' AND TRIM(v) ~ '^(19|20)[0-9]{2}' LIMIT 1) AS year
  FROM rows r
  WHERE length(r.mobile) = 10
  ORDER BY r.mobile, r."committedAt" DESC
)
UPDATE "Candidate" c SET
  "college" = COALESCE(c."college", src.college),
  "graduationYear" = COALESCE(c."graduationYear", src.year)
FROM src
WHERE c.mobile = src.mobile
  AND ((c."college" IS NULL AND src.college IS NOT NULL) OR (c."graduationYear" IS NULL AND src.year IS NOT NULL));
