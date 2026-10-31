import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DECISION_STAGES, STAGE_LABELS, type PipelineStatus } from "@placement/shared";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Card } from "../../components/ui/card";
import { importsApi, progressApi } from "../../services/workflow-api";
import type { JobProgress } from "../../types/workflow";
import { StageStatusBadge } from "../screening/badges";

function ProgressTable({ view }: { view: "screening" | "pipeline" }) {
  const jobs = useQuery({ queryKey: ["job-requests", "progress"], queryFn: progressApi.jobs });
  if (jobs.isPending) return <Card><LoadingRows /></Card>;
  if (jobs.error) return <Card><ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /></Card>;
  if (jobs.data.length === 0) return <Card><EmptyState title="No active job requests" description="Active job requests you can see are listed here." /></Card>;
  const sum = (job: JobProgress, ...statuses: PipelineStatus[]) => statuses.reduce((total, status) => total + (job.pipeline[status] ?? 0), 0);

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2">Job request</th><th className="px-4 py-2">PSM owner</th><th className="px-4 py-2">TA</th>
            {view === "screening"
              ? DECISION_STAGES.map((stage) => <th key={stage} className="px-4 py-2">{STAGE_LABELS[stage].code}</th>)
              : ["Nominated", "In process", "Selected", "Offers", "Joined", "Rejected"].map((label) => <th key={label} className="px-4 py-2">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {jobs.data.map((job) => (
            <tr key={job.id} className="border-t border-slate-100 align-top">
              <td className="px-4 py-3">
                <Link to={`/job-requests/${job.id}?tab=${view}`} className="font-semibold text-slate-800 hover:text-indigo-700">{job.roleTitle}</Link>
                <p className="text-xs text-slate-400">{job.company.name}{job.deadline ? ` · due ${format(new Date(job.deadline), "d MMM")}` : ""}</p>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">{job.psmOwner?.fullName ?? "—"}</td>
              <td className="px-4 py-3 font-semibold text-slate-800">{job.applications}</td>
              {view === "screening"
                ? DECISION_STAGES.map((stage) => (
                  <td key={stage} className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{job.selected[stage] ?? 0}</p>
                    {job.stages[stage] && <div className="mt-1"><StageStatusBadge status={job.stages[stage]!} /></div>}
                  </td>
                ))
                : [
                  sum(job, "NOT_SUBMITTED", "IN_PROCESS", "ON_HOLD", "REJECTED", "SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED", "DROPPED"),
                  sum(job, "IN_PROCESS", "ON_HOLD"),
                  sum(job, "SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
                  sum(job, "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
                  sum(job, "JOINED"),
                  sum(job, "REJECTED"),
                ].map((value, index) => <td key={index} className="px-4 py-3 font-semibold text-slate-800">{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ScreeningOverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Placements" title="Internal screening" description="Selections at each internal stage, and each stage's status, for active job requests. Open a job to work on its shortlist." />
      <ProgressTable view="screening" />
    </div>
  );
}

export function PipelineOverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Placements" title="Company pipeline" description="Nominations and company outcomes for active job requests." />
      <ProgressTable view="pipeline" />
    </div>
  );
}

export function ImportCentrePage() {
  const imports = useQuery({ queryKey: ["imports", "all"], queryFn: () => importsApi.list(1), placeholderData: keepPreviousData });
  const statusLabel = { UPLOADED: "Waiting for mapping", VALIDATED: "Waiting for approval", COMMITTED: "Saved", CANCELLED: "Cancelled" } as const;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data" title="Import centre" description="Every sheet uploaded for job requests you can see. Start a new import from a job request's Internal screening or Company pipeline tab." />
      {imports.isPending ? <Card><LoadingRows /></Card> : imports.error ? <Card><ErrorState error={imports.error} /></Card> : imports.data.items.length === 0 ? (
        <Card><EmptyState title="No imports yet" description="Open a job request and import its internal sheet to begin." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">File</th><th className="px-4 py-2">Job request</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">By</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Status</th></tr>
            </thead>
            <tbody>
              {imports.data.items.map((batch) => (
                <tr key={batch.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5"><Link to={`/imports/${batch.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{batch.sourceFileName}</Link><p className="font-mono text-[11px] text-slate-400">{batch.batchCode}</p></td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{batch.jobRequest.company.name} · {batch.jobRequest.roleTitle}</td>
                  <td className="px-4 py-2.5 text-xs">{batch.target === "COMPANY_PIPELINE" ? "Company sheet" : "Internal sheet"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{batch.importedBy.fullName}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{format(new Date(batch.createdAt), "d MMM yyyy, HH:mm")}</td>
                  <td className="px-4 py-2.5 text-xs">{statusLabel[batch.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
