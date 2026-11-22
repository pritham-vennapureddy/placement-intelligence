import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FileText, Settings2, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { ProductBadge } from "../../components/student-tags";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { usePermissions } from "../../hooks/use-permissions";
import { academyInsightsApi } from "../../services/tracking-api";
import type { AcademyFilters, CompanyReasons } from "../../types/academy";
import { downloadCsv } from "../../utils/csv";
import { ManageReasonsDialog } from "../pipeline/rejection-reason-fields";

const BAR = "#e0475b";
const UNTAGGED_KEY = "untagged";
const keyOf = (tagId: string | null) => tagId ?? UNTAGGED_KEY;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Company-round rejections grouped by the reason the team tagged: the main
 * reasons, where in the process they happen, which companies, and who.
 */
export function CompanyReasonsPanel({ filters }: { filters: AcademyFilters }) {
  const { can } = usePermissions();
  const [picked, setPicked] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const report = useQuery({
    queryKey: ["academy-insights", "company-reasons", filters, picked],
    queryFn: () => academyInsightsApi.companyReasons({ ...filters, tagId: picked ?? undefined }),
    placeholderData: keepPreviousData,
  });

  if (report.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (report.error) return <Card><ErrorState error={report.error} onRetry={() => void report.refetch()} /></Card>;
  const data = report.data;
  const pickedLabel = picked ? data.byTag.find((row) => keyOf(row.tagId) === picked)?.label : null;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Why companies rejected our students</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Every company-round rejection in these filters, by the reason the team picked when recording the result.{" "}
              {data.totals.rejections > 0 && <>{data.totals.tagged} of {data.totals.rejections} have a reason ({pct(data.totals.tagged, data.totals.rejections)}).</>}
            </p>
          </div>
          <div className="flex gap-2">
            {can("pipeline:write") && <Button size="sm" variant="outline" onClick={() => setManaging(true)}><Settings2 size={13} /> Edit reason list</Button>}
            <Button size="sm" variant="outline" disabled={data.byTag.length === 0} onClick={() => downloadReasons(data, filters)}><Download size={13} /> Download CSV</Button>
          </div>
        </div>
        {data.totals.rejections === 0 ? (
          <EmptyState icon={Tags} title="No company rejections in these filters" description="When a company rejects a student, record it on the job's Company pipeline tab and pick a reason. It shows up here." />
        ) : (
          <ReasonBars data={data} picked={picked} onPick={(key) => setPicked(picked === key ? null : key)} />
        )}
        {data.totals.untagged > 0 && (
          <p className="border-t border-amber-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-900">
            {data.totals.untagged} rejections have no reason yet. Open the job's Company pipeline tab, click the rejected round and pick a reason, or select several students and use “Record round result”.
          </p>
        )}
      </Card>

      {data.totals.rejections > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <BreakdownCard title="By round" description="Where in the company process each reason comes up."
            rows={data.byRound.map((row) => ({ group: row.round, key: keyOf(row.tagId), label: row.label, count: row.count }))} picked={picked} />
          <BreakdownCard title="By company" description="The reasons each company gave."
            rows={data.byCompany.map((row) => ({ group: `${row.companyName} · ${row.roleTitle}`, groupLink: `/job-requests/${row.jobRequestId}`, key: keyOf(row.tagId), label: row.label, count: row.count }))} picked={picked} />
        </div>
      )}

      {data.totals.rejections > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{pickedLabel ? `Students rejected for “${pickedLabel}”` : "Students rejected by companies"} ({data.students.length}{data.students.length === 1000 ? "+" : ""})</p>
            <p className="mt-0.5 text-xs text-slate-500">{pickedLabel ? "Click the reason again above to see everyone." : "Click a reason above to see only those students."}</p>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">Student</th><th className="px-3 py-2">Company · round</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Note</th><th className="px-3 py-2">Doc</th></tr>
              </thead>
              <tbody>
                {data.students.map((row) => (
                  <tr key={`${row.applicationId}-${row.roundName}`} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2">
                      <Link to={`/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.fullName}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1"><ProductBadge products={row.product} />{row.inPool && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">Assessed pool</span>}</div>
                    </td>
                    <td className="px-3 py-2 text-xs"><span className="font-medium text-slate-700">{row.companyName}</span><p className="text-slate-500">{row.roleTitle} · {row.roundName}</p></td>
                    <td className="px-3 py-2 text-xs"><span className={row.reason === "No reason tagged" ? "text-amber-700" : "text-rose-700"}>{row.reason}</span></td>
                    <td className="max-w-72 px-3 py-2 text-xs text-slate-600">{row.note ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-xs">{row.docUrl ? <a href={row.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline"><FileText size={12} /> Open</a> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ManageReasonsDialog open={managing} onOpenChange={setManaging} />
    </div>
  );
}

function ReasonBars({ data, picked, onPick }: { data: CompanyReasons; picked: string | null; onPick: (key: string) => void }) {
  const max = Math.max(0, ...data.byTag.map((row) => row.rejections));
  return (
    <ul className="divide-y divide-slate-100">
      {data.byTag.map((row) => {
        const key = keyOf(row.tagId);
        const active = picked === key;
        return (
          <li key={key}>
            <button type="button" onClick={() => onPick(key)}
              className={`grid w-full gap-2 px-4 py-2.5 text-left transition md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,14rem)] md:items-center ${active ? "bg-rose-50/70" : "hover:bg-slate-50"}`}>
              <span>
                <span className={`text-sm font-medium ${row.tagId ? "text-slate-800" : "text-amber-700"}`}>{row.label}</span>
                {row.removed && <span className="ml-1 text-[10px] text-slate-400">(removed from list)</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="h-2 w-full min-w-24 rounded-full bg-slate-100" aria-hidden>
                  <span className="block h-2 rounded-full" style={{ width: `${max > 0 ? Math.max(2, (row.rejections / max) * 100) : 0}%`, background: row.tagId ? BAR : "#d9a13b" }} />
                </span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums"><b className="text-slate-900">{row.rejections}</b> <span className="text-xs text-slate-400">{pct(row.rejections, data.totals.rejections)}</span></span>
              </span>
              <span className="text-xs tabular-nums text-slate-500">
                {row.students} {row.students === 1 ? "student" : "students"} · Academy {row.academy} · pool {row.pool}
                {(row.withNote > 0 || row.withDoc > 0) && <span className="block text-slate-400">{row.withNote} with notes · {row.withDoc} with docs</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BreakdownCard({ title, description, rows, picked }: {
  title: string; description: string; picked: string | null;
  rows: { group: string; groupLink?: string; key: string; label: string; count: number }[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { link?: string; total: number; reasons: { key: string; label: string; count: number }[] }>();
    for (const row of rows) {
      const entry = map.get(row.group) ?? { ...(row.groupLink ? { link: row.groupLink } : {}), total: 0, reasons: [] };
      entry.total += row.count;
      entry.reasons.push({ key: row.key, label: row.label, count: row.count });
      map.set(row.group, entry);
    }
    return [...map.entries()].filter(([, entry]) => !picked || entry.reasons.some((reason) => reason.key === picked));
  }, [rows, picked]);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
      <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        {groups.map(([group, entry]) => (
          <li key={group} className="px-4 py-2.5">
            <p className="flex items-baseline justify-between gap-2 text-sm">
              {entry.link ? <Link to={entry.link} className="font-medium text-slate-800 hover:text-indigo-700">{group}</Link> : <span className="font-medium text-slate-800">{group}</span>}
              <span className="text-xs tabular-nums text-slate-500">{entry.total} rejected</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {entry.reasons.map((reason) => (
                <span key={reason.key} className={`rounded-full px-2 py-0.5 text-[11px] ${picked === reason.key ? "bg-rose-600 text-white" : reason.key === UNTAGGED_KEY ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800"}`}>
                  {reason.label} · {reason.count}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function downloadReasons(data: CompanyReasons, filters: AcademyFilters) {
  downloadCsv(["company-rejection-reasons", filters.from, filters.to].filter(Boolean).join("-"),
    ["Student", "Candidate code", "Product", "Assessed pool", "Company", "Role", "Job ID", "Round", "Reason", "Note", "Doc link"],
    data.students.map((row) => [row.fullName, row.candidateCode, row.product ?? "", row.inPool ? "Yes" : "No", row.companyName, row.roleTitle, row.jobCode, row.roundName, row.reason, row.note, row.docUrl]));
}
