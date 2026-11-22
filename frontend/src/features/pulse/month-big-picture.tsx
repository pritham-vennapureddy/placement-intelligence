import { Award, Briefcase, Building2, GraduationCap, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/ui/card";
import type { MonthBigPicture, StudentPositionCounts } from "../../types/pulse";
import { cn } from "../../utils/cn";

const PROCESS = [
  { key: "STARTED", label: "Process started", dot: "bg-sky-500", text: "text-sky-700" },
  { key: "YET_TO_START", label: "Yet to start", dot: "bg-amber-500", text: "text-amber-700" },
  { key: "ENDED", label: "Process ended", dot: "bg-slate-400", text: "text-slate-600" },
] as const;

/** Furthest point, in order; each student is counted once. */
const POSITIONS = [
  { key: "IN_SHORTLISTING", label: "In our shortlisting", hint: "Not shared yet, on a drive that is still going", color: "#94a3b8" },
  { key: "NOT_SHARED_DRIVE_OVER", label: "Not shared, drive over", hint: "Never shared with the company and those drives have ended", color: "#cbd5e1" },
  { key: "REJECTED_INTERNALLY", label: "Rejected in our shortlisting", hint: "Rejected at resume shortlist, screening or assignment in every drive", color: "#f59e0b" },
  { key: "IN_PROCESS", label: "In company process", hint: "Shared and the company has not finished with them", color: "#0ea5e9" },
  { key: "ENDED_NOT_SELECTED", label: "Process ended, not selected", hint: "Rejected or dropped, or the company process is over", color: "#e0475b" },
  { key: "SELECTED", label: "Selected", hint: "Selected, offered or joined", color: "#16a34a" },
] as const;

function Stat({ icon: Icon, label, value, children }: { icon: typeof Building2; label: string; value: number; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon size={14} /> {label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {children}
    </div>
  );
}

/** Builds a link to this month's page with the given tab and filter. */
export type MonthLink = (params: Record<string, string>) => string;

function Split({ counts, link }: { counts: { YET_TO_START: number; STARTED: number; ENDED: number }; link: MonthLink }) {
  return (
    <ul className="mt-2 space-y-0.5 text-xs">
      {PROCESS.map((item) => (
        <li key={item.key}>
          <Link to={link({ tab: "drives", process: item.key })} className="flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-slate-50" title={`Show drives: ${item.label.toLowerCase()}`}>
            <span className={cn("size-2 rounded-full", item.dot)} />
            <span className="text-slate-600">{item.label}</span>
            <span className={cn("ml-auto font-semibold tabular-nums", item.text)}>{counts[item.key]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StudentPicture({ title, icon: Icon, counts, group, link }: { title: string; icon: typeof GraduationCap; counts: StudentPositionCounts; group: "ACADEMY" | "POOL"; link: MonthLink }) {
  const ended = counts.SELECTED + counts.ENDED_NOT_SELECTED;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Icon size={15} /> {title}</p>
        <p className="text-xs text-slate-500"><span className="text-2xl font-semibold tabular-nums text-slate-900">{counts.students}</span> unique students</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Link to={link({ tab: "students", view: "IN_SHORTLISTING", group })} className="rounded-lg bg-slate-50 py-2 hover:ring-1 hover:ring-slate-300"><p className="text-lg font-semibold tabular-nums text-slate-700">{counts.IN_SHORTLISTING + counts.REJECTED_INTERNALLY + counts.NOT_SHARED_DRIVE_OVER}</p><p className="text-[11px] text-slate-500">Not shared with a company</p></Link>
        <Link to={link({ tab: "students", view: "IN_PROCESS", group })} className="rounded-lg bg-sky-50 py-2 hover:ring-1 hover:ring-sky-300" title="Open the list to prepare them"><p className="text-lg font-semibold tabular-nums text-sky-700">{counts.IN_PROCESS}</p><p className="text-[11px] text-sky-800">In company process →</p></Link>
        <div className="rounded-lg bg-emerald-50 py-2"><p className="text-lg font-semibold tabular-nums text-emerald-700">{ended}</p><p className="text-[11px] text-emerald-800">Process ended · {counts.SELECTED} selected</p></div>
      </div>
      {counts.students > 0 && (
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          {POSITIONS.map((item) => counts[item.key] > 0 && <span key={item.key} style={{ width: `${(counts[item.key] / counts.students) * 100}%`, background: item.color }} />)}
        </div>
      )}
      <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {POSITIONS.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5" title={item.hint}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: item.color }} />
            <span className="text-slate-600">{item.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-800">{counts[item.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The month at a glance: companies (CRM's potential list plus drives running),
 * whether their process started, openings, and where unique Academy and
 * assessed-pool students stand.
 */
export function MonthBigPictureCard({ data, placements, link }: { data: MonthBigPicture; placements: { total: number; academy: number; pool: number }; link: MonthLink }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Big picture</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Companies on CRM's potential list for this month plus drives running this month
          ({data.onList} on the list{data.notOnList > 0 ? `, ${data.notOnList} running but not on the list` : ""}{data.droppedFromList > 0 ? `; ${data.droppedFromList} dropped or not responding are left out` : ""}).
          Students count once, at the furthest point they reached.
        </p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat icon={Building2} label="Companies this month" value={data.companies.total}><Split counts={data.companies} link={link} /></Stat>
        <Stat icon={Briefcase} label="Openings" value={data.openings.total}><Split counts={data.openings} link={link} /></Stat>
        <Stat icon={Award} label="Placements (by hired date)" value={placements.total}>
          <p className="mt-2 text-xs text-slate-600">{placements.academy} Academy · {placements.pool} assessed pool</p>
          <p className="mt-0.5 text-xs text-slate-400">{data.drives.total} job drives · {data.drives.STARTED} running · {data.drives.YET_TO_START} yet to start · {data.drives.ENDED} ended</p>
        </Stat>
      </div>
      <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">
        <StudentPicture title="Academy students" icon={GraduationCap} counts={data.students.academy} group="ACADEMY" link={link} />
        <StudentPicture title="Assessed-pool students" icon={UserRoundCheck} counts={data.students.pool} group="POOL" link={link} />
      </div>
      <ReasonsMini rows={data.notSelectedReasons} />
    </Card>
  );
}

/** Why Academy / pool students were not selected this month, as bars. */
function ReasonsMini({ rows }: { rows: MonthBigPicture["notSelectedReasons"] }) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(0, ...rows.map((row) => row.total));
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Why students were not selected</p>
        <Link to="/rsa" className="text-xs text-indigo-600 hover:underline">Tag reasons on the RSA team page →</Link>
      </div>
      {total === 0 ? <p className="mt-1 text-xs text-slate-500">No student has been rejected on this month's drives yet.</p> : (
        <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
          {rows.map((row) => (
            <li key={row.tagId ?? "untagged"} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs" title={`${row.academy} Academy · ${row.pool} assessed pool`}>
              <span className={cn("truncate", row.tagId ? "text-slate-700" : "text-amber-700")}>{row.label}</span>
              <span className="h-2 rounded-full bg-slate-100" aria-hidden>
                <span className="block h-2 rounded-full" style={{ width: `${max ? Math.max(3, (row.total / max) * 100) : 0}%`, background: row.tagId ? "#e0475b" : "#d9a13b" }} />
              </span>
              <span className="text-right tabular-nums"><b>{row.total}</b> <span className="text-slate-400">{Math.round((row.total / total) * 100)}%</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
