import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_OUTCOMES,
  PIPELINE_STATUS_LABELS,
  PIPELINE_TRANSITIONS,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  type InterviewOutcome,
  type PipelineStatus,
  type RoundType,
} from "@placement/shared";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Send, Trash2, UploadCloud } from "lucide-react";
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
import { InterviewBadge, PipelineBadge } from "../screening/badges";

function useRefresh(jobRequestId: string) {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pipeline", jobRequestId] }),
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
              <span className="text-xs text-slate-400">{app.product?.name ?? ""}</span>
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
  const [reason, setReason] = useState("");
  useEffect(() => {
    setOutcome(existing?.outcome ?? "SCHEDULED");
    setInterviewer(existing?.interviewerName ?? "");
    setFeedback(existing?.feedback ?? "");
    setReason(existing?.rejectionReason ?? "");
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => pipelineApi.recordInterview(jobRequestId, target!.nomination.id, target!.round.id, {
      outcome, interviewerName: interviewer.trim() || null, feedback: feedback.trim() || null, rejectionReason: reason.trim() || null,
    }),
    onSuccess: async () => { await refresh(); toast.success("Round result saved"); onClose(); },
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
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
          <FormField id="round-interviewer" label="Interviewer"><Input id="round-interviewer" value={interviewer} onChange={(event) => setInterviewer(event.target.value)} /></FormField>
          <FormField id="round-feedback" label="Feedback"><Textarea id="round-feedback" rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} /></FormField>
          {outcome === "REJECTED" && <FormField id="round-reason" label="Rejection reason"><Input id="round-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></FormField>}
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save result</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ jobRequestId, target, onClose }: { jobRequestId: string; target: { nomination: Nomination; to: PipelineStatus } | null; onClose: () => void }) {
  const refresh = useRefresh(jobRequestId);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  useEffect(() => { setDate(format(new Date(), "yyyy-MM-dd")); setNotes(""); }, [target]);
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
          <FormField id="status-date" label={dated ? "Date" : "Date of the change"}><Input id="status-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></FormField>
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

export function PipelineTab({ jobRequestId }: { jobRequestId: string }) {
  const { can } = usePermissions();
  const [nominating, setNominating] = useState(false);
  const [interview, setInterview] = useState<{ nomination: Nomination; round: Round } | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ nomination: Nomination; to: PipelineStatus } | null>(null);
  const [withdrawing, setWithdrawing] = useState<Nomination | null>(null);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const pipeline = useQuery({ queryKey: ["pipeline", jobRequestId], queryFn: () => pipelineApi.get(jobRequestId) });

  if (pipeline.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (pipeline.error) return <Card><ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} /></Card>;
  const { rounds, nominations, canEdit, eligibleToNominate } = pipeline.data;
  const visible = nominations.filter((nomination) => showWithdrawn || nomination.status === "NOMINATED");
  const withdrawnCount = nominations.length - nominations.filter((nomination) => nomination.status === "NOMINATED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {can("import:run") && <Button size="sm" asChild><Link to={`/job-requests/${jobRequestId}/imports/new?target=COMPANY_PIPELINE`}><UploadCloud size={14} /> Import company sheet</Link></Button>}
        {canEdit && <Button size="sm" variant="outline" onClick={() => setNominating(true)} disabled={eligibleToNominate === 0}><Send size={14} /> Nominate candidates ({eligibleToNominate} eligible)</Button>}
      </div>
      <RoundsCard jobRequestId={jobRequestId} rounds={rounds} canEdit={canEdit} />
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Nominated candidates ({nominations.length - withdrawnCount})</p>
          {withdrawnCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <Checkbox checked={showWithdrawn} onCheckedChange={(checked) => setShowWithdrawn(checked === true)} /> Show {withdrawnCount} withdrawn
            </label>
          )}
        </div>
        {visible.length === 0 ? (
          <EmptyState icon={Send} title="Nobody nominated yet" description="Nominate candidates from the final shortlist, or import the company sheet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Candidate</th>
                  {rounds.map((round) => <th key={round.id} className="whitespace-nowrap px-3 py-2">{round.name}</th>)}
                  <th className="px-4 py-2">Status</th><th className="px-4 py-2">Offer / joining</th><th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((nomination) => {
                  const next = PIPELINE_TRANSITIONS[nomination.pipelineStatus];
                  const withdrawn = nomination.status === "WITHDRAWN";
                  return (
                    <tr key={nomination.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2.5">
                        <Link to={`/candidates/${nomination.application.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{nomination.application.candidate.fullName}</Link>
                        <p className="text-xs text-slate-400">{nomination.application.product?.name ?? ""}{nomination.source === "IMPORT" ? " · from company sheet" : ""}</p>
                      </td>
                      {rounds.map((round) => {
                        const result = nomination.interviews.find((entry) => entry.roundId === round.id);
                        return (
                          <td key={round.id} className="px-3 py-2.5">
                            <button type="button" disabled={!canEdit || withdrawn} onClick={() => setInterview({ nomination, round })}
                              className="rounded-md p-0.5 hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent" title={result?.feedback ?? "Record result"}>
                              {result ? <InterviewBadge outcome={result.outcome} /> : <span className="text-xs text-slate-300">—</span>}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5">
                        {withdrawn ? <span className="text-xs text-slate-400">Withdrawn</span> : <PipelineBadge status={nomination.pipelineStatus} />}
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
    </div>
  );
}
