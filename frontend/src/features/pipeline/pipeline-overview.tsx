import type { PipelineStatus } from "@placement/shared";
import { X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import type { Nomination } from "../../types/workflow";
import { universalProductLabel } from "@placement/shared";

export type Segment = "ACADEMY" | "ACADEMY_INTENSIVE" | "EXTERNAL" | "UNKNOWN";
export const SEGMENT_LABELS: Record<Segment, string> = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Intensive", EXTERNAL: "External", UNKNOWN: "Product not known" };
const SEGMENTS: Segment[] = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL", "UNKNOWN"];
const SEGMENT_DOT: Record<Segment, string> = { ACADEMY: "bg-indigo-500", ACADEMY_INTENSIVE: "bg-orange-500", EXTERNAL: "bg-slate-500", UNKNOWN: "bg-slate-300" };

/** The product's category for this application, else the student's own category (same rule as Insights). */
export const segmentOf = (nomination: Nomination): Segment =>
  nomination.application.product?.category ?? nomination.application.candidate.category ?? "UNKNOWN";
export const productOf = (nomination: Nomination) => universalProductLabel(nomination.application.product?.name) ?? "Product not known";

const GROUPS: { key: string; label: string; statuses: PipelineStatus[]; tone: string }[] = [
  { key: "process", label: "In process", statuses: ["NOT_SUBMITTED", "IN_PROCESS", "ON_HOLD"], tone: "text-sky-700" },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"], tone: "text-rose-600" },
  { key: "selected", label: "Selected", statuses: ["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"], tone: "text-emerald-700" },
  { key: "joined", label: "Joined", statuses: ["JOINED"], tone: "text-emerald-800" },
  { key: "dropped", label: "Dropped / declined", statuses: ["DROPPED", "OFFER_DECLINED"], tone: "text-violet-700" },
];

export interface PipelineFilter { segment: Segment | "ALL"; product: string | "ALL" }

/** Nominated students by product (Academy / Intensive / External) and where they stand; click to filter the list. */
export function PipelineOverview({ nominations, filter, onFilter }: { nominations: Nomination[]; filter: PipelineFilter; onFilter: (filter: PipelineFilter) => void }) {
  if (nominations.length === 0) return null;
  const count = (rows: Nomination[], statuses: PipelineStatus[]) => rows.filter((row) => statuses.includes(row.pipelineStatus)).length;
  const rows = SEGMENTS.map((segment) => ({ segment, items: nominations.filter((nomination) => segmentOf(nomination) === segment) })).filter(({ items }) => items.length > 0);
  const filtered = filter.segment !== "ALL" || filter.product !== "ALL";
  const cell = (value: number, tone = "text-slate-800") => <span className={value ? `font-semibold ${tone}` : "text-slate-300"}>{value}</span>;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Overall picture</p>
          <p className="text-xs text-slate-500">Nominated students by Academy / Intensive / External and by product. Click a row or product to filter the list below.</p>
        </div>
        {filtered && (
          <Button size="sm" variant="outline" className="h-7" onClick={() => onFilter({ segment: "ALL", product: "ALL" })}>
            <X size={13} /> Clear filter
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Segment</th>
              <th className="px-3 py-2 text-right">Nominated</th>
              {GROUPS.map((group) => <th key={group.key} className="whitespace-nowrap px-3 py-2 text-right">{group.label}</th>)}
              <th className="whitespace-nowrap px-3 py-2 text-right">Selection rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ segment, items }) => {
              const active = filter.segment === segment;
              const selected = count(items, GROUPS[2]!.statuses);
              return (
                <tr key={segment} onClick={() => onFilter({ segment: active ? "ALL" : segment, product: "ALL" })}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${active ? "bg-indigo-50/70" : ""}`}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    <span className={`mr-2 inline-block size-2 rounded-full ${SEGMENT_DOT[segment]}`} />{SEGMENT_LABELS[segment]}
                  </td>
                  <td className="px-3 py-2 text-right">{cell(items.length)}</td>
                  {GROUPS.map((group) => <td key={group.key} className="px-3 py-2 text-right">{cell(count(items, group.statuses), group.tone)}</td>)}
                  <td className="px-3 py-2 text-right text-xs text-slate-500">{Math.round((selected / items.length) * 100)}%</td>
                </tr>
              );
            })}
            <tr onClick={() => onFilter({ segment: "ALL", product: "ALL" })} className="cursor-pointer border-t border-slate-200 bg-slate-50/60 font-semibold hover:bg-slate-100">
              <td className="px-4 py-2 text-slate-800">Total</td>
              <td className="px-3 py-2 text-right">{cell(nominations.length)}</td>
              {GROUPS.map((group) => <td key={group.key} className="px-3 py-2 text-right">{cell(count(nominations, group.statuses), group.tone)}</td>)}
              <td className="px-3 py-2 text-right text-xs text-slate-500">{Math.round((count(nominations, GROUPS[2]!.statuses) / nominations.length) * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
