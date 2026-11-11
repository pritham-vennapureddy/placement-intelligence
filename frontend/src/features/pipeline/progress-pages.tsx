import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DECISION_STAGES, STAGE_LABELS, type PipelineStatus } from "@placement/shared";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page-header";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { companiesApi, jobRequestsApi } from "../../services/api";
import { importsApi, progressApi } from "../../services/workflow-api";
import type { ImportBatch, JobProgress } from "../../types/workflow";
import { StageStatusBadge } from "../screening/badges";
import { toast } from "sonner";
import { usePermissions } from "../../hooks/use-permissions";

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
            <th className="px-4 py-2">Job request</th><th className="px-4 py-2">Employee owner</th><th className="px-4 py-2">TA</th>
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const companyId = params.get("companyId") ?? "";
  const jobRequestId = params.get("jobRequestId") ?? "";
  const [url, setUrl] = useState("");
  const [batchToDelete, setBatchToDelete] = useState<ImportBatch | null>(null);
  const imports = useQuery({ queryKey: ["imports", "all"], queryFn: () => importsApi.list(1), placeholderData: keepPreviousData });
  const companies = useQuery({
    queryKey: ["imports", "companies"],
    queryFn: async () => {
      const first = await companiesApi.list({ page: 1, pageSize: 100, status: "ACTIVE" });
      const results = [...first.items];
      for (let page = 2; page <= first.meta.totalPages; page++) {
        results.push(...(await companiesApi.list({ page, pageSize: 100, status: "ACTIVE" })).items);
      }
      return results;
    },
  });
  const jobs = useQuery({
    queryKey: ["imports", "jobs", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const first = await jobRequestsApi.list({ page: 1, pageSize: 100, view: "all", companyId });
      const results = [...first.items];
      for (let page = 2; page <= first.meta.totalPages; page++) {
        results.push(...(await jobRequestsApi.list({ page, pageSize: 100, view: "all", companyId })).items);
      }
      return results;
    },
  });
  const google = useQuery({ queryKey: ["imports", "google-info"], queryFn: importsApi.googleInfo, staleTime: Infinity });
  const connect = useMutation({
    mutationFn: () => importsApi.fromGoogle(jobRequestId, "INTERNAL_SCREENING", url.trim()),
    onSuccess: ({ batch, duplicateOf }) => {
      if (duplicateOf) toast.info(`This sheet matches import ${duplicateOf.batchCode}; check its tabs and save any changes.`);
      navigate(`/imports/${batch.id}`);
    },
  });
  const deleteImport = useMutation({
    mutationFn: (batchId: string) => importsApi.delete(batchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      toast.success("Import removed from history");
      setBatchToDelete(null);
    },
  });
  const setSelection = (nextCompanyId: string, nextJobId = "") => {
    const next = new URLSearchParams(params);
    if (nextCompanyId) next.set("companyId", nextCompanyId);
    else next.delete("companyId");
    if (nextJobId) next.set("jobRequestId", nextJobId);
    else next.delete("jobRequestId");
    setParams(next, { replace: true });
  };
  const statusLabel = { UPLOADED: "Waiting for mapping", VALIDATED: "Waiting for approval", COMMITTED: "Saved", CANCELLED: "Cancelled" } as const;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Google Sheets" title="Import a job spreadsheet" description="Choose a company and job, connect its workbook, then select the tabs for applications, products, RS, screening, AS and SP." />
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
            Company
            <select
              value={companyId}
              onChange={(event) => setSelection(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"
              disabled={companies.isPending || companies.isError}
            >
              <option value="">{companies.isPending ? "Loading companies…" : "Select a company"}</option>
              {companies.data?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
            Job / role
            <select
              value={jobRequestId}
              onChange={(event) => setSelection(companyId, event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"
              disabled={!companyId || jobs.isPending || jobs.isError}
            >
              <option value="">{!companyId ? "Select a company first" : jobs.isPending ? "Loading job requests…" : "Select a job / role"}</option>
              {jobs.data?.map((job) => <option key={job.id} value={job.id}>{job.roleTitle} · {job.jobId}</option>)}
            </select>
          </label>
        </div>
        {companies.isError && <p role="alert" className="text-sm text-rose-600">Could not load companies: {companies.error.message}</p>}
        {jobs.isError && <p role="alert" className="text-sm text-rose-600">Could not load this company’s job requests: {jobs.error.message}</p>}
        {companyId && !jobs.isPending && !jobs.isError && jobs.data?.length === 0 && (
          <p className="text-sm text-amber-700">This company has no job requests yet. Create a job request before importing applicant data.</p>
        )}
        <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
          Google Sheets URL
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </label>
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
          Share the workbook with the read-only service account{" "}
          {google.data?.serviceAccountEmail ? <strong className="select-all text-slate-800">{google.data.serviceAccountEmail}</strong> : "(not configured)"}.
          After connecting, choose the subsheet for each stage. Imported data is saved in the database; the workbook is never changed.
        </p>
        {connect.error && <p role="alert" className="text-sm text-rose-600">{connect.error.message}</p>}
        <div className="flex justify-end">
          <Button
            disabled={!jobRequestId || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(url.trim()) || connect.isPending || !google.data?.serviceAccountEmail}
            onClick={() => connect.mutate()}
          >
            {connect.isPending ? "Connecting and reading tabs…" : "Connect Google Sheet"}
          </Button>
        </div>
      </Card>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Recent imports</h2>
      {imports.isPending ? <Card><LoadingRows /></Card> : imports.error ? <Card><ErrorState error={imports.error} /></Card> : imports.data.items.length === 0 ? (
        <Card><EmptyState title="No imports yet" description="Choose a company and job above, then connect a Google Sheet." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Workbook</th><th className="px-4 py-2">Company · job</th><th className="px-4 py-2">Batch</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">By</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Status</th></tr>
            </thead>
            <tbody>
              {imports.data.items.map((batch) => (
                <tr key={batch.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5"><Link to={`/imports/${batch.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{batch.sourceFileName}</Link><p className="font-mono text-[11px] text-slate-400">{batch.batchCode}</p></td>
                  <td className="px-4 py-2.5 text-xs text-slate-600"><Link to={`/companies/${batch.jobRequest.company.id}`} className="hover:text-indigo-700">{batch.jobRequest.company.name}</Link> · {batch.jobRequest.roleTitle}</td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-700">{batch.recruitmentBatch?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs">Google Sheets</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{batch.importedBy.fullName}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{format(new Date(batch.createdAt), "d MMM yyyy, HH:mm")}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span>{statusLabel[batch.status]}</span>
                      {can("import:run") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={batch.status === "COMMITTED"}
                          title={batch.status === "COMMITTED" ? "Saved import data cannot currently be rolled back safely" : "Delete this import"}
                          aria-label={`Delete import ${batch.batchCode}`}
                          onClick={() => setBatchToDelete(batch)}
                        >
                          <Trash2 size={14} /> Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      </section>
      <ConfirmDialog
        open={Boolean(batchToDelete)}
        onOpenChange={(open) => { if (!open) setBatchToDelete(null); }}
        title="Permanently delete this import?"
        description={(
          <span>
            This removes <strong>{batchToDelete?.batchCode}</strong>, its source snapshot, and its staged rows from import history. It does not remove saved candidate or job data. Saved imports cannot be deleted here because their changes may be used by the job dashboard.
          </span>
        )}
        confirmLabel="Delete import"
        destructive
        onConfirm={async () => {
          if (!batchToDelete) return;
          await deleteImport.mutateAsync(batchToDelete.id);
        }}
      />
    </div>
  );
}
