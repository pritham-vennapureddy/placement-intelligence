import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../services/api";
import type { PlacementKpiValues, PlacementSegmentKey } from "../types/api";
import { cn } from "../utils/cn";
import { Card, CardContent, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const ALL_TIME = "__all__";
const numberFormat = new Intl.NumberFormat("en-IN");
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00Z`));
const percent = (value: number | null) => (value === null ? "—" : `${value}%`);

/** First and last day of a "YYYY-MM" month as ISO dates. */
function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const KPI_COLUMNS: {
  label: string;
  hint: string;
  value: (kpis: PlacementKpiValues) => string;
  detail: (kpis: PlacementKpiValues) => string;
}[] = [
  {
    label: "KPI 1 · Placements",
    hint: "Candidates the company selected (selected, offer released, offer accepted or joined).",
    value: (kpis) => numberFormat.format(kpis.placements),
    detail: () => "selected",
  },
  {
    label: "KPI 2 · % Positions closed",
    hint: "Fulfilment rate: openings filled ÷ openings. Each job counts at most its own openings.",
    value: (kpis) => percent(kpis.positionsClosedPct),
    detail: (kpis) => `${numberFormat.format(kpis.positionsClosed)} of ${numberFormat.format(kpis.positions)} positions`,
  },
  {
    label: "KPI 3 · % Hired conversion",
    hint: "Companies that hired at least one candidate ÷ companies worked with.",
    value: (kpis) => percent(kpis.hiredConversionPct),
    detail: (kpis) => `${numberFormat.format(kpis.companiesHired)} of ${numberFormat.format(kpis.companies)} companies`,
  },
  {
    label: "KPI 4 · Profiles → hired",
    hint: "Placements ÷ profiles considered (applications that were not withdrawn).",
    value: (kpis) => percent(kpis.profileToHirePct),
    detail: (kpis) => `${numberFormat.format(kpis.placements)} of ${numberFormat.format(kpis.profilesConsidered)} profiles`,
  },
];

function KpiCells({ kpis }: { kpis: PlacementKpiValues }) {
  return KPI_COLUMNS.map((column) => (
    <td key={column.label} className="px-3 py-3 align-top">
      <p className="text-sm font-semibold tabular-nums text-slate-900">{column.value(kpis)}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">{column.detail(kpis)}</p>
    </td>
  ));
}

function KpiHeaderCells() {
  return KPI_COLUMNS.map((column) => (
    <th key={column.label} title={column.hint} className="cursor-help px-3 py-3 font-semibold">{column.label}</th>
  ));
}

function TableShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-slate-100 p-5">
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">{children}</table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Admin placement KPIs (< 8 LPA team, per product, Academy at any CTC), by month and by company. */
export function PlacementKpiPanel() {
  const [period, setPeriod] = useState(ALL_TIME);
  const [segment, setSegment] = useState<PlacementSegmentKey>("TEAM_BELOW_8");
  const range = period === ALL_TIME ? {} : monthRange(period);

  const allTime = useQuery({ queryKey: ["dashboard", "placement-kpis", {}], queryFn: () => dashboardApi.getPlacementKpis() });
  const inPeriod = useQuery({
    queryKey: ["dashboard", "placement-kpis", range],
    queryFn: () => dashboardApi.getPlacementKpis(range),
    enabled: period !== ALL_TIME,
  });
  const current = period === ALL_TIME ? allTime : inPeriod;
  const data = current.data;
  const segments = allTime.data?.segments ?? [];
  const segmentLabel = segments.find((item) => item.key === segment)?.label ?? "";
  const periodLabel = period === ALL_TIME ? "all time" : monthLabel(period);
  const companies = useMemo(
    () => (data?.companies ?? []).filter((company) => company.kpis[segment].companies > 0),
    [data, segment],
  );

  if (allTime.isError) {
    return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Could not load placement KPIs.</div>;
  }

  return (
    <section className="space-y-5" aria-label="Placement KPIs">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Placement KPIs</h2>
          <p className="mt-1 text-xs text-slate-500">
            Jobs are grouped by request month. A job is in the &lt; {allTime.data?.ctcThresholdLpa ?? 8} LPA band when its CTC is set and below that figure.
          </p>
        </div>
        <label className="w-full space-y-1 sm:w-52">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Period</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TIME}>All time</SelectItem>
              {(allTime.data?.monthly ?? []).map(({ month }) => (
                <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {data && data.coverage.jobsWithoutCtc > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            {numberFormat.format(data.coverage.jobsWithoutCtc)} of {numberFormat.format(data.coverage.jobs)} job requests in this period have no CTC, so they are left out of every &lt; 8 LPA figure (they still count for Academy all-LPA).
            {" "}Add the CTC on each <Link to="/job-requests" className="font-semibold underline">job request</Link>.
          </p>
        </div>
      )}

      <TableShell title={`Scorecard · ${periodLabel}`} subtitle="Choose a row to see its monthly and company breakdown. Hover a heading for its definition.">
        <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400">
          <tr><th className="px-5 py-3 font-semibold">Team</th><KpiHeaderCells /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data && segments.map((item) => (
            <tr
              key={item.key}
              tabIndex={0}
              aria-selected={item.key === segment}
              onClick={() => setSegment(item.key)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSegment(item.key); } }}
              className={cn("cursor-pointer hover:bg-slate-50/80 focus:outline-none focus-visible:bg-indigo-50", item.key === segment && "bg-indigo-50/60")}
            >
              <td className="px-5 py-3 align-top">
                <p className={cn("text-sm font-semibold text-slate-800", item.key === segment && "text-indigo-700")}>{item.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{item.detail}</p>
              </td>
              <KpiCells kpis={data.totals[item.key]} />
            </tr>
          ))}
          {current.isPending && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">Loading placement KPIs…</td></tr>}
          {current.isError && <tr><td colSpan={5} role="alert" className="px-5 py-8 text-center text-sm text-rose-600">Could not load KPIs for {periodLabel}.</td></tr>}
        </tbody>
      </TableShell>

      <TableShell title={`Monthly · ${segmentLabel}`} subtitle="Every month with job requests, newest first.">
        <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400">
          <tr><th className="px-5 py-3 font-semibold">Month</th><KpiHeaderCells /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(allTime.data?.monthly ?? []).map(({ month, kpis }) => (
            <tr key={month} className={cn(month === period && "bg-indigo-50/60")}>
              <td className="px-5 py-3 text-sm font-semibold text-slate-800">{monthLabel(month)}</td>
              <KpiCells kpis={kpis[segment]} />
            </tr>
          ))}
          {allTime.data && allTime.data.monthly.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No job requests yet.</td></tr>}
        </tbody>
      </TableShell>

      <TableShell title={`Companies · ${segmentLabel} · ${periodLabel}`} subtitle="Companies this team worked with in the period, most placements first.">
        <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400">
          <tr><th className="px-5 py-3 font-semibold">Company</th><KpiHeaderCells /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {companies.map((company) => (
            <tr key={company.id} className="hover:bg-slate-50/80">
              <td className="px-5 py-3 text-sm font-semibold text-slate-800">
                <Link to={`/companies/${company.id}`} className="hover:text-indigo-700 hover:underline">{company.name}</Link>
              </td>
              <KpiCells kpis={company.kpis[segment]} />
            </tr>
          ))}
          {data && companies.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No companies for {segmentLabel} in {periodLabel}.</td></tr>}
        </tbody>
      </TableShell>
    </section>
  );
}
