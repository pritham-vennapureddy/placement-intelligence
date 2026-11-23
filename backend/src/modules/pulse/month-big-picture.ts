import { prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { academyFacts } from "../insights/academy-insights.service.js";
import { APPLICATION_REASON, NOT_SELECTED, UNTAGGED } from "../insights/company-reasons.service.js";
import { ROUND_LABELS } from "../insights/company-rounds.js";
import type { AcademyQuery } from "../insights/insights.validators.js";

/** One job drive the month covers: on CRM's potential list and/or running this month. */
export interface MonthJob {
  jobRequestId: string;
  companyId: string;
  phase: string;
  openings: number;
  processStartDate: string | null;
  processEndDate: string | null;
  onList: boolean;
  running: boolean;
}

export type JobProcessState = "YET_TO_START" | "STARTED" | "ENDED";

/**
 * Ended: the company process is marked done or has an end date. Started: CVs
 * reached the company (any status after "Yet to share CVs") or a start date is
 * set. Otherwise it is yet to start.
 */
export function jobProcessState(job: Pick<MonthJob, "phase" | "processStartDate" | "processEndDate">): JobProcessState {
  if (job.phase === "PROCESS_DONE_HIRED" || job.phase === "PROCESS_DONE_NOT_HIRED" || job.processEndDate) return "ENDED";
  if (job.phase !== "YET_TO_SHARE_CVS" || job.processStartDate) return "STARTED";
  return "YET_TO_START";
}

/** A company is started if any drive is running, yet to start if any is waiting, ended when all ended. */
export function companyProcessState(states: JobProcessState[]): JobProcessState {
  if (states.includes("STARTED")) return "STARTED";
  if (states.includes("YET_TO_START")) return "YET_TO_START";
  return "ENDED";
}

export function companyAndOpeningCounts(jobs: MonthJob[]) {
  const states = new Map<string, JobProcessState[]>();
  const openings = { total: 0, YET_TO_START: 0, STARTED: 0, ENDED: 0 };
  const drives = { total: jobs.length, YET_TO_START: 0, STARTED: 0, ENDED: 0 };
  for (const job of jobs) {
    const state = jobProcessState(job);
    states.set(job.companyId, [...(states.get(job.companyId) ?? []), state]);
    openings.total += job.openings;
    openings[state] += job.openings;
    drives[state]++;
  }
  const companies = { total: states.size, YET_TO_START: 0, STARTED: 0, ENDED: 0 };
  for (const list of states.values()) companies[companyProcessState(list)]++;
  return {
    companies,
    drives,
    openings,
    onList: new Set(jobs.filter((job) => job.onList).map((job) => job.companyId)).size,
    notOnList: new Set(jobs.filter((job) => !job.onList).map((job) => job.companyId)).size,
  };
}

export type StudentPosition = "SELECTED" | "IN_PROCESS" | "ENDED_NOT_SELECTED" | "IN_SHORTLISTING" | "REJECTED_INTERNALLY" | "NOT_SHARED_DRIVE_OVER";

/**
 * Where each unique Academy / assessed-pool student stands across the month's
 * drives, counted once at their furthest point: selected, still in a company
 * process, company process over without selection, still in our shortlisting
 * on a drive that is still going, rejected in our shortlisting everywhere, or
 * never shared on drives that are now over.
 */
export async function studentPositions(jobIds: string[], owners: Prisma.Sql) {
  const empty = (): Record<StudentPosition, number> & { students: number } =>
    ({ students: 0, SELECTED: 0, IN_PROCESS: 0, ENDED_NOT_SELECTED: 0, IN_SHORTLISTING: 0, REJECTED_INTERNALLY: 0, NOT_SHARED_DRIVE_OVER: 0 });
  const result = { academy: empty(), pool: empty() };
  if (jobIds.length === 0) return result;
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const rows = await prisma.$queryRaw<{ grp: "ACADEMY" | "POOL"; position: StudentPosition; students: number }[]>`
    ${academyFacts(query, owners, Prisma.sql`j.id = ANY(${jobIds}::uuid[])`)},
    app AS (
      SELECT f.candidate_id, f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE') AS academy, f.in_pool, f.shared, f.selected, f.internal_rejected,
        (jr."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED') OR jr."companyProcessEndDate" IS NOT NULL) AS drive_over,
        (f.pipeline IN ('SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'JOINED', 'REJECTED', 'DROPPED')
          OR n."processEndDate" IS NOT NULL
          OR jr."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED')
          OR jr."companyProcessEndDate" IS NOT NULL) AS ended
      FROM f
      JOIN "JobRequest" jr ON jr.id = f.job_id
      LEFT JOIN "CompanyNomination" n ON n.id = f.nomination_id
      WHERE f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE') OR f.in_pool
    ),
    per AS (
      SELECT candidate_id, bool_or(academy) AS academy, bool_or(in_pool) AS pool, bool_or(selected) AS selected,
        bool_or(shared AND NOT ended) AS in_process, bool_or(shared) AS shared, bool_and(internal_rejected) AS all_rejected,
        bool_or(NOT shared AND NOT internal_rejected AND NOT drive_over) AS open_shortlisting
      FROM app GROUP BY candidate_id
    ),
    pos AS (
      SELECT academy, pool,
        CASE WHEN selected THEN 'SELECTED' WHEN in_process THEN 'IN_PROCESS' WHEN shared THEN 'ENDED_NOT_SELECTED'
             WHEN open_shortlisting THEN 'IN_SHORTLISTING' WHEN all_rejected THEN 'REJECTED_INTERNALLY'
             ELSE 'NOT_SHARED_DRIVE_OVER' END AS position
      FROM per
    )
    SELECT g.grp, position, COUNT(*)::int AS students
    FROM pos CROSS JOIN LATERAL (VALUES ('ACADEMY', academy), ('POOL', pool)) AS g(grp, keep)
    WHERE keep
    GROUP BY 1, 2`;
  for (const row of rows) {
    const target = row.grp === "ACADEMY" ? result.academy : result.pool;
    target[row.position] += row.students;
    target.students += row.students;
  }
  return result;
}

export interface ReasonCount { tagId: string | null; label: string; academy: number; pool: number; total: number }

/**
 * Why Academy / assessed-pool students were not selected, per drive: one count
 * per student per drive, by the RSA team's reason (else the round's). Summing
 * drives stays exact, so the page can re-total for whatever drives it filters to.
 */
export async function notSelectedReasonsByJob(jobIds: string[], owners: Prisma.Sql) {
  if (jobIds.length === 0) return new Map<string, ReasonCount[]>();
  const query = { dateBy: "requested", academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
  const rows = await prisma.$queryRaw<{ job_id: string; tag_id: string | null; label: string; academy: number; pool: number; total: number }[]>`
    ${academyFacts(query, owners, Prisma.sql`j.id = ANY(${jobIds}::uuid[])`)}, ${ROUND_LABELS}
    SELECT f.job_id, rt.id AS tag_id, COALESCE(rt.label, ${UNTAGGED}) AS label,
      COUNT(*) FILTER (WHERE f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE'))::int AS academy,
      COUNT(*) FILTER (WHERE f.in_pool)::int AS pool,
      COUNT(*)::int AS total
    FROM f
    ${APPLICATION_REASON(Prisma.sql`f`)}
    WHERE (f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE') OR f.in_pool) AND NOT f.selected AND ${NOT_SELECTED(Prisma.sql`f`)}
    GROUP BY f.job_id, rt.id, rt.label`;
  const byJob = new Map<string, ReasonCount[]>();
  for (const row of rows) {
    byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), { tagId: row.tag_id, label: row.label, academy: row.academy, pool: row.pool, total: row.total }]);
  }
  return byJob;
}

/** Adds up per-drive reason counts; untagged last, then most common first. */
export function sumReasons(lists: ReasonCount[][]): ReasonCount[] {
  const totals = new Map<string, ReasonCount>();
  for (const row of lists.flat()) {
    const key = row.tagId ?? "";
    const known = totals.get(key);
    if (known) { known.academy += row.academy; known.pool += row.pool; known.total += row.total; }
    else totals.set(key, { ...row });
  }
  return [...totals.values()].sort((x, y) => Number(x.tagId === null) - Number(y.tagId === null) || y.total - x.total);
}
