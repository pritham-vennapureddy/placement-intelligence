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

export interface KpiJob {
  id: string;
  companyId: string;
  companyName: string;
  openings: number;
  requestDate: Date;
  ctcLpa: number | null;
  applications: {
    productCategory: CandidateCategory | null;
    candidateCategory: CandidateCategory | null;
    nomination: { status: NominationStatus; pipelineStatus: CompanyPipelineStatus } | null;
  }[];
}

export interface Kpis {
  /** KPI 1: candidates the companies selected. */
  placements: number;
  /** Openings on the jobs counted for this segment. */
  positions: number;
  /** Openings filled, capping each job at its openings so one over-hire cannot hide an unfilled job. */
  positionsClosed: number;
  /** KPI 2: positionsClosed ÷ positions. */
  positionsClosedPct: number | null;
  companies: number;
  companiesHired: number;
  /** KPI 3: companies with at least one placement ÷ companies counted. */
  hiredConversionPct: number | null;
  profilesConsidered: number;
  /** KPI 4: placements ÷ profiles considered. */
  profileToHirePct: number | null;
}

/** Product category of the application, else the candidate's; anyone without one is External. */
function categoryOf(application: KpiJob["applications"][number]): CandidateCategory {
  return application.productCategory ?? application.candidateCategory ?? "EXTERNAL";
}

const isPlaced = (application: KpiJob["applications"][number]) =>
  application.nomination?.status === "NOMINATED" && PLACED_STATUSES.includes(application.nomination.pipelineStatus);

const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

export function jobInSegment(job: Pick<KpiJob, "ctcLpa">, segment: (typeof KPI_SEGMENTS)[number]): boolean {
  return segment.ctc === "ANY" || (job.ctcLpa !== null && job.ctcLpa < CTC_THRESHOLD_LPA);
}

/**
 * The four placement KPIs for one segment over a set of jobs.
 *
 * The whole team counts every job and company in scope. A product segment counts
 * only the jobs (and companies) where it had at least one profile considered, so
 * a team is measured against the positions it actually competed for.
 */
export function computeKpis(jobs: KpiJob[], segment: (typeof KPI_SEGMENTS)[number]): Kpis {
  const categories: readonly CandidateCategory[] | null = segment.categories;
  let placements = 0;
  let positions = 0;
  let positionsClosed = 0;
  let profilesConsidered = 0;
  const companies = new Set<string>();
  const companiesHired = new Set<string>();

  for (const job of jobs) {
    if (!jobInSegment(job, segment)) continue;
    const applications = categories
      ? job.applications.filter((application) => categories.includes(categoryOf(application)))
      : job.applications;
    if (categories && applications.length === 0) continue;
    const placed = applications.filter(isPlaced).length;
    placements += placed;
    profilesConsidered += applications.length;
    positions += job.openings;
    positionsClosed += Math.min(placed, job.openings);
    companies.add(job.companyId);
    if (placed > 0) companiesHired.add(job.companyId);
  }

  return {
    placements,
    positions,
    positionsClosed,
    positionsClosedPct: ratio(positionsClosed, positions),
    companies: companies.size,
    companiesHired: companiesHired.size,
    hiredConversionPct: ratio(companiesHired.size, companies.size),
    profilesConsidered,
    profileToHirePct: ratio(placements, profilesConsidered),
  };
}

const allSegments = (jobs: KpiJob[]) =>
  Object.fromEntries(KPI_SEGMENTS.map((segment) => [segment.key, computeKpis(jobs, segment)])) as Record<SegmentKey, Kpis>;

/** Calendar month of the job's request date, e.g. "2026-10". */
export const monthOf = (date: Date) => date.toISOString().slice(0, 7);

export function buildPlacementKpis(jobs: KpiJob[]) {
  const byMonth = new Map<string, KpiJob[]>();
  const byCompany = new Map<string, { name: string; jobs: KpiJob[] }>();
  for (const job of jobs) {
    const month = monthOf(job.requestDate);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(job);
    const company = byCompany.get(job.companyId) ?? byCompany.set(job.companyId, { name: job.companyName, jobs: [] }).get(job.companyId)!;
    company.jobs.push(job);
  }

  return {
    ctcThresholdLpa: CTC_THRESHOLD_LPA,
    segments: KPI_SEGMENTS.map(({ key, label, detail }) => ({ key, label, detail })),
    totals: allSegments(jobs),
    monthly: [...byMonth]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, monthJobs]) => ({ month, kpis: allSegments(monthJobs) })),
    companies: [...byCompany]
      .map(([id, company]) => ({ id, name: company.name, kpis: allSegments(company.jobs) }))
      .sort((a, b) => b.kpis.TEAM_BELOW_8.placements - a.kpis.TEAM_BELOW_8.placements || a.name.localeCompare(b.name)),
    coverage: {
      jobs: jobs.length,
      jobsWithoutCtc: jobs.filter((job) => job.ctcLpa === null).length,
      jobsAtOrAboveThreshold: jobs.filter((job) => job.ctcLpa !== null && job.ctcLpa >= CTC_THRESHOLD_LPA).length,
    },
  };
}

export type PlacementKpis = ReturnType<typeof buildPlacementKpis>;
