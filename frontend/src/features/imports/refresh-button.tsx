import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { usePermissions } from "../../hooks/use-permissions";
import { jobRequestsApi } from "../../services/api";
import { importsApi } from "../../services/workflow-api";
import type { ImportTarget } from "../../types/workflow";

/**
 * Re-reads the Google Sheet this job was imported from, for one recruitment
 * batch. The batch's previous mapping is applied automatically, so the PSM
 * goes straight to review. With several batches the PSM picks which one.
 */
export function RefreshFromGoogleButton({ jobRequestId, target }: { jobRequestId: string; target: ImportTarget }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const imports = useQuery({ queryKey: ["imports", "job", jobRequestId], queryFn: () => importsApi.listForJob(jobRequestId), enabled: can("import:run") });
  const job = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId), enabled: can("import:run") });
  const source = imports.data?.find((batch) => batch.target === target && batch.sourceType === "GOOGLE_SHEETS");
  const refresh = useMutation({
    mutationFn: (recruitmentBatchId?: string) => importsApi.refreshFromGoogle(jobRequestId, target, recruitmentBatchId),
    onSuccess: ({ batch, duplicateOf, checked }) => {
      if (duplicateOf) toast.info("The sheet has not changed since the last approved import.");
      else if (!checked) toast.info("Check the tabs and columns for this batch.");
      navigate(`/imports/${batch.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  if (!source) return null;
  const openBatches = [...(job.data?.recruitmentBatches ?? [])].filter((batch) => batch.status === "ACTIVE").sort((a, b) => a.sequence - b.sequence);
  const label = refresh.isPending ? "Reading the sheet…" : "Refresh from Google Sheets";

  if (openBatches.length <= 1) {
    return (
      <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(openBatches[0]?.id)} title={source.sourceUrl ?? undefined}>
        <RefreshCw size={14} className={refresh.isPending ? "animate-spin" : undefined} /> {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={refresh.isPending} title={source.sourceUrl ?? undefined}>
          <RefreshCw size={14} className={refresh.isPending ? "animate-spin" : undefined} /> {label} <ChevronDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs text-slate-500">Which batch?</DropdownMenuLabel>
        {openBatches.map((batch) => (
          <DropdownMenuItem key={batch.id} onSelect={() => refresh.mutate(batch.id)}>{batch.name}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
