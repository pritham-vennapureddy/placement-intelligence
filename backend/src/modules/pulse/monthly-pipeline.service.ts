import {
  ACTIVE_POTENTIAL_STATUSES,
  hasPermission,
  nextMonthKey,
  POTENTIAL_COMPANY_STATUS_LABELS,
  STARTING_POTENTIAL_STATUSES,
  type PotentialCompanyStatus,
} from "@placement/shared";
import { inTransaction, prisma, type Db } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { academyFacts, APPLICATION_PRODUCT, POOL_SOURCE, PRODUCT_LABEL, PRODUCT_NAMES } from "../insights/academy-insights.service.js";
import { APPLICATION_REASON } from "../insights/company-reasons.service.js";
import { ROUND_LABELS } from "../insights/company-rounds.js";
import { ownerFilter } from "../insights/insights.service.js";
import type { AcademyQuery } from "../insights/insights.validators.js";
import { companyAndOpeningCounts, notSelectedReasonsByJob, studentPositions, sumReasons, type MonthJob } from "./month-big-picture.js";
import type { CarryForwardInput, CreateEntryInput, UpdateEntryInput } from "./pulse.validators.js";

/** "2026-11" → 2026-11-01 (UTC, stored as a date). */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

function assertCanWrite(user: AuthenticatedUser) {
  if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to change the monthly pipeline.");
}

const entrySelect = {
  id: true,
  month: true,
  status: true,
  roleHint: true,
  expectedOpenings: true,
  expectedStartDate: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  jobRequest: {
    select: {
      id: true, jobId: true, roleTitle: true, openings: true, processPhase: true, companyProcessStartDate: true, companyProcessEndDate: true, companyId: true,
      processRound: { select: { name: true } }, psmOwner: { select: { id: true, fullName: true } },
    },
  },
  crmOwner: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  carriedFrom: { select: { id: true, month: true, status: true } },
  carriedTo: { select: { id: true, month: true } },
  history: {
    select: { id: true, fromStatus: true, toStatus: true, note: true, changedAt: true, changedBy: { select: { id: true, fullName: true } } },
    orderBy: { changedAt: "desc" as const },
  },
} satisfies Prisma.MonthlyPipelineEntrySelect;

type EntryRow = Prisma.MonthlyPipelineEntryGetPayload<{ select: typeof entrySelect }>;

function present(entry: EntryRow, firstListed: Map<string, Date>) {
  return {
    ...entry,
    month: monthKey(entry.month),
    expectedStartDate: day(entry.expectedStartDate),
    jobRequest: { ...entry.jobRequest, companyProcessStartDate: day(entry.jobRequest.companyProcessStartDate), companyProcessEndDate: day(entry.jobRequest.companyProcessEndDate) },
    carriedFrom: entry.carriedFrom ? { ...entry.carriedFrom, month: monthKey(entry.carriedFrom.month) } : null,
    carriedTo: entry.carriedTo ? { ...entry.carriedTo, month: monthKey(entry.carriedTo.month) } : null,
    /** First month this company appeared on the list (any entry). */
    firstListedMonth: monthKey(firstListed.get(entry.company.id) ?? entry.month),
  };
}

async function assertNoDuplicate(db: Db, month: Date, jobRequestId: string) {
  const clash = await db.monthlyPipelineEntry.findFirst({ where: { month, jobRequestId }, select: { id: true } });
  if (clash) throw new ApiError(409, "ALREADY_ON_LIST", "This job ID is already on this month's list.");
}

async function crmOwnerCheck(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.user.count({ where: { id, isActive: true } });
  if (!found) throw new ApiError(400, "USER_NOT_FOUND", "The CRM owner no longer has an account.");
}

/** Only the job drives on the month's potential list. */
const listScope = (jobIds: string[]) => (jobIds.length ? Prisma.sql`j.id = ANY(${jobIds}::uuid[])` : Prisma.sql`FALSE`);

/**
 * Students in the given drives. The Academy / pool summaries count only those two
 * groups; the list (`people`) has everyone, External and company-sheet-only too.
 */
async function students(scope: Prisma.Sql, owners: Prisma.Sql) {
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const facts = academyFacts(query, owners, scope);
  const people = Prisma.sql`
    ${facts},
    ${ROUND_LABELS},
    ppl AS (
      SELECT f.*, (f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE')) AS academy FROM f
    )`;

  const [summary, stages, rows] = await Promise.all([
    prisma.$queryRaw<{ grp: string; students: number; applications: number; sp: number; shared: number; interviewed: number; selected: number; internal_rejected: number; company_rejected: number; in_process: number }[]>`
      ${people}
      SELECT g.grp,
        COUNT(DISTINCT candidate_id)::int AS students,
        COUNT(*)::int AS applications,
        COUNT(DISTINCT candidate_id) FILTER (WHERE sp)::int AS sp,
        COUNT(DISTINCT candidate_id) FILTER (WHERE shared)::int AS shared,
        COUNT(DISTINCT candidate_id) FILTER (WHERE interviewed)::int AS interviewed,
        COUNT(DISTINCT candidate_id) FILTER (WHERE selected)::int AS selected,
        COUNT(DISTINCT candidate_id) FILTER (WHERE internal_rejected)::int AS internal_rejected,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pipeline = 'REJECTED')::int AS company_rejected,
        COUNT(DISTINCT candidate_id) FILTER (WHERE pipeline IN ('IN_PROCESS', 'ON_HOLD'))::int AS in_process
      FROM ppl
      CROSS JOIN LATERAL (VALUES ('ACADEMY', academy), ('POOL', in_pool)) AS g(grp, keep)
      WHERE g.keep
      GROUP BY g.grp`,
    prisma.$queryRaw<{ grp: string; label: string; sort: number; reached: number; cleared: number; rejected: number; scheduled: number }[]>`
      ${people}
      SELECT g.grp, rounds.label, MIN(rounds.sort)::int AS sort,
        COUNT(DISTINCT ppl.candidate_id) FILTER (WHERE ci.outcome IN ('CLEARED', 'REJECTED', 'ON_HOLD'))::int AS reached,
        COUNT(DISTINCT ppl.candidate_id) FILTER (WHERE ci.outcome = 'CLEARED')::int AS cleared,
        COUNT(DISTINCT ppl.candidate_id) FILTER (WHERE ci.outcome = 'REJECTED')::int AS rejected,
        COUNT(DISTINCT ppl.candidate_id) FILTER (WHERE ci.outcome = 'SCHEDULED')::int AS scheduled
      FROM ppl
      JOIN "CompanyInterview" ci ON ci."nominationId" = ppl.nomination_id
      JOIN rounds ON rounds.id = ci."roundId"
      CROSS JOIN LATERAL (VALUES ('ACADEMY', ppl.academy), ('POOL', ppl.in_pool)) AS g(grp, keep)
      WHERE g.keep
      GROUP BY g.grp, rounds.label
      ORDER BY sort`,
    prisma.$queryRaw<{
      application_id: string; candidate_id: string; full_name: string; candidate_code: string | null; category: string; academy: boolean; in_pool: boolean; tier: string | null;
      email: string | null; mobile: string | null; college: string | null; yog: number | null; ctc: number | null; job_type: string | null; pool_user_id: string | null;
      product: string | null; pool_source: string | null;
      job_id: string; job_code: string; role_title: string; company_id: string; company_name: string;
      rs_rej: boolean; sc_rej: boolean; as_rej: boolean; sc_no_show: boolean; internal_rejected: boolean; sp: boolean;
      rs_pass: boolean; sc_pass: boolean; as_pass: boolean;
      rounds: { label: string; name: string; sequence: number; outcome: string }[];
      rejected_round: string | null; rejected_round_name: string | null; tag_id: string | null; tag_label: string | null; tag_from_rsa: boolean; rejection_note: string | null;
      from_company_sheet: boolean | null;
      rsa_status: string | null; rsa_tone: string | null; rsa_done: boolean | null; rsa_report_url: string | null; rsa_summary: string | null; shared: boolean; interviewed: boolean; selected: boolean; pipeline: string | null;
      last_round: string | null; last_outcome: string | null; student_ended: boolean;
    }[]>`
      ${people}
      SELECT ppl.application_id, ppl.candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code, ppl.category, ppl.academy, ppl.in_pool, ppl.tier,
        c.email, c.mobile, c.college, c."graduationYear" AS yog, j."ctcLpa" AS ctc, j."jobType"::text AS job_type,
        (SELECT NULLIF(TRIM(r."sourceUserId"), '') FROM "AssessedPoolRecord" r WHERE r.mobile = c.mobile LIMIT 1) AS pool_user_id,
        ${APPLICATION_PRODUCT(Prisma.sql`ppl.application_id`, Prisma.sql`c.id`)} AS product,
        (SELECT ${POOL_SOURCE(Prisma.sql`r`)} FROM "AssessedPoolRecord" r WHERE r.mobile = c.mobile LIMIT 1) AS pool_source,
        ppl.job_id, j."jobId" AS job_code, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name,
        ppl.rs_rej, ppl.sc_rej, ppl.as_rej, ppl.sc_no_show, ppl.internal_rejected, ppl.sp, ppl.shared, ppl.interviewed, ppl.selected, ppl.pipeline,
        ppl.rs_pass, ppl.sc_pass, ppl.as_pass,
        lr.label AS last_round, lr.outcome AS last_outcome,
        COALESCE((SELECT n."processEndDate" IS NOT NULL FROM "CompanyNomination" n WHERE n.id = ppl.nomination_id), FALSE) AS student_ended,
        COALESCE((
          SELECT json_agg(json_build_object('label', rounds.label, 'name', cr.name, 'sequence', cr.sequence, 'outcome', ci.outcome::text) ORDER BY cr.sequence, cr.name)
          FROM "CompanyInterview" ci JOIN "CompanyInterviewRound" cr ON cr.id = ci."roundId" JOIN rounds ON rounds.id = ci."roundId"
          WHERE ci."nominationId" = ppl.nomination_id
        ), '[]'::json) AS rounds,
        rr.label AS rejected_round, rr.round_name AS rejected_round_name, rt.id AS tag_id, rt.label AS tag_label, (ra."rejectionTagId" IS NOT NULL) AS tag_from_rsa, rr.note AS rejection_note,
        (ib.target::text = 'COMPANY_PIPELINE') AS from_company_sheet,
        rso.label AS rsa_status, rso.tone AS rsa_tone, rso."countsAsDone" AS rsa_done, rs."reportUrl" AS rsa_report_url, rs."reportSummary" AS rsa_summary
      FROM ppl
      JOIN "Candidate" c ON c.id = ppl.candidate_id
      JOIN "JobRequest" j ON j.id = ppl.job_id
      JOIN "Company" co ON co.id = j."companyId"
      ${APPLICATION_REASON(Prisma.sql`ppl`)}
      LEFT JOIN "SupportStatusOption" rso ON rso.id = rs."statusId"
      LEFT JOIN "ImportBatch" ib ON ib.id = ra."importBatchId"
      LEFT JOIN LATERAL (
        SELECT rounds.label, ci.outcome::text AS outcome
        FROM "CompanyInterview" ci JOIN rounds ON rounds.id = ci."roundId"
        WHERE ci."nominationId" = ppl.nomination_id
        ORDER BY rounds.sort DESC, ci."updatedAt" DESC
        LIMIT 1
      ) lr ON TRUE
      ORDER BY co.name, c."fullName"`,
  ]);

  const group = (grp: "ACADEMY" | "POOL") => {
    const row = summary.find((item) => item.grp === grp);
    return {
      students: row?.students ?? 0,
      applications: row?.applications ?? 0,
      finalShortlisted: row?.sp ?? 0,
      shared: row?.shared ?? 0,
      interviewed: row?.interviewed ?? 0,
      selected: row?.selected ?? 0,
      internalRejected: row?.internal_rejected ?? 0,
      companyRejected: row?.company_rejected ?? 0,
      inProcess: row?.in_process ?? 0,
      stages: stages.filter((item) => item.grp === grp).map((item) => ({ label: item.label, reached: item.reached, cleared: item.cleared, rejected: item.rejected, scheduled: item.scheduled })),
    };
  };

  return {
    academy: group("ACADEMY"),
    pool: group("POOL"),
    people: rows.map((row) => ({
      applicationId: row.application_id,
      candidateId: row.candidate_id,
      fullName: row.full_name,
      candidateCode: row.candidate_code,
      /** Platform user ID: the candidate's own code unless it was generated ("GEN-…"), else the assessed-pool sheet's. */
      userId: row.candidate_code && !row.candidate_code.startsWith("GEN-") ? row.candidate_code : row.pool_user_id,
      email: row.email,
      mobile: row.mobile,
      college: row.college,
      /** Year of graduation. */
      yog: row.yog,
      ctcLpa: row.ctc,
      jobType: row.job_type,
      category: row.category,
      academy: row.academy,
      inPool: row.in_pool,
      poolSource: row.pool_source,
      product: row.product,
      tier: row.tier,
      jobRequestId: row.job_id,
      jobCode: row.job_code,
      roleTitle: row.role_title,
      companyId: row.company_id,
      companyName: row.company_name,
      /** Where they stopped inside our process, or "SP" when shortlisted to the company. */
      internal: row.sp ? "SP" : row.as_rej ? "AS_REJECTED" : row.sc_rej ? "SC_REJECTED" : row.sc_no_show ? "SC_NO_SHOW" : row.rs_rej ? "RS_REJECTED" : "IN_PROGRESS",
      /** Rejected at our resume shortlist, screening or assignment. */
      internalRejected: Boolean(row.internal_rejected),
      shared: Boolean(row.shared),
      interviewed: Boolean(row.interviewed),
      selected: Boolean(row.selected),
      pipelineStatus: row.pipeline,
      lastRound: row.last_round,
      processEnded: row.student_ended,
      lastRoundOutcome: row.last_outcome,
      /** Cleared (or went past) our resume shortlist, screening, assignment and final shortlist. */
      passed: { resume: row.rs_pass, screening: row.sc_pass, assignment: row.as_pass, finalShortlist: row.sp },
      rejectedAt: { resume: row.rs_rej, screening: row.sc_rej, screeningNoShow: row.sc_no_show, assignment: row.as_rej },
      /** Every company round the student had, in order (generic label + the job's own round name). */
      rounds: row.rounds,
      /** The company round they were rejected in, if any. */
      rejectedRound: row.rejected_round ? { label: row.rejected_round, name: row.rejected_round_name } : null,
      /** Macro reason: the RSA team's tag, else the tag on the rejected round. */
      reason: row.tag_id ? { id: row.tag_id, label: row.tag_label!, fromRsa: row.tag_from_rsa } : null,
      rejectionNote: row.rejection_note,
      /** Added from the company sheet: never on our applications tab, so our shortlisting does not apply. */
      fromCompanySheet: Boolean(row.from_company_sheet),
      rsa: row.rsa_status ? { status: row.rsa_status, tone: row.rsa_tone ?? "slate", done: Boolean(row.rsa_done), reportUrl: row.rsa_report_url, summary: row.rsa_summary } : null,
    })),
  };
}

type GroupKey = "academy" | "pool" | "all";
type StageCounts = { attended: number; cleared: number; rejected: number; scheduled: number };
const GROUPS = Prisma.sql`CROSS JOIN LATERAL (VALUES ('academy', f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE')), ('pool', f.in_pool), ('all', TRUE)) AS g(grp, keep)`;

/**
 * Per drive: unique students at each step (applied → SP → shared → interviewed →
 * in process / rejected / selected) and in each of the company's own rounds, for
 * Academy, assessed-pool and all students.
 */
async function driveStages(scope: Prisma.Sql, owners: Prisma.Sql) {
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const facts = academyFacts(query, owners, scope);
  const [steps, rounds] = await Promise.all([
    prisma.$queryRaw<{ job_id: string; grp: GroupKey; applied: number; internal_rejected: number; sp: number; shared: number; interviewed: number; in_process: number; company_rejected: number; selected: number }[]>`
      ${facts}
      SELECT f.job_id, g.grp,
        COUNT(DISTINCT f.candidate_id)::int AS applied,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.internal_rejected)::int AS internal_rejected,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.sp)::int AS sp,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.shared)::int AS shared,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.interviewed)::int AS interviewed,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.pipeline IN ('IN_PROCESS', 'ON_HOLD'))::int AS in_process,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.pipeline = 'REJECTED')::int AS company_rejected,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE f.selected)::int AS selected
      FROM f ${GROUPS}
      WHERE g.keep
      GROUP BY f.job_id, g.grp`,
    prisma.$queryRaw<({ job_id: string; grp: GroupKey; round_id: string; name: string; sequence: number } & StageCounts)[]>`
      ${facts}
      SELECT f.job_id, g.grp, cr.id AS round_id, cr.name, cr.sequence,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE ci.outcome IN ('CLEARED', 'REJECTED', 'ON_HOLD'))::int AS attended,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE ci.outcome = 'CLEARED')::int AS cleared,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE ci.outcome = 'REJECTED')::int AS rejected,
        COUNT(DISTINCT f.candidate_id) FILTER (WHERE ci.outcome = 'SCHEDULED')::int AS scheduled
      FROM f
      JOIN "CompanyInterview" ci ON ci."nominationId" = f.nomination_id
      JOIN "CompanyInterviewRound" cr ON cr.id = ci."roundId"
      ${GROUPS}
      WHERE g.keep
      GROUP BY f.job_id, g.grp, cr.id, cr.name, cr.sequence`,
  ]);

  const empty = () => ({ applied: 0, internalRejected: 0, finalShortlisted: 0, shared: 0, interviewed: 0, inProcess: 0, companyRejected: 0, selected: 0 });
  const zero = (): StageCounts => ({ attended: 0, cleared: 0, rejected: 0, scheduled: 0 });
  const byJob = new Map<string, {
    steps: Record<GroupKey, ReturnType<typeof empty>>;
    rounds: Map<string, { roundId: string; name: string; sequence: number } & Record<GroupKey, StageCounts>>;
  }>();
  const entry = (jobId: string) => {
    let value = byJob.get(jobId);
    if (!value) byJob.set(jobId, (value = { steps: { academy: empty(), pool: empty(), all: empty() }, rounds: new Map() }));
    return value;
  };
  for (const row of steps) {
    entry(row.job_id).steps[row.grp] = {
      applied: row.applied, internalRejected: row.internal_rejected, finalShortlisted: row.sp, shared: row.shared,
      interviewed: row.interviewed, inProcess: row.in_process, companyRejected: row.company_rejected, selected: row.selected,
    };
  }
  for (const row of rounds) {
    const job = entry(row.job_id);
    const round = job.rounds.get(row.round_id)
      ?? job.rounds.set(row.round_id, { roundId: row.round_id, name: row.name, sequence: row.sequence, academy: zero(), pool: zero(), all: zero() }).get(row.round_id)!;
    round[row.grp] = { attended: row.attended, cleared: row.cleared, rejected: row.rejected, scheduled: row.scheduled };
  }
  return new Map([...byJob].map(([jobId, value]) => [jobId, {
    steps: value.steps,
    rounds: [...value.rounds.values()].sort((x, y) => x.sequence - y.sequence || x.name.localeCompare(y.name)),
  }]));
}

/** The given drives with their process, openings, students, CRM remarks and RSA review. */
async function drives(month: string, scope: Prisma.Sql, owners: Prisma.Sql) {
  const start = `${month}-01`;
  const end = `${nextMonthKey(month)}-01`;
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const stagesPromise = driveStages(scope, owners);
  const rows = await prisma.$queryRaw<{
    id: string; job_code: string; role_title: string; company_id: string; company_name: string; psm: string | null; status: string; phase: string; round_name: string | null;
    request_date: Date; start_date: Date | null; end_date: Date | null; starts_in_month: boolean; ends_in_month: boolean; requested_in_month: boolean;
    openings: number; academy: number; pool: number; shared: number; interviewed: number; selected: number;
    crm_count: number; crm_last_on: Date | null; crm_last: string | null; crm_last_by: string | null; crm_next: string | null; rsa_review: boolean; on_list: boolean;
    ctc: number | null; company_sheet: string | null; internal_sheet: string | null; products: string | null; skills: string | null;
    round_id: string | null; job_rounds: { id: string; name: string }[]; went_right: string | null; went_wrong: string | null; action_items: string | null;
  }[]>`
    ${academyFacts(query, owners, scope)},
    stu AS (
      SELECT job_id,
        COUNT(DISTINCT candidate_id) FILTER (WHERE category IN ('ACADEMY', 'ACADEMY_INTENSIVE'))::int AS academy,
        COUNT(DISTINCT candidate_id) FILTER (WHERE in_pool)::int AS pool,
        COUNT(DISTINCT candidate_id) FILTER (WHERE shared)::int AS shared,
        COUNT(DISTINCT candidate_id) FILTER (WHERE interviewed)::int AS interviewed,
        COUNT(DISTINCT candidate_id) FILTER (WHERE selected)::int AS selected
      FROM f GROUP BY job_id
    )
    SELECT j.id, j."jobId" AS job_code, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name, u."fullName" AS psm,
      j.status::text AS status, j."processPhase"::text AS phase, pr.name AS round_name,
      j."requestDate" AS request_date, j."companyProcessStartDate" AS start_date, j."companyProcessEndDate" AS end_date,
      COALESCE(j."companyProcessStartDate" >= ${start}::date AND j."companyProcessStartDate" < ${end}::date, FALSE) AS starts_in_month,
      COALESCE(j."companyProcessEndDate" >= ${start}::date AND j."companyProcessEndDate" < ${end}::date, FALSE) AS ends_in_month,
      (j."requestDate" >= ${start}::date) AS requested_in_month,
      j.openings, COALESCE(stu.academy, 0) AS academy, COALESCE(stu.pool, 0) AS pool, COALESCE(stu.shared, 0) AS shared,
      COALESCE(stu.interviewed, 0) AS interviewed, COALESCE(stu.selected, 0) AS selected,
      (SELECT COUNT(*)::int FROM "JobCrmRemark" r WHERE r."jobRequestId" = j.id) AS crm_count,
      lc."interactionOn" AS crm_last_on, lc.remark AS crm_last, lc.author AS crm_last_by, lc."nextStep" AS crm_next,
      j."ctcLpa" AS ctc, j."companySheetUrl" AS company_sheet, j."internalSheetUrl" AS internal_sheet, j."processRoundId" AS round_id,
      (SELECT string_agg(p.name, ', ' ORDER BY p.name) FROM "JobRequestProduct" jp JOIN "Product" p ON p.id = jp."productId" WHERE jp."jobRequestId" = j.id) AS products,
      (SELECT string_agg(sk.name, ', ' ORDER BY js."isMandatory" DESC, sk.name) FROM "JobRequestSkill" js JOIN "Skill" sk ON sk.id = js."skillId" WHERE js."jobRequestId" = j.id) AS skills,
      COALESCE((SELECT json_agg(json_build_object('id', cr.id, 'name', cr.name) ORDER BY cr.sequence, cr.name) FROM "CompanyInterviewRound" cr WHERE cr."jobRequestId" = j.id), '[]'::json) AS job_rounds,
      rv."wentRight" AS went_right, rv."wentWrong" AS went_wrong, rv."actionItems" AS action_items,
      EXISTS (SELECT 1 FROM "JobRsaReview" rv WHERE rv."jobRequestId" = j.id AND (rv."wentRight" IS NOT NULL OR rv."wentWrong" IS NOT NULL OR rv."actionItems" IS NOT NULL)) AS rsa_review,
      EXISTS (SELECT 1 FROM "MonthlyPipelineEntry" me WHERE me."jobRequestId" = j.id AND me.month = ${start}::date) AS on_list
    FROM "JobRequest" j
    JOIN "Company" co ON co.id = j."companyId"
    LEFT JOIN "User" u ON u.id = j."psmOwnerId"
    LEFT JOIN "CompanyInterviewRound" pr ON pr.id = j."processRoundId"
    LEFT JOIN stu ON stu.job_id = j.id
    LEFT JOIN LATERAL (
      SELECT r."interactionOn", r.remark, r."nextStep", au."fullName" AS author
      FROM "JobCrmRemark" r JOIN "User" au ON au.id = r."createdById"
      WHERE r."jobRequestId" = j.id ORDER BY r."interactionOn" DESC, r."createdAt" DESC LIMIT 1
    ) lc ON TRUE
    LEFT JOIN "JobRsaReview" rv ON rv."jobRequestId" = j.id
    WHERE ${scope} ${owners}
    ORDER BY co.name, j."roleTitle"`;

  const stages = await stagesPromise;
  return rows.map((row) => ({
    jobRequestId: row.id,
    jobCode: row.job_code,
    roleTitle: row.role_title,
    companyId: row.company_id,
    companyName: row.company_name,
    psmName: row.psm,
    status: row.status,
    phase: row.phase,
    roundName: row.round_name,
    requestDate: day(row.request_date),
    processStartDate: day(row.start_date),
    processEndDate: day(row.end_date),
    startsInMonth: row.starts_in_month,
    endsInMonth: row.ends_in_month,
    requestedInMonth: row.requested_in_month,
    openings: row.openings,
    students: { academy: row.academy, pool: row.pool, shared: row.shared, interviewed: row.interviewed, selected: row.selected },
    crmRemarkCount: row.crm_count,
    lastCrmRemark: row.crm_last ? { on: day(row.crm_last_on), remark: row.crm_last, by: row.crm_last_by, nextStep: row.crm_next } : null,
    hasRsaReview: row.rsa_review,
    /** What went right / wrong with this drive and what to change (RSA review). */
    review: { wentRight: row.went_right, wentWrong: row.went_wrong, actionItems: row.action_items },
    ctcLpa: row.ctc,
    companySheetUrl: row.company_sheet,
    internalSheetUrl: row.internal_sheet,
    /** Products eligible to apply, as stored (the UI shows universal names). */
    products: row.products,
    techStack: row.skills,
    processRoundId: row.round_id,
    rounds: row.job_rounds,
    onPotentialList: row.on_list,
    /** Unique students per step and per company round, for Academy, pool and everyone. */
    stages: stages.get(row.id) ?? null,
  }));
}

/**
 * Students hired in the month, on any drive: the month of their interview-done
 * date (process end date), else their last company round, else the job's
 * process end, else (no date at all) the job's request date. Matches how the
 * placement KPIs date a placement.
 */
async function placements(month: string, owners: Prisma.Sql) {
  const start = `${month}-01`;
  const end = `${nextMonthKey(month)}-01`;
  const rows = await prisma.$queryRaw<{
    application_id: string; candidate_id: string; full_name: string; candidate_code: string | null; category: string; in_pool: boolean; product: string | null;
    job_id: string; job_code: string; role_title: string; company_id: string; company_name: string; ctc: number | null;
    pipeline: string; hired_on: Date; source: "STUDENT" | "ROUND" | "JOB" | "REQUEST";
  }[]>`
    SELECT a.id AS application_id, c.id AS candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code,
      COALESCE(p.category::text, c.category::text, 'EXTERNAL') AS category,
      EXISTS (SELECT 1 FROM "AssessedPoolRecord" r WHERE r.mobile = c.mobile) AS in_pool,
      COALESCE(${PRODUCT_LABEL(Prisma.sql`p.category`)}, ${PRODUCT_NAMES(Prisma.sql`c.id`)}) AS product,
      j.id AS job_id, j."jobId" AS job_code, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name, j."ctcLpa" AS ctc,
      n."pipelineStatus"::text AS pipeline, h.hired_on, h.source
    FROM "CompanyNomination" n
    JOIN "Application" a ON a.id = n."applicationId"
    JOIN "Candidate" c ON c.id = a."candidateId"
    LEFT JOIN "Product" p ON p.id = a."productId"
    JOIN "JobRequest" j ON j.id = n."jobRequestId"
    JOIN "Company" co ON co.id = j."companyId"
    LEFT JOIN LATERAL (SELECT MAX(i."scheduledAt")::date AS last_round FROM "CompanyInterview" i WHERE i."nominationId" = n.id) lr ON TRUE
    CROSS JOIN LATERAL (
      SELECT COALESCE(n."processEndDate", lr.last_round, j."companyProcessEndDate", j."requestDate") AS hired_on,
        CASE WHEN n."processEndDate" IS NOT NULL THEN 'STUDENT' WHEN lr.last_round IS NOT NULL THEN 'ROUND'
          WHEN j."companyProcessEndDate" IS NOT NULL THEN 'JOB' ELSE 'REQUEST' END AS source
    ) h
    WHERE n.status = 'NOMINATED' AND n."pipelineStatus" IN ('SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'JOINED')
      AND a.status <> 'WITHDRAWN' AND j."archivedAt" IS NULL AND j.status NOT IN ('DRAFT', 'CANCELLED')
      AND h.hired_on >= ${start}::date AND h.hired_on < ${end}::date ${owners}
    ORDER BY h.hired_on, co.name, c."fullName"`;

  const people = rows.map((row) => ({
    applicationId: row.application_id,
    candidateId: row.candidate_id,
    fullName: row.full_name,
    candidateCode: row.candidate_code,
    category: row.category,
    inPool: row.in_pool,
    product: row.product,
    jobRequestId: row.job_id,
    jobCode: row.job_code,
    roleTitle: row.role_title,
    companyId: row.company_id,
    companyName: row.company_name,
    ctcLpa: row.ctc,
    pipelineStatus: row.pipeline,
    hiredOn: day(row.hired_on)!,
    hiredOnSource: row.source,
  }));
  const count = (category: string) => people.filter((person) => person.category === category).length;
  return {
    total: people.length,
    academy: count("ACADEMY"),
    intensive: count("ACADEMY_INTENSIVE"),
    external: count("EXTERNAL"),
    pool: people.filter((person) => person.inPool).length,
    companies: new Set(people.map((person) => person.companyId)).size,
    people,
  };
}

export const monthlyPipelineService = {
  /**
   * Everything the Monthly page shows for one month. Only the job drives on CRM's
   * potential list for the month count: drives, students and the big picture
   * all come from that list. The big picture leaves out dropped / no response.
   */
  async month(user: AuthenticatedUser, month: string) {
    const date = monthDate(month);
    const owners = await ownerFilter(user);
    const entries = await prisma.monthlyPipelineEntry.findMany({ where: { month: date }, select: entrySelect, orderBy: [{ company: { name: "asc" } }, { createdAt: "asc" }] });
    const jobIds = [...new Set(entries.map((entry) => entry.jobRequest.id))];
    const scope = listScope(jobIds);
    const companyIds = [...new Set(entries.map((entry) => entry.company.id))];
    const active = entries.filter((entry) => ACTIVE_POTENTIAL_STATUSES.includes(entry.status));
    const activeJobIds = [...new Set(active.map((entry) => entry.jobRequest.id))];

    const [driveRows, studentData, placed, reasonsByJob, positions, firsts] = await Promise.all([
      drives(month, scope, owners),
      students(scope, owners),
      placements(month, owners),
      notSelectedReasonsByJob(jobIds, owners),
      studentPositions(activeJobIds, owners),
      companyIds.length
        ? prisma.monthlyPipelineEntry.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _min: { month: true } })
        : Promise.resolve([]),
    ]);
    const firstListed = new Map(firsts.map((row) => [row.companyId, row._min.month!]));

    const byStatus = Object.fromEntries(Object.keys(POTENTIAL_COMPANY_STATUS_LABELS).map((status) => [status, entries.filter((entry) => entry.status === status).length])) as Record<PotentialCompanyStatus, number>;
    const companies = (list: typeof entries) => new Set(list.map((entry) => entry.company.id)).size;

    const driveById = new Map(driveRows.map((row) => [row.jobRequestId, row]));
    const activeJobs: MonthJob[] = activeJobIds.map((id) => {
      const job = active.find((entry) => entry.jobRequest.id === id)!.jobRequest;
      const row = driveById.get(id);
      return {
        jobRequestId: id, companyId: job.companyId, phase: job.processPhase, openings: job.openings,
        processStartDate: row?.processStartDate ?? day(job.companyProcessStartDate), processEndDate: row?.processEndDate ?? day(job.companyProcessEndDate),
        onList: true, running: Boolean(row),
      };
    });
    const bigPicture = {
      ...companyAndOpeningCounts(activeJobs),
      droppedFromList: companies(entries.filter((entry) => entry.status === "DROPPED" || entry.status === "NO_RESPONSE")),
      students: positions,
      notSelectedReasons: sumReasons(activeJobIds.map((id) => reasonsByJob.get(id) ?? [])),
    };

    const items = driveRows.map((row) => ({ ...row, notSelectedReasons: reasonsByJob.get(row.jobRequestId) ?? [] }));
    return {
      month,
      /** Companies, drives, openings and where unique students stand, for the active potential list. */
      bigPicture,
      potential: {
        entries: entries.map((entry) => present(entry, firstListed)),
        summary: {
          /** Distinct companies on the list, whatever their status. */
          listed: companies(entries),
          active: companies(active),
          starting: companies(entries.filter((entry) => STARTING_POTENTIAL_STATUSES.includes(entry.status))),
          newThisMonth: companies(entries.filter((entry) => !entry.carriedFrom)),
          carriedIn: companies(entries.filter((entry) => entry.carriedFrom)),
          carriedOut: companies(entries.filter((entry) => entry.carriedTo)),
          droppedOrNoResponse: companies(entries.filter((entry) => entry.status === "DROPPED" || entry.status === "NO_RESPONSE")),
          byStatus,
        },
      },
      /** The list's job drives (every status), one row per job. */
      drives: {
        items,
        summary: {
          live: items.length,
          companies: new Set(items.map((row) => row.companyId)).size,
          startingThisMonth: items.filter((row) => row.startsInMonth).length,
          startingCompanies: new Set(items.filter((row) => row.startsInMonth).map((row) => row.companyId)).size,
          endingThisMonth: items.filter((row) => row.endsInMonth).length,
          requestedThisMonth: items.filter((row) => row.requestedInMonth).length,
          openings: items.reduce((sum, row) => sum + row.openings, 0),
        },
      },
      /** Academy and assessed-pool students on the list's drives. */
      students: studentData,
      /** Placements of the month by hired (interview done) date, on any drive. */
      placements: placed,
    };
  },

  async create(user: AuthenticatedUser, input: CreateEntryInput, audit: AuditContext) {
    assertCanWrite(user);
    await crmOwnerCheck(input.crmOwnerId);
    const month = monthDate(input.month);
    return inTransaction(async (transaction) => {
      const job = await transaction.jobRequest.findUnique({
        where: { id: input.jobRequestId },
        select: { jobId: true, archivedAt: true, company: { select: { id: true, name: true } } },
      });
      if (!job || job.archivedAt) throw new ApiError(400, "JOB_REQUEST_NOT_FOUND", "No job request with that job ID.");
      const company = job.company;
      await assertNoDuplicate(transaction, month, input.jobRequestId);

      const entry = await transaction.monthlyPipelineEntry.create({
        data: {
          month,
          companyId: company.id,
          jobRequestId: input.jobRequestId,
          roleHint: input.roleHint || null,
          expectedOpenings: input.expectedOpenings ?? null,
          expectedStartDate: input.expectedStartDate ? toDate(input.expectedStartDate) : null,
          status: input.status,
          crmOwnerId: input.crmOwnerId ?? null,
          remarks: input.remarks || null,
          createdById: user.id,
          history: { create: { toStatus: input.status, note: "Added to the list", changedById: user.id } },
        },
        select: { id: true },
      });
      await recordAudit(transaction, audit, { action: "PIPELINE_ENTRY_ADDED", entityType: "MonthlyPipelineEntry", entityId: entry.id, metadata: { month: input.month, company: company.name, jobId: job.jobId, status: input.status } });
      return entry;
    });
  },

  async update(user: AuthenticatedUser, entryId: string, input: UpdateEntryInput, audit: AuditContext) {
    assertCanWrite(user);
    const entry = await prisma.monthlyPipelineEntry.findUnique({ where: { id: entryId }, select: { id: true, status: true } });
    if (!entry) throw new ApiError(404, "PIPELINE_ENTRY_NOT_FOUND", "The list entry was not found.");
    await crmOwnerCheck(input.crmOwnerId);
    return inTransaction(async (transaction) => {
      const statusChanged = input.status !== undefined && input.status !== entry.status;
      await transaction.monthlyPipelineEntry.update({
        where: { id: entry.id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.roleHint !== undefined ? { roleHint: input.roleHint || null } : {}),
          ...(input.expectedOpenings !== undefined ? { expectedOpenings: input.expectedOpenings } : {}),
          ...(input.expectedStartDate !== undefined ? { expectedStartDate: input.expectedStartDate ? toDate(input.expectedStartDate) : null } : {}),
          ...(input.crmOwnerId !== undefined ? { crmOwnerId: input.crmOwnerId } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks || null } : {}),
        },
      });
      if (statusChanged || input.note) {
        await transaction.monthlyPipelineHistory.create({
          data: { entryId: entry.id, fromStatus: entry.status, toStatus: input.status ?? entry.status, note: input.note || null, changedById: user.id },
        });
      }
      await recordAudit(transaction, audit, {
        action: "PIPELINE_ENTRY_UPDATED", entityType: "MonthlyPipelineEntry", entityId: entry.id,
        metadata: { ...(statusChanged ? { from: entry.status, to: input.status } : {}), fields: Object.keys(input) },
      });
      return { id: entry.id };
    });
  },

  async remove(user: AuthenticatedUser, entryId: string, audit: AuditContext) {
    assertCanWrite(user);
    const entry = await prisma.monthlyPipelineEntry.findUnique({ where: { id: entryId }, select: { id: true, month: true, company: { select: { name: true } } } });
    if (!entry) throw new ApiError(404, "PIPELINE_ENTRY_NOT_FOUND", "The list entry was not found.");
    await inTransaction(async (transaction) => {
      await transaction.monthlyPipelineEntry.delete({ where: { id: entry.id } });
      await recordAudit(transaction, audit, { action: "PIPELINE_ENTRY_REMOVED", entityType: "MonthlyPipelineEntry", entityId: entry.id, metadata: { month: monthKey(entry.month), company: entry.company.name } });
    });
  },

  /** Copies entries into the next month, keeping their status; each new entry points back at its source. */
  async carryForward(user: AuthenticatedUser, input: CarryForwardInput, audit: AuditContext) {
    assertCanWrite(user);
    const from = monthDate(input.fromMonth);
    const toKey = nextMonthKey(input.fromMonth);
    const to = monthDate(toKey);
    const sources = await prisma.monthlyPipelineEntry.findMany({
      where: {
        month: from,
        carriedTo: null,
        ...(input.entryIds ? { id: { in: input.entryIds } } : { status: { in: [...ACTIVE_POTENTIAL_STATUSES] } }),
      },
      select: { id: true, companyId: true, jobRequestId: true, roleHint: true, expectedOpenings: true, expectedStartDate: true, status: true, crmOwnerId: true, remarks: true },
    });
    if (input.entryIds && sources.length !== input.entryIds.length) {
      throw new ApiError(400, "ENTRY_NOT_CARRIABLE", "Some rows are not in this month or were already carried forward.");
    }
    if (sources.length === 0) return { carried: 0, skipped: 0, toMonth: toKey };
    return inTransaction(async (transaction) => {
      let carried = 0;
      let skipped = 0;
      for (const source of sources) {
        const clash = await transaction.monthlyPipelineEntry.findFirst({ where: { month: to, jobRequestId: source.jobRequestId }, select: { id: true } });
        if (clash) {
          skipped++;
          continue;
        }
        await transaction.monthlyPipelineEntry.create({
          data: {
            month: to,
            companyId: source.companyId,
            jobRequestId: source.jobRequestId,
            roleHint: source.roleHint,
            expectedOpenings: source.expectedOpenings,
            expectedStartDate: source.expectedStartDate,
            status: source.status,
            crmOwnerId: source.crmOwnerId,
            remarks: source.remarks,
            carriedFromId: source.id,
            createdById: user.id,
            history: { create: { toStatus: source.status, note: `Carried forward from ${input.fromMonth}`, changedById: user.id } },
          },
        });
        carried++;
      }
      await recordAudit(transaction, audit, { action: "PIPELINE_CARRIED_FORWARD", entityType: "MonthlyPipelineEntry", entityId: sources[0]!.id, metadata: { from: input.fromMonth, to: toKey, carried, skipped } });
      return { carried, skipped, toMonth: toKey };
    }, { timeoutMs: 60_000 });
  },
};
