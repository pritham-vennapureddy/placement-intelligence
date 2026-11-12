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
    job({ id: "j1", openings: 1, applications: [app("ACADEMY", "JOINED"), app("ACADEMY", "SELECTED"), app("EXTERNAL")] }),
    job({ id: "j2", companyId: "c2", openings: 3, applications: [app("ACADEMY_INTENSIVE", "OFFER_DECLINED")] }),
    job({ id: "j3", companyId: "c3", openings: 1, applications: [] }),
  ];
  assert.deepEqual(computeKpis(jobs, segment("TEAM_BELOW_8")), {
    placements: 2,
    positions: 5,
    positionsClosed: 1,
    positionsClosedPct: 20,
    companies: 3,
    companiesHired: 1,
    hiredConversionPct: 33.3,
    profilesConsidered: 4,
    profileToHirePct: 50,
  });
});

test("a product segment only counts jobs where it had profiles", () => {
  const jobs = [
    job({ id: "j1", openings: 2, applications: [app("ACADEMY", "SELECTED"), app("EXTERNAL", "SELECTED")] }),
    job({ id: "j2", companyId: "c2", openings: 4, applications: [app("EXTERNAL")] }),
  ];
  const academy = computeKpis(jobs, segment("ACADEMY_BELOW_8"));
  assert.equal(academy.positions, 2);
  assert.equal(academy.placements, 1);
  assert.equal(academy.companies, 1);
  assert.equal(academy.profileToHirePct, 100);
  const external = computeKpis(jobs, segment("EXTERNAL_BELOW_8"));
  assert.equal(external.positions, 6);
  assert.equal(external.companiesHired, 1);
  assert.equal(external.hiredConversionPct, 50);
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
    job({ id: "j1", openings: 1, ctcLpa: 12, applications: [app("ACADEMY", "JOINED"), app("ACADEMY_INTENSIVE", "OFFER_RELEASED"), app("EXTERNAL", "REJECTED")] }),
    job({ id: "j2", companyId: "c2", openings: 3, ctcLpa: null, applications: [app(null, "SELECTED")] }),
    job({ id: "j3", companyId: "c2", openings: 2, requestDate: new Date("2026-11-02"), applications: [] }),
  ];
  const { overview } = buildPlacementKpis(jobs);
  assert.deepEqual(overview.totals, {
    jobRequests: 3,
    companies: 2,
    openings: 6,
    positionsClosed: 2,
    positionsClosedPct: 33.3,
    placements: 3,
    placementsByCategory: { ACADEMY: 1, ACADEMY_INTENSIVE: 1, EXTERNAL: 1 },
  });
  assert.deepEqual(overview.monthly.map(({ month, openings, placements }) => ({ month, openings, placements })), [
    { month: "2026-11", openings: 2, placements: 0 },
    { month: "2026-10", openings: 4, placements: 3 },
  ]);
});
