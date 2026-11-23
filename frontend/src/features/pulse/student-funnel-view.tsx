import { Briefcase, Download, ExternalLink, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../../components/states";
import { PoolBadge, ProductBadge } from "../../components/student-tags";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import type { MonthlyStudent } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";
import { TONE_CLASSES } from "../tracking/student-support";
import type { StudentView } from "./month-big-picture";
import { StudentDetailTable } from "./student-detail-table";
import { applicationEnded, uniquePositions, type BoardRow, type StudentPosition } from "./potential-board";
import { funnelUnits, matchesPick, stageCounts, type FunnelMode, type FunnelUnit, type Pick, type Stage, type StageCounts } from "./student-funnel";

export type StudentGroup = "ALL" | "ACADEMY" | "POOL" | "EXTERNAL";
export type OutcomeView = "ALL" | StudentView;

export const OUTCOME_LABELS: Record<OutcomeView, string> = {
  ALL: "Outcome: everyone",
  IN_PROCESS: "In company process",
  COMPLETED: "Completed process",
  SELECTED: "Selected",
  NOT_SHARED: "Not shared with company",
};
/** Same buckets as the big picture: a unique student's furthest point. */
const OUTCOME_POSITIONS: Record<StudentView, StudentPosition[]> = {
  IN_PROCESS: ["IN_PROCESS"],
  COMPLETED: ["SELECTED", "ENDED_NOT_SELECTED"],
  SELECTED: ["SELECTED"],
  NOT_SHARED: ["IN_SHORTLISTING", "REJECTED_INTERNALLY", "NOT_SHARED_DRIVE_OVER"],
};

const PICK_TEXT: Record<Pick["what"], string> = {
  reached: "reached", cleared: "cleared", rejected: "rejected at", noShow: "missed", waiting: "waiting at", ended: "stopped at (drive over)",
};
const STOP_TONE: Record<FunnelUnit["stop"]["kind"], string> = {
  selected: "text-emerald-700 font-medium", rejected: "text-rose-600", noShow: "text-orange-600", waiting: "text-sky-700", ended: "text-slate-500",
};
const toneClass = (tone: string) => TONE_CLASSES[tone as keyof typeof TONE_CLASSES] ?? TONE_CLASSES.slate;

/** Pick jobs on the list by company, role or job ID. Nothing ticked = every job in the grid. */
function JobPicker({ rows, selected, onChange }: { rows: BoardRow[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = rows.filter((row) => `${row.company} ${row.role} ${row.jobCode}`.toLowerCase().includes(q.toLowerCase()));
  const label = selected.length === 0 ? "All companies in the grid"
    : selected.length === 1 ? (() => { const row = rows.find((item) => item.jobRequestId === selected[0]); return row ? `${row.company} · ${row.role}` : "1 job"; })()
      : `${selected.length} jobs`;
  return (
    <Popover onOpenChange={(open) => !open && setQ("")}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 max-w-xs justify-start", selected.length > 0 && "border-indigo-300 bg-indigo-50/60 text-indigo-800")}>
          <Briefcase size={14} /> <span className="truncate">Company / job ID: {label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-2">
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Type company, role or paste job ID" className="h-8 pl-7 text-xs" />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {shown.map((row) => (
            <label key={row.jobRequestId} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 hover:bg-slate-50">
              <Checkbox className="mt-0.5" checked={selected.includes(row.jobRequestId)} onCheckedChange={() => onChange(selected.includes(row.jobRequestId) ? selected.filter((id) => id !== row.jobRequestId) : [...selected, row.jobRequestId])} />
              <span className="min-w-0 text-xs">
                <span className="font-medium text-slate-800">{row.company}</span> <span className="text-slate-500">· {row.role}</span>
                <span className="block font-mono text-[10px] text-slate-400">{row.jobCode}</span>
              </span>
            </label>
          ))}
          {shown.length === 0 && <p className="px-2 py-3 text-xs text-slate-400">No job on the list matches.</p>}
        </div>
        {selected.length > 0 && <Button size="sm" variant="ghost" className="mt-1 h-7 w-full text-xs text-rose-600" onClick={() => onChange([])}><X size={12} /> Show all companies</Button>}
      </PopoverContent>
    </Popover>
  );
}

function Count({ value, tone, active, onClick, title }: { value: number; tone?: string; active: boolean; onClick: () => void; title: string }) {
  if (value === 0) return <span className="text-slate-300 tabular-nums">0</span>;
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn("rounded px-1.5 py-0.5 tabular-nums hover:bg-slate-100 hover:underline", tone, active && "bg-indigo-100 ring-1 ring-indigo-300")}>
      {value}
    </button>
  );
}

function FunnelTable({ stages, counts, total, pick, onPick, unit }: { stages: Stage[]; counts: Map<string, StageCounts>; total: number; pick: Pick | null; onPick: (pick: Pick | null) => void; unit: string }) {
  const toggle = (next: Pick) => onPick(pick && pick.stage === next.stage && pick.what === next.what ? null : next);
  const isOn = (stage: string, what: Pick["what"]) => pick?.stage === stage && pick.what === what;
  let lastGroup = "";
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr className="[&_th]:border-b [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
            <th className="w-44 text-left">Stage</th>
            <th className="text-left">Reached (share of applied)</th>
            <th className="w-20 text-right">Reached</th>
            <th className="w-20 text-right text-emerald-700">Cleared</th>
            <th className="w-20 text-right text-rose-600">Rejected</th>
            <th className="w-20 text-right text-orange-600">No-show</th>
            <th className="w-20 text-right text-sky-700" title="Stopped here and still waiting for a result">Waiting</th>
            <th className="w-24 text-right text-slate-500" title="Stopped here and the drive is over">Drive over</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const count = counts.get(stage.key)!;
            const header = stage.group !== lastGroup ? (lastGroup = stage.group, stage.group) : null;
            const pct = total ? Math.round((count.reached / total) * 100) : 0;
            return [
              header && (
                <tr key={`${stage.key}-h`} className="bg-white">
                  <td colSpan={8} className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {header === "ours" ? "Our shortlisting" : header === "company" ? "Company process" : "Result"}
                  </td>
                </tr>
              ),
              <tr key={stage.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-2 py-1.5 font-medium text-slate-800">{stage.label}</td>
                <td className="px-2">
                  <button type="button" onClick={() => toggle({ stage: stage.key, what: "reached" })} className="flex w-full items-center gap-2" title={`Show ${unit} who reached ${stage.label.toLowerCase()}`}>
                    <span className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
                      <span className={cn("absolute inset-y-0 left-0 rounded", stage.group === "ours" ? "bg-indigo-200" : stage.group === "company" ? "bg-sky-200" : "bg-emerald-300")} style={{ width: `${pct}%` }} />
                      {count.cleared > 0 && stage.key !== "applied" && stage.key !== "selected" && (
                        <span className="absolute inset-y-0 left-0 rounded bg-emerald-400/50" style={{ width: `${total ? (count.cleared / total) * 100 : 0}%` }} />
                      )}
                    </span>
                    <span className="w-9 text-right text-xs tabular-nums text-slate-500">{pct}%</span>
                  </button>
                </td>
                <td className="px-2 text-right"><Count value={count.reached} active={isOn(stage.key, "reached")} onClick={() => toggle({ stage: stage.key, what: "reached" })} title="Reached this stage" tone="font-medium text-slate-800" /></td>
                <td className="px-2 text-right">{stage.key === "applied" ? <span className="text-slate-300">—</span> : <Count value={count.cleared} active={isOn(stage.key, "cleared")} onClick={() => toggle({ stage: stage.key, what: "cleared" })} title="Cleared this stage" tone="text-emerald-700" />}</td>
                <td className="px-2 text-right"><Count value={count.rejected} active={isOn(stage.key, "rejected")} onClick={() => toggle({ stage: stage.key, what: "rejected" })} title="Rejected here (and went no further)" tone="font-medium text-rose-600" /></td>
                <td className="px-2 text-right"><Count value={count.noShow} active={isOn(stage.key, "noShow")} onClick={() => toggle({ stage: stage.key, what: "noShow" })} title="Missed this stage" tone="text-orange-600" /></td>
                <td className="px-2 text-right"><Count value={count.waiting} active={isOn(stage.key, "waiting")} onClick={() => toggle({ stage: stage.key, what: "waiting" })} title="Stopped here, still waiting" tone="text-sky-700" /></td>
                <td className="px-2 text-right"><Count value={count.ended} active={isOn(stage.key, "ended")} onClick={() => toggle({ stage: stage.key, what: "ended" })} title="Stopped here and the drive is over" tone="text-slate-500" /></td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

const segmentText = (person: MonthlyStudent) => [person.academy ? "Academy" : null, person.inPool ? `Pool${person.tier ? ` ${person.tier}` : ""}` : null].filter(Boolean).join(" + ");
const NONE = "__none__";
const ANY = "__any__";

/**
 * Student funnel for the drives in the grid, narrowed to chosen companies /
 * job IDs: every stage with how many reached, cleared and were rejected, and
 * underneath the students behind any number with their reason tag and RSA.
 */
export function StudentFunnelView({ rows, mode, group, onGroup, jobs, onJobs, outcome, onOutcome }: {
  rows: BoardRow[]; mode: FunnelMode; group: StudentGroup; onGroup: (group: StudentGroup) => void; jobs: string[]; onJobs: (ids: string[]) => void;
  outcome: OutcomeView; onOutcome: (outcome: OutcomeView) => void;
}) {
  const jobKey = jobs.join("|");
  const [pick, setPick] = useState<Pick | null>(null);
  // A stage picked for one set of companies means nothing for another.
  useEffect(() => setPick(null), [jobKey, group, mode]);
  const [reason, setReason] = useState(ANY);
  const [rsa, setRsa] = useState(ANY);
  const [q, setQ] = useState("");
  const chosen = useMemo(() => (jobs.length ? rows.filter((row) => jobs.includes(row.jobRequestId)) : rows), [rows, jobKey]); // jobs is a new array each render
  const keep = (person: MonthlyStudent) => group === "ALL" || (group === "ACADEMY" ? person.academy : group === "POOL" ? person.inPool : !person.academy && !person.inPool);
  const { stages, units, facts } = useMemo(() => funnelUnits(chosen, mode, keep), [chosen, mode, group]); // keep depends only on group
  const counts = useMemo(() => stageCounts(stages, units), [stages, units]);
  const positions = useMemo(() => uniquePositions(chosen, keep), [chosen, group]);
  const over = new Map(chosen.map((row) => [row.jobRequestId, row.state === "ENDED"]));
  /** Which big-picture bucket a row falls in: by furthest point for students, by this application otherwise. */
  const inOutcome = (unit: FunnelUnit) => {
    if (outcome === "ALL") return true;
    if (mode === "unique") return OUTCOME_POSITIONS[outcome].includes(positions.get(unit.person.candidateId)!);
    const person = unit.person;
    const ended = applicationEnded(person, over.get(person.jobRequestId) ?? false);
    const bucket: StudentView = !person.shared ? "NOT_SHARED" : person.selected || ended ? "COMPLETED" : "IN_PROCESS";
    return outcome === "SELECTED" ? person.selected : bucket === outcome;
  };
  const unitWord = mode === "unique" ? "students" : "applications";

  const reasonOf = (unit: FunnelUnit) => unit.applications.find((person) => person.reason)?.reason ?? null;
  const rsaOf = (unit: FunnelUnit) => unit.applications.find((person) => person.rsa)?.rsa ?? null;
  const reasons = [...new Map(units.flatMap((unit) => unit.applications.map((person) => person.reason)).filter(Boolean).map((item) => [item!.id, item!.label])).entries()];
  const rsaStatuses = [...new Set(units.flatMap((unit) => unit.applications.map((person) => person.rsa?.status)).filter(Boolean))] as string[];

  const search = useDeferredValue(q);
  const list = useMemo(() => units.filter((unit) => matchesPick(unit, pick) && inOutcome(unit)
    && (reason === ANY || (reason === NONE ? !reasonOf(unit) : reasonOf(unit)?.id === reason))
    && (rsa === ANY || (rsa === NONE ? !rsaOf(unit) : rsaOf(unit)?.status === rsa))
    && (!search || `${unit.person.fullName} ${unit.person.userId ?? ""} ${unit.person.mobile ?? ""} ${unit.applications.map((person) => `${person.companyName} ${person.jobCode}`).join(" ")}`.toLowerCase().includes(search.toLowerCase())))
    .sort((x, y) => x.stop.index - y.stop.index || x.person.fullName.localeCompare(y.person.fullName)),
  [units, pick, outcome, reason, rsa, search, positions]); // the helpers read only these
  const pickedStage = pick ? stages.find((stage) => stage.key === pick.stage) : null;

  const download = () => downloadCsv(`student-funnel-${mode}`, [
    "Student", "Code", "Segment", "Product", mode === "unique" ? "Companies" : "Company", "Job ID", "Where they stopped", "Company round rejected", "Reason tag", "Tagged by", "Rejection note", "RSA status", "RSA report",
  ], list.map((unit) => {
    const why = reasonOf(unit);
    const support = rsaOf(unit);
    return [
      unit.person.fullName, unit.person.candidateCode, segmentText(unit.person), unit.person.product,
      mode === "unique" ? unit.applications.map((person) => person.companyName).join(" | ") : unit.person.companyName, unit.applications.map((person) => person.jobCode).join(" | "),
      unit.stop.label, unit.person.rejectedRound?.name ?? "", why?.label ?? "", why ? (why.fromRsa ? "RSA team" : "Company round") : "", unit.person.rejectionNote ?? "",
      support?.status ?? "", support?.reportUrl ?? "",
    ];
  }));

  return (
    <Card className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <JobPicker rows={rows} selected={jobs} onChange={onJobs} />
        <div className="flex rounded-md border border-slate-200 p-0.5" role="group" aria-label="Student group">
          {(["ALL", "ACADEMY", "POOL", "EXTERNAL"] as const).map((value) => (
            <Button key={value} size="sm" variant={group === value ? "secondary" : "ghost"} className="h-7" aria-pressed={group === value} onClick={() => onGroup(value)}>
              {value === "ALL" ? "Everyone" : value === "ACADEMY" ? "Academy" : value === "POOL" ? "Assessed pool" : "External"}
            </Button>
          ))}
        </div>
        <p className="ml-auto text-xs text-slate-500">
          {mode === "unique"
            ? <>Each student counted once across {chosen.length} job drives; "rejected" means rejected at their furthest point everywhere.</>
            : <>Every application on {chosen.length} job drives; a student in three companies counts three times.</>}
        </p>
      </div>

      {units.length === 0 ? <EmptyState title="No students on these job drives yet" className="py-10" /> : (
        <>
          {chosen.some((row) => row.stagesRun.length === 0) && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>No shortlisting by us</b> on {chosen.filter((row) => row.stagesRun.length === 0).map((row) => row.company).join(", ")}: no resume shortlist and no final shortlist sheet, so the company sheet alone decided who went ahead.
              Applicants there who are not in the company sheet show as "Not in company sheet", not as rejected by us.
            </p>
          )}
          <FunnelTable stages={stages} counts={counts} total={units.length} pick={pick} onPick={setPick} unit={unitWord} />

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-800">
                {pick && pickedStage ? <>{list.length} {unitWord} {PICK_TEXT[pick.what]} {pickedStage.label.toLowerCase()}</> : <>{outcome === "ALL" ? "All" : OUTCOME_LABELS[outcome]}: {list.length} {unitWord}</>}
              </p>
              {pick && <button type="button" onClick={() => setPick(null)} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800">Clear stage <X size={11} /></button>}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Select value={outcome} onValueChange={(value) => onOutcome(value as OutcomeView)}>
                  <SelectTrigger className={cn("h-8 w-48 text-xs", outcome !== "ALL" && "border-indigo-300 bg-indigo-50/50")} aria-label="Outcome"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(OUTCOME_LABELS) as OutcomeView[]).map((key) => <SelectItem key={key} value={key}>{OUTCOME_LABELS[key]}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className={cn("h-8 w-48 text-xs", reason !== ANY && "border-indigo-300 bg-indigo-50/50")} aria-label="Reason tag"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Reason tag: any</SelectItem>
                    <SelectItem value={NONE}>No reason tagged</SelectItem>
                    {reasons.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={rsa} onValueChange={setRsa}>
                  <SelectTrigger className={cn("h-8 w-44 text-xs", rsa !== ANY && "border-indigo-300 bg-indigo-50/50")} aria-label="RSA status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>RSA: any</SelectItem>
                    <SelectItem value={NONE}>RSA not started</SelectItem>
                    {rsaStatuses.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input className="h-8 w-52 pl-7 text-xs" placeholder="Name, user ID, mobile, company, job ID" value={q} onChange={(event) => setQ(event.target.value)} />
                </div>
                {mode === "unique" && <Button size="sm" variant="outline" className="h-8" disabled={list.length === 0} onClick={download}><Download size={14} /> CSV</Button>}
                <Link to="/rsa" className="text-xs font-medium text-indigo-700 hover:underline">Tag reasons / RSA →</Link>
              </div>
            </div>
            {mode === "applications" ? <StudentDetailTable units={list} stages={stages} rows={chosen} facts={facts} /> : (
            <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600">
                  <tr className="[&_th]:border-b [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                    <th>Student</th><th>{mode === "unique" ? "Companies" : "Company · job"}</th><th>Where they stopped</th><th>Reason tag</th><th>RSA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.slice(0, 500).map((unit) => {
                    const why = reasonOf(unit);
                    const support = rsaOf(unit);
                    return (
                      <tr key={unit.key} className="align-top hover:bg-slate-50/60">
                        <td className="px-3 py-2">
                          <Link to={`/candidates/${unit.person.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{unit.person.fullName}</Link>
                          <div className="mt-0.5 flex flex-wrap gap-1"><ProductBadge products={unit.person.product} /><PoolBadge source={unit.person.poolSource} /></div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(mode === "unique" ? unit.applications : [unit.person]).map((person) => (
                            <p key={person.applicationId}>
                              <Link to={`/job-requests/${person.jobRequestId}?tab=pipeline`} className="text-slate-800 hover:text-indigo-700">{person.companyName}</Link>
                              <span className="text-slate-400"> · {person.roleTitle}</span>
                            </p>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className={STOP_TONE[unit.stop.kind]}>{unit.stop.label}</span>
                          {mode === "unique" && unit.applications.length > 1 && <span className="block text-slate-400">best of {unit.applications.length} companies: {unit.person.companyName}</span>}
                          {unit.person.rounds.length > 0 && (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {unit.person.rounds.map((round) => (
                                <span key={round.name} className={cn("rounded px-1 text-[10px]", round.outcome === "CLEARED" ? "bg-emerald-50 text-emerald-700" : round.outcome === "REJECTED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600")}>
                                  {round.name}: {round.outcome.toLowerCase().replace("_", " ")}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {why ? (
                            <>
                              <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">{why.label}</span>
                              <span className="block pt-0.5 text-[10px] text-slate-400">{why.fromRsa ? "tagged by RSA team" : "from the company round"}</span>
                            </>
                          ) : unit.stop.kind === "rejected" && unit.stop.stage.group !== "ours" ? <span className="text-amber-700">Not tagged</span> : <span className="text-slate-300">—</span>}
                          {unit.person.rejectionNote && <p className="mt-0.5 line-clamp-2 text-slate-500" title={unit.person.rejectionNote}>{unit.person.rejectionNote}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {support ? (
                            <>
                              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px]", toneClass(support.tone))}>{support.status}</span>
                              {support.reportUrl && <a href={support.reportUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-indigo-700 hover:underline">Report <ExternalLink size={10} /></a>}
                              {support.summary && <p className="mt-0.5 line-clamp-2 text-slate-500" title={support.summary}>{support.summary}</p>}
                            </>
                          ) : <span className="text-slate-400">Not started</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {list.length === 0 && <EmptyState title="No students match" description="Click another number in the funnel or change the filters." className="py-8" />}
              {list.length > 500 && <p className="border-t border-slate-100 p-2 text-center text-xs text-slate-500">Showing the first 500 of {list.length}. Narrow the list, or download the CSV for all.</p>}
            </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
