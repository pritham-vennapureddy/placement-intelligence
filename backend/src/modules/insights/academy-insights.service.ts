import { hasPermission } from "@placement/shared";
import { prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { maskMobile } from "../../services/pii.js";
import { bucketRejectionReason, REJECTION_BUCKETS } from "./rejection-buckets.js";
import { dateColumn, jobFilter, ownerFilter } from "./insights.service.js";
import { round, ROUND_LABELS, ROUND_METRICS, ROUND_STAGE, type RoundRow } from "./company-rounds.js";
import { APPLICATION_REASON, NOT_SELECTED } from "./company-reasons.service.js";
import type { AcademyCandidatesQuery, AcademyCandidateView, AcademyQuery, AcademySegment, AcademyStageFilter } from "./insights.validators.js";

/**
 * Academy & assessed-pool review figures.
 *
 * Definitions (shown on the page as well):
 * - Assessed pool: the candidate's mobile is in the assessed-pool sheet.
 * - Tier 1: assessed-pool bucket A (B and C are reported alongside).
 * - Stage passes are cumulative: reaching SP counts as passing AS, SC and RS too,
 *   so a skipped stage lets its students through instead of showing them as lost.
 * - Interviewed: attended at least one company round, or was selected by the company.
 * - Opportunity: final-shortlisted (SP) or shared with the company.
 */

const SELECTED = Prisma.sql`('SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED')`;
const OFFERED = Prisma.sql`('OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED')`;

/** "Bucket - D", "b", " A " → "D", "B", "A". */
const TIER = (column: Prisma.Sql) =>
  Prisma.sql`NULLIF(UPPER(REGEXP_REPLACE(BTRIM(COALESCE(${column}, '')), '^bucket\\s*[-:]?\\s*', '', 'i')), '')`;

function categoryCondition(query: AcademyQuery): Prisma.Sql {
  if (query.academyCategory === "ALL_ACADEMY") return Prisma.sql`category IN ('ACADEMY', 'ACADEMY_INTENSIVE')`;
  return Prisma.sql`category = ${query.academyCategory}`;
}

/**
 * Which assessed-pool tab a record came from: the offline assessment, the
 * competency assessment, or both. NULL when the student is not in the pool.
 */
export const POOL_SOURCE = (r: Prisma.Sql) => Prisma.sql`
  CASE
    WHEN ${r}.id IS NULL THEN NULL
    WHEN (${r}."processType" <> 'UNKNOWN' OR jsonb_exists(${r}."sourceData", 'Offline Pool Main')) AND ${r}."isCompetencyPoolMember" THEN 'BOTH'
    WHEN ${r}."isCompetencyPoolMember" THEN 'COMPETENCY'
    ELSE 'OFFLINE'
  END`;

/** The student's product(s) by name, e.g. "CCBP Academy Smart". */
/** The universal product (Academy / Intensive / External) for a product category column. */
export const PRODUCT_LABEL = (category: Prisma.Sql) => Prisma.sql`
  (CASE ${category}::text WHEN 'ACADEMY' THEN 'Academy' WHEN 'ACADEMY_INTENSIVE' THEN 'Intensive' WHEN 'EXTERNAL' THEN 'External' END)`;

/** The student's universal product(s), e.g. "Academy" or "Academy, Intensive". */
export const PRODUCT_NAMES = (candidateId: Prisma.Sql) => Prisma.sql`
  (SELECT string_agg(DISTINCT ${PRODUCT_LABEL(Prisma.sql`pr.category`)}, ', ') FROM "CandidateProduct" cp JOIN "Product" pr ON pr.id = cp."productId" WHERE cp."candidateId" = ${candidateId})`;

/** The universal product the student applied under, else their product(s) on record. */
export const APPLICATION_PRODUCT = (applicationId: Prisma.Sql, candidateId: Prisma.Sql) => Prisma.sql`
  COALESCE((SELECT ${PRODUCT_LABEL(Prisma.sql`ap.category`)} FROM "Application" ax JOIN "Product" ap ON ap.id = ax."productId" WHERE ax.id = ${applicationId}), ${PRODUCT_NAMES(candidateId)})`;

const SEGMENT_CONDITIONS: Record<AcademySegment, Prisma.Sql> = {
  ALL: Prisma.sql`TRUE`,
  ASSESSED_POOL: Prisma.sql`in_pool`,
  NOT_IN_POOL: Prisma.sql`NOT in_pool`,
  BUCKET_A: Prisma.sql`tier = 'A'`,
  BUCKET_B: Prisma.sql`tier = 'B'`,
  BUCKET_C: Prisma.sql`tier = 'C'`,
};

/**
 * One row per application (any category) as `f`, and the rows the chosen
 * category and segment keep as `af`. `jobScope` replaces the date/job filter
 * (the Monthly page scopes by drives live in a month). Pool members count whatever product they
 * applied under, since the pool is an academy list.
 */
export function academyFacts(query: AcademyQuery, owners: Prisma.Sql, jobScope: Prisma.Sql = jobFilter(query)): Prisma.Sql {
  return Prisma.sql`
    WITH base AS (
      SELECT
        a.id AS application_id,
        a."candidateId" AS candidate_id,
        j.id AS job_id,
        j."companyId" AS company_id,
        j."ctcLpa" AS ctc,
        to_char(${dateColumn(query)}, 'YYYY-MM') AS month,
        -- Assessed-pool students are Academy even if the product says External or is missing.
        CASE WHEN r.id IS NOT NULL AND COALESCE(p.category::text, c.category::text, 'UNKNOWN') IN ('EXTERNAL', 'UNKNOWN')
          THEN 'ACADEMY' ELSE COALESCE(p.category::text, c.category::text, 'UNKNOWN') END AS category,
        r.id IS NOT NULL AS in_pool,
        CASE WHEN r.id IS NOT NULL THEN ${TIER(Prisma.sql`r."bucketTier"`)} END AS tier,
        COALESCE(bool_or(ps.stage = 'RESUME_SHORTLIST' AND isc.outcome = 'SELECTED'), FALSE) AS rs_sel,
        COALESCE(bool_or(ps.stage = 'SCREENING_SHORTLIST' AND isc.outcome = 'SELECTED'), FALSE) AS sc_sel,
        COALESCE(bool_or(ps.stage = 'ASSIGNMENT_SHORTLIST' AND isc.outcome = 'SELECTED'), FALSE) AS as_sel,
        COALESCE(bool_or(ps.stage = 'FINAL_SHORTLIST' AND isc.outcome = 'SELECTED'), FALSE) AS sp,
        COALESCE(bool_or(ps.stage = 'RESUME_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS rs_rej,
        COALESCE(bool_or(ps.stage = 'SCREENING_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS sc_rej,
        COALESCE(bool_or(ps.stage = 'ASSIGNMENT_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS as_rej,
        COALESCE(bool_or(ps.stage = 'SCREENING_SHORTLIST' AND isc.outcome = 'NO_SHOW'), FALSE) AS sc_no_show,
        n.id AS nomination_id,
        CASE WHEN n.status = 'NOMINATED' THEN n."pipelineStatus"::text END AS pipeline,
        COALESCE(n.status = 'WITHDRAWN', FALSE) AS withdrawn,
        (j."processPhase" <> 'YET_TO_SHARE_CVS' AND NOT EXISTS (
          SELECT 1 FROM "ImportBatch" ib
          WHERE ib."recruitmentBatchId" = a."recruitmentBatchId" AND ib.target = 'COMPANY_PIPELINE' AND ib.status = 'COMMITTED'
        )) AS sheet_pending
      FROM "Application" a
      JOIN "JobRequest" j ON j.id = a."jobRequestId"
      JOIN "Candidate" c ON c.id = a."candidateId"
      LEFT JOIN "Product" p ON p.id = a."productId"
      LEFT JOIN "AssessedPoolRecord" r ON r.mobile = c.mobile
      LEFT JOIN "InternalStageCandidate" isc ON isc."applicationId" = a.id
      LEFT JOIN "InternalProcessStage" ps ON ps.id = isc."stageId"
      LEFT JOIN "CompanyNomination" n ON n."applicationId" = a.id
      WHERE a.status <> 'WITHDRAWN' AND ${jobScope} ${owners}
      GROUP BY a.id, j.id, p.category, c.category, r.id, r."bucketTier", n.id, n.status, n."pipelineStatus"
    ),
    iv AS (
      SELECT ci."nominationId" AS nomination_id,
        COUNT(*) FILTER (WHERE ci.outcome IN ('CLEARED', 'REJECTED', 'ON_HOLD'))::int AS attended
      FROM "CompanyInterview" ci
      GROUP BY 1
    ),
    f AS (
      SELECT b.*,
        (b.rs_rej OR b.sc_rej OR b.as_rej) AS internal_rejected,
        (b.as_sel OR b.sp) AS as_pass,
        (b.sc_sel OR b.as_sel OR b.sp) AS sc_pass,
        (b.rs_sel OR b.sc_sel OR b.as_sel OR b.sp) AS rs_pass,
        ((b.pipeline IS NOT NULL AND b.pipeline <> 'NOT_SUBMITTED') OR (b.sp AND b.sheet_pending AND NOT b.withdrawn)) AS shared,
        COALESCE(iv.attended, 0) AS interviews,
        (COALESCE(iv.attended, 0) > 0 OR b.pipeline IN ${SELECTED}) AS interviewed,
        COALESCE(b.pipeline IN ${SELECTED}, FALSE) AS selected,
        COALESCE(b.pipeline IN ${OFFERED}, FALSE) AS offered,
        COALESCE(b.pipeline = 'JOINED', FALSE) AS joined
      FROM base b
      LEFT JOIN iv ON iv.nomination_id = b.nomination_id
    ),
    af AS (
      SELECT * FROM f WHERE ${categoryCondition(query)} AND ${SEGMENT_CONDITIONS[query.segment]}
    )`;
}

const METRICS = Prisma.sql`
  COUNT(*)::int AS applications,
  COUNT(DISTINCT candidate_id)::int AS students,
  COUNT(*) FILTER (WHERE rs_pass)::int AS rs_pass,
  COUNT(*) FILTER (WHERE sc_pass)::int AS sc_pass,
  COUNT(*) FILTER (WHERE as_pass)::int AS as_pass,
  COUNT(*) FILTER (WHERE sp)::int AS sp,
  COUNT(*) FILTER (WHERE internal_rejected)::int AS internal_rejected,
  COUNT(*) FILTER (WHERE rs_rej)::int AS rs_rej,
  COUNT(*) FILTER (WHERE sc_rej)::int AS sc_rej,
  COUNT(*) FILTER (WHERE as_rej)::int AS as_rej,
  COUNT(*) FILTER (WHERE sc_no_show)::int AS sc_no_show,
  COUNT(*) FILTER (WHERE shared)::int AS shared,
  COUNT(*) FILTER (WHERE interviewed)::int AS interviewed,
  COALESCE(SUM(interviews), 0)::int AS interviews,
  COUNT(DISTINCT candidate_id) FILTER (WHERE interviewed)::int AS students_interviewed,
  COUNT(*) FILTER (WHERE selected)::int AS selected,
  COUNT(DISTINCT candidate_id) FILTER (WHERE selected)::int AS students_selected,
  COUNT(*) FILTER (WHERE offered)::int AS offered,
  COUNT(*) FILTER (WHERE joined)::int AS joined`;

interface MetricRow {
  applications: number; students: number; rs_pass: number; sc_pass: number; as_pass: number; sp: number;
  internal_rejected: number; rs_rej: number; sc_rej: number; as_rej: number; sc_no_show: number;
  shared: number; interviewed: number; interviews: number; students_interviewed: number;
  selected: number; students_selected: number; offered: number; joined: number;
}

function metrics(row: Partial<MetricRow> | undefined) {
  const r = row ?? {};
  return {
    applications: r.applications ?? 0,
    students: r.students ?? 0,
    resumeShortlisted: r.rs_pass ?? 0,
    screeningCleared: r.sc_pass ?? 0,
    assignmentCleared: r.as_pass ?? 0,
    finalShortlisted: r.sp ?? 0,
    internalRejected: r.internal_rejected ?? 0,
    rejectedAt: { RS: r.rs_rej ?? 0, SC: r.sc_rej ?? 0, AS: r.as_rej ?? 0 },
    screeningNoShow: r.sc_no_show ?? 0,
    shared: r.shared ?? 0,
    interviewed: r.interviewed ?? 0,
    interviews: r.interviews ?? 0,
    studentsInterviewed: r.students_interviewed ?? 0,
    selected: r.selected ?? 0,
    studentsSelected: r.students_selected ?? 0,
    offered: r.offered ?? 0,
    joined: r.joined ?? 0,
  };
}

/** Segments compared side by side; the funnel uses the same rows. */
function segmentRows(query: AcademyQuery): Prisma.Sql {
  const inCategory = categoryCondition(query);
  return Prisma.sql`
    CROSS JOIN LATERAL (VALUES
      ('OVERALL', TRUE),
      ('ACADEMY', ${inCategory}),
      ('ASSESSED_POOL', in_pool),
      ('NOT_IN_POOL', ${inCategory} AND NOT in_pool),
      ('BUCKET_A', tier = 'A'),
      ('BUCKET_B', tier = 'B'),
      ('BUCKET_C', tier = 'C')
    ) AS s(segment, keep)
    WHERE s.keep`;
}

const CTC_BAND = Prisma.sql`
  CASE
    WHEN ctc IS NULL THEN 'Not entered'
    WHEN ctc < 4 THEN '< 4 LPA'
    WHEN ctc < 6 THEN '4–6 LPA'
    WHEN ctc < 8 THEN '6–8 LPA'
    WHEN ctc < 12 THEN '8–12 LPA'
    ELSE '12+ LPA'
  END`;
const CTC_ORDER = ["< 4 LPA", "4–6 LPA", "6–8 LPA", "8–12 LPA", "12+ LPA", "Not entered"];

/**
 * One row per person: academy candidates (by category, product or pool) plus
 * pool members who never appeared in any sheet. Application counts follow the
 * date and job filters.
 */
function peopleCte(query: AcademyQuery, owners: Prisma.Sql): Prisma.Sql {
  const categories = query.academyCategory === "ALL_ACADEMY" ? ["ACADEMY", "ACADEMY_INTENSIVE"] : [query.academyCategory];
  return Prisma.sql`
    ${academyFacts(query, owners)},
    per AS (
      SELECT candidate_id,
        COUNT(*)::int AS applications,
        COUNT(DISTINCT company_id)::int AS companies,
        COUNT(*) FILTER (WHERE sp)::int AS sp,
        COUNT(*) FILTER (WHERE shared)::int AS shared,
        COALESCE(SUM(interviews), 0)::int AS interviews,
        COUNT(*) FILTER (WHERE interviewed)::int AS interviewed,
        COUNT(*) FILTER (WHERE selected)::int AS selected,
        COUNT(*) FILTER (WHERE internal_rejected)::int AS internal_rejected,
        MAX(month) AS last_month
      FROM f GROUP BY candidate_id
    ),
    people AS (
      SELECT c.id AS candidate_id, c."fullName" AS name, c."candidateCode" AS code, c.mobile, COALESCE(c.category::text, 'UNKNOWN') AS category,
        r.id AS pool_id, CASE WHEN r.id IS NOT NULL THEN ${TIER(Prisma.sql`r."bucketTier"`)} END AS tier,
        r."tr1Status" AS tr1, r."tr2Status" AS tr2, ${POOL_SOURCE(Prisma.sql`r`)} AS pool_source, ${PRODUCT_NAMES(Prisma.sql`c.id`)} AS product,
        COALESCE(per.applications, 0) AS applications, COALESCE(per.companies, 0) AS companies, COALESCE(per.sp, 0) AS sp, COALESCE(per.shared, 0) AS shared,
        COALESCE(per.interviews, 0) AS interviews, COALESCE(per.interviewed, 0) AS interviewed, COALESCE(per.selected, 0) AS selected,
        COALESCE(per.internal_rejected, 0) AS internal_rejected, per.last_month
      FROM "Candidate" c
      LEFT JOIN "AssessedPoolRecord" r ON r.mobile = c.mobile
      LEFT JOIN per ON per.candidate_id = c.id
      WHERE c."archivedAt" IS NULL AND (
        r.id IS NOT NULL
        OR c.category::text = ANY(${categories}::text[])
        OR EXISTS (SELECT 1 FROM "CandidateProduct" cp JOIN "Product" pr ON pr.id = cp."productId"
                   WHERE cp."candidateId" = c.id AND pr.category::text = ANY(${categories}::text[]))
      )
      UNION ALL
      SELECT NULL, COALESCE(r."sourceName", 'Unnamed'), r."sourceUserId", r.mobile, 'ACADEMY',
        r.id, ${TIER(Prisma.sql`r."bucketTier"`)}, r."tr1Status", r."tr2Status", ${POOL_SOURCE(Prisma.sql`r`)}, NULL,
        0, 0, 0, 0, 0, 0, 0, 0, NULL
      FROM "AssessedPoolRecord" r
      WHERE NOT EXISTS (SELECT 1 FROM "Candidate" c WHERE c.mobile = r.mobile AND c."archivedAt" IS NULL)
    ),
    pool AS (
      -- One row per pool record; several candidate rows can share its mobile.
      SELECT pool_id, MAX(tier) AS tier, SUM(applications)::int AS applications,
        SUM(sp + shared)::int AS opportunities, SUM(interviewed)::int AS interviewed, SUM(selected)::int AS selected,
        bool_or(candidate_id IS NOT NULL) AS matched
      FROM people WHERE pool_id IS NOT NULL GROUP BY pool_id
    )`;
}

const CANDIDATE_VIEW_CONDITIONS: Record<AcademyCandidateView, Prisma.Sql> = {
  ALL: Prisma.sql`TRUE`,
  APPLIED: Prisma.sql`applications > 0`,
  POOL: Prisma.sql`pool_id IS NOT NULL`,
  POOL_APPLIED: Prisma.sql`pool_id IS NOT NULL AND applications > 0`,
  POOL_ZERO_APPLICATIONS: Prisma.sql`pool_id IS NOT NULL AND applications = 0`,
  POOL_ZERO_OPPORTUNITY: Prisma.sql`pool_id IS NOT NULL AND applications > 0 AND sp = 0 AND shared = 0`,
  ZERO_APPLICATIONS: Prisma.sql`applications = 0`,
};

type PoolSource = "OFFLINE" | "COMPETENCY" | "BOTH";

/** "Where did they get to" filters on the student list (counts are across the period's applications). */
const STAGE_CONDITIONS: Record<AcademyStageFilter, Prisma.Sql> = {
  RESUME_REJECTED: Prisma.sql`COALESCE(rs_rej, 0) > 0`,
  SCREENING_REJECTED: Prisma.sql`COALESCE(sc_rej, 0) > 0`,
  SCREENING_NO_SHOW: Prisma.sql`COALESCE(sc_no_show, 0) > 0`,
  ASSIGNMENT_REJECTED: Prisma.sql`COALESCE(as_rej, 0) > 0`,
  INTERNAL_REJECTED: Prisma.sql`internal_rejected > 0`,
  FINAL_SHORTLISTED: Prisma.sql`sp > 0`,
  SHARED: Prisma.sql`shared > 0`,
  NOT_SHARED: Prisma.sql`applications > 0 AND shared = 0`,
  INTERVIEWED: Prisma.sql`interviewed > 0`,
  COMPANY_REJECTED: Prisma.sql`COALESCE(company_rejected, 0) > 0`,
  SELECTED: Prisma.sql`selected > 0`,
};

const APPLICATION_BANDS = ["0", "1", "2", "3–5", "6–10", "11+"];
const APPLICATION_BAND = Prisma.sql`
  CASE WHEN applications = 0 THEN '0' WHEN applications = 1 THEN '1' WHEN applications = 2 THEN '2'
       WHEN applications <= 5 THEN '3–5' WHEN applications <= 10 THEN '6–10' ELSE '11+' END`;

export const academyInsightsService = {
  async overview(user: AuthenticatedUser, query: AcademyQuery) {
    const owners = await ownerFilter(user);
    const facts = academyFacts(query, owners);
    const people = peopleCte(query, owners);
    const [segments, roundsBySegment, reasons, stacks, ctcBands, jobs, jobRounds, distribution, poolSummary, concluded] = await Promise.all([
      prisma.$queryRaw<(MetricRow & { segment: string })[]>`${facts} SELECT s.segment, ${METRICS} FROM f ${segmentRows(query)} GROUP BY s.segment`,
      prisma.$queryRaw<(RoundRow & { segment: string })[]>`
        ${facts}, ${ROUND_LABELS}
        SELECT s.segment, rounds.label, MIN(rounds.sort)::int AS sort, ${ROUND_METRICS}
        FROM f
        JOIN "CompanyInterview" ci ON ci."nominationId" = f.nomination_id
        JOIN rounds ON rounds.id = ci."roundId"
        ${segmentRows(query)}
        GROUP BY s.segment, rounds.label`,
      prisma.$queryRaw<{ stage: string; reason: string; count: number }[]>`
        ${facts}
        SELECT ps.stage::text AS stage, COALESCE(TRIM(isc."rejectionReason"), '') AS reason, COUNT(*)::int AS count
        FROM af
        JOIN "InternalStageCandidate" isc ON isc."applicationId" = af.application_id
        JOIN "InternalProcessStage" ps ON ps.id = isc."stageId"
        WHERE isc.outcome = 'REJECTED' AND ps.stage IN ('RESUME_SHORTLIST', 'SCREENING_SHORTLIST', 'ASSIGNMENT_SHORTLIST')
        GROUP BY 1, 2`,
      prisma.$queryRaw<(MetricRow & { skill: string; jobs: number; companies: number })[]>`
        ${facts}
        SELECT COALESCE(sk.name, 'Not tagged') AS skill, COUNT(DISTINCT af.job_id)::int AS jobs, COUNT(DISTINCT af.company_id)::int AS companies, ${METRICS}
        FROM af
        LEFT JOIN "JobRequestSkill" js ON js."jobRequestId" = af.job_id
        LEFT JOIN "Skill" sk ON sk.id = js."skillId"
        GROUP BY 1 ORDER BY COUNT(*) DESC, 1`,
      prisma.$queryRaw<(MetricRow & { band: string; jobs: number })[]>`
        ${facts}
        SELECT ${CTC_BAND} AS band, COUNT(DISTINCT job_id)::int AS jobs, ${METRICS} FROM af GROUP BY 1`,
      prisma.$queryRaw<(MetricRow & { job_id: string; role_title: string; company_id: string; company_name: string; month: string; ctc: number | null; phase: string; skills: string | null })[]>`
        ${facts}
        SELECT af.job_id, j."roleTitle" AS role_title, af.company_id, co.name AS company_name, af.month, j."ctcLpa" AS ctc, j."processPhase"::text AS phase,
          (SELECT string_agg(sk.name, ', ' ORDER BY sk.name) FROM "JobRequestSkill" js JOIN "Skill" sk ON sk.id = js."skillId" WHERE js."jobRequestId" = af.job_id) AS skills,
          ${METRICS}
        FROM af
        JOIN "JobRequest" j ON j.id = af.job_id
        JOIN "Company" co ON co.id = af.company_id
        GROUP BY af.job_id, j."roleTitle", af.company_id, co.name, af.month, j."ctcLpa", j."processPhase"
        ORDER BY af.month DESC, co.name`,
      prisma.$queryRaw<(RoundRow & { job_id: string })[]>`
        ${facts}, ${ROUND_LABELS}
        SELECT af.job_id, rounds.label, MIN(rounds.sort)::int AS sort, ${ROUND_METRICS}
        FROM af
        JOIN "CompanyInterview" ci ON ci."nominationId" = af.nomination_id
        JOIN rounds ON rounds.id = ci."roundId"
        GROUP BY af.job_id, rounds.label`,
      prisma.$queryRaw<{ band: string; academy: number; pool: number }[]>`
        ${people}
        SELECT band, COUNT(*) FILTER (WHERE NOT is_pool)::int AS academy, COUNT(*) FILTER (WHERE is_pool)::int AS pool
        FROM (
          SELECT ${APPLICATION_BAND} AS band, FALSE AS is_pool FROM people WHERE candidate_id IS NOT NULL
          UNION ALL
          SELECT ${APPLICATION_BAND}, TRUE FROM pool
        ) x GROUP BY band`,
      prisma.$queryRaw<{ tier: string; total: number; matched: number; applied: number; zero_applications: number; zero_opportunity: number; with_opportunity: number; interviewed: number; selected: number; applications: number }[]>`
        ${people}
        SELECT COALESCE(tier, 'No bucket') AS tier,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE matched)::int AS matched,
          COUNT(*) FILTER (WHERE applications > 0)::int AS applied,
          COUNT(*) FILTER (WHERE applications = 0)::int AS zero_applications,
          COUNT(*) FILTER (WHERE applications > 0 AND opportunities = 0)::int AS zero_opportunity,
          COUNT(*) FILTER (WHERE opportunities > 0)::int AS with_opportunity,
          COUNT(*) FILTER (WHERE interviewed > 0)::int AS interviewed,
          COUNT(*) FILTER (WHERE selected > 0)::int AS selected,
          COALESCE(SUM(applications), 0)::int AS applications
        FROM pool GROUP BY ROLLUP (COALESCE(tier, 'No bucket'))`,
      prisma.$queryRaw<{ job_id: string; role_title: string; company_id: string; company_name: string; phase: string; ended: Date | null; month: string; shared: number; selected: number; not_selected: number; rsa_done: number; rsa_open: number; rsa_none: number; rsa_statuses: { label: string; count: number }[] | null }[]>`
        ${facts},
        rsa AS (
          SELECT af.job_id, af.application_id, af.shared, af.selected, o.label, COALESCE(o."countsAsDone", FALSE) AS done, ss.id IS NOT NULL AS has_rsa
          FROM af
          LEFT JOIN "StudentSupport" ss ON ss."applicationId" = af.application_id AND ss.kind = 'RSA'
          LEFT JOIN "SupportStatusOption" o ON o.id = ss."statusId"
        )
        SELECT j.id AS job_id, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name, j."processPhase"::text AS phase,
          j."companyProcessEndDate" AS ended, to_char(${dateColumn(query)}, 'YYYY-MM') AS month,
          COUNT(rsa.application_id) FILTER (WHERE rsa.shared)::int AS shared,
          COUNT(rsa.application_id) FILTER (WHERE rsa.selected)::int AS selected,
          COUNT(rsa.application_id) FILTER (WHERE rsa.shared AND NOT rsa.selected)::int AS not_selected,
          COUNT(rsa.application_id) FILTER (WHERE rsa.shared AND NOT rsa.selected AND rsa.done)::int AS rsa_done,
          COUNT(rsa.application_id) FILTER (WHERE rsa.shared AND NOT rsa.selected AND rsa.has_rsa AND NOT rsa.done)::int AS rsa_open,
          COUNT(rsa.application_id) FILTER (WHERE rsa.shared AND NOT rsa.selected AND NOT rsa.has_rsa)::int AS rsa_none,
          (SELECT json_agg(json_build_object('label', x.label, 'count', x.count) ORDER BY x.count DESC)
             FROM (SELECT r2.label, COUNT(*)::int AS count FROM rsa r2 WHERE r2.job_id = j.id AND r2.has_rsa AND r2.shared AND NOT r2.selected GROUP BY r2.label) x) AS rsa_statuses
        FROM "JobRequest" j
        JOIN "Company" co ON co.id = j."companyId"
        LEFT JOIN rsa ON rsa.job_id = j.id
        WHERE j."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED') AND ${jobFilter(query)} ${owners}
        GROUP BY j.id, co.id
        ORDER BY j."companyProcessEndDate" DESC NULLS LAST, co.name`,
    ]);

    const segmentMap = Object.fromEntries(segments.map((row) => [row.segment, metrics(row)]));
    const segmentKeys = ["OVERALL", "ACADEMY", "ASSESSED_POOL", "NOT_IN_POOL", "BUCKET_A", "BUCKET_B", "BUCKET_C"] as const;

    const roundLabels = [...new Map(roundsBySegment.map((row) => [row.label, row.sort])).entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
    const companyRounds = roundLabels.map((label) => ({
      label,
      bySegment: Object.fromEntries(segmentKeys.map((segment) => {
        const row = roundsBySegment.find((item) => item.label === label && item.segment === segment);
        return [segment, row ? round(row) : { label, appeared: 0, cleared: 0, rejected: 0, noShow: 0, scheduled: 0 }];
      })),
    }));

    // Macro rejection buckets, with the raw reasons behind each.
    const bucketTotals = new Map(REJECTION_BUCKETS.map((bucket) => [bucket, { bucket, total: 0, RS: 0, SC: 0, AS: 0, reasons: new Map<string, number>() }]));
    for (const row of reasons) {
      const bucket = bucketTotals.get(bucketRejectionReason(row.reason))!;
      const stage = row.stage === "RESUME_SHORTLIST" ? "RS" : row.stage === "SCREENING_SHORTLIST" ? "SC" : "AS";
      bucket.total += row.count;
      bucket[stage] += row.count;
      if (row.reason) bucket.reasons.set(row.reason, (bucket.reasons.get(row.reason) ?? 0) + row.count);
    }
    const rejectionBuckets = [...bucketTotals.values()].filter((bucket) => bucket.total > 0).sort((a, b) => b.total - a.total).map((bucket) => ({
      bucket: bucket.bucket,
      total: bucket.total,
      byStage: { RS: bucket.RS, SC: bucket.SC, AS: bucket.AS },
      topReasons: [...bucket.reasons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, count]) => ({ reason, count })),
    }));

    const roundsByJob = new Map<string, RoundRow[]>();
    for (const row of jobRounds) roundsByJob.set(row.job_id, [...(roundsByJob.get(row.job_id) ?? []), row]);

    const poolTotals = poolSummary.find((row) => row.tier === null) ?? null;
    const poolTier = (row: (typeof poolSummary)[number]) => ({
      tier: row.tier, total: row.total, matched: row.matched, applied: row.applied, zeroApplications: row.zero_applications,
      zeroOpportunity: row.zero_opportunity, withOpportunity: row.with_opportunity, interviewed: row.interviewed, selected: row.selected, applications: row.applications,
    });

    const concludedJobs = concluded.map((row) => ({
      jobRequestId: row.job_id, roleTitle: row.role_title, companyId: row.company_id, companyName: row.company_name, phase: row.phase,
      processEndDate: row.ended ? row.ended.toISOString().slice(0, 10) : null, month: row.month,
      shared: row.shared, selected: row.selected, notSelected: row.not_selected, rsaDone: row.rsa_done, rsaOpen: row.rsa_open, rsaNotStarted: row.rsa_none,
      rsaStatuses: row.rsa_statuses ?? [],
    }));

    return {
      filters: query,
      segments: segmentKeys.map((segment) => ({ segment, ...(segmentMap[segment] ?? metrics(undefined)) })),
      companyRounds,
      rejectionBuckets,
      rejectionsWithoutReason: reasons.filter((row) => !row.reason).reduce((sum, row) => sum + row.count, 0),
      byTechStack: stacks.map((row) => ({ skill: row.skill, jobs: row.jobs, companies: row.companies, ...metrics(row) })),
      byCtcBand: ctcBands.sort((a, b) => CTC_ORDER.indexOf(a.band) - CTC_ORDER.indexOf(b.band)).map((row) => ({ band: row.band, jobs: row.jobs, ...metrics(row) })),
      byJob: jobs.map((row) => ({
        jobRequestId: row.job_id, roleTitle: row.role_title, companyId: row.company_id, companyName: row.company_name, month: row.month,
        ctcLpa: row.ctc, phase: row.phase, skills: row.skills, ...metrics(row),
        rounds: (roundsByJob.get(row.job_id) ?? []).sort((a, b) => a.sort - b.sort).map(round),
      })),
      applicationsPerCandidate: APPLICATION_BANDS.map((band) => {
        const row = distribution.find((item) => item.band === band);
        return { band, academy: row?.academy ?? 0, pool: row?.pool ?? 0 };
      }),
      pool: {
        totals: poolTotals ? poolTier(poolTotals) : null,
        byTier: poolSummary.filter((row) => row.tier !== null).map(poolTier).sort((a, b) => (a.tier ?? "").localeCompare(b.tier ?? "")),
      },
      concluded: {
        companies: new Set(concludedJobs.map((row) => row.companyId)).size,
        jobCount: concludedJobs.length,
        rsaComplete: concludedJobs.filter((row) => row.notSelected > 0 && row.rsaDone === row.notSelected).length,
        rsaPartial: concludedJobs.filter((row) => row.rsaDone > 0 && row.rsaDone < row.notSelected).length,
        rsaNotDone: concludedJobs.filter((row) => row.notSelected > 0 && row.rsaDone === 0).length,
        nothingToReview: concludedJobs.filter((row) => row.notSelected === 0).length,
        studentsToReview: concludedJobs.reduce((sum, row) => sum + row.notSelected, 0),
        studentsReviewed: concludedJobs.reduce((sum, row) => sum + row.rsaDone, 0),
        jobs: concludedJobs,
      },
    };
  },

  /** One student's applications in the period: each internal stage and each company round. */
  async studentApplications(user: AuthenticatedUser, candidateId: string, query: AcademyQuery) {
    const owners = await ownerFilter(user);
    const facts = academyFacts({ ...query, academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery, owners);
    const rows = await prisma.$queryRaw<{
      application_id: string; job_id: string; job_code: string | null; role_title: string; company_id: string; company_name: string; month: string;
      rs_sel: boolean; rs_rej: boolean; sc_sel: boolean; sc_rej: boolean; sc_no_show: boolean; as_sel: boolean; as_rej: boolean; sp: boolean;
      rs_pass: boolean; sc_pass: boolean; as_pass: boolean; shared: boolean; pipeline: string | null; selected: boolean;
      rejection_reason: string | null; rejected_stage: string | null;
      rounds: { label: string; sort: number; outcome: string; reason: string | null }[] | null;
    }[]>`
      ${facts}, ${ROUND_LABELS}
      SELECT f.application_id, f.job_id, j."jobId" AS job_code, j."roleTitle" AS role_title, f.company_id, co.name AS company_name, f.month,
        f.rs_sel, f.rs_rej, f.sc_sel, f.sc_rej, f.sc_no_show, f.as_sel, f.as_rej, f.sp, f.rs_pass, f.sc_pass, f.as_pass,
        f.shared, f.pipeline, f.selected,
        (SELECT string_agg(DISTINCT TRIM(x."rejectionReason"), '; ') FROM "InternalStageCandidate" x
          WHERE x."applicationId" = f.application_id AND x.outcome = 'REJECTED' AND NULLIF(TRIM(x."rejectionReason"), '') IS NOT NULL) AS rejection_reason,
        (SELECT xs.stage::text FROM "InternalStageCandidate" x JOIN "InternalProcessStage" xs ON xs.id = x."stageId"
          WHERE x."applicationId" = f.application_id AND x.outcome = 'REJECTED' LIMIT 1) AS rejected_stage,
        (SELECT jsonb_agg(jsonb_build_object('label', rounds.label, 'sort', rounds.sort, 'outcome', ci.outcome::text,
            'reason', NULLIF(concat_ws(' — ', t.label, NULLIF(TRIM(ci."rejectionReason"), '')), ''), 'tag', t.label, 'docUrl', ci."rejectionDocUrl") ORDER BY rounds.sort)
          FROM "CompanyInterview" ci JOIN rounds ON rounds.id = ci."roundId" LEFT JOIN "RejectionReasonTag" t ON t.id = ci."rejectionTagId"
          WHERE ci."nominationId" = f.nomination_id) AS rounds
      FROM f
      JOIN "JobRequest" j ON j.id = f.job_id
      JOIN "Company" co ON co.id = f.company_id
      WHERE f.candidate_id = ${candidateId}::uuid
      ORDER BY f.month DESC, co.name`;
    // A stage reads "selected" when passed (a later pass counts), "rejected", or "no-show"; null when never reached.
    const stage = (passed: boolean, rejected: boolean, noShow = false) => (rejected ? "REJECTED" : noShow ? "NO_SHOW" : passed ? "SELECTED" : null);
    return rows.map((row) => ({
      applicationId: row.application_id,
      jobRequestId: row.job_id,
      jobCode: row.job_code,
      roleTitle: row.role_title,
      companyId: row.company_id,
      companyName: row.company_name,
      month: row.month,
      internal: {
        RS: stage(row.rs_pass, row.rs_rej),
        SC: stage(row.sc_pass, row.sc_rej, row.sc_no_show),
        AS: stage(row.as_pass, row.as_rej),
        SP: row.sp ? "SELECTED" : null,
      },
      rejectedStage: row.rejected_stage,
      rejectionReason: row.rejection_reason,
      shared: row.shared,
      pipelineStatus: row.pipeline,
      selected: row.selected,
      rounds: (row.rounds ?? []).map(({ label, outcome, reason }) => ({ label, outcome, reason })),
    }));
  },

  async candidates(user: AuthenticatedUser, query: AcademyCandidatesQuery) {
    const owners = await ownerFilter(user);
    const conditions: Prisma.Sql[] = [CANDIDATE_VIEW_CONDITIONS[query.view]];
    if (query.segment === "ASSESSED_POOL") conditions.push(Prisma.sql`pool_id IS NOT NULL`);
    if (query.segment === "NOT_IN_POOL") conditions.push(Prisma.sql`pool_id IS NULL`);
    if (query.segment.startsWith("BUCKET_")) conditions.push(Prisma.sql`tier = ${query.segment.slice(-1)}`);
    if (query.poolSource === "ANY") conditions.push(Prisma.sql`pool_id IS NOT NULL`);
    else if (query.poolSource === "NONE") conditions.push(Prisma.sql`pool_id IS NULL`);
    else if (query.poolSource === "OFFLINE") conditions.push(Prisma.sql`pool_source IN ('OFFLINE', 'BOTH')`);
    else if (query.poolSource === "COMPETENCY") conditions.push(Prisma.sql`pool_source IN ('COMPETENCY', 'BOTH')`);
    else if (query.poolSource === "BOTH") conditions.push(Prisma.sql`pool_source = 'BOTH'`);
    if (query.product === "NONE") conditions.push(Prisma.sql`product IS NULL`);
    else if (query.product) conditions.push(Prisma.sql`${query.product} = ANY(string_to_array(product, ', '))`);
    if (query.stage) conditions.push(STAGE_CONDITIONS[query.stage]);
    if (query.reasonTagId) {
      conditions.push(query.reasonTagId === "untagged"
        ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(reasons, '[]'::jsonb)) x WHERE x->>'tagId' IS NULL)`
        : Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(reasons, '[]'::jsonb)) x WHERE x->>'tagId' = ${query.reasonTagId})`);
    }
    if (query.q) {
      const digits = query.q.replace(/\D/g, "");
      conditions.push(digits.length >= 4
        ? Prisma.sql`(name ILIKE ${`%${query.q}%`} OR mobile LIKE ${`%${digits}%`})`
        : Prisma.sql`name ILIKE ${`%${query.q}%`}`);
    }
    const rows = await prisma.$queryRaw<{
      candidate_id: string | null; name: string; code: string | null; mobile: string | null; category: string; pool_id: string | null; tier: string | null;
      tr1: string | null; tr2: string | null; pool_source: PoolSource | null; product: string | null; applications: number; companies: number; sp: number; shared: number; interviews: number; interviewed: number; selected: number;
      internal_rejected: number; last_month: string | null;
      rs_sel: number | null; rs_rej: number | null; sc_sel: number | null; sc_rej: number | null; sc_no_show: number | null; as_sel: number | null; as_rej: number | null;
      company: Record<string, { cleared: number; rejected: number }> | null;
      company_rejected: number | null; reasons: { tagId: string | null; label: string }[] | null;
    }[]>`
      ${peopleCte(query, owners)}, ${ROUND_LABELS},
      -- Each internal stage, counted the same way as the funnel (a later pass counts as passing earlier stages).
      internal AS (
        SELECT candidate_id,
          COUNT(*) FILTER (WHERE rs_pass)::int AS rs_sel, COUNT(*) FILTER (WHERE rs_rej)::int AS rs_rej,
          COUNT(*) FILTER (WHERE sc_pass)::int AS sc_sel, COUNT(*) FILTER (WHERE sc_rej)::int AS sc_rej, COUNT(*) FILTER (WHERE sc_no_show)::int AS sc_no_show,
          COUNT(*) FILTER (WHERE as_pass)::int AS as_sel, COUNT(*) FILTER (WHERE as_rej)::int AS as_rej
        FROM f GROUP BY candidate_id
      ),
      -- Each company round: { TR1: { cleared, rejected }, … }.
      company AS (
        SELECT candidate_id, jsonb_object_agg(stage, jsonb_build_object('cleared', cleared, 'rejected', rejected)) AS company
        FROM (
          SELECT f.candidate_id, ${ROUND_STAGE} AS stage,
            COUNT(*) FILTER (WHERE ci.outcome = 'CLEARED')::int AS cleared,
            COUNT(*) FILTER (WHERE ci.outcome = 'REJECTED')::int AS rejected
          FROM f
          JOIN "CompanyInterview" ci ON ci."nominationId" = f.nomination_id
          JOIN rounds ON rounds.id = ci."roundId"
          GROUP BY 1, 2
        ) per_stage
        GROUP BY candidate_id
      ),
      -- Company-round rejections and the reason each was tagged with.
      -- Drives where the company did not select them, and why (RSA tag, else the rejected round's tag).
      company_rej AS (
        SELECT f.candidate_id, COUNT(*)::int AS company_rejected,
          jsonb_agg(jsonb_build_object('tagId', rt.id, 'label', COALESCE(rt.label, 'No reason tagged'))) AS reasons
        FROM f
        ${APPLICATION_REASON(Prisma.sql`f`)}
        WHERE ${NOT_SELECTED(Prisma.sql`f`)}
        GROUP BY f.candidate_id
      ),
      listed AS (
        SELECT people.*, internal.rs_sel, internal.rs_rej, internal.sc_sel, internal.sc_rej, internal.sc_no_show, internal.as_sel, internal.as_rej, company.company,
          company_rej.company_rejected, company_rej.reasons
        FROM people
        LEFT JOIN internal ON internal.candidate_id = people.candidate_id
        LEFT JOIN company ON company.candidate_id = people.candidate_id
        LEFT JOIN company_rej ON company_rej.candidate_id = people.candidate_id
      )
      SELECT * FROM listed
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY applications DESC, name
      LIMIT 5000`;
    const showContact = hasPermission(user.roles, "candidate:pii:read");
    return rows.map((row) => ({
      candidateId: row.candidate_id,
      fullName: row.name,
      candidateCode: row.code,
      mobile: showContact ? row.mobile : maskMobile(row.mobile),
      category: row.category,
      inPool: row.pool_id !== null,
      poolSource: row.pool_source,
      product: row.product,
      tier: row.tier,
      tr1Status: row.tr1,
      tr2Status: row.tr2,
      applications: row.applications,
      companies: row.companies,
      internalRejected: row.internal_rejected,
      finalShortlisted: row.sp,
      shared: row.shared,
      interviewed: row.interviewed,
      interviews: row.interviews,
      selected: row.selected,
      lastMonth: row.last_month,
      internalStages: {
        RS: { selected: row.rs_sel ?? 0, rejected: row.rs_rej ?? 0 },
        SC: { selected: row.sc_sel ?? 0, rejected: row.sc_rej ?? 0, noShow: row.sc_no_show ?? 0 },
        AS: { selected: row.as_sel ?? 0, rejected: row.as_rej ?? 0 },
      },
      companyStages: row.company ?? {},
      companyRejected: row.company_rejected ?? 0,
      rejectionReasons: [...new Set((row.reasons ?? []).map((reason) => reason.label))],
    }));
  },
};
