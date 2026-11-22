import type { CandidateCategory, CompanyPipelineStatus, NominationStatus } from "../../generated/prisma/client.js";

/** Company-side statuses that count as a placement (the company selected the candidate). */
export const PLACED_STATUSES: readonly CompanyPipelineStatus[] = ["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "JOINED"];

/** Jobs offering strictly less than this CTC (in LPA) belong to the < 8 LPA team. */
export const CTC_THRESHOLD_LPA = 8;

export const KPI_SEGMENTS = [
  { key: "TEAM_BELOW_8", label: "Team < 8 LPA", detail: "Academy, Intensive Online and External", categories: null, ctc: "BELOW_THRESHOLD" },
  { key: "ACADEMY_BELOW_8", label: "Academy < 8 LPA", detail: "Academy products", categories: ["ACADEMY"], ctc: "BELOW_THRESHOLD" },
  { key: "INTENSIVE_BELOW_8", label: "Intensive Online < 8 LPA", detail: "Intensive products", categories: ["ACADEMY_INTENSIVE"], ctc: "BELOW_THRESHOLD" },
  { key: "EXTERNAL_BELOW_8", label: "External < 8 LPA", detail: "Candidates outside our products", categories: ["EXTERNAL"], ctc: "BELOW_THRESHOLD" },
  { key: "ACADEMY_ALL", label: "Academy (all LPA)", detail: "Academy products at any CTC", categories: ["ACADEMY"], ctc: "ANY" },
] as const satisfies readonly {
  key: string;
  label: string;
  detail: string;
  categories: readonly CandidateCategory[] | null;
  ctc: "BELOW_THRESHOLD" | "ANY";
}[];

export type SegmentKey = (typeof KPI_SEGMENTS)[number]["key"];

/** Where a placement's hired date came from: the student's interview-done date, their last company round, or the job's process end. */
export type HiredOnSource = "STUDENT" | "ROUND" | "JOB";

export interface KpiJob {
  id: string;
  jobCode?: string;
  roleTitle?: string;
  companyId: string;
  companyName: string;
  openings: number;
  requestDate: Date;
  ctcLpa: number | null;
  /** When the company's process on this job ended; null while it is still running. */
  processEndedOn?: Date | null;
  applications: {
    id?: string;
    candidateName?: string;
    productCategory: CandidateCategory | null;
    candidateCategory: CandidateCategory | null;
    nomination: { status: NominationStatus; pipelineStatus: CompanyPipelineStatus } | null;
    /**
     * The day the student was hired (interview done). Placements count in this
     * month, not the job request month; without one the request date stands in.
     */
    hiredOn?: Date | null;
    hiredOnSource?: HiredOnSource | null;
  }[];
}

type KpiApplication = KpiJob["applications"][number];

/** Whether a date falls in the period being measured. */
export type InPeriod = (date: Date) => boolean;
const ALWAYS: InPeriod = () => true;

/** Inclusive ISO-date range ("2026-10-01" to "2026-10-31"); open ends are unbounded. */
export function periodTest(from?: string, to?: string): InPeriod {
  if (!from && !to) return ALWAYS;
  const start = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
  const end = to ? Date.parse(`${to}T00:00:00Z`) : Infinity;
  return (date) => date.getTime() >= start && date.getTime() <= end;
}

/** Calendar month of a date, e.g. "2026-10". */
export const monthOf = (date: Date) => date.toISOString().slice(0, 7);

const monthTest = (month: string): InPeriod => (date) => monthOf(date) === month;

/** The day a placement counts on: the hired date, else the job's request date. */
export const placedOn = (application: KpiApplication, job: Pick<KpiJob, "requestDate">) => application.hiredOn ?? job.requestDate;

export interface Kpis {
  /** KPI 1: candidates the companies selected. */
  placements: number;
  /** Openings on jobs whose company process ended in the period (running or not-started jobs are left out). */
  positions: number;
  /** Of those openings, how many were filled, each job capped at its openings so one over-hire cannot hide an unfilled job. */
  positionsClosed: number;
  /** KPI 2: positionsClosed ÷ positions. */
  positionsClosedPct: number | null;
  /** Companies worked with: a job requested or a hire in the period. */
  companies: number;
  /** Companies with a placement in the period. */
  companiesHired: number;
  /** Companies whose process (on at least one job) ended in the period. */
  companiesProcessEnded: number;
  /** Of those, companies that hired at least one student on an ended job. */
  companiesEndedHired: number;
  /** KPI 3: companiesEndedHired ÷ companiesProcessEnded. */
  hiredConversionPct: number | null;
  profilesConsidered: number;
  /** KPI 4: placements ÷ profiles considered. */
  profileToHirePct: number | null;
}

/** Product category of the application, else the candidate's; anyone without one is External. */
function categoryOf(application: KpiApplication): CandidateCategory {
  return application.productCategory ?? application.candidateCategory ?? "EXTERNAL";
}

const isPlaced = (application: KpiApplication) =>
  application.nomination?.status === "NOMINATED" && PLACED_STATUSES.includes(application.nomination.pipelineStatus);

const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

export function jobInSegment(job: Pick<KpiJob, "ctcLpa">, segment: (typeof KPI_SEGMENTS)[number]): boolean {
  return segment.ctc === "ANY" || (job.ctcLpa !== null && job.ctcLpa < CTC_THRESHOLD_LPA);
}

/** Placed applications of a job, earliest hire first, each with the day it counts on. */
function placedInOrder(job: KpiJob, applications: KpiApplication[]) {
  return applications
    .filter(isPlaced)
    .map((application) => ({ application, on: placedOn(application, job) }))
    .sort((x, y) => x.on.getTime() - y.on.getTime());
}

/**
 * The four placement KPIs for one segment over a set of jobs, for one period.
 *
 * Placements count in the period the student was hired; profiles and companies
 * worked with in the period the job was requested. Positions closed (KPI 2) and
 * hired conversion (KPI 3) look only at jobs whose company process ended in the
 * period: a job that came in but has not started or not finished is left out.
 *
 * The whole team counts every job and company in scope. A product segment counts
 * only the jobs (and companies) where it had at least one profile considered, so
 * a team is measured against the positions it actually competed for.
 */
export function computeKpis(jobs: KpiJob[], segment: (typeof KPI_SEGMENTS)[number], inPeriod: InPeriod = ALWAYS): Kpis {
  const categories: readonly CandidateCategory[] | null = segment.categories;
  let placements = 0;
  let positions = 0;
  let positionsClosed = 0;
  let profilesConsidered = 0;
  const companies = new Set<string>();
  const companiesHired = new Set<string>();
  const companiesEnded = new Set<string>();
  const companiesEndedHired = new Set<string>();

  for (const job of jobs) {
    if (!jobInSegment(job, segment)) continue;
    const applications = categories
      ? job.applications.filter((application) => categories.includes(categoryOf(application)))
      : job.applications;
    if (categories && applications.length === 0) continue;
    const requested = inPeriod(job.requestDate);
    const placed = placedInOrder(job, applications);
    const placedInPeriod = placed.filter(({ on }) => inPeriod(on)).length;
    if (job.processEndedOn && inPeriod(job.processEndedOn)) {
      positions += job.openings;
      positionsClosed += Math.min(placed.length, job.openings);
      companiesEnded.add(job.companyId);
      if (placed.length > 0) companiesEndedHired.add(job.companyId);
    }
    if (!requested && placedInPeriod === 0) continue;
    placements += placedInPeriod;
    if (requested) {
      profilesConsidered += applications.length;
      companies.add(job.companyId);
    }
    if (placedInPeriod > 0) {
      companies.add(job.companyId);
      companiesHired.add(job.companyId);
    }
  }

  return {
    placements,
    positions,
    positionsClosed,
    positionsClosedPct: ratio(positionsClosed, positions),
    companies: companies.size,
    companiesHired: companiesHired.size,
    companiesProcessEnded: companiesEnded.size,
    companiesEndedHired: companiesEndedHired.size,
    hiredConversionPct: ratio(companiesEndedHired.size, companiesEnded.size),
    profilesConsidered,
    profileToHirePct: ratio(placements, profilesConsidered),
  };
}

const allSegments = (jobs: KpiJob[], inPeriod: InPeriod = ALWAYS) =>
  Object.fromEntries(KPI_SEGMENTS.map((segment) => [segment.key, computeKpis(jobs, segment, inPeriod)])) as Record<SegmentKey, Kpis>;

/** Placement categories in display order. */
export const OVERVIEW_CATEGORIES = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"] as const satisfies readonly CandidateCategory[];

export interface OverviewFigures {
  jobRequests: number;
  companies: number;
  /** Openings on the job requests received. */
  openings: number;
  /** Openings on jobs whose company process ended in the period. */
  positions: number;
  /** Of those, openings filled (each job capped at its openings). */
  positionsClosed: number;
  positionsClosedPct: number | null;
  placements: number;
  placementsByCategory: Record<(typeof OVERVIEW_CATEGORIES)[number], number>;
  /** Companies whose process ended in the period, and how many of them hired. */
  companiesProcessEnded: number;
  companiesEndedHired: number;
  hiredCompaniesPct: number | null;
}

/**
 * Big-picture figures over every job at any CTC: openings received (by request
 * date), positions closed on jobs whose process ended (by process end date) and
 * placements by category (by hired date).
 */
export function overviewFigures(jobs: KpiJob[], inPeriod: InPeriod = ALWAYS): OverviewFigures {
  const placementsByCategory = { ACADEMY: 0, ACADEMY_INTENSIVE: 0, EXTERNAL: 0 };
  let openings = 0;
  let positions = 0;
  let positionsClosed = 0;
  let jobRequests = 0;
  const companies = new Set<string>();
  const ended = new Set<string>();
  const endedHired = new Set<string>();
  for (const job of jobs) {
    const placed = placedInOrder(job, job.applications);
    if (job.processEndedOn && inPeriod(job.processEndedOn)) {
      positions += job.openings;
      positionsClosed += Math.min(placed.length, job.openings);
      ended.add(job.companyId);
      if (placed.length > 0) endedHired.add(job.companyId);
    }
    for (const { application, on } of placed) {
      if (inPeriod(on)) placementsByCategory[categoryOf(application) as keyof typeof placementsByCategory]++;
    }
    if (inPeriod(job.requestDate)) {
      jobRequests++;
      openings += job.openings;
      companies.add(job.companyId);
    }
  }
  const placements = placementsByCategory.ACADEMY + placementsByCategory.ACADEMY_INTENSIVE + placementsByCategory.EXTERNAL;
  return {
    jobRequests,
    companies: companies.size,
    openings,
    positions,
    positionsClosed,
    positionsClosedPct: ratio(positionsClosed, positions),
    placements,
    placementsByCategory,
    companiesProcessEnded: ended.size,
    companiesEndedHired: endedHired.size,
    hiredCompaniesPct: ratio(endedHired.size, ended.size),
  };
}

/**
 * Scorecard, monthly and company KPIs plus the big picture for jobs in scope.
 * `from` / `to` (ISO dates) bound the period: a job counts when requested in it,
 * a placement when the student was hired in it, so an August job's October hire
 * is an October placement.
 */
export function buildPlacementKpis(jobs: KpiJob[], range: { from?: string | undefined; to?: string | undefined } = {}) {
  const inRange = periodTest(range.from, range.to);
  const months = new Set<string>();
  const byCompany = new Map<string, { name: string; jobs: KpiJob[] }>();
  const hiredDates = { placements: 0, STUDENT: 0, ROUND: 0, JOB: 0, missing: 0 };
  const undated: {
    applicationId: string | null; candidateName: string | null; jobRequestId: string; jobCode: string | null; roleTitle: string | null;
    companyName: string; requestDate: string;
  }[] = [];

  for (const job of jobs) {
    if (inRange(job.requestDate)) months.add(monthOf(job.requestDate));
    if (job.processEndedOn && inRange(job.processEndedOn)) months.add(monthOf(job.processEndedOn));
    for (const { application, on } of placedInOrder(job, job.applications)) {
      if (!inRange(on)) continue;
      months.add(monthOf(on));
      hiredDates.placements++;
      if (application.hiredOn && application.hiredOnSource) hiredDates[application.hiredOnSource]++;
      else {
        hiredDates.missing++;
        undated.push({
          applicationId: application.id ?? null, candidateName: application.candidateName ?? null, jobRequestId: job.id,
          jobCode: job.jobCode ?? null, roleTitle: job.roleTitle ?? null, companyName: job.companyName, requestDate: job.requestDate.toISOString().slice(0, 10),
        });
      }
    }
    const company = byCompany.get(job.companyId) ?? byCompany.set(job.companyId, { name: job.companyName, jobs: [] }).get(job.companyId)!;
    company.jobs.push(job);
  }
  const monthList = [...months].sort((x, y) => y.localeCompare(x));
  const inMonth = (month: string): InPeriod => {
    const test = monthTest(month);
    return (date) => test(date) && inRange(date);
  };
  const jobsInRange = jobs.filter((job) => inRange(job.requestDate));

  return {
    ctcThresholdLpa: CTC_THRESHOLD_LPA,
    segments: KPI_SEGMENTS.map(({ key, label, detail }) => ({ key, label, detail })),
    totals: allSegments(jobs, inRange),
    /** All CTC levels, month by month: openings by request month, placements by hired month. */
    overview: {
      totals: overviewFigures(jobs, inRange),
      monthly: monthList.map((month) => ({ month, ...overviewFigures(jobs, inMonth(month)) })),
    },
    monthly: monthList.map((month) => ({ month, kpis: allSegments(jobs, inMonth(month)) })),
    companies: [...byCompany]
      .map(([id, company]) => ({ id, name: company.name, kpis: allSegments(company.jobs, inRange) }))
      .filter(({ kpis }) => Object.values(kpis).some((segment) => segment.companies > 0))
      .sort((x, y) => y.kpis.TEAM_BELOW_8.placements - x.kpis.TEAM_BELOW_8.placements || x.name.localeCompare(y.name)),
    coverage: {
      jobs: jobsInRange.length,
      jobsWithoutCtc: jobsInRange.filter((job) => job.ctcLpa === null).length,
      jobsAtOrAboveThreshold: jobsInRange.filter((job) => job.ctcLpa !== null && job.ctcLpa >= CTC_THRESHOLD_LPA).length,
    },
    /** Where each placement's hired date came from; `undated` ones count in their job's request month until a date is added. */
    hiredDates: { ...hiredDates, undated: undated.sort((x, y) => x.companyName.localeCompare(y.companyName)) },
  };
}

export type PlacementKpis = ReturnType<typeof buildPlacementKpis>;
