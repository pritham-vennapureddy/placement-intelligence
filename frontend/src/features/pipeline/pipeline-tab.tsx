import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DIRECT_SHARE_REASON_LABELS,
  DIRECT_SHARE_REASONS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_OUTCOMES,
  PIPELINE_STATUS_LABELS,
  PIPELINE_TRANSITIONS,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  type DirectShareReason,
  type InterviewOutcome,
  type PipelineStatus,
  type RoundType,
} from "@placement/shared";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ClipboardCheck, CornerDownRight, FileText, Plus, Send, Tag, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { usePermissions } from "../../hooks/use-permissions";
import { pipelineApi } from "../../services/workflow-api";
import type { Nomination, Round } from "../../types/workflow";
import { RefreshFromGoogleButton } from "../imports/refresh-button";
import { JobTrackingPanel } from "../tracking/job-tracking-panel";
import { ProcessDates } from "../tracking/tracking-dialogs";
import { InterviewBadge, PipelineBadge } from "../screening/badges";
import { PipelineOverview, productOf, segmentOf, SEGMENT_LABELS, type PipelineFilter, type Segment } from "./pipeline-overview";
import { ProductBadge } from "../../components/student-tags";
import { docUrlError, emptyRejection, RejectionReasonFields, rejectionPayload, type RejectionValue } from "./rejection-reason-fields";

function useRefresh(jobRequestId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pipeline", jobRequestId] }),
    queryClient.invalidateQueries({ queryKey: ["tracking", jobRequestId] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

function RoundsCard({ jobRequestId, rounds, canEdit }: { jobRequestId: string; rounds: Round[]; canEdit: boolean }) {
  const refresh = useRefresh(jobRequestId);
  const [name, setName] = useState("");
  const [roundType, setRoundType] = useState<RoundType>("TECHNICAL");
  const run = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message),
  });
  const move = (index: number, delta: number) => {
    const ids = rounds.map((round) => round.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    run.mutate(() => pipelineApi.reorderRounds(jobRequestId, ids));
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-800">Company rounds</p>
        <p className="text-xs text-slate-400">Configured for this job; the company sheet import can add them too.</p>
      </div>
      {rounds.length === 0 && <p className="text-xs text-slate-500">No rounds yet.</p>}
      <ol className="flex flex-wrap gap-2">
        {rounds.map((round, index) => (
          <li key={round.id} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm">
            <span className="font-medium text-slate-700">{index + 1}. {round.name}</span>
            <span className="text-xs text-slate-400">· {ROUND_TYPE_LABELS[round.roundType]}</span>
            {canEdit && (
              <>
                <Button size="icon-sm" variant="ghost" disabled={index === 0 || run.isPending} onClick={() => move(index, -1)} aria-label="Move earlier"><ArrowUp size={13} /></Button>
                <Button size="icon-sm" variant="ghost" disabled={index === rounds.length - 1 || run.isPending} onClick={() => move(index, 1)} aria-label="Move later"><ArrowDown size={13} /></Button>
                <Button size="icon-sm" variant="ghost" disabled={round.interviews > 0 || run.isPending} title={round.interviews > 0 ? "Has results; cannot be removed" : "Remove"}
                  onClick={() => run.mutate(() => pipelineApi.deleteRound(jobRequestId, round.id))} aria-label="Remove round"><Trash2 size={13} /></Button>
              </>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Round name, e.g. TR Round 2" className="h-9 w-56" />
          <Select value={roundType} onValueChange={(value) => setRoundType(value as RoundType)}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{ROUND_TYPES.map((type) => <SelectItem key={type} value={type}>{ROUND_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!name.trim() || run.isPending}
            onClick={() => run.mutate(async () => { await pipelineApi.createRound(jobRequestId, name.trim(), roundType); setName(""); })}>
            <Plus size={14} /> Add round
          </Button>
        </div>
      )}
    </Card>
  );
}

function NominateDialog({ jobRequestId, open, onOpenChange }: { jobRequestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const [onlyFinal, setOnlyFinal] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { if (open) setSelected(new Set()); }, [open]);
  const eligible = useQuery({ queryKey: ["pipeline", jobRequestId, "eligible"], queryFn: () => pipelineApi.eligible(jobRequestId), enabled: open });
  const list = useMemo(() => (eligible.data ?? [])
    .filter((app) => !onlyFinal || app.outcomes.FINAL_SHORTLIST === "SELECTED")
    .sort((a, b) => (a.finalPriority ?? "P9").localeCompare(b.finalPriority ?? "P9")), [eligible.data, onlyFinal]);
  const save = useMutation({
    mutationFn: () => pipelineApi.nominate(jobRequestId, [...selected]),
    onSuccess: async (result) => {
      await refresh();
      toast.success(`${result.nominated} nominated`);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nominate to the company</DialogTitle>
          <DialogDescription>Candidates rejected at any internal stage are not listed and cannot be nominated.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <Checkbox checked={onlyFinal} onCheckedChange={(checked) => setOnlyFinal(checked === true)} /> Only candidates selected at the final shortlist (SP)
        </label>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          {list.map((app) => (
            <label key={app.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
              <Checkbox checked={selected.has(app.id)} onCheckedChange={() => setSelected((current) => {
                const next = new Set(current);
                if (next.has(app.id)) next.delete(app.id); else next.add(app.id);
                return next;
              })} />
              <span className="flex-1">
                <span className="font-medium text-slate-800">{app.candidate.fullName}</span>
                <span className="ml-2 text-xs text-slate-400">{app.candidate.mobile ?? app.candidate.email}</span>
              </span>
              {app.finalPriority && <span className="text-xs text-slate-500">{app.finalPriority}</span>}
              <ProductBadge products={app.product ? [app.product] : app.candidate.products} />
            </label>
          ))}
          {eligible.isPending && <p className="p-6 text-center text-sm text-slate-400">Loading…</p>}
          {eligible.data && list.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Nobody to nominate{onlyFinal ? " from the final shortlist" : ""}.</p>}
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button disabled={selected.size === 0 || save.isPending} onClick={() => save.mutate()}>Nominate {selected.size || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InterviewDialog({ jobRequestId, target, onClose }: { jobRequestId: string; target: { nomination: Nomination; round: Round } | null; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const existing = target?.nomination.interviews.find((interview) => interview.roundId === target.round.id);
  const [outcome, setOutcome] = useState<InterviewOutcome>("SCHEDULED");
  const [interviewer, setInterviewer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [rejection, setRejection] = useState<RejectionValue>(emptyRejection);
  const [roundDate, setRoundDate] = useState("");
  useEffect(() => {
    setRoundDate(existing?.scheduledAt?.slice(0, 10) ?? "");
    setOutcome(existing?.outcome ?? "SCHEDULED");
    setInterviewer(existing?.interviewerName ?? "");
    setFeedback(existing?.feedback ?? "");
    setRejection({ tagId: existing?.rejectionTag?.id ?? null, note: existing?.rejectionReason ?? "", docUrl: existing?.rejectionDocUrl ?? "" });
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => pipelineApi.recordInterview(jobRequestId, target!.nomination.id, target!.round.id, {
      outcome,
      // A calendar day, stored at midnight UTC so it reads back as the same day.
      scheduledAt: roundDate ? `${roundDate}T00:00:00.000Z` : null,
      interviewerName: interviewer.trim() || null, feedback: feedback.trim() || null,
      ...(outcome === "REJECTED" ? rejectionPayload(rejection) : {}),
    }),
    onSuccess: async () => { await refresh(); toast.success("Round result saved"); onClose(); },
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target?.round.name}</DialogTitle>
          <DialogDescription>{target?.nomination.application.candidate.fullName}. Round results do not change the overall status; use “Change status” for that.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="round-outcome" label="Result" required>
            <Select value={outcome} onValueChange={(value) => setOutcome(value as InterviewOutcome)}>
              <SelectTrigger id="round-outcome" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{INTERVIEW_OUTCOMES.map((value) => <SelectItem key={value} value={value}>{value === "SCHEDULED" ? "Scheduled / in progress" : INTERVIEW_OUTCOME_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="round-date" label="Round date">
            <Input id="round-date" type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)} />
          </FormField>
          <FormField id="round-interviewer" label="Interviewer"><Input id="round-interviewer" value={interviewer} onChange={(event) => setInterviewer(event.target.value)} /></FormField>
          <FormField id="round-feedback" label="Feedback"><Textarea id="round-feedback" rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></FormField>
          {outcome === "REJECTED" && <RejectionReasonFields idPrefix="round" value={rejection} onChange={setRejection} />}
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (outcome === "REJECTED" && Boolean(docUrlError(rejection.docUrl)))}>Save result</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The student's interview-done date if known: their process end date, else their latest round date. */
function knownHiredDate(nomination: Nomination): string | null {
  if (nomination.processEndDate) return nomination.processEndDate.slice(0, 10);
  const rounds = nomination.interviews.map((entry) => entry.scheduledAt?.slice(0, 10)).filter((value): value is string => Boolean(value)).sort();
  return rounds.at(-1) ?? null;
}

const PLACED_STATUSES: readonly PipelineStatus[] = ["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "JOINED"];

function StatusDialog({ jobRequestId, target, onClose }: { jobRequestId: string; target: { nomination: Nomination; to: PipelineStatus } | null; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const hiring = target?.to === "SELECTED";
  useEffect(() => {
    setDate((target?.to === "SELECTED" ? knownHiredDate(target.nomination) : null) ?? format(new Date(), "yyyy-MM-dd"));
    setNotes("");
  }, [target]);
  const save = useMutation({
    mutationFn: () => pipelineApi.changeStatus(jobRequestId, target!.nomination.id, target!.to, date, notes.trim() || undefined),
    onSuccess: async () => { await refresh(); toast.success("Status updated"); onClose(); },
  });
  const dated = target && ["OFFER_RELEASED", "OFFER_ACCEPTED", "JOINED", "IN_PROCESS"].includes(target.to);
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target ? PIPELINE_STATUS_LABELS[target.to] : ""}</DialogTitle>
          <DialogDescription>{target?.nomination.application.candidate.fullName} · currently {target ? PIPELINE_STATUS_LABELS[target.nomination.pipelineStatus].toLowerCase() : ""}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="status-date" label={hiring ? "Interview done date (hired date)" : dated ? "Date" : "Date of the change"}>
            <Input id="status-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            {hiring && <p className="mt-1 text-xs text-slate-500">The placement counts in this month. It is saved as the student's process end date.</p>}
          </FormField>
          <FormField id="status-notes" label="Notes"><Textarea id="status-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !date}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ jobRequestId, nomination, onClose }: { jobRequestId: string; nomination: Nomination | null; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(""), [nomination]);
  const save = useMutation({
    mutationFn: () => pipelineApi.withdraw(jobRequestId, nomination!.id, notes.trim()),
    onSuccess: async () => { await refresh(); toast.success("Nomination withdrawn"); onClose(); },
  });
  return (
    <Dialog open={Boolean(nomination)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw nomination?</DialogTitle>
          <DialogDescription>{nomination?.application.candidate.fullName} will no longer count as nominated. Their history is kept.</DialogDescription>
        </DialogHeader>
        <FormField id="withdraw-notes" label="Reason" required><Textarea id="withdraw-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></FormField>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={() => save.mutate()} disabled={save.isPending || notes.trim().length < 2}>Withdraw</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nominated without being selected at the internal final shortlist (SP): shared to the company directly. */
const isDirectShare = (nomination: Nomination) => !nomination.application.stageOutcomes.some((outcome) => outcome.outcome === "SELECTED");

export function PipelineTab({ jobRequestId, roleTitle = "", companyName = "" }: { jobRequestId: string; roleTitle?: string; companyName?: string }) {
  const { can } = usePermissions();
  const [nominating, setNominating] = useState(false);
  const [interview, setInterview] = useState<{ nomination: Nomination; round: Round } | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ nomination: Nomination; to: PipelineStatus } | null>(null);
  const [withdrawing, setWithdrawing] = useState<Nomination | null>(null);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [datesTarget, setDatesTarget] = useState<Nomination | null>(null);
  const [directTarget, setDirectTarget] = useState<Nomination[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkDates, setBulkDates] = useState<Nomination[] | null>(null);
  const [bulkRound, setBulkRound] = useState<Nomination[] | null>(null);
  const [filter, setFilter] = useState<PipelineFilter>({ segment: "ALL", product: "ALL" });
  const pipeline = useQuery({ queryKey: ["pipeline", jobRequestId], queryFn: () => pipelineApi.get(jobRequestId) });

  if (pipeline.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (pipeline.error) return <Card><ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} /></Card>;
  const { rounds, nominations, canEdit, eligibleToNominate } = pipeline.data;
  const active = nominations.filter((nomination) => nomination.status === "NOMINATED");
  const matchesFilter = (nomination: Nomination) =>
    (filter.segment === "ALL" || segmentOf(nomination) === filter.segment) && (filter.product === "ALL" || productOf(nomination) === filter.product);
  const visible = nominations.filter((nomination) => (showWithdrawn || nomination.status === "NOMINATED") && matchesFilter(nomination));
  const filterLabel = filter.product !== "ALL" ? filter.product : filter.segment !== "ALL" ? SEGMENT_LABELS[filter.segment] : null;
  const withdrawnCount = nominations.length - nominations.filter((nomination) => nomination.status === "NOMINATED").length;
  const direct = nominations.filter((nomination) => nomination.status === "NOMINATED" && isDirectShare(nomination));
  const untagged = direct.filter((nomination) => !nomination.directShareReason);
  const pickable = visible.filter((nomination) => nomination.status === "NOMINATED");
  const pickedList = nominations.filter((nomination) => picked.has(nomination.id) && nomination.status === "NOMINATED");
  const allPicked = pickable.length > 0 && pickable.every((nomination) => picked.has(nomination.id));
  const togglePick = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const shared = active.filter((nomination) => nomination.pipelineStatus !== "NOT_SUBMITTED");
  const sharedWithoutEnd = shared.filter((nomination) => !nomination.processEndDate);
  const starts = active.map((nomination) => nomination.processStartDate?.slice(0, 10)).filter((value): value is string => Boolean(value)).sort();
  const ends = shared.map((nomination) => nomination.processEndDate?.slice(0, 10)).filter((value): value is string => Boolean(value)).sort();
  const companyStart = starts[0] ?? null;
  const companyEnd = shared.length > 0 && sharedWithoutEnd.length === 0 ? ends.at(-1) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RefreshFromGoogleButton jobRequestId={jobRequestId} target="COMPANY_PIPELINE" />
        {can("import:run") && <Button size="sm" asChild><Link to={`/job-requests/${jobRequestId}/imports/new?target=COMPANY_PIPELINE`}><UploadCloud size={14} /> Import company sheet</Link></Button>}
        {canEdit && <Button size="sm" variant="outline" onClick={() => setNominating(true)} disabled={eligibleToNominate === 0}><Send size={14} /> Nominate candidates ({eligibleToNominate} eligible)</Button>}
      </div>
      <JobTrackingPanel jobRequestId={jobRequestId} roleTitle={roleTitle} companyName={companyName} rounds={rounds.map(({ id, name }) => ({ id, name }))} />
      <RoundsCard jobRequestId={jobRequestId} rounds={rounds} canEdit={canEdit} />
      <PipelineOverview nominations={active} filter={filter} onFilter={setFilter} />
      <Card className="overflow-hidden">
        {direct.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-900">
            <CornerDownRight size={14} />
            <span>
              {direct.length} of these {direct.length === 1 ? "profile" : "profiles"} reached the company without the internal shortlist (not selected at SP)
              {untagged.length > 0 ? <> · <strong>{untagged.length} not tagged with a reason</strong></> : " · all tagged"}.
            </span>
            {canEdit && (
              <Button size="sm" variant="outline" className="ml-auto h-7 bg-white" onClick={() => setDirectTarget(untagged.length > 0 ? untagged : direct)}>
                <Tag size={13} /> {untagged.length > 0 ? `Tag ${untagged.length} untagged` : "Change tag for all"}
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">
            Nominated candidates ({nominations.length - withdrawnCount})
            {filterLabel && <span className="ml-2 text-xs font-normal text-indigo-700">showing {visible.length} · {filterLabel}</span>}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-3">
          {canEdit && sharedWithoutEnd.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPicked(new Set(sharedWithoutEnd.filter(matchesFilter).map((nomination) => nomination.id)))}>
              Select {sharedWithoutEnd.filter(matchesFilter).length} without end date
            </Button>
          )}
          <Select value={filter.segment} onValueChange={(value) => setFilter({ segment: value as Segment | "ALL", product: "ALL" })}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by segment"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All students</SelectItem>
              {(Object.keys(SEGMENT_LABELS) as Segment[]).map((segment) => (
                <SelectItem key={segment} value={segment}>{SEGMENT_LABELS[segment]} ({active.filter((nomination) => segmentOf(nomination) === segment).length})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {withdrawnCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <Checkbox checked={showWithdrawn} onCheckedChange={(checked) => setShowWithdrawn(checked === true)} /> Show {withdrawnCount} withdrawn
            </label>
          )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/50 px-4 py-2 text-xs text-slate-600">
          <span>
            <span className="font-medium text-slate-700">Company process:</span>{" "}
            {companyStart || companyEnd ? <ProcessDates start={companyStart} end={companyEnd} /> : <span className="text-slate-400">no student dates yet</span>}
          </span>
          <span className="text-slate-400">
            Calculated from the students' dates.
            {sharedWithoutEnd.length > 0 && shared.length > 0 && ` Ends once all ${shared.length} shared students have an end date (${sharedWithoutEnd.length} missing).`}
          </span>
        </div>
        {canEdit && pickedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2 text-xs text-indigo-900">
            <span className="font-medium">{pickedList.length} selected</span>
            {rounds.length > 0 && <Button size="sm" className="h-7" onClick={() => setBulkRound(pickedList)}><ClipboardCheck size={13} /> Record round result</Button>}
            <Button size="sm" variant="outline" className="h-7 bg-white" onClick={() => setBulkDates(pickedList)}><CalendarDays size={13} /> Set process dates</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
        )}
        {visible.length === 0 ? (
          filterLabel
            ? <EmptyState icon={Send} title={`No ${filterLabel} students here`} description="Clear the filter to see everyone." />
            : <EmptyState icon={Send} title="Nobody nominated yet" description="Nominate candidates from the final shortlist, or import the company sheet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  {canEdit && (
                    <th className="w-8 py-2 pl-4">
                      <Checkbox aria-label="Select all shown" checked={allPicked}
                        onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((nomination) => nomination.id)))} />
                    </th>
                  )}
                  <th className="px-4 py-2">Candidate</th>
                  {rounds.map((round) => <th key={round.id} className="whitespace-nowrap px-3 py-2">{round.name}</th>)}
                  <th className="px-4 py-2">Status</th><th className="whitespace-nowrap px-4 py-2">Process dates</th><th className="px-4 py-2">Offer / joining</th><th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((nomination) => {
                  const next = PIPELINE_TRANSITIONS[nomination.pipelineStatus];
                  const withdrawn = nomination.status === "WITHDRAWN";
                  return (
                    <tr key={nomination.id} className={`border-t border-slate-100 align-top ${picked.has(nomination.id) ? "bg-indigo-50/40" : ""}`}>
                      {canEdit && (
                        <td className="py-3 pl-4">
                          <Checkbox aria-label={`Select ${nomination.application.candidate.fullName}`} disabled={withdrawn}
                            checked={picked.has(nomination.id) && !withdrawn} onCheckedChange={() => togglePick(nomination.id)} />
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Link to={`/candidates/${nomination.application.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{nomination.application.candidate.fullName}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <ProductBadge products={nomination.application.product ? [nomination.application.product] : nomination.application.candidate.products} />
                          {nomination.source === "IMPORT" && <span className="text-[11px] text-slate-400">from company sheet</span>}
                        </div>
                        {isDirectShare(nomination) && (
                          <button type="button" disabled={!canEdit} onClick={() => setDirectTarget([nomination])}
                            title={nomination.directShareNote ?? (canEdit ? "Say why this profile skipped the internal shortlist" : undefined)}
                            className={`mt-1 inline-flex max-w-56 items-center gap-1 rounded-full border px-2 py-0.5 text-left text-[11px] disabled:cursor-default ${nomination.directShareReason
                              ? "border-sky-200 bg-sky-50 text-sky-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                            <CornerDownRight size={11} className="shrink-0" />
                            <span className="truncate">Direct to company · {nomination.directShareReason ? DIRECT_SHARE_REASON_LABELS[nomination.directShareReason] : "reason?"}</span>
                          </button>
                        )}
                      </td>
                      {rounds.map((round) => {
                        const result = nomination.interviews.find((entry) => entry.roundId === round.id);
                        return (
                          <td key={round.id} className="px-3 py-2.5">
                            <button type="button" disabled={!canEdit || withdrawn} onClick={() => setInterview({ nomination, round })}
                              className="rounded-md p-0.5 hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent" title={result?.feedback ?? "Record result"}>
                              {result ? <InterviewBadge outcome={result.outcome} /> : <span className="text-xs text-slate-300">—</span>}
                              {result?.scheduledAt && <p className="mt-0.5 whitespace-nowrap text-[10px] text-slate-400">{format(new Date(`${result.scheduledAt.slice(0, 10)}T00:00:00`), "d MMM yyyy")}</p>}
                              {result?.outcome === "REJECTED" && (
                                <p className={`mt-0.5 max-w-32 truncate text-left text-[10px] ${result.rejectionTag ? "text-rose-700" : "font-medium text-amber-700"}`}
                                  title={[result.rejectionTag?.label, result.rejectionReason].filter(Boolean).join(" — ") || undefined}>
                                  {result.rejectionTag?.label ?? (canEdit ? "Add reason" : "No reason")}
                                </p>
                              )}
                            </button>
                            {result?.rejectionDocUrl && (
                              <a href={result.rejectionDocUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:underline"><FileText size={10} /> Doc</a>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5">
                        {withdrawn ? <span className="text-xs text-slate-400">Withdrawn</span> : <PipelineBadge status={nomination.pipelineStatus} />}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        <button type="button" disabled={!canEdit} onClick={() => setDatesTarget(nomination)}
                          className="rounded-md p-0.5 text-left hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent" title={canEdit ? "Set process dates" : undefined}>
                          <ProcessDates start={nomination.processStartDate} end={nomination.processEndDate} />
                          {!withdrawn && PLACED_STATUSES.includes(nomination.pipelineStatus) && !nomination.processEndDate && (
                            <p className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-amber-700">Add hired date</p>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {nomination.offerReleasedAt && <p>Offer {format(new Date(nomination.offerReleasedAt), "d MMM")}</p>}
                        {nomination.offerAcceptedAt && <p>Accepted {format(new Date(nomination.offerAcceptedAt), "d MMM")}</p>}
                        {nomination.joinedAt && <p className="font-medium text-emerald-700">Joined {format(new Date(nomination.joinedAt), "d MMM yyyy")}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && !withdrawn && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Change status <ChevronDown size={13} /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {next.map((status) => (
                                <DropdownMenuItem key={status} onSelect={() => setStatusTarget({ nomination, to: status })}>{PIPELINE_STATUS_LABELS[status]}</DropdownMenuItem>
                              ))}
                              {next.length === 0 && <DropdownMenuItem disabled>No further steps</DropdownMenuItem>}
                              {["NOT_SUBMITTED", "IN_PROCESS", "ON_HOLD", "REJECTED"].includes(nomination.pipelineStatus) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-rose-600" onSelect={() => setWithdrawing(nomination)}>Withdraw nomination…</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <NominateDialog jobRequestId={jobRequestId} open={nominating} onOpenChange={setNominating} />
      <InterviewDialog jobRequestId={jobRequestId} target={interview} onClose={() => setInterview(null)} />
      <StatusDialog jobRequestId={jobRequestId} target={statusTarget} onClose={() => setStatusTarget(null)} />
      <WithdrawDialog jobRequestId={jobRequestId} nomination={withdrawing} onClose={() => setWithdrawing(null)} />
      <StudentProcessDatesDialog jobRequestId={jobRequestId} nomination={datesTarget} onClose={() => setDatesTarget(null)} />
      <BulkProcessDatesDialog jobRequestId={jobRequestId} targets={bulkDates} onClose={(saved) => { setBulkDates(null); if (saved) setPicked(new Set()); }} />
      <BulkRoundResultDialog jobRequestId={jobRequestId} rounds={rounds} targets={bulkRound} onClose={(saved) => { setBulkRound(null); if (saved) setPicked(new Set()); }} />
      <DirectShareDialog jobRequestId={jobRequestId} targets={directTarget} untagged={untagged} onClose={() => setDirectTarget(null)} />
    </div>
  );
}

/** One round result (and, for rejections, the reason) for many students at once. */
function BulkRoundResultDialog({ jobRequestId, rounds, targets, onClose }: { jobRequestId: string; rounds: Round[]; targets: Nomination[] | null; onClose: (saved: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const [roundId, setRoundId] = useState("");
  const [outcome, setOutcome] = useState<InterviewOutcome>("REJECTED");
  const [roundDate, setRoundDate] = useState("");
  const [rejection, setRejection] = useState<RejectionValue>(emptyRejection);
  useEffect(() => {
    setRoundId(rounds[0]?.id ?? "");
    setOutcome("REJECTED");
    setRoundDate("");
    setRejection(emptyRejection());
  }, [targets]); // eslint-disable-line react-hooks/exhaustive-deps
  const round = rounds.find((entry) => entry.id === roundId);
  const alreadyRecorded = round ? (targets ?? []).filter((nomination) => nomination.interviews.some((entry) => entry.roundId === round.id)).length : 0;
  const save = useMutation({
    mutationFn: () => pipelineApi.recordInterviewsBulk(jobRequestId, roundId, {
      nominationIds: (targets ?? []).map((nomination) => nomination.id),
      outcome,
      ...(roundDate ? { scheduledAt: `${roundDate}T00:00:00.000Z` } : {}),
      ...(outcome === "REJECTED" ? rejectionPayload(rejection) : {}),
    }),
    onSuccess: async () => { await refresh(); toast.success(`Saved ${round?.name ?? "round"} result for ${targets?.length ?? 0} students`); onClose(true); },
  });
  return (
    <Dialog open={Boolean(targets)} onOpenChange={(open) => !open && !save.isPending && onClose(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a round result for {targets?.length ?? 0} students</DialogTitle>
          <DialogDescription>Use this when the company gives the same result for several students, e.g. everyone rejected in the technical round.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bulk-round" label="Round" required>
              <Select value={roundId} onValueChange={setRoundId}>
                <SelectTrigger id="bulk-round" className="h-10 w-full"><SelectValue placeholder="Choose a round" /></SelectTrigger>
                <SelectContent>{rounds.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField id="bulk-outcome" label="Result" required>
              <Select value={outcome} onValueChange={(value) => setOutcome(value as InterviewOutcome)}>
                <SelectTrigger id="bulk-outcome" className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{INTERVIEW_OUTCOMES.map((value) => <SelectItem key={value} value={value}>{value === "SCHEDULED" ? "Scheduled / in progress" : INTERVIEW_OUTCOME_LABELS[value]}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField id="bulk-round-date" label="Round date" hint="Leave blank to keep each student's own date.">
            <Input id="bulk-round-date" type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)} />
          </FormField>
          {outcome === "REJECTED" && <RejectionReasonFields idPrefix="bulk-round" value={rejection} onChange={setRejection} />}
          {alreadyRecorded > 0 && <p className="text-xs text-amber-700">{alreadyRecorded} of these students already have a {round?.name} result; it will be replaced.</p>}
          <p className="text-xs text-slate-500">{targets?.map((nomination) => nomination.application.candidate.fullName).join(", ")}</p>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!roundId || save.isPending || (outcome === "REJECTED" && Boolean(docUrlError(rejection.docUrl)))}>Save for {targets?.length ?? 0}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same process start and/or end date for many students at once. A date left
 * blank keeps each student's own; the job's company process dates follow.
 */
function BulkProcessDatesDialog({ jobRequestId, targets, onClose }: { jobRequestId: string; targets: Nomination[] | null; onClose: (saved: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clearStart, setClearStart] = useState(false);
  const [clearEnd, setClearEnd] = useState(false);
  useEffect(() => { setStartDate(""); setEndDate(""); setClearStart(false); setClearEnd(false); }, [targets]);
  const hired = (targets ?? []).filter((nomination) => PLACED_STATUSES.includes(nomination.pipelineStatus)).length;
  const invalid = Boolean(startDate && endDate && endDate < startDate);
  const nothing = !startDate && !endDate && !clearStart && !clearEnd;
  const save = useMutation({
    mutationFn: () => pipelineApi.setProcessDatesBulk(jobRequestId, {
      nominationIds: (targets ?? []).map((nomination) => nomination.id),
      ...(clearStart ? { startDate: null } : startDate ? { startDate } : {}),
      ...(clearEnd ? { endDate: null } : endDate ? { endDate } : {}),
    }),
    onSuccess: async () => { await refresh(); toast.success(`Process dates saved for ${targets?.length ?? 0} students`); onClose(true); },
  });
  return (
    <Dialog open={Boolean(targets)} onOpenChange={(open) => !open && !save.isPending && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set process dates</DialogTitle>
          <DialogDescription>For {targets?.length ?? 0} selected students. Leave a date blank to keep each student's own.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="bulk-process-start" label="Start date">
            <Input id="bulk-process-start" type="date" value={startDate} disabled={clearStart} onChange={(event) => setStartDate(event.target.value)} />
            <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Checkbox checked={clearStart} onCheckedChange={(checked) => { setClearStart(checked === true); setStartDate(""); }} /> Clear start dates</label>
          </FormField>
          <FormField id="bulk-process-end" label="End date (interview done)">
            <Input id="bulk-process-end" type="date" value={endDate} min={startDate || undefined} disabled={clearEnd} onChange={(event) => setEndDate(event.target.value)} />
            <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><Checkbox checked={clearEnd} onCheckedChange={(checked) => { setClearEnd(checked === true); setEndDate(""); }} /> Clear end dates</label>
          </FormField>
        </div>
        {hired > 0 && endDate && <p className="text-xs text-slate-500">{hired} of them {hired === 1 ? "is" : "are"} hired: the end date is their hired date, so the placement counts in that month.</p>}
        <p className="text-xs text-slate-500">The company process start and end are recalculated from all students' dates.</p>
        {invalid && <p className="text-xs text-rose-600">The end date cannot be before the start date.</p>}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || invalid || nothing}>Save for {targets?.length ?? 0}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hand-entered start / end dates of one student's company process. */
function StudentProcessDatesDialog({ jobRequestId, nomination, onClose }: { jobRequestId: string; nomination: Nomination | null; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  useEffect(() => {
    if (nomination) { setStartDate(nomination.processStartDate?.slice(0, 10) ?? ""); setEndDate(nomination.processEndDate?.slice(0, 10) ?? ""); }
  }, [nomination]);
  const invalid = Boolean(startDate && endDate && endDate < startDate);
  const placed = Boolean(nomination && nomination.status !== "WITHDRAWN" && PLACED_STATUSES.includes(nomination.pipelineStatus));
  const save = useMutation({
    mutationFn: () => pipelineApi.setProcessDates(jobRequestId, nomination!.id, { startDate: startDate || null, endDate: endDate || null }),
    onSuccess: async () => { await refresh(); toast.success("Process dates saved"); onClose(); },
  });
  return (
    <Dialog open={Boolean(nomination)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Student process dates</DialogTitle>
          <DialogDescription>{nomination?.application.candidate.fullName} · when this student's company process started and ended.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="student-process-start" label="Start date">
            <Input id="student-process-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </FormField>
          <FormField id="student-process-end" label={placed ? "End date (interview done / hired)" : "End date"}>
            <Input id="student-process-end" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
          </FormField>
        </div>
        {placed && <p className="text-xs text-slate-500">This student was hired: the placement counts in the month of the end date.</p>}
        {invalid && <p className="text-xs text-rose-600">The end date cannot be before the start date.</p>}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || invalid}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Why profiles reached the company without the internal shortlist — e.g. the company never
 * takes our shortlisting, or another team shared the profiles straight into the company sheet.
 */
function DirectShareDialog({ jobRequestId, targets, untagged, onClose }: { jobRequestId: string; targets: Nomination[] | null; untagged: Nomination[]; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const [reason, setReason] = useState<DirectShareReason | "">("");
  const [note, setNote] = useState("");
  const [alsoUntagged, setAlsoUntagged] = useState(false);
  const single = targets?.length === 1 ? targets[0]! : null;
  // Other untagged direct profiles that one tag could cover too.
  const others = single ? untagged.filter((nomination) => nomination.id !== single.id) : [];
  useEffect(() => {
    if (!targets) return;
    const reasons = new Set(targets.map((nomination) => nomination.directShareReason));
    const shared = reasons.size === 1 ? [...reasons][0] : null;
    setReason(shared ?? "");
    setNote(targets.length === 1 ? targets[0]!.directShareNote ?? "" : "");
    setAlsoUntagged(false);
  }, [targets]);
  const ids = [...(targets ?? []), ...(alsoUntagged ? others : [])].map((nomination) => nomination.id);
  const save = useMutation({
    mutationFn: (clear: boolean) => pipelineApi.setDirectShare(jobRequestId, {
      nominationIds: ids,
      reason: clear ? null : reason || null,
      note: clear ? null : note.trim() || null,
    }),
    onSuccess: async (_, clear) => { await refresh(); toast.success(clear ? "Tag removed" : ids.length === 1 ? "Tagged" : `${ids.length} profiles tagged`); onClose(); },
  });
  const tagged = targets?.some((nomination) => nomination.directShareReason) ?? false;
  return (
    <Dialog open={Boolean(targets)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why didn't this go through shortlisting?</DialogTitle>
          <DialogDescription>
            {single ? single.application.candidate.fullName : `${targets?.length ?? 0} profiles`} reached the company without being selected in the internal process (TA → SP).
            The internal and company sheets both stay as they are; this only records why.
          </DialogDescription>
        </DialogHeader>
        <FormField id="direct-reason" label="Reason">
          <Select value={reason} onValueChange={(value) => setReason(value as DirectShareReason)}>
            <SelectTrigger id="direct-reason"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
            <SelectContent>{DIRECT_SHARE_REASONS.map((value) => <SelectItem key={value} value={value}>{DIRECT_SHARE_REASON_LABELS[value]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        <FormField id="direct-note" label="Note (optional)">
          <Textarea id="direct-note" rows={2} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="E.g. who shared it, or what the company asked for" />
        </FormField>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Checkbox checked={alsoUntagged} onCheckedChange={(checked) => setAlsoUntagged(checked === true)} />
            Also tag the {others.length} other untagged direct {others.length === 1 ? "profile" : "profiles"} in this job
          </label>
        )}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          {tagged && <Button variant="ghost" className="mr-auto" onClick={() => save.mutate(true)} disabled={save.isPending}>Remove tag</Button>}
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate(false)} disabled={save.isPending || !reason}>Save{ids.length > 1 ? ` for ${ids.length}` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
