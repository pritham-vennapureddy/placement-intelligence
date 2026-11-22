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
import { academyFacts } from "../insights/academy-insights.service.js";
import { ROUND_LABELS } from "../insights/company-rounds.js";
import { ownerFilter } from "../insights/insights.service.js";
import type { AcademyQuery } from "../insights/insights.validators.js";
import { jobRequestsRepository } from "../job-requests/job-requests.repository.js";
import type { CarryForwardInput, CreateEntryInput, UpdateEntryInput } from "./pulse.validators.js";

/** "2026-11" → 2026-11-01 (UTC, stored as a date). */
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

function assertCanWrite(user: AuthenticatedUser) {
  if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to change the monthly pipeline.");
}

/**
 * A drive is live in a month when it was requested by the month's end, had not
 * started after it, and had not finished before it. "Finished" is the hand-entered
 * process end date, else the date the process was marked done, else the date a
 * closed / filled / cancelled job was last changed.
 */
export function liveInMonth(month: string): Prisma.Sql {
  const start = `${month}-01`;
  const end = `${nextMonthKey(month)}-01`;
  return Prisma.sql`
    j."archivedAt" IS NULL
    AND j."requestDate" < ${end}::date
    AND (j."companyProcessStartDate" IS NULL OR j."companyProcessStartDate" < ${end}::date)
    AND COALESCE(
      j."companyProcessEndDate",
      CASE WHEN j."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED') THEN j."processPhaseAt"::date END,
      CASE WHEN j.status IN ('FILLED', 'CANCELLED', 'CLOSED') THEN j."updatedAt"::date END,
      'infinity'::date
    ) >= ${start}::date`;
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
      id: true, jobId: true, roleTitle: true, processPhase: true, companyProcessStartDate: true,
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
    jobRequest: entry.jobRequest ? { ...entry.jobRequest, companyProcessStartDate: day(entry.jobRequest.companyProcessStartDate) } : null,
    carriedFrom: entry.carriedFrom ? { ...entry.carriedFrom, month: monthKey(entry.carriedFrom.month) } : null,
    carriedTo: entry.carriedTo ? { ...entry.carriedTo, month: monthKey(entry.carriedTo.month) } : null,
    /** First month this company appeared on the list (any entry). */
    firstListedMonth: monthKey(firstListed.get(entry.company.id) ?? entry.month),
  };
}

async function assertJobOfCompany(db: Db, jobRequestId: string, companyId: string) {
  const job = await db.jobRequest.findUnique({ where: { id: jobRequestId }, select: { companyId: true, archivedAt: true } });
  if (!job || job.archivedAt) throw new ApiError(400, "JOB_REQUEST_NOT_FOUND", "The job drive was not found.");
  if (job.companyId !== companyId) throw new ApiError(400, "JOB_OF_OTHER_COMPANY", "That job drive belongs to another company.");
}

async function assertNoDuplicate(db: Db, month: Date, companyId: string, jobRequestId: string | null, exceptId?: string) {
  const clash = await db.monthlyPipelineEntry.findFirst({
    where: { month, companyId, jobRequestId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ApiError(409, "ALREADY_ON_LIST", jobRequestId
      ? "This job drive is already on this month's list."
      : "This company is already on this month's list. Edit that row, or link a job drive to tell them apart.");
  }
}

async function crmOwnerCheck(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.user.count({ where: { id, isActive: true } });
  if (!found) throw new ApiError(400, "USER_NOT_FOUND", "The CRM owner no longer has an account.");
}

/** Student numbers for Academy and assessed-pool students in the month's live drives. */
async function students(month: string, owners: Prisma.Sql) {
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const facts = academyFacts(query, owners, liveInMonth(month));
  const people = Prisma.sql`
    ${facts},
    ${ROUND_LABELS},
    ppl AS (
      SELECT f.*, (f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE')) AS academy
      FROM f WHERE f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE') OR f.in_pool
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
      job_id: string; job_code: string; role_title: string; company_id: string; company_name: string;
      rs_rej: boolean; sc_rej: boolean; as_rej: boolean; sc_no_show: boolean; sp: boolean; shared: boolean; interviewed: boolean; selected: boolean; pipeline: string | null;
      last_round: string | null; last_outcome: string | null;
    }[]>`
      ${people}
      SELECT ppl.application_id, ppl.candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code, ppl.category, ppl.academy, ppl.in_pool, ppl.tier,
        ppl.job_id, j."jobId" AS job_code, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name,
        ppl.rs_rej, ppl.sc_rej, ppl.as_rej, ppl.sc_no_show, ppl.sp, ppl.shared, ppl.interviewed, ppl.selected, ppl.pipeline,
        lr.label AS last_round, lr.outcome AS last_outcome
      FROM ppl
      JOIN "Candidate" c ON c.id = ppl.candidate_id
      JOIN "JobRequest" j ON j.id = ppl.job_id
      JOIN "Company" co ON co.id = j."companyId"
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
      category: row.category,
      academy: row.academy,
      inPool: row.in_pool,
      tier: row.tier,
      jobRequestId: row.job_id,
      jobCode: row.job_code,
      roleTitle: row.role_title,
      companyId: row.company_id,
      companyName: row.company_name,
      /** Where they stopped inside our process, or "SP" when shortlisted to the company. */
      internal: row.sp ? "SP" : row.as_rej ? "AS_REJECTED" : row.sc_rej ? "SC_REJECTED" : row.sc_no_show ? "SC_NO_SHOW" : row.rs_rej ? "RS_REJECTED" : "IN_PROGRESS",
      shared: Boolean(row.shared),
      interviewed: Boolean(row.interviewed),
      selected: Boolean(row.selected),
      pipelineStatus: row.pipeline,
      lastRound: row.last_round,
      lastRoundOutcome: row.last_outcome,
    })),
  };
}

async function drives(month: string, owners: Prisma.Sql) {
  const start = `${month}-01`;
  const end = `${nextMonthKey(month)}-01`;
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const rows = await prisma.$queryRaw<{
    id: string; job_code: string; role_title: string; company_id: string; company_name: string; psm: string | null; status: string; phase: string; round_name: string | null;
    request_date: Date; start_date: Date | null; end_date: Date | null; starts_in_month: boolean; ends_in_month: boolean; requested_in_month: boolean;
    academy: number; pool: number; shared: number; interviewed: number; selected: number;
    crm_count: number; crm_last_on: Date | null; crm_last: string | null; rsa_review: boolean; on_list: boolean;
  }[]>`
    ${academyFacts(query, owners, liveInMonth(month))},
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
      COALESCE(stu.academy, 0) AS academy, COALESCE(stu.pool, 0) AS pool, COALESCE(stu.shared, 0) AS shared,
      COALESCE(stu.interviewed, 0) AS interviewed, COALESCE(stu.selected, 0) AS selected,
      (SELECT COUNT(*)::int FROM "JobCrmRemark" r WHERE r."jobRequestId" = j.id) AS crm_count,
      lc."interactionOn" AS crm_last_on, lc.remark AS crm_last,
      EXISTS (SELECT 1 FROM "JobRsaReview" rv WHERE rv."jobRequestId" = j.id AND (rv."wentRight" IS NOT NULL OR rv."wentWrong" IS NOT NULL OR rv."actionItems" IS NOT NULL)) AS rsa_review,
      EXISTS (SELECT 1 FROM "MonthlyPipelineEntry" me WHERE me."jobRequestId" = j.id AND me.month = ${start}::date) AS on_list
    FROM "JobRequest" j
    JOIN "Company" co ON co.id = j."companyId"
    LEFT JOIN "User" u ON u.id = j."psmOwnerId"
    LEFT JOIN "CompanyInterviewRound" pr ON pr.id = j."processRoundId"
    LEFT JOIN stu ON stu.job_id = j.id
    LEFT JOIN LATERAL (
      SELECT r."interactionOn", r.remark FROM "JobCrmRemark" r WHERE r."jobRequestId" = j.id ORDER BY r."interactionOn" DESC, r."createdAt" DESC LIMIT 1
    ) lc ON TRUE
    WHERE ${liveInMonth(month)} ${owners}
    ORDER BY starts_in_month DESC, co.name, j."roleTitle"`;

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
    students: { academy: row.academy, pool: row.pool, shared: row.shared, interviewed: row.interviewed, selected: row.selected },
    crmRemarkCount: row.crm_count,
    lastCrmRemark: row.crm_last ? { on: day(row.crm_last_on), remark: row.crm_last } : null,
    hasRsaReview: row.rsa_review,
    onPotentialList: row.on_list,
  }));
}

export const monthlyPipelineService = {
  /** Everything the Monthly page shows for one month. */
  async month(user: AuthenticatedUser, month: string) {
    const date = monthDate(month);
    const owners = await ownerFilter(user);
    const [entries, driveRows, studentData] = await Promise.all([
      prisma.monthlyPipelineEntry.findMany({ where: { month: date }, select: entrySelect, orderBy: [{ company: { name: "asc" } }, { createdAt: "asc" }] }),
      drives(month, owners),
      students(month, owners),
    ]);
    const companyIds = [...new Set(entries.map((entry) => entry.company.id))];
    const firsts = companyIds.length
      ? await prisma.monthlyPipelineEntry.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds } }, _min: { month: true } })
      : [];
    const firstListed = new Map(firsts.map((row) => [row.companyId, row._min.month!]));

    const byStatus = Object.fromEntries(Object.keys(POTENTIAL_COMPANY_STATUS_LABELS).map((status) => [status, entries.filter((entry) => entry.status === status).length])) as Record<PotentialCompanyStatus, number>;
    const active = entries.filter((entry) => ACTIVE_POTENTIAL_STATUSES.includes(entry.status));
    const companies = (list: typeof entries) => new Set(list.map((entry) => entry.company.id)).size;

    return {
      month,
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
      drives: {
        items: driveRows,
        summary: {
          live: driveRows.length,
          companies: new Set(driveRows.map((row) => row.companyId)).size,
          startingThisMonth: driveRows.filter((row) => row.startsInMonth).length,
          startingCompanies: new Set(driveRows.filter((row) => row.startsInMonth).map((row) => row.companyId)).size,
          endingThisMonth: driveRows.filter((row) => row.endsInMonth).length,
          requestedThisMonth: driveRows.filter((row) => row.requestedInMonth).length,
        },
      },
      students: studentData,
    };
  },

  async create(user: AuthenticatedUser, input: CreateEntryInput, audit: AuditContext) {
    assertCanWrite(user);
    await crmOwnerCheck(input.crmOwnerId);
    const month = monthDate(input.month);
    return inTransaction(async (transaction) => {
      let company = input.jobRequestId
        ? await transaction.jobRequest.findUnique({ where: { id: input.jobRequestId }, select: { company: { select: { id: true, name: true, status: true } } } }).then((job) => job?.company ?? null)
        : null;
      if (input.jobRequestId && !company) throw new ApiError(400, "JOB_REQUEST_NOT_FOUND", "The job drive was not found.");
      company ??= await jobRequestsRepository.findCompanyByName(transaction, input.companyName);
      company ??= await jobRequestsRepository.createCompany(transaction, input.companyName, user.id);
      if (input.jobRequestId) await assertJobOfCompany(transaction, input.jobRequestId, company.id);
      await assertNoDuplicate(transaction, month, company.id, input.jobRequestId ?? null);

      const entry = await transaction.monthlyPipelineEntry.create({
        data: {
          month,
          companyId: company.id,
          jobRequestId: input.jobRequestId ?? null,
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
      await recordAudit(transaction, audit, { action: "PIPELINE_ENTRY_ADDED", entityType: "MonthlyPipelineEntry", entityId: entry.id, metadata: { month: input.month, company: company.name, status: input.status } });
      return entry;
    });
  },

  async update(user: AuthenticatedUser, entryId: string, input: UpdateEntryInput, audit: AuditContext) {
    assertCanWrite(user);
    const entry = await prisma.monthlyPipelineEntry.findUnique({ where: { id: entryId }, select: { id: true, month: true, companyId: true, jobRequestId: true, status: true } });
    if (!entry) throw new ApiError(404, "PIPELINE_ENTRY_NOT_FOUND", "The list entry was not found.");
    await crmOwnerCheck(input.crmOwnerId);
    return inTransaction(async (transaction) => {
      if (input.jobRequestId !== undefined && input.jobRequestId !== entry.jobRequestId) {
        if (input.jobRequestId) await assertJobOfCompany(transaction, input.jobRequestId, entry.companyId);
        await assertNoDuplicate(transaction, entry.month, entry.companyId, input.jobRequestId, entry.id);
      }
      const statusChanged = input.status !== undefined && input.status !== entry.status;
      await transaction.monthlyPipelineEntry.update({
        where: { id: entry.id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.jobRequestId !== undefined ? { jobRequestId: input.jobRequestId } : {}),
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
        const clash = await transaction.monthlyPipelineEntry.findFirst({ where: { month: to, companyId: source.companyId, jobRequestId: source.jobRequestId }, select: { id: true } });
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
