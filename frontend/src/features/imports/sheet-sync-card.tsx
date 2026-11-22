import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { usePermissions } from "../../hooks/use-permissions";
import { sheetSyncApi, type SheetSyncRun, type SyncOutcome } from "../../services/sheet-sync-api";
import { cn } from "../../utils/cn";

const OUTCOME: Record<SyncOutcome, { label: string; tone: string }> = {
  APPLIED: { label: "Updated", tone: "bg-emerald-50 text-emerald-700" },
  UNCHANGED: { label: "No change", tone: "bg-slate-100 text-slate-600" },
  NEEDS_REVIEW: { label: "Needs review", tone: "bg-amber-50 text-amber-800" },
  FAILED: { label: "Could not read", tone: "bg-rose-50 text-rose-700" },
};

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

function summary(run: SheetSyncRun) {
  const parts = [`${run.applied} updated`, `${run.unchanged} no change`];
  if (run.needsReview) parts.push(`${run.needsReview} need review`);
  if (run.failed) parts.push(`${run.failed} could not be read`);
  return parts.join(" · ");
}

/**
 * "Sync all company sheets": reads every drive's company Google Sheet and
 * applies the changes. The same runs every 2 hours (8am–10pm) on a schedule.
 */
export function SheetSyncCard({ compact = false }: { compact?: boolean }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const runs = useQuery({
    queryKey: ["sheet-sync", "runs"],
    queryFn: sheetSyncApi.runs,
    // Poll while a run is going so progress shows up.
    refetchInterval: (query) => (query.state.data?.[0]?.status === "RUNNING" ? 3000 : false),
  });
  const latest = runs.data?.[0];
  const running = latest?.status === "RUNNING";
  const start = useMutation({
    mutationFn: sheetSyncApi.start,
    onSuccess: async ({ alreadyRunning }) => {
      toast[alreadyRunning ? "info" : "success"](alreadyRunning ? "A sync is already running." : "Syncing every company sheet…");
      await queryClient.invalidateQueries({ queryKey: ["sheet-sync", "runs"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const [watching, setWatching] = useState<string | null>(null);
  // When a run this page watched finishes, refresh the data so pages show the new results.
  useEffect(() => {
    if (!latest) return;
    if (latest.status === "RUNNING") setWatching(latest.id);
    else if (watching === latest.id) {
      setWatching(null);
      void queryClient.invalidateQueries();
    }
  }, [latest?.id, latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const button = can("import:run") && (
    <Button size="sm" disabled={running || start.isPending} onClick={() => start.mutate()}>
      <RefreshCw size={14} className={running || start.isPending ? "animate-spin" : undefined} />
      {running ? `Syncing… ${latest.applied + latest.unchanged + latest.needsReview + latest.failed} of ${latest.total || "?"}` : "Sync all company sheets"}
    </Button>
  );

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {button}
        {latest && !running && <span className="text-xs text-slate-500">Last sync {ago(latest.finishedAt ?? latest.startedAt)}{latest.needsReview ? ` · ${latest.needsReview} need review` : ""}</span>}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Company sheet sync</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Every company Google Sheet is read every 2 hours from 8am to 10pm. Changes are applied when the sheet's tabs and columns match the last import and no row has an error;
            anything else waits below as “Needs review”.
          </p>
          {latest && (
            <p className="mt-1.5 text-xs text-slate-600">
              {running ? <>Running now · started {ago(latest.startedAt)}</> : <>Last sync {ago(latest.finishedAt ?? latest.startedAt)} ({latest.trigger === "SCHEDULED" ? "scheduled" : `by ${latest.startedBy?.fullName ?? "someone"}`}): {latest.status === "FAILED" ? <span className="text-rose-600">failed — {latest.error}</span> : summary(latest)}</>}
            </p>
          )}
        </div>
        {button}
      </div>
      {latest && latest.results.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Drives in the last sync ({latest.results.length})
          </button>
          {open && (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
              {[...latest.results].sort((a, b) => order(a.outcome) - order(b.outcome)).map((row) => (
                <li key={`${row.jobRequestId}-${row.batchName}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", OUTCOME[row.outcome].tone)}>{OUTCOME[row.outcome].label}</span>
                  <Link to={`/job-requests/${row.jobRequestId}?tab=pipeline`} className="font-medium text-slate-800 hover:text-indigo-700">{row.companyName}</Link>
                  <span className="text-slate-500">{row.roleTitle} · {row.batchName}</span>
                  {row.reason && <span className="basis-full pl-1 text-slate-500 sm:basis-auto">{row.reason}</span>}
                  {row.outcome === "NEEDS_REVIEW" && row.batchId && <Link to={`/imports/${row.batchId}`} className="ml-auto font-medium text-indigo-600 hover:underline">Review →</Link>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

const order = (outcome: SyncOutcome) => ({ NEEDS_REVIEW: 0, FAILED: 1, APPLIED: 2, UNCHANGED: 3 })[outcome];
