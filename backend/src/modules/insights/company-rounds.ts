import { Prisma } from "../../generated/prisma/client.js";

/**
 * Company rounds become comparable steps across jobs: CV screen, assessment,
 * TR1, TR2…, MR, client, HR. Use as a CTE: `WITH …, ${ROUND_LABELS} SELECT … JOIN rounds`.
 */
export const ROUND_LABELS = Prisma.sql`
  rounds AS (
    SELECT cr.id,
      CASE cr."roundType"
        WHEN 'RESUME_SCREENING' THEN 'Company CV screen'
        WHEN 'ASSIGNMENT' THEN 'Assessment / assignment'
        WHEN 'TECHNICAL' THEN 'TR' || ROW_NUMBER() OVER (PARTITION BY cr."recruitmentBatchId", cr."roundType" ORDER BY cr.sequence, cr.name)
        WHEN 'MANAGERIAL' THEN 'MR'
        WHEN 'CLIENT' THEN 'Client round'
        WHEN 'HR' THEN 'HR'
        ELSE 'Other rounds'
      END AS label,
      CASE cr."roundType"
        WHEN 'RESUME_SCREENING' THEN 100
        WHEN 'ASSIGNMENT' THEN 200
        WHEN 'TECHNICAL' THEN 300 + ROW_NUMBER() OVER (PARTITION BY cr."recruitmentBatchId", cr."roundType" ORDER BY cr.sequence, cr.name)
        WHEN 'MANAGERIAL' THEN 400
        WHEN 'CLIENT' THEN 500
        WHEN 'HR' THEN 600
        ELSE 700
      END AS sort
    FROM "CompanyInterviewRound" cr
  )`;

export const ROUND_METRICS = Prisma.sql`
  COUNT(*) FILTER (WHERE ci.outcome IN ('CLEARED', 'REJECTED', 'ON_HOLD'))::int AS appeared,
  COUNT(*) FILTER (WHERE ci.outcome = 'CLEARED')::int AS cleared,
  COUNT(*) FILTER (WHERE ci.outcome = 'REJECTED')::int AS rejected,
  COUNT(*) FILTER (WHERE ci.outcome = 'NO_SHOW')::int AS no_show,
  COUNT(*) FILTER (WHERE ci.outcome = 'SCHEDULED')::int AS scheduled`;

export type RoundRow = { label: string; sort: number; appeared: number; cleared: number; rejected: number; no_show: number; scheduled: number };

export const round = (row: RoundRow) => ({
  label: row.label, appeared: row.appeared, cleared: row.cleared, rejected: row.rejected, noShow: row.no_show, scheduled: row.scheduled,
});

/** Stage keys for a `rounds.label`: CV, ASSESSMENT, TR1, TR2, TR3 (third and later), MR, CLIENT, HR, OTHER. */
export const ROUND_STAGE = Prisma.sql`
  CASE
    WHEN rounds.label = 'Company CV screen' THEN 'CV'
    WHEN rounds.label = 'Assessment / assignment' THEN 'ASSESSMENT'
    WHEN rounds.label IN ('TR1', 'TR2') THEN rounds.label
    WHEN rounds.label LIKE 'TR%' THEN 'TR3'
    WHEN rounds.label = 'MR' THEN 'MR'
    WHEN rounds.label = 'Client round' THEN 'CLIENT'
    WHEN rounds.label = 'HR' THEN 'HR'
    ELSE 'OTHER'
  END`;
