import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Award, BriefcaseBusiness, CircleCheckBig, Table2, ChartColumn } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "../../components/kpi-card";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { dashboardApi } from "../../services/api";
import type { PlacementOverviewFigures } from "../../types/api";

/**
 * Fixed categorical order (validated: CVD ΔE 9.2, normal-vision 27.6 on white).
 * Aqua sits below 3:1 on white, so the chart always carries a legend and a table view.
 */
const CATEGORIES = [
  { key: "ACADEMY", label: "Academy", color: "#2a78d6" },
  { key: "ACADEMY_INTENSIVE", label: "Intensive", color: "#eb6834" },
  { key: "EXTERNAL", label: "External", color: "#1baf7a" },
] as const;
const OPENINGS_COLOR = "#2a78d6";
const CLOSED_COLOR = "#eb6834";

const monthLabel = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yyyy");
const shortMonth = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yy");
const pctText = (value: number | null) => (value === null ? "—" : `${value}%`);

/** Insights' month filter ("2026-10") as the date range the KPI endpoint takes. */
function toRange(from?: string, to?: string) {
  const end = (month: string) => {
    const [year, mon] = month.split("-").map(Number) as [number, number];
    return `${month}-${String(new Date(year, mon, 0).getDate()).padStart(2, "0")}`;
  };
  return { ...(from ? { from: `${from}-01` } : {}), ...(to ? { to: end(to) } : {}) };
}

function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>
      ))}
    </div>
  );
}

type Row = { month: string } & PlacementOverviewFigures;

function MonthTooltip({ active, row, label, kind }: { active: boolean | undefined; row: Row | undefined; label: unknown; kind: "placements" | "openings" }) {
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-800">{monthLabel(String(label))}</p>
      {kind === "placements" ? (
        <>
          {CATEGORIES.map((category) => (
            <p key={category.key} className="flex items-center gap-1.5 text-slate-600">
              <i className="h-2 w-2 rounded-sm" style={{ background: category.color }} />{category.label}
              <span className="ml-auto pl-4 font-medium tabular-nums text-slate-800">{row.placementsByCategory[category.key]}</span>
            </p>
          ))}
          <p className="mt-1 border-t border-slate-100 pt-1 text-slate-600">Total <span className="float-right pl-4 font-semibold tabular-nums text-slate-900">{row.placements}</span></p>
        </>
      ) : (
        <>
          <p className="text-slate-600">Openings received <span className="float-right pl-4 font-medium tabular-nums text-slate-800">{row.openings}</span></p>
          <p className="text-slate-600">Positions closed <span className="float-right pl-4 font-medium tabular-nums text-slate-800">{row.positionsClosed} · {pctText(row.positionsClosedPct)}</span></p>
          <p className="text-slate-500">{row.jobRequests} job requests · {row.companies} companies</p>
        </>
      )}
    </div>
  );
}

const axisProps = { axisLine: false, tickLine: false, tick: { fill: "#64748b", fontSize: 11 } } as const;

/**
 * Month-by-month big picture across every CTC level: openings received, positions
 * closed and placements split by Academy / Intensive / External. A job counts in
 * the month it was requested, like the rest of Insights.
 */
export function BigPicture({ from, to }: { from?: string | undefined; to?: string | undefined }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const range = toRange(from, to);
  const query = useQuery({
    queryKey: ["dashboard", "placement-kpis", range],
    queryFn: () => dashboardApi.getPlacementKpis(range),
    placeholderData: keepPreviousData,
  });

  if (query.isPending) return <Card><LoadingRows rows={4} /></Card>;
  if (query.error) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>;
  const { totals, monthly } = query.data.overview;
  // Oldest month first so the chart reads left to right in time.
  const chartRows = [...monthly].reverse();

  return (
    <section className="space-y-3" aria-label="Big picture">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Big picture · month by month</h2>
          <p className="text-xs text-slate-500">Every job at any CTC, in the month it was requested. A placement is a student the company selected, offered or who joined.</p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Chart or table">
          <Button size="sm" variant={view === "chart" ? "secondary" : "ghost"} onClick={() => setView("chart")} aria-pressed={view === "chart"}><ChartColumn size={14} /> Chart</Button>
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")} aria-pressed={view === "table"}><Table2 size={14} /> Table</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Openings received" value={totals.openings} hint={`${totals.jobRequests} job requests · ${totals.companies} companies`} icon={BriefcaseBusiness} />
        <KpiCard label="Positions closed" value={totals.positionsClosed} hint={`${pctText(totals.positionsClosedPct)} of openings`} icon={CircleCheckBig} tone="emerald" />
        <KpiCard label="Placements" value={totals.placements} hint="Selected, offered or joined" icon={Award} tone="sky" />
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Placements by category</p>
          <div className="mt-2 space-y-1.5">
            {CATEGORIES.map((category) => (
              <p key={category.key} className="flex items-center gap-2 text-sm text-slate-700">
                <i className="h-2.5 w-2.5 rounded-sm" style={{ background: category.color }} />{category.label}
                <span className="ml-auto font-semibold tabular-nums text-slate-900">{totals.placementsByCategory[category.key]}</span>
              </p>
            ))}
          </div>
        </Card>
      </div>

      {monthly.length === 0 ? <Card><EmptyState title="No job requests in this period" /></Card> : view === "chart" ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-800">Placements by category</p>
            <div className="mt-2"><Legend items={CATEGORIES} /></div>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid stroke="#eef1f6" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={shortMonth} {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip cursor={{ fill: "#f1f5f9" }} content={(props) => <MonthTooltip active={props.active} row={props.payload?.[0]?.payload as Row | undefined} label={props.label} kind="placements" />} />
                  {CATEGORIES.map((category, index) => (
                    <Bar key={category.key} dataKey={`placementsByCategory.${category.key}`} name={category.label} stackId="placements"
                      fill={category.color} stroke="#ffffff" strokeWidth={2} maxBarSize={44}
                      radius={index === CATEGORIES.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-800">Openings received and positions closed</p>
            <div className="mt-2"><Legend items={[{ label: "Openings received", color: OPENINGS_COLOR }, { label: "Positions closed", color: CLOSED_COLOR }]} /></div>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barGap={2} barCategoryGap="30%">
                  <CartesianGrid stroke="#eef1f6" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={shortMonth} {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip cursor={{ fill: "#f1f5f9" }} content={(props) => <MonthTooltip active={props.active} row={props.payload?.[0]?.payload as Row | undefined} label={props.label} kind="openings" />} />
                  <Bar dataKey="openings" name="Openings received" fill={OPENINGS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="positionsClosed" name="Positions closed" fill={CLOSED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Month</th>
                <th className="px-3 py-2 text-right">Job requests</th>
                <th className="px-3 py-2 text-right">Companies</th>
                <th className="px-3 py-2 text-right">Openings received</th>
                <th className="px-3 py-2 text-right">Positions closed</th>
                <th className="px-3 py-2 text-right">Placements</th>
                {CATEGORIES.map((category) => <th key={category.key} className="px-3 py-2 text-right">{category.label}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {monthly.map((row) => (
                <tr key={row.month} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{monthLabel(row.month)}</td>
                  <td className="px-3 py-2 text-right">{row.jobRequests}</td>
                  <td className="px-3 py-2 text-right">{row.companies}</td>
                  <td className="px-3 py-2 text-right">{row.openings}</td>
                  <td className="px-3 py-2 text-right">{row.positionsClosed} <span className="text-xs text-slate-400">{pctText(row.positionsClosedPct)}</span></td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">{row.placements}</td>
                  {CATEGORIES.map((category) => <td key={category.key} className="px-3 py-2 text-right">{row.placementsByCategory[category.key]}</td>)}
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold text-slate-900">
                <td className="px-4 py-2">Total</td>
                <td className="px-3 py-2 text-right">{totals.jobRequests}</td>
                <td className="px-3 py-2 text-right">{totals.companies}</td>
                <td className="px-3 py-2 text-right">{totals.openings}</td>
                <td className="px-3 py-2 text-right">{totals.positionsClosed} <span className="text-xs font-normal text-slate-400">{pctText(totals.positionsClosedPct)}</span></td>
                <td className="px-3 py-2 text-right">{totals.placements}</td>
                {CATEGORIES.map((category) => <td key={category.key} className="px-3 py-2 text-right">{totals.placementsByCategory[category.key]}</td>)}
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
