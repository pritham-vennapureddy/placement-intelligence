import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { jobRequestsApi } from "../../services/api";
import { importsApi } from "../../services/workflow-api";
import type { ImportBatch, ImportTarget } from "../../types/workflow";
import { cn } from "../../utils/cn";

const COPY: Record<ImportTarget, { title: string; description: string }> = {
  INTERNAL_SCREENING: {
    title: "Read the internal Google Sheet",
    description: "Choose the batch first. Each batch reads its own tabs of the internal sheet: usually TA, RS, SC, AS and SP for the first batch and numbered tabs such as TA-1, RS-1… for the next. You confirm the tabs on the next step.",
  },
  COMPANY_PIPELINE: {
    title: "Read the company Google Sheet",
    description: "Use the Company sheet only for candidates shared with the company and company-side process results. Internal student details remain sourced from the Internal sheet.",
  },
};

const NEW_BATCH = "new";
const isSheetsLink = (value: string) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(value.trim());

export function ImportUploadPage() {
  const { jobRequestId = "" } = useParams();
  const [params] = useSearchParams();
  const target: ImportTarget = params.get("target") === "COMPANY_PIPELINE" ? "COMPANY_PIPELINE" : "INTERNAL_SCREENING";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [link, setLink] = useState("");
  const [linkEdited, setLinkEdited] = useState(false);
  const [batchChoice, setBatchChoice] = useState<string>("");
  const [newBatch, setNewBatch] = useState({ name: "", openings: "" });
  const job = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId) });
  const imports = useQuery({ queryKey: ["imports", "job", jobRequestId], queryFn: () => importsApi.listForJob(jobRequestId) });
  const google = useQuery({ queryKey: ["imports", "google-info"], queryFn: importsApi.googleInfo, staleTime: Infinity });

  const batches = useMemo(() => [...(job.data?.recruitmentBatches ?? [])].sort((a, b) => a.sequence - b.sequence), [job.data]);
  const lastImport = (batchId: string) => imports.data?.find((entry) => entry.target === target && entry.recruitmentBatch?.id === batchId && entry.status === "COMMITTED");
  const jobSheetFromImports = imports.data?.find((entry) => entry.target === target && entry.sourceUrl)?.sourceUrl ?? null;

  // Start on ?batch=…, else the latest open batch; with no batches yet, a new one.
  useEffect(() => {
    if (batchChoice || !job.data) return;
    const requested = params.get("batch");
    const open = batches.filter((batch) => batch.status === "ACTIVE");
    setBatchChoice(requested && batches.some((batch) => batch.id === requested) ? requested : open.at(-1)?.id ?? NEW_BATCH);
  }, [job.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (batchChoice === NEW_BATCH && !newBatch.name) setNewBatch((current) => ({ ...current, name: `Batch ${batches.length + 1}` }));
  }, [batchChoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // The link: the batch's own sheet, else the job's, else the sheet this job was last read from.
  const selectedBatch = batches.find((batch) => batch.id === batchChoice);
  useEffect(() => {
    if (linkEdited) return;
    const batchLink = target === "COMPANY_PIPELINE" ? selectedBatch?.companySheetUrl : selectedBatch?.internalSheetUrl;
    const jobLink = target === "COMPANY_PIPELINE" ? job.data?.companySheetUrl : job.data?.internalSheetUrl;
    setLink(batchLink ?? jobLink ?? jobSheetFromImports ?? "");
  }, [batchChoice, job.data, jobSheetFromImports, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const started = ({ batch, duplicateOf }: { batch: ImportBatch; duplicateOf: { batchCode: string } | null }) => {
    if (duplicateOf) toast.info(`Nothing has changed since import ${duplicateOf.batchCode}. Re-importing only applies changes.`);
    navigate(`/imports/${batch.id}`);
  };
  const fromLink = useMutation({
    mutationFn: async () => {
      let recruitmentBatchId = batchChoice;
      if (batchChoice === NEW_BATCH) {
        const openings = newBatch.openings.trim() ? Number(newBatch.openings) : null;
        const created = await jobRequestsApi.createRecruitmentBatch(jobRequestId, {
          name: newBatch.name.trim(),
          openings,
          ...(target === "COMPANY_PIPELINE" ? { companySheetUrl: link.trim() } : { internalSheetUrl: link.trim() }),
        });
        recruitmentBatchId = created.id;
        setBatchChoice(created.id);
        await queryClient.invalidateQueries({ queryKey: ["job-requests", jobRequestId] });
      }
      return importsApi.fromGoogle(jobRequestId, target, link.trim(), recruitmentBatchId);
    },
    onSuccess: started,
  });
  const error = fromLink.error;
  const copy = COPY[target];
  const newBatchValid = batchChoice !== NEW_BATCH
    || (newBatch.name.trim().length >= 2 && (!newBatch.openings.trim() || (Number.isInteger(Number(newBatch.openings)) && Number(newBatch.openings) > 0)));
  const ready = Boolean(batchChoice) && newBatchValid && isSheetsLink(link) && Boolean(google.data?.serviceAccountEmail) && !fromLink.isPending;

  const downloadTemplate = async () => {
    try {
      const blob = await importsApi.internalTemplate();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "internal-screening-standard.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(downloadError instanceof Error ? downloadError.message : "The Excel template could not be downloaded.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/job-requests/${jobRequestId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> {job.data ? `${job.data.company.name} · ${job.data.roleTitle}` : "Back to job request"}
      </Link>
      <PageHeader eyebrow="Import" title={copy.title} description={copy.description} />

      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">1 · Which batch is this import for?</h2>
          <p className="text-xs text-slate-400">A company's repeat request is a new batch: it keeps its own applicants, stage results and import history.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {batches.map((batch) => {
            const last = lastImport(batch.id);
            const closed = batch.status === "CLOSED";
            return (
              <button
                key={batch.id}
                type="button"
                disabled={closed}
                onClick={() => setBatchChoice(batch.id)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  batchChoice === batch.id ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200 hover:bg-slate-50",
                  closed && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="font-semibold text-slate-800">{batch.name}</span>
                {closed && <span className="ml-2 text-xs text-slate-500">Closed</span>}
                <span className="mt-0.5 block text-xs text-slate-500">
                  {last ? `Last imported ${format(new Date(last.committedAt ?? last.createdAt), "d MMM yyyy")} · ${last.batchCode}` : "Not imported yet"}
                  {batch.openings ? ` · ${batch.openings} openings` : ""}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setBatchChoice(NEW_BATCH)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm",
              batchChoice === NEW_BATCH ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-300 hover:bg-slate-50",
            )}
          >
            <Plus size={15} className="text-indigo-600" />
            <span><span className="font-semibold text-slate-800">New batch</span><span className="block text-xs text-slate-500">The company asked for another round of candidates</span></span>
          </button>
        </div>
        {batchChoice === NEW_BATCH && (
          <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600">Batch name</span>
              <Input value={newBatch.name} onChange={(event) => setNewBatch({ ...newBatch, name: event.target.value })} placeholder="Batch 2" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600">Openings <span className="font-normal text-slate-400">(optional)</span></span>
              <Input inputMode="numeric" value={newBatch.openings} onChange={(event) => setNewBatch({ ...newBatch, openings: event.target.value })} placeholder="e.g. 5" />
            </label>
          </div>
        )}
      </Card>

      {target === "INTERNAL_SCREENING" && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-indigo-100 bg-indigo-50/50 p-4">
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-slate-800">Standard internal sheet template</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Share this workbook with the team. Keep its tab names and row-1 headers; for a later batch, add numbered copies of the tabs (TA-1, RS-1, …).
            </p>
          </div>
          <Button variant="outline" onClick={() => void downloadTemplate()}>
            <Download size={15} /> Download Excel template
          </Button>
        </Card>
      )}
      <Card className="space-y-4 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">2 · Google Sheets link</span>
            <Input value={link} onChange={(event) => { setLink(event.target.value); setLinkEdited(true); }} placeholder="https://docs.google.com/spreadsheets/d/…" />
            <span className="block text-[11px] text-slate-400">Filled in from the batch or job request when a link is saved there. Later batches usually use the same sheet.</span>
          </label>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
            The dashboard reads the sheet with read-only access and never changes it. Share the sheet (Viewer is enough) with{" "}
            {google.data?.serviceAccountEmail
              ? <strong className="select-all text-slate-800">{google.data.serviceAccountEmail}</strong>
              : "the dashboard's Google service account (not configured yet — ask an administrator)"}.
          </div>
          <div className="flex justify-end">
            <Button disabled={!ready} onClick={() => fromLink.mutate()}>
              {fromLink.isPending ? "Reading the sheet…" : `Read the sheet${selectedBatch ? ` for ${selectedBatch.name}` : batchChoice === NEW_BATCH && newBatch.name.trim() ? ` for ${newBatch.name.trim()}` : ""}`}
            </Button>
          </div>
      </Card>
      {error && <p role="alert" className="text-sm text-rose-600">{error.message}</p>}
      <div className="flex justify-end"><Button variant="outline" asChild><Link to={`/job-requests/${jobRequestId}`}>Cancel</Link></Button></div>
    </div>
  );
}
