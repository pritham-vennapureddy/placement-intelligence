import { POTENTIAL_COMPANY_STATUS_LABELS, POTENTIAL_COMPANY_STATUSES, type PotentialCompanyStatus } from "@placement/shared";
import { Briefcase, Building2, ClipboardList, GraduationCap, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/ui/card";
import { cn } from "../../utils/cn";
import { PROCESS_STATE_LABELS, type BoardSummary, type PositionCounts, type ProcessState, type Split } from "./potential-board";

const PROCESS: { key: ProcessState; dot: string; text: string }[] = [
  { key: "YET_TO_START", dot: "bg-amber-500", text: "text-amber-700" },
  { key: "STARTED", dot: "bg-sky-500", text: "text-sky-700" },
  { key: "ENDED", dot: "bg-slate-400", text: "text-slate-600" },
];

/** Furthest point, in order; each student is counted once. */
const POSITIONS = [
  { key: "IN_SHORTLISTING", label: "In our shortlisting", hint: "Not shared yet, on a drive that is still going", color: "#94a3b8" },
  { key: "NOT_SHARED_DRIVE_OVER", label: "Not shared, drive over", hint: "Never shared with the company and those drives have ended", color: "#cbd5e1" },
  { key: "REJECTED_INTERNALLY", label: "Rejected in our shortlisting", hint: "Rejected at resume shortlist, screening or assignment in every drive", color: "#f59e0b" },
  { key: "IN_PROCESS", label: "In company process", hint: "Shared and the company has not finished with them", color: "#0ea5e9" },
  { key: "ENDED_NOT_SELECTED", label: "Process completed, not selected", hint: "Rejected or dropped, or the company process is over", color: "#e0475b" },
  { key: "SELECTED", label: "Selected", hint: "Selected, offered or joined", color: "#16a34a" },
] as const;

export const STATUS_TONE: Record<PotentialCompanyStatus, string> = {
  POTENTIAL: "border-slate-200 bg-slate-50 text-slate-700",
  IN_DISCUSSION: "border-sky-200 bg-sky-50 text-sky-700",
  CONFIRMED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  PROCESS_STARTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ON_HOLD: "border-amber-200 bg-amber-50 text-amber-700",
  NO_RESPONSE: "border-orange-200 bg-orange-50 text-orange-700",
  DROPPED: "border-rose-200 bg-rose-50 text-rose-700",
};

export type StudentView = "IN_PROCESS" | "COMPLETED" | "SELECTED" | "NOT_SHARED";

export interface BigPictureActions {
  /** Narrow the grid to one process stage (Yet to start / In process / Ended). */
  onProcess: (state: ProcessState) => void;
  onCrmStatus: (status: PotentialCompanyStatus) => void;
  /** Open the students list for one group and outcome. */
  onStudents: (group: "ACADEMY" | "POOL", view: StudentView | "ALL") => void;
  activeProcess: string[] | undefined;
  activeCrmStatus: string[] | undefined;
}

function Tile({ icon: Icon, label, value, children }: { icon: typeof Building2; label: string; value: number; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"><Icon size={14} /> {label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {children}
    </div>
  );
}

function ProcessSplit({ counts, actions, unit }: { counts: Split; actions: BigPictureActions; unit: string }) {
  return (
    <ul className="mt-2 space-y-0.5 text-sm">
      {PROCESS.map((item) => {
        const on = actions.activeProcess?.includes(PROCESS_STATE_LABELS[item.key]);
        return (
          <li key={item.key}>
            <button type="button" onClick={() => actions.onProcess(item.key)}
              className={cn("-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-slate-50", on && "bg-indigo-50 ring-1 ring-indigo-200")}
              title={`Show only ${unit} ${PROCESS_STATE_LABELS[item.key].toLowerCase()}`}>
              <span className={cn("size-2 rounded-full", item.dot)} />
              <span className="text-slate-600">{PROCESS_STATE_LABELS[item.key]}</span>
              <span className={cn("ml-auto font-semibold tabular-nums", item.text)}>{counts[item.key]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StudentCard({ title, icon: Icon, counts, group, actions }: { title: string; icon: typeof GraduationCap; counts: PositionCounts; group: "ACADEMY" | "POOL"; actions: BigPictureActions }) {
  const completed = counts.SELECTED + counts.ENDED_NOT_SELECTED;
  const notShared = counts.IN_SHORTLISTING + counts.REJECTED_INTERNALLY + counts.NOT_SHARED_DRIVE_OVER;
  const box = "rounded-lg px-2 py-2.5 text-center transition hover:ring-2";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Icon size={15} /> {title}</p>
        <button type="button" onClick={() => actions.onStudents(group, "ALL")} className="text-xs text-slate-500 hover:text-indigo-700">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{counts.students}</span> unique students →
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => actions.onStudents(group, "IN_PROCESS")} className={cn(box, "bg-sky-50 hover:ring-sky-300")}>
          <p className="text-2xl font-semibold tabular-nums text-sky-700">{counts.IN_PROCESS}</p>
          <p className="text-[11px] font-medium text-sky-800">In company process</p>
        </button>
        <button type="button" onClick={() => actions.onStudents(group, "COMPLETED")} className={cn(box, "bg-emerald-50 hover:ring-emerald-300")}>
          <p className="text-2xl font-semibold tabular-nums text-emerald-700">{completed}</p>
          <p className="text-[11px] font-medium text-emerald-800">Completed process</p>
          <p className="text-[11px] text-emerald-700">{counts.SELECTED} selected</p>
        </button>
        <button type="button" onClick={() => actions.onStudents(group, "NOT_SHARED")} className={cn(box, "bg-slate-50 hover:ring-slate-300")}>
          <p className="text-2xl font-semibold tabular-nums text-slate-700">{notShared}</p>
          <p className="text-[11px] font-medium text-slate-600">Not shared with company</p>
        </button>
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
 * The potential list at a glance: companies and openings by process stage, CRM
 * status, and where unique Academy and assessed-pool students stand. Worked out
 * from the rows the grid is showing, so filters change every number here.
 */
export function MonthBigPictureCard({ summary, actions, filtered, totalDrives }: { summary: BoardSummary; actions: BigPictureActions; filtered: boolean; totalDrives: number }) {
  const statuses = POTENTIAL_COMPANY_STATUSES.filter((status) => (summary.byCrmStatus[status] ?? 0) > 0);
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <Tile icon={Building2} label="Potential companies" value={summary.companies.total}>
          <ProcessSplit counts={summary.companies} actions={actions} unit="companies" />
        </Tile>
        <Tile icon={Briefcase} label="Total openings" value={summary.openings.total}>
          <ProcessSplit counts={summary.openings} actions={actions} unit="openings" />
        </Tile>
        <Tile icon={ClipboardList} label="Job drives by CRM status" value={summary.drives.total}>
          {statuses.length === 0 ? <p className="mt-2 text-xs text-slate-400">None</p> : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {statuses.map((status) => (
                <button key={status} type="button" onClick={() => actions.onCrmStatus(status)}
                  className={cn("rounded-full border px-2 py-0.5 text-xs", STATUS_TONE[status], actions.activeCrmStatus?.includes(POTENTIAL_COMPANY_STATUS_LABELS[status]) && "ring-2 ring-indigo-400")}>
                  {POTENTIAL_COMPANY_STATUS_LABELS[status]} <b className="tabular-nums">{summary.byCrmStatus[status]}</b>
                </button>
              ))}
            </div>
          )}
          {filtered && <p className="mt-2 text-[11px] text-indigo-700">Filtered: {summary.drives.total} of {totalDrives} job drives</p>}
        </Tile>
      </div>
      <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">
        <StudentCard title="Academy students" icon={GraduationCap} counts={summary.academy} group="ACADEMY" actions={actions} />
        <StudentCard title="Assessed-pool students" icon={UserRoundCheck} counts={summary.pool} group="POOL" actions={actions} />
      </div>
      <ReasonsMini rows={summary.reasons} />
    </Card>
  );
}

/** Why Academy / pool students were not selected on these drives, as bars. */
function ReasonsMini({ rows }: { rows: BoardSummary["reasons"] }) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(0, ...rows.map((row) => row.total));
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Why students were not selected</p>
        <Link to="/rsa" className="text-xs text-indigo-600 hover:underline">Tag reasons on the RSA team page →</Link>
      </div>
      {total === 0 ? <p className="mt-1 text-xs text-slate-500">No student has been rejected on these drives yet.</p> : (
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
