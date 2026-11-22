import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompanyPipelineStatus } from "../../generated/prisma/client.js";
import { buildPlacementKpis, computeKpis, KPI_SEGMENTS, type KpiJob } from "./placement-kpis.js";

const segment = (key: (typeof KPI_SEGMENTS)[number]["key"]) => KPI_SEGMENTS.find((item) => item.key === key)!;
type Category = "ACADEMY" | "ACADEMY_INTENSIVE" | "EXTERNAL";

const app = (category: Category | null, pipelineStatus?: CompanyPipelineStatus) => ({
  productCategory: category,
  candidateCategory: null,
  nomination: pipelineStatus ? { status: "NOMINATED" as const, pipelineStatus } : null,
});

const endedOct = new Date("2026-10-25T00:00:00Z");

const job = (overrides: Partial<KpiJob>): KpiJob => ({
  id: "job",
  companyId: "c1",
  companyName: "Acme",
  openings: 2,
  requestDate: new Date("2026-10-05"),
  ctcLpa: 5,
  applications: [],
  ...overrides,
});

test("team KPIs count every in-band job and cap fills at each job's openings", () => {
  const jobs = [
    job({ id: "j1", openings: 1, processEndedOn: endedOct, applications: [app("ACADEMY", "JOINED"), app("ACADEMY", "SELECTED"), app("EXTERNAL")] }),
    job({ id: "j2", companyId: "c2", openings: 3, processEndedOn: endedOct, applications: [app("ACADEMY_INTENSIVE", "OFFER_DECLINED")] }),
    job({ id: "j3", companyId: "c3", openings: 1, processEndedOn: endedOct, applications: [] }),
  ];
  assert.deepEqual(computeKpis(jobs, segment("TEAM_BELOW_8")), {
    placements: 2,
    positions: 5,
    positionsClosed: 1,
    positionsClosedPct: 20,
    companies: 3,
    companiesHired: 1,
    companiesProcessEnded: 3,
    companiesEndedHired: 1,
    hiredConversionPct: 33.3,
    profilesConsidered: 4,
    profileToHirePct: 50,
  });
});

test("a product segment only counts jobs where it had profiles", () => {
  const jobs = [
    job({ id: "j1", openings: 2, processEndedOn: endedOct, applications: [app("ACADEMY", "SELECTED"), app("EXTERNAL", "SELECTED")] }),
    job({ id: "j2", companyId: "c2", openings: 4, processEndedOn: endedOct, applications: [app("EXTERNAL")] }),
  ];
  const academy = computeKpis(jobs, segment("ACADEMY_BELOW_8"));
  assert.equal(academy.positions, 2);
  assert.equal(academy.placements, 1);
  assert.equal(academy.companies, 1);
  assert.equal(academy.profileToHirePct, 100);
  const external = computeKpis(jobs, segment("EXTERNAL_BELOW_8"));
  assert.equal(external.positions, 6);
  assert.equal(external.companiesHired, 1);
});

test("applications with no product fall back to the candidate category, then External", () => {
  const jobs = [job({ applications: [
    { productCategory: null, candidateCategory: "ACADEMY", nomination: null },
    { productCategory: null, candidateCategory: null, nomination: { status: "NOMINATED", pipelineStatus: "JOINED" } },
  ] })];
  assert.equal(computeKpis(jobs, segment("ACADEMY_BELOW_8")).profilesConsidered, 1);
  assert.equal(computeKpis(jobs, segment("EXTERNAL_BELOW_8")).placements, 1);
});

test("withdrawn nominations do not count as placements", () => {
  const jobs = [job({ applications: [{ productCategory: "ACADEMY", candidateCategory: null, nomination: { status: "WITHDRAWN", pipelineStatus: "SELECTED" } }] })];
  assert.equal(computeKpis(jobs, segment("TEAM_BELOW_8")).placements, 0);
});

test("the < 8 LPA band excludes jobs at 8 LPA or without a CTC; Academy all-LPA keeps them", () => {
  const jobs = [
    job({ id: "low", ctcLpa: 7.99, applications: [app("ACADEMY", "SELECTED")] }),
    job({ id: "high", ctcLpa: 8, applications: [app("ACADEMY", "SELECTED")] }),
    job({ id: "unknown", ctcLpa: null, applications: [app("ACADEMY", "SELECTED")] }),
  ];
  assert.equal(computeKpis(jobs, segment("ACADEMY_BELOW_8")).placements, 1);
  assert.equal(computeKpis(jobs, segment("ACADEMY_ALL")).placements, 3);
  const result = buildPlacementKpis(jobs);
  assert.deepEqual(result.coverage, { jobs: 3, jobsWithoutCtc: 1, jobsAtOrAboveThreshold: 1 });
});

test("percentages are null when nothing is counted", () => {
  const kpis = computeKpis([], segment("TEAM_BELOW_8"));
  assert.equal(kpis.positionsClosedPct, null);
  assert.equal(kpis.hiredConversionPct, null);
  assert.equal(kpis.profileToHirePct, null);
});

test("results are grouped by request month (newest first) and by company", () => {
  const result = buildPlacementKpis([
    job({ id: "a", requestDate: new Date("2026-09-30"), applications: [app("ACADEMY", "SELECTED")] }),
    job({ id: "b", requestDate: new Date("2026-10-01"), companyId: "c2", companyName: "Beta", applications: [app("ACADEMY", "SELECTED"), app("ACADEMY", "JOINED")] }),
    job({ id: "c", requestDate: new Date("2026-10-20"), applications: [] }),
  ]);
  assert.deepEqual(result.monthly.map(({ month }) => month), ["2026-10", "2026-09"]);
  assert.equal(result.monthly[0]!.kpis.TEAM_BELOW_8.placements, 2);
  assert.equal(result.monthly[0]!.kpis.TEAM_BELOW_8.companies, 2);
  assert.deepEqual(result.companies.map(({ name, kpis }) => [name, kpis.TEAM_BELOW_8.placements]), [["Beta", 2], ["Acme", 1]]);
  assert.equal(result.totals.TEAM_BELOW_8.placements, 3);
});

test("the big picture counts every CTC level, splits placements by category and groups by request month", () => {
  const jobs = [
    // 12 LPA is outside the < 8 LPA team but still in the big picture.
    job({ id: "j1", openings: 1, ctcLpa: 12, processEndedOn: endedOct, applications: [app("ACADEMY", "JOINED"), app("ACADEMY_INTENSIVE", "OFFER_RELEASED"), app("EXTERNAL", "REJECTED")] }),
    job({ id: "j2", companyId: "c2", openings: 3, ctcLpa: null, processEndedOn: endedOct, applications: [app(null, "SELECTED")] }),
    // Came in November but its process has not ended: its openings stay out of positions closed.
    job({ id: "j3", companyId: "c2", openings: 2, requestDate: new Date("2026-11-02"), applications: [] }),
  ];
  const { overview } = buildPlacementKpis(jobs);
  assert.deepEqual(overview.totals, {
    jobRequests: 3,
    companies: 2,
    openings: 6,
    positions: 4,
    positionsClosed: 2,
    positionsClosedPct: 50,
    placements: 3,
    placementsByCategory: { ACADEMY: 1, ACADEMY_INTENSIVE: 1, EXTERNAL: 1 },
    companiesProcessEnded: 2,
    companiesEndedHired: 2,
    hiredCompaniesPct: 100,
  });
  assert.deepEqual(overview.monthly.map(({ month, openings, placements }) => ({ month, openings, placements })), [
    { month: "2026-11", openings: 2, placements: 0 },
    { month: "2026-10", openings: 4, placements: 3 },
  ]);
});

const hired = (category: Category, on: string, source: "STUDENT" | "ROUND" | "JOB" = "STUDENT") => ({
  ...app(category, "SELECTED"),
  hiredOn: new Date(`${on}T00:00:00Z`),
  hiredOnSource: source,
});

test("placements count in the hired month, openings in the request month", () => {
  const jobs = [
    // Requested in August; one hire in September, two in October.
    job({ id: "aug", openings: 2, requestDate: new Date("2026-08-10"), applications: [hired("ACADEMY", "2026-09-28"), hired("ACADEMY", "2026-10-03"), hired("EXTERNAL", "2026-10-15")] }),
    job({ id: "oct", companyId: "c2", companyName: "Beta", openings: 1, requestDate: new Date("2026-10-01"), applications: [] }),
  ];
  const result = buildPlacementKpis(jobs);
  assert.deepEqual(result.overview.monthly.map(({ month, openings, placements }) => ({ month, openings, placements })), [
    { month: "2026-10", openings: 1, placements: 2 },
    { month: "2026-09", openings: 0, placements: 1 },
    { month: "2026-08", openings: 2, placements: 0 },
  ]);
  const october = result.monthly[0]!.kpis.TEAM_BELOW_8;
  assert.equal(october.placements, 2);
  // Acme hired in October (job from August) and Beta asked in October.
  assert.equal(october.companies, 2);
  assert.equal(october.companiesHired, 1);
  // All time is unchanged by the split.
  assert.equal(result.totals.TEAM_BELOW_8.placements, 3);
});

test("a period filter takes hires from older jobs and drops hires outside it", () => {
  const jobs = [
    job({ id: "aug", requestDate: new Date("2026-08-10"), applications: [hired("ACADEMY", "2026-10-03"), hired("ACADEMY", "2026-11-02")] }),
    job({ id: "sep", companyId: "c2", companyName: "Beta", requestDate: new Date("2026-09-10"), applications: [hired("ACADEMY", "2026-09-20")] }),
  ];
  const result = buildPlacementKpis(jobs, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(result.totals.TEAM_BELOW_8.placements, 1);
  assert.equal(result.totals.TEAM_BELOW_8.positions, 0);
  assert.deepEqual(result.monthly.map(({ month }) => month), ["2026-10"]);
  assert.deepEqual(result.companies.map(({ name }) => name), ["Acme"]);
  assert.equal(result.coverage.jobs, 0);
});

test("placements without a hired date stay in the request month and are listed", () => {
  const jobs = [job({
    id: "j1", jobCode: "JR-1", roleTitle: "Dev", requestDate: new Date("2026-10-05"),
    applications: [{ ...app("ACADEMY", "JOINED"), id: "a1", candidateName: "Asha" }, hired("ACADEMY", "2026-11-01", "ROUND")],
  })];
  const result = buildPlacementKpis(jobs);
  assert.deepEqual(result.overview.monthly.map(({ month, placements }) => ({ month, placements })), [
    { month: "2026-11", placements: 1 },
    { month: "2026-10", placements: 1 },
  ]);
  assert.equal(result.hiredDates.placements, 2);
  assert.equal(result.hiredDates.ROUND, 1);
  assert.equal(result.hiredDates.missing, 1);
  assert.deepEqual(result.hiredDates.undated, [{
    applicationId: "a1", candidateName: "Asha", jobRequestId: "j1", jobCode: "JR-1", roleTitle: "Dev", companyName: "Acme", requestDate: "2026-10-05",
  }]);
});

test("hired conversion is hired companies out of companies whose process ended in the period", () => {
  const ended = (on: string) => new Date(`${on}T00:00:00Z`);
  const jobs = [
    // Ended in October and hired (the hire itself was in September).
    job({ id: "a", companyId: "c1", processEndedOn: ended("2026-10-10"), applications: [hired("ACADEMY", "2026-09-25")] }),
    // Ended in October without a hire.
    job({ id: "b", companyId: "c2", companyName: "Beta", processEndedOn: ended("2026-10-20"), applications: [app("ACADEMY", "REJECTED")] }),
    // Still running: not in the denominator even though it hired.
    job({ id: "c", companyId: "c3", companyName: "Gamma", processEndedOn: null, applications: [hired("ACADEMY", "2026-10-05")] }),
  ];
  const result = buildPlacementKpis(jobs, { from: "2026-10-01", to: "2026-10-31" });
  const team = result.totals.TEAM_BELOW_8;
  assert.equal(team.companiesProcessEnded, 2);
  assert.equal(team.companiesEndedHired, 1);
  assert.equal(team.hiredConversionPct, 50);
  assert.equal(result.overview.totals.hiredCompaniesPct, 50);
  // A product segment only counts the ended companies where it had profiles.
  assert.equal(result.totals.EXTERNAL_BELOW_8.companiesProcessEnded, 0);
});

test("positions closed only count jobs whose process ended in the period", () => {
  const jobs = [
    // Requested in September, ended in November with 1 of 2 openings filled.
    job({ id: "a", openings: 2, requestDate: new Date("2026-09-10"), processEndedOn: new Date("2026-11-12T00:00:00Z"), applications: [hired("ACADEMY", "2026-11-05")] }),
    // Came in November, not started or still running: left out.
    job({ id: "b", companyId: "c2", companyName: "Beta", openings: 5, requestDate: new Date("2026-11-03"), processEndedOn: null, applications: [] }),
    // Ended in October: not November's.
    job({ id: "c", companyId: "c3", companyName: "Gamma", openings: 1, requestDate: new Date("2026-09-01"), processEndedOn: endedOct, applications: [hired("ACADEMY", "2026-10-20")] }),
  ];
  const november = buildPlacementKpis(jobs, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(november.totals.TEAM_BELOW_8.positions, 2);
  assert.equal(november.totals.TEAM_BELOW_8.positionsClosed, 1);
  assert.equal(november.totals.TEAM_BELOW_8.positionsClosedPct, 50);
  assert.equal(november.overview.totals.openings, 5);
  assert.equal(november.overview.totals.positions, 2);
  const all = buildPlacementKpis(jobs);
  assert.equal(all.totals.TEAM_BELOW_8.positions, 3);
  assert.equal(all.totals.TEAM_BELOW_8.positionsClosed, 2);
});
