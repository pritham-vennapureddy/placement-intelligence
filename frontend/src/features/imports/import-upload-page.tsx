import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { jobRequestsApi } from "../../services/api";
import { importsApi } from "../../services/workflow-api";
import type { ImportTarget } from "../../types/workflow";
import { cn } from "../../utils/cn";

const COPY: Record<ImportTarget, { title: string; description: string; steps: string[] }> = {
  INTERNAL_SCREENING: {
    title: "Import the internal sheet",
    description: "Applications and the PSM's shortlists (TA, RS, SC, AS, SP) for this job.",
    steps: [
      "Download the internal Google Sheet: File → Download → Microsoft Excel (.xlsx).",
      "Upload it here; you'll tell the dashboard which tab is which.",
      "Review what will change, then approve. Nothing is saved before that.",
    ],
  },
  COMPANY_PIPELINE: {
    title: "Import the company sheet",
    description: "The profiles shared with the company and their round results.",
    steps: [
      "Download the company's sheet as .xlsx.",
      "Choose this job's tab(s), the round columns and what the results mean.",
      "Profiles are matched to applicants by email, then mobile; you resolve the rest.",
    ],
  },
};

export function ImportUploadPage() {
  const { jobRequestId = "" } = useParams();
  const [params] = useSearchParams();
  const target: ImportTarget = params.get("target") === "COMPANY_PIPELINE" ? "COMPANY_PIPELINE" : "INTERNAL_SCREENING";
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const job = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId) });

  const upload = useMutation({
    mutationFn: (file: File) => importsApi.upload(jobRequestId, target, file),
    onSuccess: ({ batch, duplicateOf }) => {
      if (duplicateOf) toast.info(`This exact file was already imported (${duplicateOf.batchCode}). Re-importing only applies changes.`);
      navigate(`/imports/${batch.id}`);
    },
  });

  const pick = (file: File | undefined) => {
    if (file) upload.mutate(file);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  };
  const copy = COPY[target];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/job-requests/${jobRequestId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> {job.data ? `${job.data.company.name} · ${job.data.roleTitle}` : "Back to job request"}
      </Link>
      <PageHeader eyebrow="Import" title={copy.title} description={copy.description} />
      <Card className="p-5">
        <ol className="space-y-2 text-sm text-slate-600">
          {copy.steps.map((step, index) => (
            <li key={step} className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-700">{index + 1}</span>{step}</li>
          ))}
        </ol>
      </Card>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && input.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-6 py-14 text-center transition",
          dragging ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-indigo-300",
        )}
      >
        {upload.isPending ? (
          <>
            <FileSpreadsheet className="animate-pulse text-indigo-500" size={32} />
            <p className="text-sm font-medium text-slate-700">Reading the workbook…</p>
          </>
        ) : (
          <>
            <UploadCloud className="text-indigo-500" size={32} />
            <p className="text-sm font-semibold text-slate-800">Drop the .xlsx or .csv file here, or click to choose</p>
            <p className="text-xs text-slate-400">Up to 20 MB. The file is stored with the import for audit.</p>
          </>
        )}
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(event) => pick(event.target.files?.[0])} />
      </div>
      {upload.error && <p role="alert" className="text-sm text-rose-600">{upload.error.message}</p>}
      <div className="flex justify-end"><Button variant="outline" asChild><Link to={`/job-requests/${jobRequestId}`}>Cancel</Link></Button></div>
    </div>
  );
}
