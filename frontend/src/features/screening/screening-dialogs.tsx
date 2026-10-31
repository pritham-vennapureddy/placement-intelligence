import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DECISION_STAGES,
  INTERNAL_STAGES,
  PRIORITIES,
  STAGE_LABELS,
  STAGE_OUTCOME_LABELS,
  STAGE_OUTCOMES,
  type DecisionStage,
  type Priority,
  type StageOutcome,
} from "@placement/shared";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { catalogApi } from "../../services/api";
import { applicationsApi, screeningApi } from "../../services/workflow-api";
import type { StageCandidateRow } from "../../types/workflow";
import { OutcomeBadge } from "./badges";

const NONE = "__none__";

function useRefresh(jobRequestId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["screening", jobRequestId] }),
      queryClient.invalidateQueries({ queryKey: ["pipeline", jobRequestId] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

/** One candidate's decision at one stage; saved on its own so PSMs can work incrementally. */
export function DecisionDialog({
  jobRequestId,
  stage,
  row,
  onOpenChange,
}: {
  jobRequestId: string;
  stage: DecisionStage;
  row: StageCandidateRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefresh(jobRequestId);
  const [outcome, setOutcome] = useState<StageOutcome>("PENDING");
  const [priority, setPriority] = useState<Priority | null>(null);
  const [tech, setTech] = useState("");
  const [comm, setComm] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  useEffect(() => {
    if (!row) return;
    setOutcome(row.outcome ?? "PENDING");
    setPriority(row.priority ?? null);
    setTech(row.techScore?.toString() ?? "");
    setComm(row.commScore?.toString() ?? "");
    setReason(row.rejectionReason ?? "");
    setRemarks(row.remarks ?? "");
  }, [row]);
  const score = (value: string) => (value.trim() === "" ? null : Number(value));
  const invalidScore = [tech, comm].some((value) => value.trim() !== "" && (Number.isNaN(Number(value)) || Number(value) < 0 || Number(value) > 10));
  const save = useMutation({
    mutationFn: () => screeningApi.decide(jobRequestId, stage, row!.application.id, {
      outcome, priority, techScore: score(tech), commScore: score(comm), rejectionReason: reason.trim() || null, remarks: remarks.trim() || null,
    }),
    onSuccess: async () => {
      await refresh();
      toast.success("Decision saved");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !save.isPending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.application.candidate.fullName}</DialogTitle>
          <DialogDescription>{STAGE_LABELS[stage].code} · {STAGE_LABELS[stage].label}. Saving a decision does not change the stage's status.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="decision-outcome" label="Outcome" required>
            <Select value={outcome} onValueChange={(value) => setOutcome(value as StageOutcome)}>
              <SelectTrigger id="decision-outcome" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{STAGE_OUTCOMES.map((value) => <SelectItem key={value} value={value}>{STAGE_OUTCOME_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="decision-priority" label="Priority">
            <Select value={priority ?? NONE} onValueChange={(value) => setPriority(value === NONE ? null : (value as Priority))}>
              <SelectTrigger id="decision-priority" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {PRIORITIES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="decision-tech" label="Technical score (0–10)"><Input id="decision-tech" inputMode="decimal" value={tech} onChange={(event) => setTech(event.target.value)} /></FormField>
          <FormField id="decision-comm" label="Communication score (0–10)"><Input id="decision-comm" inputMode="decimal" value={comm} onChange={(event) => setComm(event.target.value)} /></FormField>
          {(outcome === "REJECTED" || reason) && (
            <FormField id="decision-reason" label="Rejection reason" className="sm:col-span-2">
              <Input id="decision-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. No projects, weak fundamentals" />
            </FormField>
          )}
          <FormField id="decision-remarks" label="Remarks" className="sm:col-span-2">
            <Textarea id="decision-remarks" rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          </FormField>
        </div>
        {invalidScore && <p className="text-sm text-rose-600">Scores must be numbers from 0 to 10.</p>}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || invalidScore}>{save.isPending ? "Saving…" : "Save decision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manual candidate selection: choose applicants (by default, those selected at the previous stage). */
export function AddToStageDialog({ jobRequestId, stage, open, onOpenChange }: { jobRequestId: string; stage: DecisionStage; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const previous = INTERNAL_STAGES[INTERNAL_STAGES.indexOf(stage) - 1]!;
  const [from, setFrom] = useState<"previous" | "all">("previous");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<StageOutcome>("PENDING");
  useEffect(() => {
    if (open) { setSelected(new Set()); setSearch(""); setOutcome("PENDING"); }
  }, [open]);
  const pool = useQuery({
    queryKey: ["screening", jobRequestId, "pool", stage, from, search],
    queryFn: () => screeningApi.candidates(jobRequestId, from === "previous" ? previous : "TOTAL_APPLICATIONS", {
      pageSize: 100,
      ...(from === "previous" && previous !== "TOTAL_APPLICATIONS" ? { outcome: "SELECTED" as const } : {}),
      ...(search ? { search } : {}),
    }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => screeningApi.addToStage(jobRequestId, stage, [...selected], outcome),
    onSuccess: async (result) => {
      await refresh();
      toast.success(`${result.added} added${result.alreadyThere ? `, ${result.alreadyThere} were already on this stage` : ""}`);
      onOpenChange(false);
    },
  });
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add candidates to {STAGE_LABELS[stage].code} · {STAGE_LABELS[stage].label}</DialogTitle>
          <DialogDescription>Choose applicants by hand. Their decision can be set now or later.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={from} onValueChange={(value) => setFrom(value as "previous" | "all")}>
            <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="previous">{previous === "TOTAL_APPLICATIONS" ? "All applicants" : `Selected at ${STAGE_LABELS[previous].code}`}</SelectItem>
              <SelectItem value="all">All applicants</SelectItem>
            </SelectContent>
          </Select>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, mobile…" className="h-9 flex-1" />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          {pool.data?.items.map((row) => (
            <label key={row.application.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
              <Checkbox checked={selected.has(row.application.id)} onCheckedChange={() => toggle(row.application.id)} />
              <span className="flex-1">
                <span className="font-medium text-slate-800">{row.application.candidate.fullName}</span>
                <span className="ml-2 text-xs text-slate-400">{row.application.candidate.mobile ?? row.application.candidate.email}</span>
              </span>
              {row.priority && <span className="text-xs text-slate-500">{row.priority}</span>}
              {row.outcome && <OutcomeBadge outcome={row.outcome} />}
            </label>
          ))}
          {pool.data?.items.length === 0 && <p className="p-6 text-center text-sm text-slate-400">No applicants match.</p>}
          {pool.isPending && <p className="p-6 text-center text-sm text-slate-400">Loading…</p>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Add as</span>
          <Select value={outcome} onValueChange={(value) => setOutcome(value as StageOutcome)}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{(["PENDING", "SELECTED", "ON_HOLD"] as const).map((value) => <SelectItem key={value} value={value}>{STAGE_OUTCOME_LABELS[value]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button disabled={selected.size === 0 || save.isPending} onClick={() => save.mutate()}>Add {selected.size || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Re-use candidates from an earlier drive (usually the same company's last job request). */
export function CarryOverDialog({ jobRequestId, open, onOpenChange }: { jobRequestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const [sourceId, setSourceId] = useState("");
  const [filter, setFilter] = useState("FINAL_SHORTLIST:SELECTED");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sources = useQuery({ queryKey: ["carry-over", jobRequestId, "sources"], queryFn: () => applicationsApi.sources(jobRequestId), enabled: open });
  useEffect(() => {
    if (open && !sourceId && sources.data?.[0]) setSourceId(sources.data[0].id);
  }, [open, sources.data, sourceId]);
  useEffect(() => setSelected(new Set()), [sourceId, filter]);
  const [stage, outcome] = filter === "ALL" ? [undefined, undefined] : (filter.split(":") as [DecisionStage, StageOutcome]);
  const candidates = useQuery({
    queryKey: ["carry-over", jobRequestId, sourceId, filter],
    queryFn: () => applicationsApi.sourceCandidates(jobRequestId, { fromJobRequestId: sourceId, ...(stage ? { stage, outcome } : {}) }),
    enabled: open && Boolean(sourceId),
  });
  const save = useMutation({
    mutationFn: () => applicationsApi.carryOver(jobRequestId, sourceId, [...selected]),
    onSuccess: async (result) => {
      await refresh();
      toast.success(`${result.added} candidate(s) added to this job`);
      onOpenChange(false);
    },
  });
  const filters = useMemo(() => [
    { value: "FINAL_SHORTLIST:SELECTED", label: "Final shortlist (SP) — selected" },
    { value: "SCREENING_SHORTLIST:SELECTED", label: "Screening (SC) — selected" },
    { value: "FINAL_SHORTLIST:ON_HOLD", label: "Final shortlist (SP) — on hold" },
    ...DECISION_STAGES.map((value) => ({ value: `${value}:REJECTED`, label: `${STAGE_LABELS[value].code} — rejected` })),
    { value: "ALL", label: "Everyone who applied" },
  ], []);

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add candidates from an earlier drive</DialogTitle>
          <DialogDescription>Pick who to bring into this job. Each gets a new application here; their earlier history stays with the earlier job.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={sourceId || undefined} onValueChange={setSourceId}>
            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Choose an earlier job request" /></SelectTrigger>
            <SelectContent>
              {sources.data?.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.company.name} · {source.roleTitle} · {source.requestDate.slice(0, 10)}{source.sameCompany ? " (same company)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{filters.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {sources.data?.length === 0 && <p className="text-sm text-slate-500">No earlier job requests with applicants that you can see.</p>}
        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          {candidates.data?.map((row) => (
            <label key={row.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
              <Checkbox
                checked={selected.has(row.id)}
                disabled={row.alreadyOnThisJob}
                onCheckedChange={() => setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                  return next;
                })}
              />
              <span className="flex-1">
                <span className="font-medium text-slate-800">{row.candidate.fullName}</span>
                <span className="ml-2 text-xs text-slate-400">{row.candidate.mobile ?? row.candidate.email}</span>
                {row.alreadyOnThisJob && <span className="ml-2 text-xs text-amber-700">already on this job</span>}
              </span>
              <span className="flex gap-1">
                {DECISION_STAGES.filter((key) => row.outcomes[key]).map((key) => (
                  <span key={key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{STAGE_LABELS[key].code}: {STAGE_OUTCOME_LABELS[row.outcomes[key]!].toLowerCase()}</span>
                ))}
              </span>
            </label>
          ))}
          {candidates.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Nobody matches this filter.</p>}
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button disabled={selected.size === 0 || save.isPending} onClick={() => save.mutate()}>Add {selected.size || ""} to this job</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddCandidateDialog({ jobRequestId, open, onOpenChange }: { jobRequestId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(jobRequestId);
  const [values, setValues] = useState({ fullName: "", email: "", mobile: "", candidateCode: "", productId: "" });
  useEffect(() => {
    if (open) setValues({ fullName: "", email: "", mobile: "", candidateCode: "", productId: "" });
  }, [open]);
  const products = useQuery({ queryKey: ["catalog", "products"], queryFn: catalogApi.products, enabled: open });
  const save = useMutation({
    mutationFn: () => applicationsApi.add(jobRequestId, {
      candidate: {
        fullName: values.fullName.trim(),
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        ...(values.mobile.trim() ? { mobile: values.mobile.trim() } : {}),
        ...(values.candidateCode.trim() ? { candidateCode: values.candidateCode.trim() } : {}),
        ...(values.productId ? { productId: values.productId } : {}),
      },
    }),
    onSuccess: async () => {
      await refresh();
      toast.success("Candidate added");
      onOpenChange(false);
    },
  });
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a candidate</DialogTitle>
          <DialogDescription>For someone who is not in the internal sheet. Most applicants should come from the sheet import.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="new-name" label="Full name" required className="sm:col-span-2"><Input id="new-name" value={values.fullName} onChange={set("fullName")} /></FormField>
          <FormField id="new-email" label="Email"><Input id="new-email" value={values.email} onChange={set("email")} /></FormField>
          <FormField id="new-mobile" label="Mobile"><Input id="new-mobile" value={values.mobile} onChange={set("mobile")} /></FormField>
          <FormField id="new-code" label="Candidate ID" hint="Platform user ID, if known."><Input id="new-code" value={values.candidateCode} onChange={set("candidateCode")} /></FormField>
          <FormField id="new-product" label="Product">
            <Select value={values.productId || NONE} onValueChange={(productId) => setValues((current) => ({ ...current, productId: productId === NONE ? "" : productId }))}>
              <SelectTrigger id="new-product" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not known</SelectItem>
                {products.data?.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button disabled={values.fullName.trim().length < 2 || (!values.email.trim() && !values.mobile.trim() && !values.candidateCode.trim()) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Adding…" : "Add candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
