import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { ArrowLeft, ExternalLink, Pencil, RefreshCw, UserRoundCog } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { HistoryList } from "../../components/history-list";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { jobRequestsApi } from "../../services/api";
import { importsApi } from "../../services/workflow-api";
import { PipelineTab } from "../pipeline/pipeline-tab";
import { ScreeningTab } from "../screening/screening-tab";
import { ChangeStatusDialog, ReassignOwnerDialog } from "./job-request-dialogs";
import { JobStatusBadge } from "./job-status-badge";

const day = (value: string) => format(new Date(value), "d MMM yyyy");

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{children || "—"}</dd>
    </div>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
      {children} <ExternalLink size={12} />
    </a>
  );
}

function JobImports({ jobRequestId }: { jobRequestId: string }) {
  const imports = useQuery({ queryKey: ["imports", "job", jobRequestId], queryFn: () => importsApi.listForJob(jobRequestId) });
  if (imports.isPending) return <Card><LoadingRows /></Card>;
  if (imports.error) return <Card><ErrorState error={imports.error} /></Card>;
  if (imports.data.length === 0) return <Card><EmptyState title="No imports yet" description="Import the internal sheet from the Internal screening tab, and the company sheet from the Company pipeline tab." /></Card>;
  const statusLabel = { UPLOADED: "Waiting for mapping", VALIDATED: "Waiting for approval", COMMITTED: "Saved", CANCELLED: "Cancelled" } as const;
  return (
    <Card className="overflow-hidden">
      <ol className="divide-y divide-slate-100">
        {imports.data.map((batch) => (
          <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div>
              <Link to={`/imports/${batch.id}`} className="text-sm font-semibold text-slate-800 hover:text-indigo-700">{batch.sourceFileName}</Link>
              <p className="text-xs text-slate-500">
                {batch.target === "COMPANY_PIPELINE" ? "Company sheet" : "Internal sheet"} · {batch.batchCode} · {format(new Date(batch.createdAt), "d MMM yyyy, HH:mm")} · {batch.importedBy.fullName}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${batch.status === "COMMITTED" ? "bg-emerald-50 text-emerald-700" : batch.status === "CANCELLED" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>
              {statusLabel[batch.status]}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function JobRequestDetailPage() {
  const { jobRequestId = "" } = useParams();
  const [changingStatus, setChangingStatus] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const setTab = (value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === "overview") next.delete("tab"); else next.set("tab", value);
    return next;
  }, { replace: true });
  const job = useQuery({ queryKey: ["job-requests", jobRequestId], queryFn: () => jobRequestsApi.get(jobRequestId) });

  if (job.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (job.error) return <Card><ErrorState error={job.error} onRetry={() => void job.refetch()} /></Card>;
  const data = job.data;
  const daysLeft = data.deadline ? differenceInCalendarDays(new Date(data.deadline), new Date()) : null;
  const isActive = ["DRAFT", "OPEN", "ON_HOLD"].includes(data.status);

  return (
    <div className="space-y-6">
      <Link to="/job-requests" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Job requests
      </Link>
      <PageHeader
        eyebrow={data.company.name}
        title={data.roleTitle}
        description={<span className="font-mono text-xs">Job ID {data.jobId}</span>}
        actions={(
          <>
            <JobStatusBadge status={data.status} />
            {data.canEdit && data.allowedTransitions.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setChangingStatus(true)}><RefreshCw size={14} /> Change status</Button>
            )}
            {data.canReassign && (
              <Button variant="outline" size="sm" onClick={() => setReassigning(true)}><UserRoundCog size={14} /> Reassign</Button>
            )}
            {data.canEdit && (
              <Button size="sm" asChild><Link to={`/job-requests/${data.id}/edit`}><Pencil size={14} /> Edit</Link></Button>
            )}
          </>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["PSM owner", data.psmOwner?.fullName ?? "Unassigned"],
          ["Openings", `${data.openings} · ${data.requiredCandidateCount} profiles required`],
          ["Requested", day(data.requestDate)],
          [
            "Deadline",
            data.deadline
              ? `${day(data.deadline)}${isActive && daysLeft !== null ? (daysLeft < 0 ? ` · ${-daysLeft} days overdue` : ` · ${daysLeft} days left`) : ""}`
              : "No deadline",
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-sm font-semibold ${label === "Deadline" && isActive && daysLeft !== null && daysLeft <= 7 ? "text-rose-600" : "text-slate-800"}`}>{value}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="screening">Internal screening</TabsTrigger>
          <TabsTrigger value="pipeline">Company pipeline</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="ownership">Ownership ({data.assignments.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="p-5">
            <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Company"><Link to={`/companies/${data.company.id}`} className="text-indigo-600 hover:underline">{data.company.name}</Link></Detail>
              <Detail label="HubSpot deal">{data.hubspotDealUrl ? <ExternalAnchor href={data.hubspotDealUrl}>{data.hubspotDealId}</ExternalAnchor> : data.hubspotDealId}</Detail>
              <Detail label="Timeline">{data.timeline}</Detail>
              <Detail label="Tech stack">
                {data.skills.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {data.skills.map(({ skill }) => (
                      <span key={skill.id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{skill.name}</span>
                    ))}
                  </span>
                )}
              </Detail>
              <Detail label="Eligible products">
                {data.eligibleProducts.length ? data.eligibleProducts.map(({ product }) => product.name).join(", ") : "Any product"}
              </Detail>
              <Detail label="Proposed shortlisting mechanism">{data.shortlistingMechanism}</Detail>
              <Detail label="Internal sheet">{data.internalSheetUrl && <ExternalAnchor href={data.internalSheetUrl}>Open</ExternalAnchor>}</Detail>
              <Detail label="Company sheet">{data.companySheetUrl && <ExternalAnchor href={data.companySheetUrl}>Open</ExternalAnchor>}</Detail>
              <Detail label="Created">{`${day(data.createdAt)} by ${data.createdBy.fullName}`}</Detail>
              <Detail label="Company remarks" wide>{data.companyRemarks}</Detail>
              <Detail label="Job description" wide>{data.description}</Detail>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="screening"><ScreeningTab jobRequestId={data.id} /></TabsContent>
        <TabsContent value="pipeline"><PipelineTab jobRequestId={data.id} /></TabsContent>
        <TabsContent value="imports"><JobImports jobRequestId={data.id} /></TabsContent>

        <TabsContent value="ownership">
          <Card className="overflow-hidden">
            {data.assignments.length === 0 ? (
              <EmptyState title="No ownership recorded" />
            ) : (
              <ol className="divide-y divide-slate-100">
                {data.assignments.map((assignment) => (
                  <li key={assignment.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {assignment.assignedTo.fullName}
                        {!assignment.endedAt && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Current</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {day(assignment.assignedAt)} – {assignment.endedAt ? day(assignment.endedAt) : "now"}
                        {assignment.assignedBy && ` · assigned by ${assignment.assignedBy.fullName}`}
                      </p>
                      {assignment.notes && <p className="mt-1 text-xs text-slate-500">“{assignment.notes}”</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden"><HistoryList entries={data.history} /></Card>
        </TabsContent>
      </Tabs>

      <ChangeStatusDialog job={data} open={changingStatus} onOpenChange={setChangingStatus} />
      <ReassignOwnerDialog job={data} open={reassigning} onOpenChange={setReassigning} />
    </div>
  );
}
