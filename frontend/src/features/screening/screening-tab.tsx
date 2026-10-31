import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INTERNAL_STAGES,
  STAGE_LABELS,
  STAGE_OUTCOME_LABELS,
  STAGE_OUTCOMES,
  STAGE_STATUS_LABELS,
  STAGE_STATUSES,
  type DecisionStage,
  type InternalStage,
  type StageOutcome,
  type StageStatus,
} from "@placement/shared";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, History, Pencil, Plus, Search, UploadCloud, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { usePermissions } from "../../hooks/use-permissions";
import { screeningApi } from "../../services/workflow-api";
import type { ScreeningProcess, StageCandidateRow, StageView } from "../../types/workflow";
import { cn } from "../../utils/cn";
import { CATEGORY_LABELS, OutcomeBadge, StageStatusBadge } from "./badges";
import { AddCandidateDialog, AddToStageDialog, CarryOverDialog, DecisionDialog } from "./screening-dialogs";

const ALL = "__all__";

function StageCard({ stage, total, active, onClick }: { stage: StageView; total: number; active: boolean; onClick: () => void }) {
  const { code, label } = STAGE_LABELS[stage.stage];
  const counts = stage.counts;
  const isTotal = stage.stage === "TOTAL_APPLICATIONS";
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-xl border bg-white p-3 text-left transition", active ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200 hover:border-indigo-200")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-indigo-600">{code}</span>
        <StageStatusBadge status={stage.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{isTotal ? total : counts.SELECTED ?? 0}</p>
      <p className="text-[11px] text-slate-400">
        {isTotal ? "applicants" : `selected · ${counts.REJECTED ?? 0} rejected · ${counts.ON_HOLD ?? 0} hold · ${counts.PENDING ?? 0} pending`}
      </p>
    </button>
  );
}

function StageSettings({ jobRequestId, stage, canEdit }: { jobRequestId: string; stage: StageView; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StageStatus>(stage.status);
  const [statusRemarks, setStatusRemarks] = useState("");
  const [nextPlannedDate, setNextPlannedDate] = useState(stage.nextPlannedDate?.slice(0, 10) ?? "");
  const [remarks, setRemarks] = useState(stage.remarks ?? "");
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    setStatus(stage.status);
    setStatusRemarks("");
    setNextPlannedDate(stage.nextPlannedDate?.slice(0, 10) ?? "");
    setRemarks(stage.remarks ?? "");
  }, [stage]);
  const dirty = status !== stage.status || nextPlannedDate !== (stage.nextPlannedDate?.slice(0, 10) ?? "") || remarks !== (stage.remarks ?? "");
  const save = useMutation({
    mutationFn: () => screeningApi.updateStage(jobRequestId, stage.stage, {
      ...(status !== stage.status ? { status, ...(statusRemarks.trim() ? { statusRemarks: statusRemarks.trim() } : {}) } : {}),
      nextPlannedDate: nextPlannedDate || null,
      remarks: remarks.trim() || null,
    }),
    onSuccess: (process) => {
      queryClient.setQueryData(["screening", jobRequestId], process);
      toast.success("Stage updated");
    },
  });

  return (
    <div className="space-y-3 border-b border-slate-100 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="stage-status" label="Stage status" hint="Set by you; never changed automatically.">
          <Select value={status} onValueChange={(value) => setStatus(value as StageStatus)} disabled={!canEdit}>
            <SelectTrigger id="stage-status" className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGE_STATUSES.map((value) => <SelectItem key={value} value={value}>{STAGE_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        {status !== stage.status && (
          <FormField id="stage-status-note" label="Why (optional)">
            <Input id="stage-status-note" className="h-9" value={statusRemarks} onChange={(event) => setStatusRemarks(event.target.value)} />
          </FormField>
        )}
        <FormField id="stage-next" label="Next planned date">
          <Input id="stage-next" type="date" className="h-9" value={nextPlannedDate} onChange={(event) => setNextPlannedDate(event.target.value)} disabled={!canEdit} />
        </FormField>
        <FormField id="stage-remarks" label="Remarks" className={status !== stage.status ? "" : "lg:col-span-2"}>
          <Input id="stage-remarks" className="h-9" value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={!canEdit} />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {stage.completedAt && `Completed ${format(new Date(stage.completedAt), "d MMM yyyy")} · `}
          {stage.completionLog.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-indigo-600 hover:underline" onClick={() => setShowLog(!showLog)}>
              <History size={12} /> {showLog ? "Hide" : "Show"} status history ({stage.completionLog.length})
            </button>
          )}
        </span>
        {canEdit && <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save stage"}</Button>}
      </div>
      {save.error && <p className="text-xs text-rose-600">{save.error.message}</p>}
      {showLog && (
        <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          {stage.completionLog.map((entry) => (
            <li key={entry.recordedAt}>
              {format(new Date(entry.recordedAt), "d MMM yyyy, HH:mm")} · {STAGE_STATUS_LABELS[entry.fromStatus]} → {STAGE_STATUS_LABELS[entry.toStatus]}
              {entry.recordedBy && ` · ${entry.recordedBy.fullName}`}{entry.remarks && ` · “${entry.remarks}”`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageCandidates({ jobRequestId, stage, canEdit }: { jobRequestId: string; stage: InternalStage; canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<StageOutcome | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StageCandidateRow | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { setPage(1); setOutcome(ALL); }, [stage]);
  const isTotal = stage === "TOTAL_APPLICATIONS";
  const rows = useQuery({
    queryKey: ["screening", jobRequestId, "candidates", stage, page, outcome, search],
    queryFn: () => screeningApi.candidates(jobRequestId, stage, { page, pageSize: 25, ...(outcome !== ALL ? { outcome } : {}), ...(search ? { search } : {}) }),
    // Keep the old rows while paging or filtering, but never show another stage's rows.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === stage ? keepPreviousData(previous) : undefined),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <label className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, mobile, ID…" className="h-9 pl-8" />
        </label>
        {!isTotal && (
          <Select value={outcome} onValueChange={(value) => { setOutcome(value as StageOutcome | typeof ALL); setPage(1); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All outcomes</SelectItem>
              {STAGE_OUTCOMES.map((value) => <SelectItem key={value} value={value}>{STAGE_OUTCOME_LABELS[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!isTotal && canEdit && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAdding(true)}><Plus size={14} /> Add candidates to this stage</Button>}
      </div>
      {rows.isPending ? <LoadingRows /> : rows.error ? <ErrorState error={rows.error} onRetry={() => void rows.refetch()} /> : rows.data.items.length === 0 ? (
        <EmptyState icon={Users} title={isTotal ? "No applicants yet" : "Nobody at this stage yet"}
          description={isTotal ? "Import the internal sheet, add candidates from an earlier drive, or add one by hand." : "Import a sheet for this stage or add candidates by hand."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Product</th>
                {isTotal ? <th className="px-4 py-2">Applied</th> : <><th className="px-4 py-2">Outcome</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Scores</th><th className="px-4 py-2">Reason / remarks</th></>}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.data.items.map((row) => (
                <tr key={row.application.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2.5">
                    <Link to={`/candidates/${row.application.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.application.candidate.fullName}</Link>
                    <p className="text-xs text-slate-400">{[row.application.candidate.mobile, row.application.candidate.email].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {row.application.product?.name ?? "—"}
                    {row.application.candidate.category && <p className="text-slate-400">{CATEGORY_LABELS[row.application.candidate.category]}</p>}
                  </td>
                  {isTotal ? (
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {row.application.appliedAt ? format(new Date(row.application.appliedAt), "d MMM yyyy") : "—"}
                      {row.application.source === "CARRIED_OVER" && <p className="text-indigo-600">from an earlier drive</p>}
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-2.5">{row.outcome && <OutcomeBadge outcome={row.outcome} />}<p className="mt-1 text-[11px] text-slate-400">{row.source === "IMPORT" ? "from sheet" : row.decidedBy ? `by ${row.decidedBy.fullName}` : ""}</p></td>
                      <td className="px-4 py-2.5 text-xs">{row.priority ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{row.techScore !== null && row.techScore !== undefined ? `Tech ${row.techScore}` : ""}{row.commScore !== null && row.commScore !== undefined ? ` · Comm ${row.commScore}` : ""}</td>
                      <td className="max-w-64 px-4 py-2.5 text-xs text-slate-600">{[row.rejectionReason, row.remarks].filter(Boolean).join(" · ")}</td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-right">
                    {!isTotal && canEdit && <Button size="icon-sm" variant="ghost" aria-label="Edit decision" onClick={() => setEditing(row)}><Pencil size={14} /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.data && rows.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>{rows.data.meta.total} candidates · page {page} of {rows.data.meta.totalPages}</span>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
            <Button size="icon-sm" variant="outline" disabled={page >= rows.data.meta.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
          </div>
        </div>
      )}
      {!isTotal && (
        <>
          <DecisionDialog jobRequestId={jobRequestId} stage={stage as DecisionStage} row={editing} onOpenChange={(open) => !open && setEditing(null)} />
          <AddToStageDialog jobRequestId={jobRequestId} stage={stage as DecisionStage} open={adding} onOpenChange={setAdding} />
        </>
      )}
    </div>
  );
}

function ShortlistingNotes({ jobRequestId, process, canEdit }: { jobRequestId: string; process: ScreeningProcess; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(process.shortlistingNotes ?? "");
  useEffect(() => setNotes(process.shortlistingNotes ?? ""), [process.shortlistingNotes]);
  const save = useMutation({
    mutationFn: () => screeningApi.updateNotes(jobRequestId, notes.trim() || null),
    onSuccess: (next) => {
      queryClient.setQueryData(["screening", jobRequestId], next);
      toast.success("Shortlisting method saved");
    },
  });
  return (
    <Card className="space-y-2 p-4">
      <p className="text-sm font-semibold text-slate-800">Shortlisting method followed</p>
      <p className="text-xs text-slate-400">How candidates were shortlisted for this company: criteria, tests, who screened.</p>
      <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit} placeholder="e.g. Resume screen on projects and GitHub, then a 20-minute technical call." />
      {canEdit && notes !== (process.shortlistingNotes ?? "") && (
        <div className="flex justify-end"><Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>
      )}
    </Card>
  );
}

export function ScreeningTab({ jobRequestId }: { jobRequestId: string }) {
  const { can } = usePermissions();
  const [stage, setStage] = useState<InternalStage>("TOTAL_APPLICATIONS");
  const [carryOver, setCarryOver] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const process = useQuery({ queryKey: ["screening", jobRequestId], queryFn: () => screeningApi.get(jobRequestId) });

  if (process.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (process.error) return <Card><ErrorState error={process.error} onRetry={() => void process.refetch()} /></Card>;
  const data = process.data;
  const current = data.stages.find((entry) => entry.stage === stage)!;
  const canEdit = data.canEdit;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {can("import:run") && (
          <Button size="sm" asChild><Link to={`/job-requests/${jobRequestId}/imports/new?target=INTERNAL_SCREENING`}><UploadCloud size={14} /> Import internal sheet</Link></Button>
        )}
        {can("candidate:write") && (
          <>
            <Button size="sm" variant="outline" onClick={() => setCarryOver(true)}><Users size={14} /> Add from an earlier drive</Button>
            <Button size="sm" variant="outline" onClick={() => setAddingCandidate(true)}><UserPlus size={14} /> Add a candidate</Button>
          </>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {INTERNAL_STAGES.map((key) => (
          <StageCard key={key} stage={data.stages.find((entry) => entry.stage === key)!} total={data.totalApplications} active={key === stage} onClick={() => setStage(key)} />
        ))}
      </div>
      <ShortlistingNotes jobRequestId={jobRequestId} process={data} canEdit={canEdit} />
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 pt-4">
          <p className="text-sm font-semibold text-slate-800">{STAGE_LABELS[stage].code} · {STAGE_LABELS[stage].label}</p>
        </div>
        <StageSettings jobRequestId={jobRequestId} stage={current} canEdit={canEdit} />
        <StageCandidates jobRequestId={jobRequestId} stage={stage} canEdit={canEdit} />
      </Card>
      <CarryOverDialog jobRequestId={jobRequestId} open={carryOver} onOpenChange={setCarryOver} />
      <AddCandidateDialog jobRequestId={jobRequestId} open={addingCandidate} onOpenChange={setAddingCandidate} />
    </div>
  );
}
