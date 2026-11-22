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
import { ArrowRightLeft, BriefcaseBusiness, Building2, CalendarClock, Download, GraduationCap, History, Pencil, Plus, Rocket, Trash2, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { catalogApi } from "../../services/api";
import { monthlyPipelineApi } from "../../services/pulse-api";
import { guidanceApi } from "../../services/tracking-api";
import type { MonthlyPipeline, MonthlyStudent, MonthlyStudentGroup, PipelineEntry } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";

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

/** Add or edit one company on the month's potential list. */
function EntryDialog({ month, entry, open, onOpenChange }: { month: string; entry: PipelineEntry | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh();
  const [companyName, setCompanyName] = useState("");
  const [status, setStatus] = useState<PotentialCompanyStatus>("POTENTIAL");
  const [note, setNote] = useState("");
  const [jobRequestId, setJobRequestId] = useState(NONE);
  const [roleHint, setRoleHint] = useState("");
  const [openings, setOpenings] = useState("");
  const [startDate, setStartDate] = useState("");
  const [crmOwnerId, setCrmOwnerId] = useState(NONE);
  const [remarks, setRemarks] = useState("");
  useEffect(() => {
    if (!open) return;
    setCompanyName(entry?.company.name ?? "");
    setStatus(entry?.status ?? "POTENTIAL");
    setNote("");
    setJobRequestId(entry?.jobRequest?.id ?? NONE);
    setRoleHint(entry?.roleHint ?? "");
    setOpenings(entry?.expectedOpenings ? String(entry.expectedOpenings) : "");
    setStartDate(entry?.expectedStartDate ?? "");
    setCrmOwnerId(entry?.crmOwner?.id ?? NONE);
    setRemarks(entry?.remarks ?? "");
  }, [open, entry]);

  const search = useDebouncedValue(companyName.trim(), 300);
  const jobs = useQuery({ queryKey: ["guidance", "jobs", search], queryFn: () => guidanceApi.searchJobs(search), enabled: open && search.length >= 2 });
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: open, staleTime: 300_000 });
  const jobOptions = useMemo(() => {
    const list = (jobs.data ?? []).filter((job) => !entry || job.company.name.toLowerCase() === entry.company.name.toLowerCase());
    if (entry?.jobRequest && !list.some((job) => job.id === entry.jobRequest!.id)) {
      return [{ id: entry.jobRequest.id, roleTitle: entry.jobRequest.roleTitle, company: { name: entry.company.name } }, ...list];
    }
    return list;
  }, [jobs.data, entry]);

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        jobRequestId: jobRequestId === NONE ? null : jobRequestId,
        roleHint: roleHint.trim() || null,
        expectedOpenings: openings ? Number(openings) : null,
        expectedStartDate: startDate || null,
        crmOwnerId: crmOwnerId === NONE ? null : crmOwnerId,
        remarks: remarks.trim() || null,
      };
      if (entry) await monthlyPipelineApi.update(entry.id, { ...fields, status, ...(note.trim() ? { note: note.trim() } : {}) });
      else await monthlyPipelineApi.create({ month, companyName: companyName.trim(), status, ...fields });
    },
    onSuccess: async () => { await refresh(); toast.success(entry ? "Entry updated" : "Company added to the list"); onOpenChange(false); },
  });
  const statusChanged = entry && status !== entry.status;

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? entry.company.name : "Add a potential company"}</DialogTitle>
          <DialogDescription>{monthText(month)} · CRM potential list{entry?.carriedFrom ? ` · carried from ${monthText(entry.carriedFrom.month)}` : ""}</DialogDescription>
        </DialogHeader>
        <form id="entry-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          {!entry && (
            <FormField id="entry-company" label="Company" required hint="An existing company with this name is reused; otherwise it is created." className="sm:col-span-2">
              <Input id="entry-company" value={companyName} maxLength={200} onChange={(event) => setCompanyName(event.target.value)} required autoFocus />
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
          <FormField id="entry-job" label="Job drive" hint={jobOptions.length === 0 ? "Link it once the job request exists." : undefined}>
            <Select value={jobRequestId} onValueChange={setJobRequestId}>
              <SelectTrigger id="entry-job"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No job request yet</SelectItem>
                {jobOptions.map((job) => <SelectItem key={job.id} value={job.id}>{job.company.name} · {job.roleTitle}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="entry-role" label="Expected role">
            <Input id="entry-role" value={roleHint} maxLength={200} onChange={(event) => setRoleHint(event.target.value)} placeholder="e.g. SDE intern, Data analyst" />
          </FormField>
          <FormField id="entry-openings" label="Expected openings">
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
          <Button type="submit" form="entry-form" disabled={save.isPending || (!entry && !companyName.trim())}>{save.isPending ? "Saving…" : entry ? "Save" : "Add to list"}</Button>
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
          <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add company</Button>
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
                        </Link>
                      ) : entry.roleHint ? <p className="text-xs text-slate-500">{entry.roleHint}</p> : <p className="text-xs text-slate-400">No job request yet</p>}
                    </td>
                    <td className="pr-3 pt-2.5"><StatusBadge status={entry.status} /></td>
                    <td className="pr-3 pt-2.5 text-slate-600">{entry.crmOwner?.fullName ?? "—"}</td>
                    <td className="pr-3 pt-2.5 text-slate-600">{dateText(entry.expectedStartDate ?? entry.jobRequest?.companyProcessStartDate ?? null)}</td>
                    <td className="pr-3 pt-2.5 tabular-nums text-slate-600">{entry.expectedOpenings ?? "—"}</td>
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

function Drives({ data }: { data: MonthlyPipeline }) {
  const [onlyStarting, setOnlyStarting] = useState(false);
  const rows = onlyStarting ? data.drives.items.filter((drive) => drive.startsInMonth) : data.drives.items;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Job drives in pipeline</h2>
          <p className="mt-0.5 text-xs text-slate-500">Drives requested by the month's end that had not finished before it started. "Starts" uses the hand-entered company process start date.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={onlyStarting} onChange={(event) => setOnlyStarting(event.target.checked)} /> Only drives starting this month ({data.drives.summary.startingThisMonth})
        </label>
      </div>
      {rows.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No drives" className="py-8" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Process dates</th>
                <th className="pr-2 text-right font-medium" title="Academy students who applied">Academy</th><th className="pr-2 text-right font-medium" title="Assessed-pool students who applied">Pool</th>
                <th className="pr-2 text-right font-medium">Shared</th><th className="pr-2 text-right font-medium" title="Attended at least one company round">Interviewed</th><th className="pr-3 text-right font-medium">Selected</th>
                <th className="pr-3 font-medium">Latest CRM remark</th><th className="font-medium">RSA review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((drive) => (
                <tr key={drive.jobRequestId} className="align-top">
                  <td className="py-2.5 pr-3">
                    <Link to={`/job-requests/${drive.jobRequestId}`} className="font-medium text-slate-900 hover:text-indigo-700">{drive.companyName}</Link>
                    <p className="text-xs text-slate-500">{drive.roleTitle}{drive.psmName ? ` · ${drive.psmName}` : ""}</p>
                    {drive.startsInMonth && <Badge variant="outline" className="mt-1 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Starts this month</Badge>}
                  </td>
                  <td className="pr-3 pt-2.5 text-xs text-slate-700">{companyProcessLabel(drive.phase, drive.roundName)}</td>
                  <td className="pr-3 pt-2.5 text-xs text-slate-600">{dateText(drive.processStartDate)} – {dateText(drive.processEndDate)}</td>
                  <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.academy}</td>
                  <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.pool}</td>
                  <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.shared}</td>
                  <td className="pr-2 pt-2.5 text-right tabular-nums">{drive.students.interviewed}</td>
                  <td className="pr-3 pt-2.5 text-right tabular-nums font-medium text-emerald-700">{drive.students.selected}</td>
                  <td className="max-w-xs pr-3 pt-2.5 text-xs text-slate-600">
                    {drive.lastCrmRemark ? <><span className="text-slate-400">{dateText(drive.lastCrmRemark.on)}:</span> <span className="line-clamp-2">{drive.lastCrmRemark.remark}</span></> : <span className="text-slate-400">None</span>}
                    <Link to={`/job-requests/${drive.jobRequestId}?tab=notes`} className="text-indigo-700 hover:underline">{drive.crmRemarkCount ? `All ${drive.crmRemarkCount}` : "Add"}</Link>
                  </td>
                  <td className="pt-2.5 text-xs">{drive.hasRsaReview ? <span className="text-emerald-700">Written</span> : <span className="text-slate-400">Not yet</span>}</td>
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
    { label: "Shortlisted by us (SP)", value: group.finalShortlisted },
    { label: "Shared with company", value: group.shared },
    { label: "Got an interview (any company round)", value: group.interviewed },
    { label: "Still in company process", value: group.inProcess },
    { label: "Selected", value: group.selected },
  ];
  const max = Math.max(group.students, 1);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500">Distinct students · {group.applications} applications · {group.internalRejected} rejected internally (RS/SC/AS) · {group.companyRejected} rejected by companies</p>
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
  SP: "Shortlisted (SP)", AS_REJECTED: "Rejected at AS", SC_REJECTED: "Rejected at SC", SC_NO_SHOW: "SC no-show", RS_REJECTED: "Rejected at RS", IN_PROGRESS: "In our process",
};
type PeopleView = "ALL" | "SHARED" | "INTERVIEWED" | "SELECTED" | "INTERNAL_REJECTED" | "COMPANY_REJECTED";
const VIEW_LABELS: Record<PeopleView, string> = { ALL: "Everyone", SHARED: "Shared with company", INTERVIEWED: "Got an interview", SELECTED: "Selected", INTERNAL_REJECTED: "Rejected internally", COMPANY_REJECTED: "Rejected by company" };
const inView = (person: MonthlyStudent, view: PeopleView) =>
  view === "ALL" || (view === "SHARED" && person.shared) || (view === "INTERVIEWED" && person.interviewed) || (view === "SELECTED" && person.selected)
  || (view === "INTERNAL_REJECTED" && person.internal.endsWith("REJECTED")) || (view === "COMPANY_REJECTED" && person.pipelineStatus === "REJECTED");

function Students({ data }: { data: MonthlyPipeline }) {
  const [group, setGroup] = useState<"ALL" | "ACADEMY" | "POOL">("ALL");
  const [view, setView] = useState<PeopleView>("ALL");
  const [q, setQ] = useState("");
  const { academy, pool, people } = data.students;
  const rows = people.filter((person) =>
    (group === "ALL" || (group === "ACADEMY" ? person.academy : person.inPool)) && inView(person, view)
    && (!q || `${person.fullName} ${person.candidateCode ?? ""} ${person.companyName}`.toLowerCase().includes(q.toLowerCase())));
  const segmentText = (person: MonthlyStudent) => [person.academy ? "Academy" : null, person.inPool ? `Pool${person.tier ? ` ${person.tier}` : ""}` : null].filter(Boolean).join(" + ");
  const companyStatus = (person: MonthlyStudent) =>
    person.lastRound ? `${person.lastRound}: ${person.lastRoundOutcome?.toLowerCase().replace("_", " ")}` : person.pipelineStatus ? PIPELINE_STATUS_LABELS[person.pipelineStatus] : person.shared ? "Shared" : "—";

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Academy & assessed-pool students in these drives</h2>
      <p className="mt-0.5 text-xs text-slate-500">Counts are distinct students. A pool student from the Academy is counted in both. Same definitions as Academy &amp; pool.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GroupFunnel title="Academy" group={academy} tone="bg-indigo-100" />
        <GroupFunnel title="Assessed pool" group={pool} tone="bg-emerald-100" />
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => downloadCsv(`students-${data.month}`, ["Student", "Code", "Segment", "Company", "Role", "Our process", "Shared", "Interviewed", "Selected", "Company status"],
          rows.map((person) => [person.fullName, person.candidateCode, segmentText(person), person.companyName, person.roleTitle, INTERNAL_LABELS[person.internal], person.shared, person.interviewed, person.selected, companyStatus(person)]))}>
          <Download size={14} /> CSV ({rows.length})
        </Button>
      </div>
      <div className="mt-3 max-h-[560px] overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 border-b border-slate-200 bg-white text-left text-xs text-slate-500">
            <tr><th className="py-2 pr-3 font-medium">Student</th><th className="pr-3 font-medium">Segment</th><th className="pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">Our process</th><th className="pr-3 font-medium">Company stage</th><th className="font-medium">Result</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((person) => (
              <tr key={person.applicationId}>
                <td className="py-2 pr-3"><Link to={`/candidates/${person.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{person.fullName}</Link>{person.candidateCode && <span className="block text-xs text-slate-400">{person.candidateCode}</span>}</td>
                <td className="pr-3 text-xs text-slate-600">{segmentText(person)}</td>
                <td className="pr-3 text-xs"><Link to={`/job-requests/${person.jobRequestId}`} className="text-slate-800 hover:text-indigo-700">{person.companyName}</Link><span className="block text-slate-500">{person.roleTitle}</span></td>
                <td className="pr-3 text-xs text-slate-600">{INTERNAL_LABELS[person.internal]}</td>
                <td className="pr-3 text-xs text-slate-600">{companyStatus(person)}</td>
                <td className="text-xs">{person.selected ? <span className="font-medium text-emerald-700">Selected</span> : person.pipelineStatus === "REJECTED" || person.internal.endsWith("REJECTED") ? <span className="text-rose-600">Rejected</span> : <span className="text-slate-500">Open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title="No students match" className="py-8" />}
      </div>
    </Card>
  );
}

/** One month at a glance for stakeholder meetings: CRM's potential list, live drives and student outcomes. */
export function MonthlyPipelinePage() {
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth();
  const query = useQuery({ queryKey: ["monthly-pipeline", month], queryFn: () => monthlyPipelineApi.month(month), placeholderData: keepPreviousData });
  const data = query.data;
  const loading = query.isPending;
  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Workspace"
        title="Monthly pipeline"
        description="Companies CRM expects this month, the drives running, and how Academy and assessed-pool students are doing in them."
        actions={(
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Month
            <Input type="month" className="w-40" value={month} onChange={(event) => event.target.value && setParams({ month: event.target.value })} />
          </label>
        )}
      />
      {query.error ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard label="Potential companies (active)" value={data?.potential.summary.active} hint={data ? `${data.potential.summary.listed} on the list in total` : ""} icon={Building2} loading={loading} />
            <KpiCard label="Confirmed / started" value={data?.potential.summary.starting} hint="From CRM's list" icon={Rocket} tone="emerald" loading={loading} />
            <KpiCard label="Drives in pipeline" value={data?.drives.summary.live} hint={data ? `${data.drives.summary.companies} companies` : ""} icon={BriefcaseBusiness} tone="sky" loading={loading} />
            <KpiCard label="Drives starting this month" value={data?.drives.summary.startingThisMonth} hint={data ? `${data.drives.summary.startingCompanies} companies · ${data.drives.summary.endingThisMonth} ending` : ""} icon={CalendarClock} tone="amber" loading={loading} />
            <KpiCard label="Academy students" value={data?.students.academy.students} hint={data ? `${data.students.academy.interviewed} got an interview · ${data.students.academy.selected} selected` : ""} icon={GraduationCap} tone="indigo" loading={loading} />
            <KpiCard label="Assessed-pool students" value={data?.students.pool.students} hint={data ? `${data.students.pool.interviewed} got an interview · ${data.students.pool.selected} selected` : ""} icon={UserRoundCheck} tone="emerald" loading={loading} />
          </div>
          {loading || !data ? <Card><LoadingRows rows={8} /></Card> : (
            <>
              <PotentialList data={data} />
              <Drives data={data} />
              <Students data={data} />
            </>
          )}
        </>
      )}
    </div>
  );
}
