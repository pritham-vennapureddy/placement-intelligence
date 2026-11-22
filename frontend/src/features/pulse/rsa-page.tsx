import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PIPELINE_STATUS_LABELS } from "@placement/shared";
import { format } from "date-fns";
import { CircleCheckBig, Download, ExternalLink, FileText, Link2, ListTodo, Pencil, Settings2, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { catalogApi } from "../../services/api";
import { rsaApi } from "../../services/pulse-api";
import { guidanceApi } from "../../services/tracking-api";
import type { RsaFilters, RsaProgress, RsaResult, RsaSegment, RsaStudent, RsaWorklist } from "../../types/pulse";
import { ManageReasonsDialog, useRejectionReasons } from "../pipeline/rejection-reason-fields";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";
import { ManageStatusesDialog, SupportBadge } from "../tracking/student-support";
import { ProductBadge } from "../../components/student-tags";

const today = () => format(new Date(), "yyyy-MM-dd");
const SEGMENT_LABELS: Record<RsaSegment, string> = { ACADEMY_OR_POOL: "Academy + assessed pool", ACADEMY: "Academy", POOL: "Assessed pool", EVERYONE: "Everyone (incl. external)" };
const PROGRESS_LABELS: Record<RsaProgress, string> = { ALL: "Any RSA status", NOT_STARTED: "Not started", IN_PROGRESS: "Started, not done", DONE: "Done" };
const RESULT_LABELS: Record<RsaResult, string> = { ALL: "Any result", UNKNOWN: "Result not known yet", NOT_SELECTED: "Not selected", SELECTED: "Selected" };
const RESULT_TONE: Record<Exclude<RsaResult, "ALL">, string> = { UNKNOWN: "bg-slate-100 text-slate-600", NOT_SELECTED: "bg-rose-50 text-rose-700", SELECTED: "bg-emerald-50 text-emerald-700" };
const NO_REASON = "__none__";
const ADD_REASON = "__add__";
const segmentText = (student: RsaStudent) =>
  [student.category === "ACADEMY" || student.category === "ACADEMY_INTENSIVE" ? (student.category === "ACADEMY" ? "Academy" : "Intensive") : null, student.inPool ? `Pool${student.tier ? ` ${student.tier}` : ""}` : null].filter(Boolean).join(" + ") || "External";
const whereRejected = (student: RsaStudent) =>
  student.result === "SELECTED" ? "Selected"
    : student.result === "UNKNOWN" ? (student.pipelineStatus ? PIPELINE_STATUS_LABELS[student.pipelineStatus] : "Shared, no result yet")
      : student.rejectedRound ?? (student.pipelineStatus ? PIPELINE_STATUS_LABELS[student.pipelineStatus] : "Not selected (drive closed)");

/** The reason dropdown on each row: saves straight away. */
function ReasonCell({ student, onAdd }: { student: RsaStudent; onAdd: () => void }) {
  const queryClient = useQueryClient();
  const reasons = useRejectionReasons();
  const save = useMutation({
    mutationFn: (tagId: string | null) => rsaApi.setReason(student.applicationId, tagId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["rsa"] }); toast.success("Reason saved"); },
    onError: (error) => toast.error(error.message),
  });
  // The student's own RSA tag; a round tag shows as a suggestion until the RSA team confirms one.
  const value = student.reason?.fromRsa ? student.reason.id : NO_REASON;
  const options = (reasons.data ?? []).filter((reason) => !reason.archivedAt || reason.id === value);
  return (
    <div className="w-48">
      <Select value={value} disabled={save.isPending} onValueChange={(next) => (next === ADD_REASON ? onAdd() : save.mutate(next === NO_REASON ? null : next))}>
        <SelectTrigger className={cn("h-8 text-xs", value === NO_REASON ? "text-slate-400" : "border-rose-200 bg-rose-50/50 text-rose-800")} aria-label={`Reason for ${student.fullName}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_REASON}>No reason yet</SelectItem>
          {options.map((reason) => <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>)}
          <SelectItem value={ADD_REASON}><span className="text-indigo-600">+ Add or edit reasons…</span></SelectItem>
        </SelectContent>
      </Select>
      {!student.reason?.fromRsa && student.reason && <p className="mt-0.5 text-[10px] text-slate-500" title="Tagged on the company round">Round says: {student.reason.label}</p>}
    </div>
  );
}

/** The big picture of reasons for students not selected, across the current list. Click a bar to filter. */
function ReasonChart({ summary, picked, onPick }: { summary: RsaWorklist["summary"]; picked: string | undefined; onPick: (tagId: string | undefined) => void }) {
  const total = summary.byReason.reduce((sum, row) => sum + row.students, 0);
  const max = Math.max(0, ...summary.byReason.map((row) => row.students));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Why students were not selected</p>
          <p className="mt-0.5 text-xs text-slate-500">Reasons the RSA team tagged (else the company round's tag) for every student in this list who was not selected or has no result yet. Click a reason to see those students.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{summary.byResult.UNKNOWN} result not known</span>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">{summary.byResult.NOT_SELECTED} not selected</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{summary.byResult.SELECTED} selected</span>
        </div>
      </div>
      {total === 0 ? <p className="px-4 py-6 text-center text-xs text-slate-500">Nobody to analyse in this list.</p> : (
        <ul className="divide-y divide-slate-100">
          {summary.byReason.map((row) => {
            const key = row.tagId ?? "untagged";
            const active = picked === key;
            return (
              <li key={key}>
                <button type="button" onClick={() => onPick(active ? undefined : key)}
                  className={cn("grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5rem] items-center gap-3 px-4 py-2 text-left", active ? "bg-rose-50/70" : "hover:bg-slate-50")}>
                  <span className={cn("truncate text-sm", row.tagId ? "font-medium text-slate-800" : "text-amber-700")}>{row.label}</span>
                  <span className="h-2.5 rounded-full bg-slate-100" aria-hidden>
                    <span className="block h-2.5 rounded-full" style={{ width: `${max ? Math.max(2, (row.students / max) * 100) : 0}%`, background: row.tagId ? "#e0475b" : "#d9a13b" }} />
                  </span>
                  <span className="text-right text-sm tabular-nums"><b>{row.students}</b> <span className="text-xs text-slate-400">{Math.round((row.students / total) * 100)}%</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ReportDialog({ student, open, onOpenChange }: { student: RsaStudent | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const statuses = useQuery({ queryKey: ["guidance", "status-options"], queryFn: guidanceApi.statusOptions, enabled: open });
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: open, staleTime: 300_000 });
  const [statusId, setStatusId] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [contributorIds, setContributorIds] = useState<string[]>([]);
  const [others, setOthers] = useState("");
  const [doneOn, setDoneOn] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const options = useMemo(
    () => (statuses.data ?? []).filter((option) => option.kind === "RSA" && (!option.archivedAt || option.id === student?.rsa?.statusId)),
    [statuses.data, student],
  );
  useEffect(() => {
    if (!open || !student) return;
    setSummary(student.rsa?.reportSummary ?? "");
    setUrl(student.rsa?.reportUrl ?? "");
    setContributorIds(student.rsa?.contributors.map(({ id }) => id) ?? []);
    setOthers(student.rsa?.otherContributors ?? "");
    setDoneOn(student.rsa?.doneOn ?? "");
    setPeopleSearch("");
  }, [open, student]);
  useEffect(() => {
    if (open && student) setStatusId(student.rsa?.statusId ?? options.find((option) => option.countsAsDone)?.id ?? options[0]?.id ?? "");
  }, [open, student, options]);
  const status = options.find((option) => option.id === statusId);
  const people = (owners.data ?? []).filter((person) => !peopleSearch || person.fullName.toLowerCase().includes(peopleSearch.toLowerCase()) || contributorIds.includes(person.id));

  const save = useMutation({
    mutationFn: () => rsaApi.saveReport(student!.applicationId, {
      statusId,
      reportSummary: summary.trim() || null,
      reportUrl: url.trim() || null,
      contributorIds,
      otherContributors: others.trim() || null,
      doneOn: doneOn || (status?.countsAsDone ? today() : null),
    }),
    onSuccess: async () => {
      await Promise.all(["rsa", "guidance", "insights", "drive-notes"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success("RSA report saved");
      onOpenChange(false);
    },
  });
  if (!student) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>RSA report · {student.fullName}</DialogTitle>
          <DialogDescription>
            {student.companyName} · {student.roleTitle} · {whereRejected(student)}{student.rejectionReason ? ` — “${student.rejectionReason}”` : ""}
          </DialogDescription>
        </DialogHeader>
        <form id="rsa-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <FormField id="rsa-status" label="RSA status" required>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger id="rsa-status"><SelectValue placeholder={statuses.isPending ? "Loading…" : "Choose"} /></SelectTrigger>
              <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}{option.archivedAt ? " (deleted)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="rsa-done" label="Done on">
            <Input id="rsa-done" type="date" max={today()} value={doneOn} onChange={(event) => setDoneOn(event.target.value)} />
          </FormField>
          <FormField id="rsa-summary" label="Summary" required={Boolean(status?.needsNote)} hint="Why they were rejected, gaps found, and what the student should work on." className="sm:col-span-2">
            <Textarea id="rsa-summary" rows={6} maxLength={5000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="e.g. Cleared coding, rejected in TR1 on SQL joins and project depth. Communication fine. Action: SQL practice set + project walkthrough mock." />
          </FormField>
          <FormField id="rsa-url" label="Full report link" hint="Google Doc or Drive link; make sure the team has access." className="sm:col-span-2">
            <Input id="rsa-url" type="url" maxLength={1000} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/document/d/…" />
          </FormField>
          <FormField id="rsa-people" label={`Done by${status?.needsContributor ? " *" : ""}`} className="sm:col-span-2">
            <Input id="rsa-people" placeholder="Search team members" value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} />
            <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2">
              {people.map((person) => (
                <label key={person.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <Checkbox checked={contributorIds.includes(person.id)} onCheckedChange={() => setContributorIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                  {person.fullName}
                </label>
              ))}
            </div>
            <Input className="mt-2" placeholder="Others without an account (e.g. trainer name)" maxLength={300} value={others} onChange={(event) => setOthers(event.target.value)} />
          </FormField>
        </form>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="rsa-form" disabled={save.isPending || !statusId}>{save.isPending ? "Saving…" : "Save report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The RSA team's worklist: students shared with companies and not selected, with their reports. */
export function RsaPage() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | undefined) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  });
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebouncedValue(search.trim(), 300);
  const filters: RsaFilters = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    segment: (params.get("segment") as RsaSegment | null) ?? "ACADEMY_OR_POOL",
    progress: (params.get("progress") as RsaProgress | null) ?? "ALL",
    result: (params.get("result") as RsaResult | null) ?? "ALL",
    reasonTagId: params.get("reason") ?? undefined,
    q: q || undefined,
  };
  const list = useQuery({ queryKey: ["rsa", filters], queryFn: () => rsaApi.students(filters), placeholderData: keepPreviousData });
  const [editing, setEditing] = useState<RsaStudent | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  // The chart counts the list without the reason filter, so picking a reason keeps every bar visible.
  const chartFilters = { ...filters, reasonTagId: undefined };
  const chart = useQuery({ queryKey: ["rsa", chartFilters], queryFn: () => rsaApi.students(chartFilters), placeholderData: keepPreviousData, enabled: Boolean(filters.reasonTagId) });
  const chartSummary = filters.reasonTagId ? chart.data?.summary : list.data?.summary;
  const summary = list.data?.summary;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Placements"
        title="RSA team"
        description="Every student who is in a company sheet, even before the result comes in. Tag why they were not selected, write the summary, attach the report link, and mark it done."
        actions={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setReasonsOpen(true)}><Settings2 size={14} /> Reasons</Button><Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><Settings2 size={14} /> RSA statuses</Button></div>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Students in company sheets" value={summary?.total} hint={summary ? `${summary.byResult.UNKNOWN} result not known yet` : ""} icon={ListTodo} loading={list.isPending} />
        <KpiCard label="Not started" value={summary?.notStarted} icon={Timer} tone="rose" loading={list.isPending} />
        <KpiCard label="Done" value={summary?.done} hint={summary ? `${summary.inProgress} started, not done` : ""} icon={CircleCheckBig} tone="emerald" loading={list.isPending} />
        <KpiCard label="With report link" value={summary?.withLink} icon={Link2} tone="sky" loading={list.isPending} />
      </div>
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField id="rsa-from" label="From month"><Input id="rsa-from" type="month" className="w-40" value={filters.from ?? ""} onChange={(event) => set("from", event.target.value || undefined)} /></FormField>
          <FormField id="rsa-to" label="To month"><Input id="rsa-to" type="month" className="w-40" value={filters.to ?? ""} onChange={(event) => set("to", event.target.value || undefined)} /></FormField>
          <FormField id="rsa-segment" label="Students">
            <Select value={filters.segment!} onValueChange={(value) => set("segment", value)}>
              <SelectTrigger id="rsa-segment" className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(SEGMENT_LABELS) as RsaSegment[]).map((key) => <SelectItem key={key} value={key}>{SEGMENT_LABELS[key]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="rsa-progress" label="RSA status">
            <Select value={filters.progress!} onValueChange={(value) => set("progress", value)}>
              <SelectTrigger id="rsa-progress" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(PROGRESS_LABELS) as RsaProgress[]).map((key) => <SelectItem key={key} value={key}>{PROGRESS_LABELS[key]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="rsa-result" label="Company result">
            <Select value={filters.result!} onValueChange={(value) => set("result", value === "ALL" ? undefined : value)}>
              <SelectTrigger id="rsa-result" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(RESULT_LABELS) as RsaResult[]).map((key) => <SelectItem key={key} value={key}>{RESULT_LABELS[key]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="rsa-q" label="Search"><Input id="rsa-q" className="w-56" placeholder="Name, code or company" value={search} onChange={(event) => setSearch(event.target.value)} /></FormField>
          <Button
            variant="outline" size="sm" className="ml-auto" disabled={!list.data?.items.length}
            onClick={() => downloadCsv("rsa-reports", ["Student", "Code", "Segment", "Company", "Role", "Month", "Result", "Rejected at", "Reason", "Company note", "RSA status", "Summary", "Report link", "Done by", "Done on"],
              (list.data?.items ?? []).map((student) => [student.fullName, student.candidateCode, segmentText(student), student.companyName, student.roleTitle, student.month, RESULT_LABELS[student.result], whereRejected(student), student.reason?.label ?? "", student.rejectionReason,
                student.rsa?.statusLabel ?? "Not started", student.rsa?.reportSummary, student.rsa?.reportUrl,
                student.rsa ? [...student.rsa.contributors.map((person) => person.fullName), student.rsa.otherContributors].filter(Boolean).join(", ") : "", student.rsa?.doneOn]))}
          >
            <Download size={14} /> CSV
          </Button>
        </div>
      </Card>
      {chartSummary && <ReasonChart summary={chartSummary} picked={filters.reasonTagId} onPick={(key) => set("reason", key)} />}
      <Card className="p-0">
        {list.isPending ? <LoadingRows rows={8} /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data.items.length === 0 ? (
          <EmptyState icon={FileText} title="Nobody here" description="Students appear here once they are in a company sheet (shared with the company). Try widening the filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2 font-medium">Student</th><th className="pr-3 font-medium">Company · role</th><th className="pr-3 font-medium">Result</th><th className="pr-3 font-medium">Why not selected</th><th className="pr-3 font-medium">RSA</th><th className="pr-3 font-medium">Summary</th><th className="pr-3 font-medium">Report</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.items.map((student) => (
                  <tr key={student.applicationId} className="align-top">
                    <td className="px-4 py-2.5">
                      <Link to={`/candidates/${student.candidateId}`} className="font-medium text-slate-900 hover:text-indigo-700">{student.fullName}</Link>
                      <div className="mt-0.5"><ProductBadge products={student.product} /></div>
                      <span className="block text-xs text-slate-500">{segmentText(student)}{student.candidateCode ? ` · ${student.candidateCode}` : ""}</span>
                    </td>
                    <td className="pr-3 pt-2.5 text-xs"><Link to={`/job-requests/${student.jobRequestId}?tab=notes`} className="text-slate-800 hover:text-indigo-700">{student.companyName}</Link><span className="block text-slate-500">{student.roleTitle} · {student.month}</span></td>
                    <td className="max-w-[200px] pr-3 pt-2.5 text-xs text-slate-700">
                      <span className={cn("rounded-full px-1.5 py-px text-[10px] font-medium", RESULT_TONE[student.result])}>{RESULT_LABELS[student.result]}</span>
                      <span className="mt-1 block">{whereRejected(student)}</span>
                      {student.rejectionReason && <span className="block text-slate-500">“{student.rejectionReason}”</span>}
                    </td>
                    <td className="pr-3 pt-1.5">{student.result === "SELECTED" ? <span className="text-xs text-slate-300">—</span> : <ReasonCell student={student} onAdd={() => setReasonsOpen(true)} />}</td>
                    <td className="pr-3 pt-2.5">{student.rsa ? <SupportBadge label={student.rsa.statusLabel} tone={student.rsa.statusTone} /> : <span className="text-xs text-rose-600">Not started</span>}
                      {student.rsa?.contributors.length ? <span className="mt-1 block text-[11px] text-slate-500">{student.rsa.contributors.map((person) => person.fullName).join(", ")}</span> : null}
                    </td>
                    <td className="max-w-sm pr-3 pt-2.5 text-xs text-slate-600"><p className="line-clamp-3 whitespace-pre-wrap">{student.rsa?.reportSummary ?? "—"}</p></td>
                    <td className="pr-3 pt-2.5 text-xs">{student.rsa?.reportUrl ? <a href={student.rsa.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">Open <ExternalLink size={11} /></a> : <span className="text-slate-400">—</span>}</td>
                    <td className="pr-3 pt-1.5 text-right"><Button size="sm" variant={student.rsa ? "outline" : "default"} onClick={() => setEditing(student)}><Pencil size={13} /> {student.rsa ? "Edit" : "Write"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ReportDialog student={editing} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
      <ManageStatusesDialog open={manageOpen} onOpenChange={setManageOpen} initialKind="RSA" />
      <ManageReasonsDialog open={reasonsOpen} onOpenChange={setReasonsOpen} />
    </div>
  );
}
