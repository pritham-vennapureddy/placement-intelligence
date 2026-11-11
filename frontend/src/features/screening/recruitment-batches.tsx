import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Layers, Pencil, Plus, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FormField } from "../../components/form-field";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { usePermissions } from "../../hooks/use-permissions";
import { jobRequestsApi } from "../../services/api";
import { BATCH_TAB_CODES, type BatchTabCode, type BatchTabs, type JobRequestDetail, type RecruitmentBatchSummary } from "../../types/api";
import { cn } from "../../utils/cn";

const NONE = "__none__";
const TAB_LABELS: Record<BatchTabCode, string> = {
  TA: "TA · Applications",
  RS: "RS · Resume shortlist",
  SC: "SC · Screening shortlist",
  AS: "AS · Assignment shortlist",
  SP: "SP · Final shortlist",
};

function TabChips({ tabs }: { tabs: BatchTabs | null }) {
  const chosen = BATCH_TAB_CODES.filter((code) => tabs?.[code]);
  if (chosen.length === 0) return <span className="text-xs text-slate-400">Tabs detected on import</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chosen.map((code) => (
        <span key={code} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
          <span className="font-semibold text-indigo-600">{code}</span> {tabs![code]}
        </span>
      ))}
    </div>
  );
}

/**
 * Recruitment batches of a job request. Every batch reads the job request's
 * internal sheet (unless it names its own workbook); the PSM picks which tabs
 * of it are this batch's TA / RS / SC / AS / SP.
 */
export function RecruitmentBatchesPanel({ jobRequestId }: { jobRequestId: string }) {
  const { can } = usePermissions();
  const job = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId) });
  const [editing, setEditing] = useState<RecruitmentBatchSummary | "new" | null>(null);
  if (!job.data) return null;
  const batches = [...job.data.recruitmentBatches].sort((a, b) => a.sequence - b.sequence);
  const canWrite = can("job:write");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Layers size={15} /> Recruitment batches</p>
          {job.data.internalSheetUrl ? (
            <p className="mt-0.5 text-xs text-slate-500">
              Batches read the job request's internal sheet{" "}
              <a href={job.data.internalSheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline">open <ExternalLink size={11} /></a>
              {" "}unless a batch has its own. Change it under Edit job request.
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle size={12} /> No internal sheet yet.{" "}
              {canWrite && <Link to={`/job-requests/${jobRequestId}/edit`} className="underline">Add it on the job request</Link>}
            </p>
          )}
        </div>
        {canWrite && <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus size={14} /> Add batch</Button>}
      </div>

      {batches.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No batches yet. Batch 1 is created on the first import, or add it here and choose its tabs.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {batches.map((batch) => (
            <li key={batch.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-40 flex-1">
                <p className={cn("text-sm font-medium", batch.status === "CLOSED" ? "text-slate-400" : "text-slate-800")}>
                  {batch.name}
                  {batch.status === "CLOSED" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-[10px] font-normal text-slate-500">Closed</span>}
                  {batch.internalSheetUrl && <span className="ml-2 rounded bg-amber-50 px-1.5 text-[10px] font-normal text-amber-700">Own sheet</span>}
                </p>
                <p className="text-xs text-slate-400">{batch.openings ? `${batch.openings} openings` : "Openings not set"}</p>
              </div>
              <div className="min-w-48 flex-[2]"><TabChips tabs={batch.internalTabs} /></div>
              <div className="flex gap-1.5">
                {canWrite && <Button size="sm" variant="ghost" onClick={() => setEditing(batch)}><Pencil size={13} /> Edit</Button>}
                {can("import:run") && batch.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/job-requests/${jobRequestId}/imports/new?target=INTERNAL_SCREENING&batch=${batch.id}`}><UploadCloud size={13} /> Import</Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <BatchDialog job={job.data} batch={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function BatchDialog({ job, batch, onClose }: { job: JobRequestDetail; batch: RecruitmentBatchSummary | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(batch?.name ?? `Batch ${job.recruitmentBatches.length + 1}`);
  const [openings, setOpenings] = useState(batch?.openings ? String(batch.openings) : "");
  const [closed, setClosed] = useState(batch?.status === "CLOSED");
  const [useOwnSheet, setUseOwnSheet] = useState(Boolean(batch?.internalSheetUrl));
  const [ownSheet, setOwnSheet] = useState(batch?.internalSheetUrl ?? "");
  const [tabs, setTabs] = useState<BatchTabs>(batch?.internalTabs ?? {});
  const [tabsTouched, setTabsTouched] = useState(Boolean(batch?.internalTabs));

  const ownSheetValid = /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(ownSheet.trim());
  const sheetUrl = useOwnSheet ? (ownSheetValid ? ownSheet.trim() : null) : job.internalSheetUrl;
  const sheetTabs = useQuery({
    queryKey: ["internal-sheet-tabs", job.id, batch?.id ?? "new", useOwnSheet ? sheetUrl : "job"],
    queryFn: () => jobRequestsApi.internalSheetTabs(job.id, batch?.id, useOwnSheet && sheetUrl ? sheetUrl : undefined),
    enabled: Boolean(sheetUrl),
    retry: false,
  });

  // Until the PSM picks tabs, offer the suggestion (e.g. "TA-1", "RS-1" for batch 2).
  useEffect(() => {
    if (!tabsTouched && sheetTabs.data) setTabs(sheetTabs.data.current ?? sheetTabs.data.suggested);
  }, [sheetTabs.data, tabsTouched]);

  const available = new Set(sheetTabs.data?.tabs ?? []);
  const missingTabs = sheetTabs.data ? BATCH_TAB_CODES.filter((code) => tabs[code] && !available.has(tabs[code]!)) : [];
  const chosen = BATCH_TAB_CODES.map((code) => tabs[code]).filter(Boolean) as string[];
  const duplicate = chosen.find((tab, index) => chosen.indexOf(tab) !== index);
  const openingsValid = !openings.trim() || (Number.isInteger(Number(openings)) && Number(openings) > 0);
  const valid = name.trim().length >= 2 && openingsValid && !duplicate && (!useOwnSheet || ownSheetValid);

  const save = useMutation({
    mutationFn: async () => {
      const input = {
        name: name.trim(),
        openings: openings.trim() ? Number(openings) : null,
        internalSheetUrl: useOwnSheet ? ownSheet.trim() : null,
        internalTabs: Object.fromEntries(BATCH_TAB_CODES.map((code) => [code, tabs[code] || null])) as BatchTabs,
      };
      return batch
        ? jobRequestsApi.updateRecruitmentBatch(job.id, batch.id, { ...input, status: closed ? "CLOSED" : "ACTIVE" })
        : jobRequestsApi.createRecruitmentBatch(job.id, input);
    },
    onSuccess: async () => {
      toast.success(batch ? "Batch updated." : "Batch added.");
      await queryClient.invalidateQueries({ queryKey: ["job-requests", job.id] });
      await queryClient.invalidateQueries({ queryKey: ["internal-sheet-tabs", job.id] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{batch ? `Edit ${batch.name}` : "Add recruitment batch"}</DialogTitle>
          <DialogDescription>Choose which tabs of the internal sheet belong to this batch. The import uses these tabs, and you can still adjust them on the mapping screen.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="batch-name" label="Batch name" required error={name.trim().length < 2 ? "At least 2 characters." : undefined}>
            <Input id="batch-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          <FormField id="batch-openings" label="Openings" error={openingsValid ? undefined : "A whole number above 0."}>
            <Input id="batch-openings" inputMode="numeric" placeholder="Optional" value={openings} onChange={(event) => setOpenings(event.target.value)} />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <Checkbox checked={useOwnSheet} onCheckedChange={(value) => { setUseOwnSheet(value === true); setTabsTouched(false); }} />
          This batch is in a different Google Sheet
        </label>
        {useOwnSheet && (
          <FormField id="batch-sheet" label="Batch sheet link" error={ownSheet.trim() && !ownSheetValid ? "Paste a docs.google.com/spreadsheets link." : undefined}>
            <Input id="batch-sheet" placeholder="https://docs.google.com/spreadsheets/…" value={ownSheet} onChange={(event) => { setOwnSheet(event.target.value); setTabsTouched(false); }} />
          </FormField>
        )}

        <div className="space-y-2 rounded-lg border border-slate-100 p-3">
          <p className="text-xs font-semibold text-slate-700">Tabs for this batch {sheetTabs.data && <span className="font-normal text-slate-400">· {sheetTabs.data.title}</span>}</p>
          {!sheetUrl ? (
            <p className="text-xs text-amber-700">{useOwnSheet ? "Paste the batch's sheet link to list its tabs." : "Add the internal sheet on the job request first; tabs can be chosen afterwards."}</p>
          ) : sheetTabs.isPending ? (
            <p className="text-xs text-slate-500">Reading the sheet's tabs…</p>
          ) : sheetTabs.error ? (
            <p className="text-xs text-red-600">{sheetTabs.error.message}</p>
          ) : (
            <>
              {BATCH_TAB_CODES.map((code) => (
                <div key={code} className="grid grid-cols-[10rem_1fr] items-center gap-2">
                  <span className="text-xs text-slate-600">{TAB_LABELS[code]}</span>
                  <Select value={tabs[code] || NONE} onValueChange={(value) => { setTabsTouched(true); setTabs((current) => ({ ...current, [code]: value === NONE ? null : value })); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{code === "TA" ? "Detect on import" : "Not in this sheet / enter by hand"}</SelectItem>
                      {sheetTabs.data.tabs.map((tab) => {
                        const owner = sheetTabs.data.usedBy[tab];
                        return (
                          <SelectItem key={tab} value={tab} disabled={Boolean(owner)}>
                            {tab}{owner ? ` · used by ${owner}` : ""}
                          </SelectItem>
                        );
                      })}
                      {tabs[code] && !available.has(tabs[code]!) && <SelectItem value={tabs[code]!}>{tabs[code]} (missing)</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {!tabsTouched && !batch?.internalTabs && <p className="text-[11px] text-slate-400">Suggested from tab names; change any that are wrong.</p>}
              {!tabs.TA && chosen.length > 0 && <p className="text-xs text-amber-700">Choose the TA tab too: without it the import detects all tabs itself and ignores these choices.</p>}
              {duplicate && <p className="text-xs text-red-600">“{duplicate}” is chosen twice; each tab can be one stage only.</p>}
              {missingTabs.length > 0 && (
                <p className="text-xs text-amber-700">Not found in the sheet: {missingTabs.map((code) => `${code} “${tabs[code]}”`).join(", ")}. Was the tab renamed? Those stages are mapped on import instead.</p>
              )}
            </>
          )}
        </div>

        {batch && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Checkbox checked={closed} onCheckedChange={(value) => setClosed(value === true)} />
            Batch closed (hidden from imports and refresh)
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : batch ? "Save batch" : "Add batch"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
