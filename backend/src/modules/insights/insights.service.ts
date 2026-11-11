import { hasPermission } from "@placement/shared";
import { prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { resolveDataScope } from "../../services/data-scope.service.js";
import { maskMobile } from "../../services/pii.js";
import type { InsightsQuery, StudentInsightsQuery, StudentStatusFilter } from "./insights.validators.js";

/**
 * Stakeholders and administrators see the whole workspace here; managers see
 * their team's jobs and employees their own, as everywhere else.
 */
async function ownerFilter(user: AuthenticatedUser): Promise<Prisma.Sql> {
  if (user.roles.includes("STAKEHOLDER")) return Prisma.empty;
  const scope = await resolveDataScope(user);
  if (scope.kind === "organization") return Prisma.empty;
  if (scope.ownerIds.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND j."psmOwnerId" = ANY(${scope.ownerIds}::uuid[])`;
}

function jobFilter(query: InsightsQuery): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`j."archivedAt" IS NULL`];
  if (query.from) parts.push(Prisma.sql`j."requestDate" >= ${`${query.from}-01`}::date`);
  if (query.to) parts.push(Prisma.sql`j."requestDate" < (${`${query.to}-01`}::date + INTERVAL '1 month')`);
  if (query.companyId) parts.push(Prisma.sql`j."companyId" = ${query.companyId}::uuid`);
  return Prisma.join(parts, " AND ");
}

/**
 * One row per application with its internal and company outcome.
 * category: the product's category when applied, else the candidate's.
 */
function applicationFacts(query: InsightsQuery, owners: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH facts AS (
      SELECT
        a.id AS application_id,
        a."candidateId" AS candidate_id,
        j.id AS job_id,
        j."companyId" AS company_id,
        to_char(j."requestDate", 'YYYY-MM') AS month,
        COALESCE(p.category::text, c.category::text, 'UNKNOWN') AS category,
        COALESCE(bool_or(ps.stage = 'RESUME_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS rs_rejected,
        COALESCE(bool_or(ps.stage = 'SCREENING_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS sc_rejected,
        COALESCE(bool_or(ps.stage = 'ASSIGNMENT_SHORTLIST' AND isc.outcome = 'REJECTED'), FALSE) AS as_rejected,
        COALESCE(bool_or(ps.stage = 'SCREENING_SHORTLIST' AND isc.outcome = 'NO_SHOW'), FALSE) AS sc_no_show,
        COALESCE(bool_or(ps.stage = 'FINAL_SHORTLIST' AND isc.outcome = 'SELECTED'), FALSE) AS sp,
        CASE WHEN n.status = 'NOMINATED' THEN n."pipelineStatus"::text END AS pipeline,
        COALESCE(n.status = 'WITHDRAWN', FALSE) AS withdrawn,
        -- Job moved past "Yet to share CVs" but this drive's company sheet is not imported yet.
        (j."processPhase" <> 'YET_TO_SHARE_CVS' AND NOT EXISTS (
          SELECT 1 FROM "ImportBatch" ib
          WHERE ib."recruitmentBatchId" = a."recruitmentBatchId" AND ib.target = 'COMPANY_PIPELINE' AND ib.status = 'COMMITTED'
        )) AS sheet_pending
      FROM "Application" a
      JOIN "JobRequest" j ON j.id = a."jobRequestId"
      JOIN "Candidate" c ON c.id = a."candidateId"
      LEFT JOIN "Product" p ON p.id = a."productId"
      LEFT JOIN "InternalStageCandidate" isc ON isc."applicationId" = a.id
      LEFT JOIN "InternalProcessStage" ps ON ps.id = isc."stageId"
      LEFT JOIN "CompanyNomination" n ON n."applicationId" = a.id
      WHERE a.status <> 'WITHDRAWN' AND ${jobFilter(query)} ${owners}
      GROUP BY a.id, j.id, p.category, c.category, n.status, n."pipelineStatus"
    ),
    f AS (
      SELECT *,
        (rs_rejected OR sc_rejected OR as_rejected) AS internal_rejected,
        ((pipeline IS NOT NULL AND pipeline <> 'NOT_SUBMITTED') OR (sp AND sheet_pending AND NOT withdrawn)) AS shared,
        (sp AND (pipeline IS NULL OR pipeline = 'NOT_SUBMITTED') AND NOT (sheet_pending AND NOT withdrawn)) AS not_shared
      FROM facts
      ${query.category ? Prisma.sql`WHERE category = ${query.category}` : Prisma.empty}
    )`;
}

/** Aggregates every metric for whatever the rows are grouped by. */
const METRICS = Prisma.sql`
  COUNT(*)::int AS applications,
  COUNT(DISTINCT candidate_id)::int AS students,
  COUNT(*) FILTER (WHERE category = 'ACADEMY')::int AS academy_applications,
  COUNT(*) FILTER (WHERE internal_rejected)::int AS internal_rejected,
  COUNT(*) FILTER (WHERE internal_rejected AND category = 'ACADEMY')::int AS academy_internal_rejected,
  COUNT(*) FILTER (WHERE rs_rejected)::int AS rs_rejected,
  COUNT(*) FILTER (WHERE sc_rejected)::int AS sc_rejected,
  COUNT(*) FILTER (WHERE as_rejected)::int AS as_rejected,
  COUNT(*) FILTER (WHERE sc_no_show)::int AS sc_no_show,
  COUNT(*) FILTER (WHERE sp)::int AS final_shortlisted,
  COUNT(*) FILTER (WHERE shared)::int AS shared,
  COUNT(*) FILTER (WHERE not_shared)::int AS not_shared,
  COUNT(*) FILTER (WHERE pipeline IN ('IN_PROCESS', 'ON_HOLD'))::int AS in_process,
  COUNT(*) FILTER (WHERE pipeline = 'REJECTED')::int AS company_rejected,
  COUNT(*) FILTER (WHERE pipeline IN ('SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED'))::int AS selected,
  COUNT(*) FILTER (WHERE pipeline IN ('OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED'))::int AS offers,
  COUNT(*) FILTER (WHERE pipeline = 'JOINED')::int AS joined`;

interface MetricRow {
  applications: number;
  students: number;
  academy_applications: number;
  internal_rejected: number;
  academy_internal_rejected: number;
  rs_rejected: number;
  sc_rejected: number;
  as_rejected: number;
  sc_no_show: number;
  final_shortlisted: number;
  shared: number;
  not_shared: number;
  in_process: number;
  company_rejected: number;
  selected: number;
  offers: number;
  joined: number;
}

function metrics(row: MetricRow | undefined) {
  const r = row ?? ({} as Partial<MetricRow>);
  return {
    applications: r.applications ?? 0,
    students: r.students ?? 0,
    academyApplications: r.academy_applications ?? 0,
    internalRejected: r.internal_rejected ?? 0,
    academyInternalRejected: r.academy_internal_rejected ?? 0,
    rejectedAt: { RS: r.rs_rejected ?? 0, SC: r.sc_rejected ?? 0, AS: r.as_rejected ?? 0 },
    screeningNoShow: r.sc_no_show ?? 0,
    finalShortlisted: r.final_shortlisted ?? 0,
    shared: r.shared ?? 0,
    notShared: r.not_shared ?? 0,
    inProcess: r.in_process ?? 0,
    companyRejected: r.company_rejected ?? 0,
    selected: r.selected ?? 0,
    offers: r.offers ?? 0,
    joined: r.joined ?? 0,
  };
}

const STATUS_CONDITIONS: Record<StudentStatusFilter, Prisma.Sql> = {
  INTERNAL_REJECTED: Prisma.sql`internal_rejected`,
  FINAL_SHORTLIST: Prisma.sql`sp`,
  NOT_SHARED: Prisma.sql`not_shared`,
  SHARED: Prisma.sql`shared`,
  IN_PROCESS: Prisma.sql`pipeline IN ('IN_PROCESS', 'ON_HOLD')`,
  COMPANY_REJECTED: Prisma.sql`pipeline = 'REJECTED'`,
  SELECTED: Prisma.sql`pipeline IN ('SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'JOINED')`,
  JOINED: Prisma.sql`pipeline = 'JOINED'`,
};

export const insightsService = {
  async overview(user: AuthenticatedUser, query: InsightsQuery) {
    const owners = await ownerFilter(user);
    const facts = applicationFacts(query, owners);
    const [totals, byCategory, byCompany, byMonth, skipped, rejectionReasons, jobStats] = await Promise.all([
      prisma.$queryRaw<MetricRow[]>`${facts} SELECT ${METRICS} FROM f`,
      prisma.$queryRaw<(MetricRow & { category: string })[]>`${facts} SELECT category, ${METRICS} FROM f GROUP BY category ORDER BY category`,
      prisma.$queryRaw<(MetricRow & { company_id: string; company_name: string; jobs: number })[]>`
        ${facts}
        SELECT f.company_id, co.name AS company_name, COUNT(DISTINCT f.job_id)::int AS jobs, ${METRICS}
        FROM f JOIN "Company" co ON co.id = f.company_id
        GROUP BY f.company_id, co.name
        ORDER BY COUNT(*) DESC, co.name`,
      prisma.$queryRaw<(MetricRow & { month: string; jobs: number; companies: number })[]>`
        ${facts}
        SELECT month, COUNT(DISTINCT job_id)::int AS jobs, COUNT(DISTINCT company_id)::int AS companies, ${METRICS}
        FROM f GROUP BY month ORDER BY month DESC`,
      prisma.$queryRaw<{ job_id: string; role_title: string; company_id: string; company_name: string; owner_name: string | null; month: string; skip_reason: string | null; note: string | null; final_shortlisted: number }[]>`
        SELECT j.id AS job_id, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name, u."fullName" AS owner_name,
               to_char(j."requestDate", 'YYYY-MM') AS month, s."skipReason"::text AS skip_reason, s.remarks AS note,
               (SELECT COUNT(*)::int FROM "InternalStageCandidate" x JOIN "InternalProcessStage" xs ON xs.id = x."stageId"
                 WHERE xs."jobRequestId" = j.id AND xs.stage = 'FINAL_SHORTLIST' AND x.outcome = 'SELECTED') AS final_shortlisted
        FROM "InternalProcessStage" s
        JOIN "JobRequest" j ON j.id = s."jobRequestId"
        JOIN "Company" co ON co.id = j."companyId"
        LEFT JOIN "User" u ON u.id = j."psmOwnerId"
        WHERE s.stage = 'SCREENING_SHORTLIST' AND s.status = 'NOT_CONDUCTED' AND ${jobFilter(query)} ${owners}
        ORDER BY j."requestDate" DESC`,
      prisma.$queryRaw<{ stage: string; reason: string; count: number }[]>`
        ${facts}
        SELECT ps.stage::text AS stage, TRIM(isc."rejectionReason") AS reason, COUNT(*)::int AS count
        FROM f
        JOIN "InternalStageCandidate" isc ON isc."applicationId" = f.application_id
        JOIN "InternalProcessStage" ps ON ps.id = isc."stageId"
        WHERE isc.outcome = 'REJECTED' AND NULLIF(TRIM(isc."rejectionReason"), '') IS NOT NULL
          AND ps.stage IN ('RESUME_SHORTLIST', 'SCREENING_SHORTLIST', 'ASSIGNMENT_SHORTLIST')
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
      prisma.$queryRaw<{ phase: string; count: number }[]>`
        SELECT j."processPhase"::text AS phase, COUNT(*)::int AS count
        FROM "JobRequest" j
        WHERE ${jobFilter(query)} ${owners} AND j.status IN ('DRAFT', 'OPEN', 'ON_HOLD')
        GROUP BY 1`,
    ]);
    const skipReasons = new Map<string, number>();
    for (const row of skipped) skipReasons.set(row.skip_reason ?? "UNSPECIFIED", (skipReasons.get(row.skip_reason ?? "UNSPECIFIED") ?? 0) + 1);
    return {
      filters: query,
      totals: metrics(totals[0]),
      byCategory: byCategory.map((row) => ({ category: row.category, ...metrics(row) })),
      byCompany: byCompany.map((row) => ({ companyId: row.company_id, companyName: row.company_name, jobs: row.jobs, ...metrics(row) })),
      byMonth: byMonth.map((row) => ({ month: row.month, jobs: row.jobs, companies: row.companies, ...metrics(row) })),
      screeningSkipped: {
        total: skipped.length,
        byReason: [...skipReasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        jobs: skipped.map((row) => ({
          jobRequestId: row.job_id,
          roleTitle: row.role_title,
          companyId: row.company_id,
          companyName: row.company_name,
          ownerName: row.owner_name,
          month: row.month,
          reason: row.skip_reason,
          note: row.note,
          finalShortlisted: row.final_shortlisted,
        })),
      },
      rejectionReasons,
      activeJobsByPhase: jobStats,
    };
  },

  async students(user: AuthenticatedUser, query: StudentInsightsQuery) {
    const owners = await ownerFilter(user);
    const facts = applicationFacts(query, owners);
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.status) conditions.push(STATUS_CONDITIONS[query.status]);
    if (query.q) {
      const digits = query.q.replace(/\D/g, "");
      conditions.push(digits.length >= 4
        ? Prisma.sql`(c."fullName" ILIKE ${`%${query.q}%`} OR c.mobile LIKE ${`%${digits}%`})`
        : Prisma.sql`c."fullName" ILIKE ${`%${query.q}%`}`);
    }
    const where = Prisma.join(conditions, " AND ");
    const offset = (query.page - 1) * query.pageSize;
    const [count, rows] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`${facts} SELECT COUNT(*)::int AS total FROM f JOIN "Candidate" c ON c.id = f.candidate_id WHERE ${where}`,
      prisma.$queryRaw<{
        application_id: string; candidate_id: string; full_name: string; candidate_code: string; mobile: string | null;
        category: string; product_name: string | null; job_id: string; role_title: string; company_id: string; company_name: string; month: string;
        rs_rejected: boolean; sc_rejected: boolean; as_rejected: boolean; sc_no_show: boolean; sp: boolean; pipeline: string | null;
        shared: boolean; not_shared: boolean; rejection_reason: string | null; guidance_status: string | null; guidance_by: string | null; rsa_status: string | null; rsa_by: string | null; session_guidance: boolean;
      }[]>`
        ${facts}
        SELECT f.application_id, f.candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code, c.mobile,
               f.category, p.name AS product_name, f.job_id, j."roleTitle" AS role_title, f.company_id, co.name AS company_name, f.month,
               f.rs_rejected, f.sc_rejected, f.as_rejected, f.sc_no_show, f.sp, f.pipeline, f.shared, f.not_shared,
               (SELECT string_agg(DISTINCT x."rejectionReason", '; ') FROM "InternalStageCandidate" x
                 WHERE x."applicationId" = f.application_id AND x.outcome = 'REJECTED' AND NULLIF(TRIM(x."rejectionReason"), '') IS NOT NULL) AS rejection_reason,
               sgo.label AS guidance_status,
               concat_ws(', ', (SELECT string_agg(u."fullName", ', ' ORDER BY u."fullName") FROM "StudentSupportContributor" sc JOIN "User" u ON u.id = sc."userId" WHERE sc."supportId" = sg.id), NULLIF(sg."otherContributors", '')) AS guidance_by,
               sro.label AS rsa_status,
               concat_ws(', ', (SELECT string_agg(u."fullName", ', ' ORDER BY u."fullName") FROM "StudentSupportContributor" sc JOIN "User" u ON u.id = sc."userId" WHERE sc."supportId" = sr.id), NULLIF(sr."otherContributors", '')) AS rsa_by,
               EXISTS (SELECT 1 FROM "GuidanceSession" gs WHERE gs."jobRequestId" = f.job_id) AS session_guidance
        FROM f
        JOIN "Candidate" c ON c.id = f.candidate_id
        JOIN "Application" a ON a.id = f.application_id
        LEFT JOIN "Product" p ON p.id = a."productId"
        JOIN "JobRequest" j ON j.id = f.job_id
        JOIN "Company" co ON co.id = f.company_id
        LEFT JOIN "StudentSupport" sg ON sg."applicationId" = f.application_id AND sg.kind = 'GUIDANCE'
        LEFT JOIN "StudentSupport" sr ON sr."applicationId" = f.application_id AND sr.kind = 'RSA'
        LEFT JOIN "SupportStatusOption" sgo ON sgo.id = sg."statusId"
        LEFT JOIN "SupportStatusOption" sro ON sro.id = sr."statusId"
        WHERE ${where}
        ORDER BY f.month DESC, co.name, c."fullName"
        LIMIT ${query.pageSize} OFFSET ${offset}`,
    ]);
    const showContact = hasPermission(user.roles, "candidate:pii:read");
    return {
      items: rows.map((row) => ({
        applicationId: row.application_id,
        candidateId: row.candidate_id,
        fullName: row.full_name,
        candidateCode: row.candidate_code,
        mobile: showContact ? row.mobile : maskMobile(row.mobile),
        category: row.category,
        productName: row.product_name,
        jobRequestId: row.job_id,
        roleTitle: row.role_title,
        companyId: row.company_id,
        companyName: row.company_name,
        month: row.month,
        rejectedAt: row.rs_rejected ? "RS" : row.sc_rejected ? "SC" : row.as_rejected ? "AS" : null,
        screeningNoShow: row.sc_no_show,
        finalShortlisted: row.sp,
        shareStatus: row.shared ? "SHARED" : row.not_shared ? "NOT_SHARED" : "NOT_SHORTLISTED",
        pipelineStatus: row.pipeline,
        rejectionReason: row.rejection_reason,
        guidance: row.guidance_status
          ? `${row.guidance_status}${row.guidance_by ? ` · ${row.guidance_by}` : ""}`
          : row.session_guidance ? "Drive session" : null,
        rsa: row.rsa_status ? `${row.rsa_status}${row.rsa_by ? ` · ${row.rsa_by}` : ""}` : null,
      })),
      meta: { page: query.page, pageSize: query.pageSize, total: count[0]?.total ?? 0, totalPages: Math.max(1, Math.ceil((count[0]?.total ?? 0) / query.pageSize)) },
    };
  },
};
