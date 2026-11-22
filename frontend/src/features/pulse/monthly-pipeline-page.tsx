import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  companyProcessLabel,
  nextMonthKey,
  PIPELINE_STATUS_LABELS,
  POTENTIAL_COMPANY_STATUS_LABELS,
  POTENTIAL_COMPANY_STATUSES,
  type PotentialCompanyStatus,
} from "@placement/shared";
import { format } from "date-fns";
import { ArrowRightLeft, Award, BriefcaseBusiness, Building2, CalendarClock, Download, GraduationCap, History, Pencil, Plus, Rocket, Trash2, UserRoundCheck } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormField } from "../../components/form-field";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { catalogApi } from "../../services/api";
import { monthlyPipelineApi } from "../../services/pulse-api";
import { guidanceApi } from "../../services/tracking-api";
import type { GuidanceJobOption } from "../../types/tracking";
import type { DriveStages, DriveStepCounts, MonthlyPipeline, MonthlyStudent, MonthlyStudentGroup, PipelineEntry } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";
import { PoolBadge, ProductBadge } from "../../components/student-tags";

const currentMonth = () => format(new Date(), "yyyy-MM");
const monthText = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMMM yyyy");
const shortMonth = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yy");
const dateText = (value: string | null) => (value ? format(new Date(`${value}T00:00:00`), "d MMM") : "—");
const NONE = "__none__";

const STATUS_TONE: Record<PotentialCompanyStatus, string> = {
  POTENTIAL: "border-slate-200 bg-slate-50 text-slate-700",
  IN_DISCUSSION: "border-sky-200 bg-sky-50 text-sky-700",
  CONFIRMED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  PROCESS_STARTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ON_HOLD: "border-amber-200 bg-amber-50 text-amber-700",
  NO_RESPONSE: "border-orange-200 bg-orange-50 text-orange-700",
  DROPPED: "border-rose-200 bg-rose-50 text-rose-700",
};

function StatusBadge({ status }: { status: PotentialCompanyStatus }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap text-[11px]", STATUS_TONE[status])}>{POTENTIAL_COMPANY_STATUS_LABELS[status]}</Badge>;
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["monthly-pipeline"] });
}

/** Add (by job ID) or edit one job drive on the month's potential list. */
function EntryDialog({ month, entry, open, onOpenChange }: { month: string; entry: PipelineEntry | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh();
  const [jobSearch, setJobSearch] = useState("");
  const [job, setJob] = useState<GuidanceJobOption | null>(null);
  const [status, setStatus] = useState<PotentialCompanyStatus>("POTENTIAL");
  const [note, setNote] = useState("");
  const [openings, setOpenings] = useState("");
  const [startDate, setStartDate] = useState("");
  const [crmOwnerId, setCrmOwnerId] = useState(NONE);
  const [remarks, setRemarks] = useState("");
  useEffect(() => {
    if (!open) return;
    setJobSearch("");
    setJob(null);
    setStatus(entry?.status ?? "POTENTIAL");
    setNote("");
    setOpenings(entry?.expectedOpenings ? String(entry.expectedOpenings) : "");
    setStartDate(entry?.expectedStartDate ?? "");
    setCrmOwnerId(entry?.crmOwner?.id ?? NONE);
    setRemarks(entry?.remarks ?? "");
  }, [open, entry]);

  const search = useDebouncedValue(jobSearch.trim(), 300);
  const jobs = useQuery({ queryKey: ["guidance", "jobs", search], queryFn: () => guidanceApi.searchJobs(search), enabled: open && !entry && !job });
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: open, staleTime: 300_000 });

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        expectedOpenings: openings ? Number(openings) : null,
        expectedStartDate: startDate || null,
        crmOwnerId: crmOwnerId === NONE ? null : crmOwnerId,
        remarks: remarks.trim() || null,
      };
      if (entry) await monthlyPipelineApi.update(entry.id, { ...fields, status, ...(note.trim() ? { note: note.trim() } : {}) });
      else await monthlyPipelineApi.create({ month, jobRequestId: job!.id, status, ...fields });
    },
    onSuccess: async () => { await refresh(); toast.success(entry ? "Entry updated" : "Added to the list"); onOpenChange(false); },
  });
  const statusChanged = entry && status !== entry.status;

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? entry.company.name : "Add to the potential list"}</DialogTitle>
          <DialogDescription>{monthText(month)} · CRM potential list{entry?.carriedFrom ? ` · carried from ${monthText(entry.carriedFrom.month)}` : ""}</DialogDescription>
        </DialogHeader>
        <form id="entry-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          {entry ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:col-span-2">
              <p className="font-medium text-slate-800">{entry.jobRequest.roleTitle}</p>
              <p className="font-mono text-xs text-slate-500">Job ID {entry.jobRequest.jobId} · {entry.jobRequest.openings} openings</p>
            </div>
          ) : job ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm sm:col-span-2">
              <div>
                <p className="font-medium text-slate-900">{job.company.name} · {job.roleTitle}</p>
                <p className="font-mono text-xs text-slate-500">Job ID {job.jobId}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setJob(null)}>Change</Button>
            </div>
          ) : (
            <FormField id="entry-job-search" label="Job ID" required hint="Paste the job ID (or type the company or role) and pick the job request." className="sm:col-span-2">
              <Input id="entry-job-search" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="e.g. 98edf8f6" autoFocus />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {jobs.isPending ? <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>
                  : (jobs.data ?? []).length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">No job request found. Create the job request first, then add it here.</p>
                    : (jobs.data ?? []).map((option) => (
                      <button key={option.id} type="button" onClick={() => setJob(option)} className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50">
                        <span className="text-sm font-medium text-slate-800">{option.company.name} · {option.roleTitle}</span>
                        <span className="block font-mono text-[11px] text-slate-400">{option.jobId}</span>
                      </button>
                    ))}
              </div>
            </FormField>
          )}
          <FormField id="entry-status" label="Status" required>
            <Select value={status} onValueChange={(value) => setStatus(value as PotentialCompanyStatus)}>
              <SelectTrigger id="entry-status"><SelectValue /></SelectTrigger>
              <SelectContent>{POTENTIAL_COMPANY_STATUSES.map((value) => <SelectItem key={value} value={value}>{POTENTIAL_COMPANY_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="entry-owner" label="CRM owner">
            <Select value={crmOwnerId} onValueChange={setCrmOwnerId}>
              <SelectTrigger id="entry-owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {(owners.data ?? []).map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          {entry && (
            <FormField id="entry-note" label={statusChanged ? "Why the status changed" : "Add an update (optional)"} hint="Saved to the history, so the month shows what moved and why." className="sm:col-span-2">
              <Input id="entry-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="e.g. HR confirmed drive dates on call" />
            </FormField>
          )}
          <FormField id="entry-openings" label="Expected openings" hint="Leave blank to use the job's openings.">
            <Input id="entry-openings" type="number" min={1} max={10000} value={openings} onChange={(event) => setOpenings(event.target.value)} />
          </FormField>
          <FormField id="entry-start" label="Expected process start">
            <Input id="entry-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </FormField>
          <FormField id="entry-remarks" label="Remarks" className="sm:col-span-2">
            <Textarea id="entry-remarks" rows={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Where things stand with the company" />
          </FormField>
        </form>
        {entry && entry.history.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><History size={13} /> History</p>
            <ol className="grid max-h-48 gap-2 overflow-y-auto">
              {entry.history.map((item) => (
                <li key={item.id} className="text-xs text-slate-600">
                  <span className="text-slate-400">{format(new Date(item.changedAt), "d MMM, HH:mm")}</span> · {item.changedBy.fullName}:{" "}
                  {item.fromStatus && item.fromStatus !== item.toStatus ? <>{POTENTIAL_COMPANY_STATUS_LABELS[item.fromStatus]} → </> : null}
                  <strong className="font-medium text-slate-800">{POTENTIAL_COMPANY_STATUS_LABELS[item.toStatus]}</strong>
                  {item.note && <> — “{item.note}”</>}
                </li>
              ))}
            </ol>
          </div>
        )}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="entry-form" disabled={save.isPending || (!entry && !job)}>{save.isPending ? "Saving…" : entry ? "Save" : "Add to list"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PotentialList({ data }: { data: MonthlyPipeline }) {
  const refresh = useRefresh();
  const [filter, setFilter] = useState<PotentialCompanyStatus | "ALL">("ALL");
  const [editing, setEditing] = useState<PipelineEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PipelineEntry | null>(null);
  const [carryOpen, setCarryOpen] = useState(false);
  const { entries, summary } = data.potential;
  const rows = filter === "ALL" ? entries : entries.filter((entry) => entry.status === filter);
  const next = nextMonthKey(data.month);
  const carriable = entries.filter((entry) => !entry.carriedTo && !["DROPPED", "NO_RESPONSE"].includes(entry.status)).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Potential companies · {monthText(data.month)}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            CRM's list for the month. {summary.newThisMonth} new, {summary.carriedIn} carried in from earlier months, {summary.droppedOrNoResponse} dropped / no response, {summary.carriedOut} carried on to {monthText(next)}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCarryOpen(true)} disabled={carriable === 0} title="Copy the still-active companies to next month's list">
            <ArrowRightLeft size={14} /> Carry to {shortMonth(next)} ({carriable})
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add by job ID</Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter("ALL")} className={cn("rounded-full border px-2.5 py-1 text-xs", filter === "ALL" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600")}>All {entries.length}</button>
        {POTENTIAL_COMPANY_STATUSES.filter((status) => summary.byStatus[status] > 0).map((status) => (
          <button key={status} type="button" onClick={() => setFilter(status)} className={cn("rounded-full border px-2.5 py-1 text-xs", filter === status ? "ring-2 ring-indigo-400" : "", STATUS_TONE[status])}>
            {POTENTIAL_COMPANY_STATUS_LABELS[status]} {summary.byStatus[status]}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={Building2} title="No companies on this month's list yet" description="Add the companies CRM is talking to this month, or carry last month's active ones forward from the previous month." className="py-8" />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-3 font-medium">Company</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">CRM owner</th><th className="pr-3 font-medium">Expected start</th><th className="pr-3 font-medium">Openings</th><th className="pr-3 font-medium">On list since</th><th className="pr-3 font-medium">Remarks / last update</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((entry) => {
                const last = entry.history[0];
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-slate-900">{entry.company.name}</p>
                      {entry.jobRequest ? (
                        <Link to={`/job-requests/${entry.jobRequest.id}?tab=notes`} className="text-xs text-indigo-700 hover:underline">
                          {entry.jobRequest.roleTitle} · {companyProcessLabel(entry.jobRequest.processPhase, entry.jobRequest.processRound?.name)}
                          <span className="block font-mono text-[10px] text-slate-400">{entry.jobRequest.jobId}</span>
                        </Link>
                      ) : entry.roleHint ? <p className="text-xs text-slate-500">{entry.roleHint}</p> : <p className="text-xs text-slate-400">No job request yet</p>}
                    </td>
                    <td className="pr-3 pt-2.5"><StatusBadge status={entry.status} /></td>
                    <td className="pr-3 pt-2.5 text-slate-600">{entry.crmOwner?.fullName ?? "—"}</td>
                    <td className="pr-3 pt-2.5 text-slate-600">{dateText(entry.expectedStartDate ?? entry.jobRequest?.companyProcessStartDate ?? null)}</td>
                    <td className="pr-3 pt-2.5 tabular-nums text-slate-600">{entry.expectedOpenings ?? entry.jobRequest.openings}</td>
                    <td className="pr-3 pt-2.5 text-xs text-slate-600">
                      {monthText(entry.firstListedMonth)}
                      {entry.firstListedMonth !== data.month && <span className="block text-amber-700">pending since {shortMonth(entry.firstListedMonth)}</span>}
                      {entry.carriedTo && <span className="block text-slate-400">carried to {shortMonth(entry.carriedTo.month)}</span>}
                    </td>
                    <td className="max-w-xs pr-3 pt-2.5 text-xs text-slate-600">
                      {entry.remarks && <p className="line-clamp-2 whitespace-pre-wrap">{entry.remarks}</p>}
                      {last?.note && <p className="mt-0.5 line-clamp-1 text-slate-400">{format(new Date(last.changedAt), "d MMM")}: {last.note}</p>}
                    </td>
                    <td className="whitespace-nowrap pt-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit" onClick={() => setEditing(entry)}><Pencil size={13} /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600" aria-label="Remove" onClick={() => setDeleting(entry)}><Trash2 size={13} /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <EntryDialog month={data.month} entry={editing} open={adding || editing !== null} onOpenChange={(open) => { if (!open) { setAdding(false); setEditing(null); } }} />
      <ConfirmDialog
        open={carryOpen}
        onOpenChange={setCarryOpen}
        title={`Carry ${carriable} companies to ${monthText(next)}?`}
        description="Every company still active this month (not dropped, no response, or already carried) is copied to next month's list with its status, owner and remarks. This month's list stays as it is."
        confirmLabel="Carry forward"
        onConfirm={async () => {
          const result = await monthlyPipelineApi.carryForward(data.month);
          await refresh();
          toast.success(`${result.carried} carried to ${monthText(result.toMonth)}${result.skipped ? `, ${result.skipped} already there` : ""}`);
          setCarryOpen(false);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove from this month's list?"
        description={deleting ? <>Removes <strong>{deleting.company.name}</strong> from {monthText(data.month)} only, with its history for this month. To record that the company backed out, set the status to Dropped instead.</> : ""}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await monthlyPipelineApi.remove(deleting.id);
          await refresh();
          toast.success("Removed from the list");
          setDeleting(null);
        }}
      />
    </Card>
  );
}

/** One drive's student journey: each step and each of the company's rounds, Academy / pool / everyone. */
function DriveStagesTable({ stages }: { stages: DriveStages }) {
  const groups = [
    { key: "academy", label: "Academy" },
    { key: "pool", label: "Assessed pool" },
    { key: "all", label: "All students" },
  ] as const;
  const steps: { label: string; value: (counts: DriveStepCounts) => number; tone?: string }[] = [
    { label: "Applied", value: (counts) => counts.applied },
    { label: "Rejected in our shortlisting", value: (counts) => counts.internalRejected, tone: "text-rose-600" },
    { label: "Made our final shortlist", value: (counts) => counts.finalShortlisted },
    { label: "Shared with company", value: (counts) => counts.shared },
    { label: "Got an interview", value: (counts) => counts.interviewed },
  ];
  const outcomes: typeof steps = [
    { label: "Still in company process", value: (counts) => counts.inProcess },
    { label: "Rejected by company", value: (counts) => counts.companyRejected, tone: "text-rose-600" },
    { label: "Selected", value: (counts) => counts.selected, tone: "font-semibold text-emerald-700" },
  ];
  const stepRow = (step: (typeof steps)[number]) => (
    <tr key={step.label}>
      <td className="py-1 pr-3 text-slate-700">{step.label}</td>
      {groups.map((group) => <td key={group.key} className={cn("px-2 text-right tabular-nums", step.tone)} colSpan={4}>{step.value(stages.steps[group.key])}</td>)}
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/50 p-3">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1 text-left font-medium">Unique students</th>
            {groups.map((group) => <th key={group.key} colSpan={4} className="px-2 pb-1 text-right font-semibold text-slate-700">{group.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {steps.map(stepRow)}
          {stages.rounds.length > 0 && (
            <tr className="text-slate-500">
              <td className="pb-1 pt-3 font-medium">Company rounds</td>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <td className="px-1 pt-3 text-right" title="Attended">Attended</td>
                  <td className="px-1 pt-3 text-right text-emerald-700" title="Cleared">Cleared</td>
                  <td className="px-1 pt-3 text-right text-rose-600" title="Rejected">Rejected</td>
                  <td className="px-1 pt-3 text-right" title="Scheduled, not yet attended">Scheduled</td>
                </Fragment>
              ))}
            </tr>
          )}
          {stages.rounds.map((round) => (
            <tr key={round.roundId}>
              <td className="py-1 pr-3 font-medium text-slate-800">{round.name}</td>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <td className="px-1 text-right tabular-nums">{round[group.key].attended}</td>
                  <td className="px-1 text-right tabular-nums text-emerald-700">{round[group.key].cleared}</td>
                  <td className="px-1 text-right tabular-nums text-rose-600">{round[group.key].rejected}</td>
                  <td className="px-1 text-right tabular-nums text-slate-500">{round[group.key].scheduled}</td>
                </Fragment>
              ))}
            </tr>
          ))}
          {outcomes.map(stepRow)}
        </tbody>
      </table>
    </div>
  );
}

function Drives({ data }: { data: MonthlyPipeline }) {
  const [onlyStarting, setOnlyStarting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = onlyStarting ? data.drives.items.filter((drive) => drive.startsInMonth) : data.drives.items;
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOpen = rows.length > 0 && rows.every((drive) => expanded.has(drive.jobRequestId));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Job drives in pipeline</h2>
          <p className="mt-0.5 text-xs text-slate-500">Drives requested by the month's end that had not finished before it started. Academy columns are unique Academy students on that drive; open "Stages" for every step and company round.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={onlyStarting} onChange={(event) => setOnlyStarting(event.target.checked)} /> Only drives starting this month ({data.drives.summary.startingThisMonth})
          </label>
          {rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setExpanded(allOpen ? new Set() : new Set(rows.map((drive) => drive.jobRequestId)))}>
              {allOpen ? "Hide all stages" : "Show all stages"}
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No drives" className="py-8" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Process dates</th><th className="pr-2 text-right font-medium">Openings</th>
                <th className="pr-2 text-right font-medium" title="Unique Academy students who applied">Academy applied</th>
                <th className="pr-2 text-right font-medium" title="Academy students shared with the company">Academy shared</th>
                <th className="pr-2 text-right font-medium" title="Academy students who attended at least one company round">Academy interviewed</th>
                <th className="pr-2 text-right font-medium" title="Academy students still in the company process">Academy in process</th>
                <th className="pr-2 text-right font-medium" title="Academy students selected">Academy selected</th>
                <th className="pr-2 text-right font-medium" title="Assessed-pool students who applied">Pool applied</th>
                <th className="pr-3 text-right font-medium" title="All students shared with the company">All shared</th>
                <th className="pr-3 font-medium">Latest CRM remark</th><th className="font-medium">RSA review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((drive) => {
                const academy = drive.stages?.steps.academy;
                const open = expanded.has(drive.jobRequestId);
                return (
                  <Fragment key={drive.jobRequestId}>
                    <tr className="align-top">
                      <td className="py-2.5 pr-3">
                        <Link to={`/job-requests/${drive.jobRequestId}`} className="font-medium text-slate-900 hover:text-indigo-700">{drive.companyName}</Link>
                        <p className="text-xs text-slate-500">{drive.roleTitle}{drive.psmName ? ` · ${drive.psmName}` : ""}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {drive.startsInMonth && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Starts this month</Badge>}
                          {drive.stages && (
                            <button type="button" onClick={() => toggle(drive.jobRequestId)} className="text-xs font-medium text-indigo-700 hover:underline" aria-expanded={open}>
                              {open ? "Hide stages" : `Stages${drive.stages.rounds.length ? ` (${drive.stages.rounds.length} rounds)` : ""}`}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="pr-3 pt-2.5 text-xs text-slate-700">{companyProcessLabel(drive.phase, drive.roundName)}</td>
                      <td className="pr-3 pt-2.5 text-xs text-slate-600">{dateText(drive.processStartDate)} – {dateText(drive.processEndDate)}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.openings}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.academy}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{academy?.shared ?? 0}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{academy?.interviewed ?? 0}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{academy?.inProcess ?? 0}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums font-medium text-emerald-700">{academy?.selected ?? 0}</td>
                      <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.pool}</td>
                      <td className="pr-3 pt-2.5 text-right tabular-nums">{drive.students.shared}</td>
                      <td className="max-w-xs pr-3 pt-2.5 text-xs text-slate-600">
                        {drive.lastCrmRemark ? <><span className="text-slate-400">{dateText(drive.lastCrmRemark.on)}:</span> <span className="line-clamp-2">{drive.lastCrmRemark.remark}</span></> : <span className="text-slate-400">None</span>}
                        <Link to={`/job-requests/${drive.jobRequestId}?tab=notes`} className="text-indigo-700 hover:underline">{drive.crmRemarkCount ? `All ${drive.crmRemarkCount}` : "Add"}</Link>
                      </td>
                      <td className="pt-2.5 text-xs">{drive.hasRsaReview ? <span className="text-emerald-700">Written</span> : <span className="text-slate-400">Not yet</span>}</td>
                    </tr>
                    {open && drive.stages && (
                      <tr><td colSpan={13} className="pb-4 pt-1"><DriveStagesTable stages={drive.stages} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const CATEGORY_TEXT: Record<string, string> = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Intensive", EXTERNAL: "External" };
const HIRED_SOURCE_TEXT = { STUDENT: "", ROUND: "last round date", JOB: "job's process end", REQUEST: "no date: job request month" } as const;

function Placements({ data }: { data: MonthlyPipeline }) {
  const placed = data.placements;
  const estimated = placed.people.filter((person) => person.hiredOnSource !== "STUDENT").length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Placements this month</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Students hired in {monthText(data.month)} by interview done date (the student's process end date), whenever the job was requested.
            {estimated > 0 && ` ${estimated} have no hired date yet, so the last round date, the job's process end or (with no date at all) the job request date is used. Set the student's process end date on the job's pipeline tab.`}
          </p>
        </div>
        {placed.people.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => downloadCsv(
            `placements-${data.month}.csv`,
            ["Hired on", "Date from", "Student", "Student code", "Category", "Assessed pool", "Company", "Role", "Job ID", "CTC (LPA)", "Status"],
            placed.people.map((person) => [
              person.hiredOn, person.hiredOnSource === "STUDENT" ? "Hired date" : HIRED_SOURCE_TEXT[person.hiredOnSource],
              person.fullName, person.candidateCode ?? "", CATEGORY_TEXT[person.category] ?? person.category, person.inPool ? "Yes" : "No",
              person.companyName, person.roleTitle, person.jobCode, person.ctcLpa ?? "", PIPELINE_STATUS_LABELS[person.pipelineStatus],
            ]),
          )}><Download size={14} /> CSV</Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">{placed.total} placed · {placed.companies} companies</Badge>
        <Badge variant="outline">Academy {placed.academy}</Badge>
        <Badge variant="outline">Intensive {placed.intensive}</Badge>
        <Badge variant="outline">External {placed.external}</Badge>
        <Badge variant="outline">Assessed pool {placed.pool}</Badge>
      </div>
      {placed.people.length === 0 ? <EmptyState icon={Award} title="No placements dated in this month" className="py-8" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-3 font-medium">Hired on</th><th className="pr-3 font-medium">Student</th><th className="pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">CTC</th><th className="font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {placed.people.map((person) => (
                <tr key={person.applicationId} className="align-top">
                  <td className="py-2.5 pr-3 text-xs">
                    <span className="font-medium text-slate-800">{dateText(person.hiredOn)}</span>
                    {person.hiredOnSource !== "STUDENT" && <p className="text-[10px] text-amber-700">{HIRED_SOURCE_TEXT[person.hiredOnSource]}</p>}
                  </td>
                  <td className="pr-3 pt-2.5">
                    <Link to={`/candidates/${person.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{person.fullName}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1"><ProductBadge products={person.product} />{person.inPool && <span className="rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">Assessed pool</span>}</div>
                  </td>
                  <td className="pr-3 pt-2.5">
                    <Link to={`/job-requests/${person.jobRequestId}?tab=pipeline`} className="text-slate-800 hover:text-indigo-700">{person.companyName}</Link>
                    <p className="text-xs text-slate-500">{person.roleTitle}</p>
                  </td>
                  <td className="pr-3 pt-2.5 text-xs tabular-nums text-slate-600">{person.ctcLpa === null ? "—" : `${person.ctcLpa} LPA`}</td>
                  <td className="pt-2.5 text-xs text-emerald-700">{PIPELINE_STATUS_LABELS[person.pipelineStatus]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function GroupFunnel({ title, group, tone }: { title: string; group: MonthlyStudentGroup; tone: string }) {
  const steps = [
    { label: "In pipeline (applied)", value: group.students },
    { label: "Made our final shortlist", value: group.finalShortlisted },
    { label: "Shared with company", value: group.shared },
    { label: "Got an interview (any company round)", value: group.interviewed },
    { label: "Still in company process", value: group.inProcess },
    { label: "Selected", value: group.selected },
  ];
  const max = Math.max(group.students, 1);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">Distinct students · {group.applications} applications · {group.internalRejected} rejected in our shortlisting · {group.companyRejected} rejected by companies</p>
      <div className="mt-3 grid gap-1.5">
        {steps.map((step) => (
          <div key={step.label} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
            <div className="relative h-6 overflow-hidden rounded bg-slate-50">
              <div className={cn("absolute inset-y-0 left-0 rounded", tone)} style={{ width: `${(step.value / max) * 100}%` }} />
              <span className="relative z-10 flex h-full items-center px-2 text-slate-800">{step.label}</span>
            </div>
            <span className="w-10 text-right font-semibold tabular-nums text-slate-900">{step.value}</span>
          </div>
        ))}
      </div>
      {group.stages.length > 0 && (
        <table className="mt-4 w-full text-xs">
          <thead className="text-left text-slate-500"><tr><th className="pb-1 font-medium">Company stage</th><th className="text-right font-medium">Attended</th><th className="text-right font-medium">Cleared</th><th className="text-right font-medium">Rejected</th><th className="text-right font-medium">Scheduled</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {group.stages.map((stage) => (
              <tr key={stage.label}><td className="py-1 text-slate-700">{stage.label}</td><td className="text-right tabular-nums">{stage.reached}</td><td className="text-right tabular-nums text-emerald-700">{stage.cleared}</td><td className="text-right tabular-nums text-rose-600">{stage.rejected}</td><td className="text-right tabular-nums text-slate-500">{stage.scheduled}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const INTERNAL_LABELS: Record<MonthlyStudent["internal"], string> = {
  SP: "On our final shortlist", AS_REJECTED: "Rejected at our assignment", SC_REJECTED: "Rejected at our screening", SC_NO_SHOW: "Missed our screening", RS_REJECTED: "Rejected at our resume shortlist", IN_PROGRESS: "In our shortlisting",
};
type PeopleView = "ALL" | "SHARED" | "INTERVIEWED" | "SELECTED" | "INTERNAL_REJECTED" | "COMPANY_REJECTED";
const VIEW_LABELS: Record<PeopleView, string> = { ALL: "Everyone", SHARED: "Shared with company", INTERVIEWED: "Got an interview", SELECTED: "Selected", INTERNAL_REJECTED: "Rejected internally", COMPANY_REJECTED: "Rejected by company" };
const inView = (person: MonthlyStudent, view: PeopleView) =>
  view === "ALL" || (view === "SHARED" && person.shared) || (view === "INTERVIEWED" && person.interviewed) || (view === "SELECTED" && person.selected)
  || (view === "INTERNAL_REJECTED" && person.internal.endsWith("REJECTED")) || (view === "COMPANY_REJECTED" && person.pipelineStatus === "REJECTED");

/**
 * How far one application got, best first, with a short label of where the
 * student stands on it right now.
 */
function positionOf(person: MonthlyStudent): { rank: number; label: string } {
  if (person.selected) return { rank: 7, label: "Selected" };
  if (person.pipelineStatus === "IN_PROCESS" || person.pipelineStatus === "ON_HOLD") {
    if (person.lastRound) return { rank: 6, label: `${person.lastRound}: ${(person.lastRoundOutcome ?? "").toLowerCase().replace("_", " ")}` };
    return { rank: 5, label: person.pipelineStatus === "ON_HOLD" ? "On hold with company" : "Shared, waiting for company" };
  }
  if (person.shared && person.pipelineStatus !== "REJECTED" && person.pipelineStatus !== "DROPPED") return { rank: 5, label: "Shared with company" };
  if (person.internal === "SP") return { rank: 4, label: "On our final shortlist, not shared yet" };
  if (person.internal === "IN_PROGRESS") return { rank: 3, label: "In our shortlisting (resume, screening, assignment)" };
  if (person.pipelineStatus === "REJECTED") return { rank: 2, label: person.lastRound ? `Rejected by company at ${person.lastRound}` : "Rejected by company" };
  if (person.pipelineStatus === "DROPPED") return { rank: 2, label: "Dropped" };
  return { rank: 1, label: INTERNAL_LABELS[person.internal] };
}

type UniqueStudent = {
  candidateId: string; fullName: string; candidateCode: string | null; academy: boolean; inPool: boolean; tier: string | null;
  applications: MonthlyStudent[]; best: MonthlyStudent; position: string; open: number;
};

function uniqueStudents(people: MonthlyStudent[]): UniqueStudent[] {
  const byCandidate = new Map<string, MonthlyStudent[]>();
  for (const person of people) byCandidate.set(person.candidateId, [...(byCandidate.get(person.candidateId) ?? []), person]);
  return [...byCandidate.values()].map((applications) => {
    const sorted = [...applications].sort((x, y) => positionOf(y).rank - positionOf(x).rank);
    const best = sorted[0]!;
    return {
      candidateId: best.candidateId, fullName: best.fullName, candidateCode: best.candidateCode, academy: best.academy, inPool: best.inPool, tier: best.tier,
      applications: sorted, best, position: positionOf(best).label,
      open: applications.filter((person) => positionOf(person).rank >= 3 && positionOf(person).rank <= 6).length,
    };
  }).sort((x, y) => positionOf(y.best).rank - positionOf(x.best).rank || x.fullName.localeCompare(y.fullName));
}

function Students({ data }: { data: MonthlyPipeline }) {
  const [group, setGroup] = useState<"ALL" | "ACADEMY" | "POOL">("ALL");
  const [view, setView] = useState<PeopleView>("ALL");
  const [layout, setLayout] = useState<"STUDENT" | "APPLICATION">("STUDENT");
  const [q, setQ] = useState("");
  const { academy, pool, people } = data.students;
  const rows = people.filter((person) =>
    (group === "ALL" || (group === "ACADEMY" ? person.academy : person.inPool)) && inView(person, view)
    && (!q || `${person.fullName} ${person.candidateCode ?? ""} ${person.companyName}`.toLowerCase().includes(q.toLowerCase())));
  const students = uniqueStudents(rows);
  const segmentText = (person: { academy: boolean; inPool: boolean; tier: string | null }) => [person.academy ? "Academy" : null, person.inPool ? `Pool${person.tier ? ` ${person.tier}` : ""}` : null].filter(Boolean).join(" + ");
  const companyStatus = (person: MonthlyStudent) =>
    person.lastRound ? `${person.lastRound}: ${person.lastRoundOutcome?.toLowerCase().replace("_", " ")}` : person.pipelineStatus ? PIPELINE_STATUS_LABELS[person.pipelineStatus] : person.shared ? "Shared" : "—";
  const download = () => layout === "STUDENT"
    ? downloadCsv(`students-unique-${data.month}`, ["Student", "Code", "Segment", "Companies", "Where they are now", "Best company", "Still open", "All companies (stage)"],
      students.map((student) => [student.fullName, student.candidateCode, segmentText(student), student.applications.length, student.position, student.best.companyName, student.open,
        student.applications.map((person) => `${person.companyName}: ${positionOf(person).label}`).join(" | ")]))
    : downloadCsv(`students-${data.month}`, ["Student", "Code", "Segment", "Company", "Role", "Our process", "Shared", "Interviewed", "Selected", "Company status"],
      rows.map((person) => [person.fullName, person.candidateCode, segmentText(person), person.companyName, person.roleTitle, INTERNAL_LABELS[person.internal], person.shared, person.interviewed, person.selected, companyStatus(person)]));

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Academy & assessed-pool students in these drives</h2>
      <p className="mt-0.5 text-xs text-slate-500">Counts are unique students: someone in three companies counts once. A pool student from the Academy is counted in both. Same definitions as Academy &amp; pool.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GroupFunnel title="Academy" group={academy} tone="bg-indigo-100" />
        <GroupFunnel title="Assessed pool" group={pool} tone="bg-emerald-100" />
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-md border border-slate-200 p-0.5" role="group" aria-label="One row per">
            <Button size="sm" variant={layout === "STUDENT" ? "secondary" : "ghost"} className="h-8" aria-pressed={layout === "STUDENT"} onClick={() => setLayout("STUDENT")}>By student ({students.length})</Button>
            <Button size="sm" variant={layout === "APPLICATION" ? "secondary" : "ghost"} className="h-8" aria-pressed={layout === "APPLICATION"} onClick={() => setLayout("APPLICATION")}>By company ({rows.length})</Button>
          </div>
          <Select value={group} onValueChange={(value) => setGroup(value as typeof group)}>
            <SelectTrigger className="w-40" aria-label="Student group"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">Academy + pool</SelectItem><SelectItem value="ACADEMY">Academy only</SelectItem><SelectItem value="POOL">Assessed pool only</SelectItem></SelectContent>
          </Select>
          <Select value={view} onValueChange={(value) => setView(value as PeopleView)}>
            <SelectTrigger className="w-52" aria-label="Outcome"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(VIEW_LABELS) as PeopleView[]).map((key) => <SelectItem key={key} value={key}>{VIEW_LABELS[key]}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="w-56" placeholder="Search name, code, company" value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={download}>
          <Download size={14} /> CSV ({layout === "STUDENT" ? students.length : rows.length})
        </Button>
      </div>
      <div className="mt-3 max-h-[560px] overflow-auto">
        {layout === "STUDENT" ? (
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-3 font-medium">Student</th><th className="pr-3 font-medium">Segment</th><th className="pr-3 font-medium">Where they are now</th><th className="pr-3 font-medium">Every company this month</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((student) => (
                <tr key={student.candidateId} className="align-top">
                  <td className="py-2 pr-3"><Link to={`/candidates/${student.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{student.fullName}</Link><div className="mt-0.5 flex flex-wrap gap-1"><ProductBadge products={student.best.product} /><PoolBadge source={student.best.poolSource} /></div></td>
                  <td className="pr-3 pt-2 text-xs text-slate-600">{segmentText(student)}</td>
                  <td className="pr-3 pt-2 text-xs">
                    <span className={cn("font-medium", student.best.selected ? "text-emerald-700" : positionOf(student.best).rank <= 2 ? "text-rose-600" : "text-slate-800")}>{student.position}</span>
                    <span className="block text-slate-500">{student.best.companyName}</span>
                    <span className="block text-slate-400">{student.applications.length} {student.applications.length === 1 ? "company" : "companies"}{student.open > 0 ? ` · ${student.open} still open` : ""}</span>
                  </td>
                  <td className="pr-3 pt-2 text-xs">
                    <ul className="space-y-0.5">
                      {student.applications.map((person) => (
                        <li key={person.applicationId}>
                          <Link to={`/job-requests/${person.jobRequestId}?tab=pipeline`} className="text-slate-800 hover:text-indigo-700">{person.companyName}</Link>
                          <span className="text-slate-500"> · {positionOf(person).label}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-left text-xs text-slate-500">
              <tr><th className="py-2 pr-3 font-medium">Student</th><th className="pr-3 font-medium">Segment</th><th className="pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">Our process</th><th className="pr-3 font-medium">Company stage</th><th className="font-medium">Result</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((person) => (
                <tr key={person.applicationId}>
                  <td className="py-2 pr-3"><Link to={`/candidates/${person.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{person.fullName}</Link><div className="mt-0.5 flex flex-wrap gap-1"><ProductBadge products={person.product} /><PoolBadge source={person.poolSource} /></div></td>
                  <td className="pr-3 text-xs text-slate-600">{segmentText(person)}</td>
                  <td className="pr-3 text-xs"><Link to={`/job-requests/${person.jobRequestId}`} className="text-slate-800 hover:text-indigo-700">{person.companyName}</Link><span className="block text-slate-500">{person.roleTitle}</span></td>
                  <td className="pr-3 text-xs text-slate-600">{INTERNAL_LABELS[person.internal]}</td>
                  <td className="pr-3 text-xs text-slate-600">{companyStatus(person)}</td>
                  <td className="text-xs">{person.selected ? <span className="font-medium text-emerald-700">Selected</span> : person.pipelineStatus === "REJECTED" || person.internal.endsWith("REJECTED") ? <span className="text-rose-600">Rejected</span> : <span className="text-slate-500">Open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length === 0 && <EmptyState title="No students match" className="py-8" />}
      </div>
    </Card>
  );
}

/** One month at a glance for stakeholder meetings: CRM's potential list, live drives and student outcomes. */
export function MonthlyPipelinePage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  const tab = params.get("tab") ?? "drives";
  const query = useQuery({ queryKey: ["monthly-pipeline", month], queryFn: () => monthlyPipelineApi.month(month), placeholderData: keepPreviousData });
  const data = query.data;
  const loading = query.isPending;
  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Workspace"
        title="Monthly pipeline"
        description="Pick a month to see the job drives running, how Academy and assessed-pool students are doing in them, placements, and CRM's potential companies."
        actions={(
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Month
            <Input type="month" className="w-40" value={month} onChange={(event) => event.target.value && setParams((current) => { const next = new URLSearchParams(current); next.set("month", event.target.value); return next; })} />
          </label>
        )}
      />
      {query.error ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <KpiCard label="Potential companies (active)" value={data?.potential.summary.active} hint={data ? `${data.potential.summary.listed} on the list in total` : ""} icon={Building2} loading={loading} />
            <KpiCard label="Confirmed / started" value={data?.potential.summary.starting} hint="From CRM's list" icon={Rocket} tone="emerald" loading={loading} />
            <KpiCard label="Drives in pipeline" value={data?.drives.summary.live} hint={data ? `${data.drives.summary.companies} companies · ${data.drives.summary.openings} openings` : ""} icon={BriefcaseBusiness} tone="sky" loading={loading} />
            <KpiCard label="Drives starting this month" value={data?.drives.summary.startingThisMonth} hint={data ? `${data.drives.summary.startingCompanies} companies · ${data.drives.summary.endingThisMonth} ending` : ""} icon={CalendarClock} tone="amber" loading={loading} />
            <KpiCard label="Placements (by hired date)" value={data?.placements.total} hint={data ? `${data.placements.academy} Academy · ${data.placements.pool} pool · ${data.placements.companies} companies` : ""} icon={Award} tone="emerald" loading={loading} />
            <KpiCard label="Academy students (unique)" value={data?.students.academy.students} hint={data ? `${data.students.academy.applications} applications · ${data.students.academy.interviewed} interviewed · ${data.students.academy.selected} selected` : ""} icon={GraduationCap} tone="indigo" loading={loading} />
            <KpiCard label="Assessed-pool students (unique)" value={data?.students.pool.students} hint={data ? `${data.students.pool.applications} applications · ${data.students.pool.interviewed} interviewed · ${data.students.pool.selected} selected` : ""} icon={UserRoundCheck} tone="emerald" loading={loading} />
          </div>
          {loading || !data ? <Card><LoadingRows rows={8} /></Card> : (
            <>
              <Tabs value={tab} onValueChange={(value) => setParams((current) => { const next = new URLSearchParams(current); next.set("tab", value); return next; })}>
                <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
                  <TabsTrigger value="drives">Job drives ({data.drives.summary.live})</TabsTrigger>
                  <TabsTrigger value="students">Academy & pool students</TabsTrigger>
                  <TabsTrigger value="placements">Placements ({data.placements.total})</TabsTrigger>
                  <TabsTrigger value="potential">Potential companies · CRM ({data.potential.summary.active})</TabsTrigger>
                </TabsList>
                <TabsContent value="drives"><Drives data={data} /></TabsContent>
                <TabsContent value="students"><Students data={data} /></TabsContent>
                <TabsContent value="placements"><Placements data={data} /></TabsContent>
                <TabsContent value="potential"><PotentialList data={data} /></TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </div>
  );
}
