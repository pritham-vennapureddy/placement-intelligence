import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COMPANY_PROCESS_PHASE_LABELS, COMPANY_PROCESS_PHASES, isRoundPhase, type CompanyProcessPhase, type CompanyShareStatus, type PipelineStatus } from "@placement/shared";
import { format } from "date-fns";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { guidanceApi, trackingApi } from "../../services/tracking-api";
import { cn } from "../../utils/cn";
import { PipelineBadge } from "../screening/badges";

const today = () => format(new Date(), "yyyy-MM-dd");

/** Refreshes everything that shows company status or guidance. */
export function useTrackingRefresh() {
  const queryClient = useQueryClient();
  return () => Promise.all(["tracking", "my-work", "guidance", "insights", "pipeline", "dashboard", "companies", "job-requests"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

const PHASE_HINTS: Partial<Record<CompanyProcessPhase, string>> = {
  YET_TO_SHARE_CVS: "Shortlisting is still going on; nothing has been sent.",
  CVS_SHARED: "Profiles are with the company; no round has started.",
  HIRING_IN_PROGRESS: "The company is running its process (rounds not tracked separately).",
  ROUND_YET_TO_START: "Waiting for a specific round to begin.",
  ROUND_IN_PROGRESS: "A specific round is going on.",
  PROCESS_DONE_HIRED: "The company finished its process and hired at least one student.",
  PROCESS_DONE_NOT_HIRED: "The company finished its process without hiring anyone.",
};

export function ProcessStatusDialog({
  job,
  open,
  onOpenChange,
}: {
  job: { id: string; roleTitle: string; companyName: string; phase: CompanyProcessPhase; roundId: string | null; rounds: { id: string; name: string }[] };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useTrackingRefresh();
  const [phase, setPhase] = useState<CompanyProcessPhase>(job.phase);
  const [roundId, setRoundId] = useState<string>(job.roundId ?? "");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) { setPhase(job.phase); setRoundId(job.roundId ?? job.rounds[0]?.id ?? ""); setNotes(""); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsRound = isRoundPhase(phase);
  const save = useMutation({
    mutationFn: () => trackingApi.setProcessStatus(job.id, { phase, roundId: needsRound ? roundId : null, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onSuccess: async () => { await refresh(); toast.success("Company status updated"); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Company process status</DialogTitle>
          <DialogDescription>{job.companyName} · {job.roleTitle}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="process-phase" label="Stage" required>
            <Select value={phase} onValueChange={(value) => setPhase(value as CompanyProcessPhase)}>
              <SelectTrigger id="process-phase" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPANY_PROCESS_PHASES.map((value) => (
                  <SelectItem key={value} value={value}>{isRoundPhase(value) ? `Round: ${COMPANY_PROCESS_PHASE_LABELS[value].toLowerCase()}` : COMPANY_PROCESS_PHASE_LABELS[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {PHASE_HINTS[phase] && <p className="mt-1 text-xs text-slate-400">{PHASE_HINTS[phase]}</p>}
          </FormField>
          {needsRound && (
            <FormField id="process-round" label="Round" required>
              {job.rounds.length === 0 ? (
                <p className="text-xs text-amber-700">This job has no company rounds yet. Add them on the job's Company pipeline tab (for example TR1, TR2, HR).</p>
              ) : (
                <Select value={roundId} onValueChange={setRoundId}>
                  <SelectTrigger id="process-round" className="h-10 w-full"><SelectValue placeholder="Choose the round" /></SelectTrigger>
                  <SelectContent>{job.rounds.map((round) => <SelectItem key={round.id} value={round.id}>{round.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </FormField>
          )}
          <FormField id="process-notes" label="Notes"><Textarea id="process-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. TR1 scheduled for Friday" /></FormField>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (needsRound && !roundId)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "I gave guidance": for one known job, or with a search over every live job. */
export function RecordGuidanceDialog({
  open,
  onOpenChange,
  job,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: { id: string; label: string } | undefined;
}) {
  const refresh = useTrackingRefresh();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(job ?? null);
  const [givenOn, setGivenOn] = useState(today());
  const [notes, setNotes] = useState("");
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (open) { setPicked(job ?? null); setSearch(""); setGivenOn(today()); setNotes(""); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobs = useQuery({ queryKey: ["guidance", "jobs", debounced], queryFn: () => guidanceApi.searchJobs(debounced.trim()), enabled: open && !job });
  const save = useMutation({
    mutationFn: () => guidanceApi.addSession(picked!.id, givenOn, notes.trim() || undefined),
    onSuccess: async () => { await refresh(); toast.success("Guidance recorded"); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record guidance I gave</DialogTitle>
          <DialogDescription>It is recorded under your name, even when the job belongs to another PSM.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!job && (
            <FormField id="guidance-job" label="Job" required>
              {picked ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{picked.label}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input id="guidance-job" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, role or Job ID" className="h-9 pl-8" />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                    {jobs.data?.map((option) => (
                      <button key={option.id} type="button" className="flex w-full items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50"
                        onClick={() => setPicked({ id: option.id, label: `${option.company.name} · ${option.roleTitle}` })}>
                        <span><span className="font-medium text-slate-800">{option.company.name}</span> · {option.roleTitle}</span>
                        <span className="shrink-0 text-xs text-slate-400">{option.psmOwner?.fullName ?? "Unassigned"}</span>
                      </button>
                    ))}
                    {jobs.isPending && <p className="p-4 text-center text-xs text-slate-400">Loading…</p>}
                    {jobs.data?.length === 0 && <p className="p-4 text-center text-xs text-slate-400">No matching jobs.</p>}
                  </div>
                </div>
              )}
            </FormField>
          )}
          {job && <p className="text-sm font-medium text-slate-800">{job.label}</p>}
          <FormField id="guidance-date" label="Date" required><Input id="guidance-date" type="date" max={today()} value={givenOn} onChange={(event) => setGivenOn(event.target.value)} /></FormField>
          <FormField id="guidance-notes" label="Notes"><Textarea id="guidance-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Topics covered, how many attended…" /></FormField>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !picked || !givenOn}>Record guidance</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProcessBadge({ label, phase }: { label: string; phase: CompanyProcessPhase }) {
  const tone = phase === "PROCESS_DONE_HIRED" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : phase === "PROCESS_DONE_NOT_HIRED" ? "border-rose-200 bg-rose-50 text-rose-700"
    : phase === "OFFERS_RELEASED" ? "border-indigo-200 bg-indigo-50 text-indigo-700"
      : phase === "ON_HOLD" ? "border-amber-200 bg-amber-50 text-amber-700"
        : phase === "YET_TO_SHARE_CVS" ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-sky-200 bg-sky-50 text-sky-700";
  return <Badge variant="outline" className={cn("whitespace-nowrap", tone)}>{label}</Badge>;
}

/** Where a student stands with the company: Not shared with company, or the pipeline status. */
export function CompanyStatusCell({ shareStatus, pipelineStatus }: { shareStatus: CompanyShareStatus; pipelineStatus: PipelineStatus | null }) {
  if (shareStatus === "NOT_SHARED") return <Badge variant="outline" className="whitespace-nowrap border-amber-200 bg-amber-50 text-amber-700">Not shared with company</Badge>;
  // Shared by the job's process status; the company sheet has not been imported yet.
  if (shareStatus === "SHARED" && (!pipelineStatus || pipelineStatus === "NOT_SUBMITTED")) {
    return <Badge variant="outline" className="whitespace-nowrap border-sky-200 bg-sky-50 text-sky-700" title="The job is past “Yet to share CVs”; the company sheet is not imported yet.">Shared · sheet pending</Badge>;
  }
  if (shareStatus === "SHARED" && pipelineStatus) return <PipelineBadge status={pipelineStatus} />;
  return <span className="text-xs text-slate-300">—</span>;
}
