import { JOB_TYPE_LABELS } from "@placement/shared";
import { format } from "date-fns";
import { Download, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../../components/states";
import { POOL_SOURCE_LABELS, productNames, type PoolSource } from "../../components/student-tags";
import { Button } from "../../components/ui/button";
import type { MonthlyStudent } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";
import { ColumnFilter, type SortDir } from "./column-filter";
import { applicationEnded, type BoardRow } from "./potential-board";
import type { FactsOf, FunnelUnit, Stage } from "./student-funnel";

const BLANK = "(blank)";
const OUTCOME_TEXT: Record<string, string> = { CLEARED: "Cleared", REJECTED: "Rejected", NO_SHOW: "No show", ON_HOLD: "On hold", SCHEDULED: "Scheduled" };
const TONE: Record<string, string> = {
  Cleared: "bg-emerald-50 text-emerald-700", Shared: "bg-emerald-50 text-emerald-700", Selected: "bg-emerald-100 text-emerald-800 font-semibold",
  Rejected: "bg-rose-50 text-rose-700", "No show": "bg-orange-50 text-orange-700", "Not shared": "bg-amber-50 text-amber-800",
  Pending: "bg-sky-50 text-sky-700", Scheduled: "bg-sky-50 text-sky-700", "On hold": "bg-amber-50 text-amber-700", "Not cleared": "bg-slate-100 text-slate-600",
};

interface DetailColumn {
  key: string;
  label: string;
  /** Text used for filtering, sorting and the CSV. */
  value: (person: MonthlyStudent, unit: FunnelUnit) => string;
  render?: (person: MonthlyStudent, unit: FunnelUnit) => ReactNode;
  filter?: boolean;
  numeric?: boolean;
  className?: string;
  /** A stage column: shown as a coloured outcome. */
  stage?: boolean;
}

const poolTag = (person: MonthlyStudent) => (person.poolSource ? POOL_SOURCE_LABELS[person.poolSource as PoolSource].replace("Assessed pool · ", "") : "");
const userId = (person: MonthlyStudent) => person.userId ?? "";

/**
 * Every application on the chosen drives, one row each (a student in three
 * companies shows three times), with the student's details and the result of
 * every stage of our process and the company's. Each column filters like Excel.
 */
export function StudentDetailTable({ units, stages, rows, facts }: { units: FunnelUnit[]; stages: Stage[]; rows: BoardRow[]; facts: FactsOf }) {
  const [filters, setFilters] = useState<Record<string, string[] | undefined>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const [limit, setLimit] = useState(500);

  const jobs = useMemo(() => new Map(rows.map((row) => [row.jobRequestId, row])), [rows]);
  const columns = useMemo<DetailColumn[]>(() => {
    const stageText = (person: MonthlyStudent, stage: Stage) => {
      const fact = facts(person, stage.key);
      const over = applicationEnded(person, jobs.get(person.jobRequestId)?.state === "ENDED");
      if (stage.key === "shared") return fact.rejected ? "Rejected" : person.shared ? "Shared" : fact.reached ? "Not shared" : "";
      // Students added from the company sheet never went through our shortlisting.
      if (person.fromCompanySheet && stage.group === "ours") return "Did not apply";
      if (fact.rejected) return "Rejected";
      if (fact.noShow) return "No show";
      if (fact.cleared) return "Cleared";
      if (fact.reached) return over ? "Not cleared" : "Pending";
      return "";
    };
    // Company rounds by position in each job (round 1, 2, …), named when every job agrees.
    const maxRounds = Math.max(0, ...rows.map((row) => row.drive?.rounds.length ?? 0));
    const roundColumns: DetailColumn[] = Array.from({ length: maxRounds }, (_, index) => {
      const names = new Set(rows.map((row) => row.drive?.rounds[index]?.name).filter(Boolean));
      const label = names.size === 1 ? [...names][0]! : `Company round ${index + 1}`;
      const named = names.size !== 1;
      const value = (person: MonthlyStudent) => {
        const round = jobs.get(person.jobRequestId)?.drive?.rounds[index];
        if (!round) return "";
        const outcome = person.rounds.find((item) => item.name === round.name)?.outcome;
        const text = outcome ? OUTCOME_TEXT[outcome] ?? outcome : "";
        return text && named ? `${round.name}: ${text}` : text;
      };
      return { key: `round${index}`, label, value, filter: true, stage: true };
    });
    const internal = stages.filter((stage) => (stage.group === "ours" && stage.key !== "applied") || stage.key === "shared");
    return [
      { key: "company", label: "Company name", value: (person) => person.companyName, filter: true, className: "font-medium text-slate-900",
        render: (person) => <Link to={`/job-requests/${person.jobRequestId}?tab=pipeline`} className="font-medium text-slate-900 hover:text-indigo-700">{person.companyName}</Link> },
      { key: "role", label: "Role", value: (person) => person.roleTitle, filter: true, className: "max-w-[180px] truncate" },
      { key: "ctc", label: "CTC", value: (person) => (person.ctcLpa === null ? "" : `${person.ctcLpa} LPA`), filter: true, numeric: true },
      { key: "requestDate", label: "Job requested date", value: (person) => jobs.get(person.jobRequestId)?.requestDate ?? "", filter: true,
        render: (person) => { const date = jobs.get(person.jobRequestId)?.requestDate; return date ? format(new Date(`${date}T00:00:00`), "d MMM yy") : null; } },
      { key: "jobType", label: "Job type", value: (person) => (person.jobType ? JOB_TYPE_LABELS[person.jobType] : ""), filter: true },
      { key: "userId", label: "User ID", value: userId, className: "font-mono text-[10px] text-slate-500" },
      { key: "name", label: "Student name", value: (person) => person.fullName,
        render: (person) => <Link to={`/candidates/${person.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{person.fullName}</Link> },
      { key: "tag", label: "Tag", value: poolTag, filter: true,
        render: (person) => poolTag(person) ? <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-800">{poolTag(person)}</span> : null },
      { key: "product", label: "Product", value: (person) => productNames(person.product).join(", "), filter: true },
      { key: "yog", label: "Year of graduation", value: (person) => (person.yog ? String(person.yog) : ""), filter: true, numeric: true },
      { key: "mobile", label: "Mobile number", value: (person) => person.mobile ?? "", className: "font-mono text-[11px]" },
      { key: "email", label: "Email", value: (person) => person.email ?? "", className: "max-w-[200px] truncate" },
      { key: "college", label: "College name", value: (person) => person.college ?? "", filter: true, className: "max-w-[220px] truncate" },
      { key: "cameVia", label: "Came via", value: (person) => (person.fromCompanySheet ? "Company sheet (did not apply)" : "Applied"), filter: true,
        render: (person) => person.fromCompanySheet ? <span className="rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700">Company sheet (did not apply)</span> : <span className="text-slate-500">Applied</span> },
      ...internal.map((stage) => ({ key: `stage:${stage.key}`, label: stage.label, value: (person: MonthlyStudent) => stageText(person, stage), filter: true, stage: true })),
      ...roundColumns,
      { key: "result", label: "Selected", value: (person) => (person.selected ? "Selected" : ""), filter: true, stage: true },
      { key: "stop", label: "Where they stopped", value: (_, unit) => unit.stop.label, filter: true, className: "min-w-[200px]" },
      { key: "reason", label: "Reason tag", value: (person) => person.reason?.label ?? "", filter: true,
        render: (person) => person.reason ? <span className="rounded-full bg-rose-50 px-1.5 py-px text-[10px] font-medium text-rose-700" title={person.reason.fromRsa ? "Tagged by RSA team" : "From the company round"}>{person.reason.label}</span> : null },
      { key: "rsa", label: "RSA", value: (person) => person.rsa?.status ?? "", filter: true,
        render: (person) => person.rsa ? (person.rsa.reportUrl ? <a href={person.rsa.reportUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{person.rsa.status}</a> : person.rsa.status) : null },
    ];
  }, [stages, rows, jobs, facts]);

  // Every cell's text, worked out once per data change; filters, sorting and the CSV read from it.
  const texts = useMemo(() => new Map(units.map((unit) => [unit.key, columns.map((column) => column.value(unit.person, unit))])), [units, columns]);
  const textOf = (unit: FunnelUnit, index: number) => texts.get(unit.key)![index]!;
  const activeFilters = columns.map((column, index) => ({ index, key: column.key, allowed: filters[column.key] })).filter((item) => item.allowed && item.allowed.length > 0);
  const filtered = (except?: string) => units.filter((unit) => activeFilters.every(({ index, key, allowed }) => key === except || allowed!.includes(textOf(unit, index) || BLANK)));
  const visible = useMemo(() => {
    const list = filtered();
    const index = sort ? columns.findIndex((item) => item.key === sort.key) : -1;
    if (index < 0 || !sort) return list;
    const numeric = columns[index]!.numeric;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((x, y) => {
      const a = textOf(x, index);
      const b = textOf(y, index);
      if (!a !== !b) return a ? -1 : 1; // blanks last
      return (numeric ? (parseFloat(a) || 0) - (parseFloat(b) || 0) : a.localeCompare(b)) * sign;
    });
  }, [texts, filters, sort]); // texts covers units and columns
  const valuesFor = (column: DetailColumn) => {
    const index = columns.indexOf(column);
    const counts = new Map<string, number>();
    for (const unit of filtered(column.key)) { const value = textOf(unit, index) || BLANK; counts.set(value, (counts.get(value) ?? 0) + 1); }
    return [...counts].map(([value, count]) => ({ value, count }))
      .sort((x, y) => Number(x.value === BLANK) - Number(y.value === BLANK) || (column.numeric ? (parseFloat(x.value) || 0) - (parseFloat(y.value) || 0) : x.value.localeCompare(y.value)));
  };
  const active = columns.filter((column) => filters[column.key]?.length);
  const download = () => downloadCsv("student-funnel-applications", columns.map((column) => column.label), visible.map((unit) => texts.get(unit.key)!));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-500"><b className="text-slate-800">{visible.length}</b> applications{visible.length !== units.length ? ` of ${units.length}` : ""} · a student in several companies shows once per company</p>
        {active.map((column) => (
          <button key={column.key} type="button" onClick={() => setFilters((current) => ({ ...current, [column.key]: undefined }))}
            className="inline-flex max-w-xs items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">
            <span className="truncate"><b className="font-medium">{column.label}:</b> {filters[column.key]!.join(", ")}</span><X size={11} className="shrink-0" />
          </button>
        ))}
        {active.length > 0 && <button type="button" onClick={() => setFilters({})} className="text-xs font-medium text-rose-600 hover:underline">Clear column filters</button>}
        <Button size="sm" variant="outline" className="ml-auto h-8" disabled={visible.length === 0} onClick={download}><Download size={14} /> CSV ({visible.length})</Button>
      </div>
      <div className="max-h-[640px] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-slate-50">
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} className={cn("whitespace-nowrap border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-600", column.stage && "bg-sky-50/60", index === 0 && "sticky left-0 z-30 bg-slate-50")}>
                  <ColumnFilter
                    title={column.label}
                    values={column.filter ? () => valuesFor(column) : []}
                    selected={filters[column.key]}
                    onChange={(next) => setFilters((current) => ({ ...current, [column.key]: next }))}
                    sort={sort?.key === column.key ? sort.dir : null}
                    onSort={(dir) => setSort(dir ? { key: column.key, dir } : null)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map((unit) => (
              <tr key={unit.key} className="group hover:bg-indigo-50/30">
                {columns.map((column, index) => {
                  const text = textOf(unit, index);
                  const outcome = text.includes(": ") ? text.split(": ").pop()! : text;
                  return (
                    <td key={column.key} className={cn("whitespace-nowrap border-b border-slate-100 px-2 py-1.5 text-slate-700", column.className, index === 0 && "sticky left-0 z-10 bg-white group-hover:bg-indigo-50/30")} title={text || undefined}>
                      {column.render ? column.render(unit.person, unit)
                        : column.stage ? (text ? <span className={cn("rounded px-1.5 py-px text-[11px]", TONE[outcome] ?? "bg-slate-100 text-slate-600")}>{text}</span> : <span className="text-slate-300">—</span>)
                          : text || <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <EmptyState title="No applications match" description="Change a column filter or click another number in the funnel." className="py-8" />}
        {visible.length > limit && (
          <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-2 text-xs text-slate-500">
            Showing {limit} of {visible.length}.
            <Button size="sm" variant="outline" className="h-7" onClick={() => setLimit(visible.length)}>Show all</Button>
            <span>or download the CSV.</span>
          </div>
        )}
      </div>
    </div>
  );
}
