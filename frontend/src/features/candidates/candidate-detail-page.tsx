import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERNAL_STAGES, STAGE_LABELS } from "@placement/shared";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { HistoryList } from "../../components/history-list";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Card } from "../../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { usePermissions } from "../../hooks/use-permissions";
import { candidatesApi } from "../../services/workflow-api";
import type { CandidateDetail } from "../../types/workflow";
import { ASSESSED_LABELS, CATEGORY_LABELS, InterviewBadge, OutcomeBadge, PipelineBadge } from "../screening/badges";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-700">{children || "—"}</dd>
    </div>
  );
}

function ApplicationHistory({ application }: { application: CandidateDetail["applications"][number] }) {
  const outcomes = new Map(application.stageOutcomes.map((outcome) => [outcome.stage.stage, outcome]));
  const nomination = application.nomination;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/job-requests/${application.jobRequest.id}?tab=screening`} className="text-sm font-semibold text-slate-800 hover:text-indigo-700">
            {application.jobRequest.company.name} · {application.jobRequest.roleTitle}
          </Link>
          <p className="text-xs text-slate-500">
            Applied {format(new Date(application.appliedAt), "d MMM yyyy")}{application.product ? ` · ${application.product.name}` : ""}
            {application.sourceApplication && ` · re-used from ${application.sourceApplication.jobRequest.company.name} · ${application.sourceApplication.jobRequest.roleTitle}`}
          </p>
        </div>
        {nomination && <PipelineBadge status={nomination.pipelineStatus} />}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Internal screening</p>
        <div className="flex flex-wrap gap-2">
          {INTERNAL_STAGES.filter((stage) => stage !== "TOTAL_APPLICATIONS").map((stage) => {
            const outcome = outcomes.get(stage);
            return (
              <div key={stage} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-500">{STAGE_LABELS[stage].code}</p>
                <div className="mt-1">{outcome ? <OutcomeBadge outcome={outcome.outcome} /> : <span className="text-slate-300">—</span>}</div>
                {outcome?.rejectionReason && <p className="mt-1 max-w-48 text-slate-500">{outcome.rejectionReason}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {nomination && (
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-600">Company process</p>
          <div className="flex flex-wrap gap-2">
            {[...nomination.interviews].sort((a, b) => a.round.sequence - b.round.sequence).map((interview) => (
              <div key={interview.round.name} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-500">{interview.round.name}</p>
                <div className="mt-1"><InterviewBadge outcome={interview.outcome} /></div>
              </div>
            ))}
          </div>
          <ol className="mt-3 space-y-1 text-xs text-slate-500">
            {nomination.stageHistory.map((entry) => (
              <li key={entry.changedAt + entry.toStatus}>
                {format(new Date(entry.changedAt), "d MMM yyyy")} · <PipelineBadge status={entry.toStatus} className="ml-1" />{entry.notes && ` · ${entry.notes}`}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

export function CandidateDetailPage() {
  const { candidateId = "" } = useParams();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const candidate = useQuery({ queryKey: ["candidates", candidateId], queryFn: () => candidatesApi.get(candidateId) });
  const update = useMutation({
    mutationFn: (input: { assessedPool?: string; category?: string | null }) => candidatesApi.update(candidateId, input),
    onSuccess: (next) => {
      queryClient.setQueryData(["candidates", candidateId], next);
      toast.success("Candidate updated");
    },
    onError: (error) => toast.error(error.message),
  });

  if (candidate.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (candidate.error) return <Card><ErrorState error={candidate.error} onRetry={() => void candidate.refetch()} /></Card>;
  const data = candidate.data;
  const canEdit = can("candidate:write");

  return (
    <div className="space-y-6">
      <Link to="/candidates" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft size={15} /> Candidates</Link>
      <PageHeader eyebrow="Candidate" title={data.fullName} description={<span className="font-mono text-xs">{data.candidateCode}</span>} />
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Jobs ({data.applications.length})</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="space-y-3">
          {data.applications.length === 0 ? <Card><EmptyState title="No applications you can see" /></Card>
            : data.applications.map((application) => <ApplicationHistory key={application.id} application={application} />)}
        </TabsContent>
        <TabsContent value="profile">
          <Card className="p-5">
            <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Email">{data.email}</Detail>
              <Detail label="Mobile">{data.mobile}</Detail>
              <Detail label="Resume">{data.resumeUrl && <a href={data.resumeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">Open <ExternalLink size={12} /></a>}</Detail>
              <Detail label="College">{data.college}</Detail>
              <Detail label="Degree">{[data.degree, data.department].filter(Boolean).join(" · ")}</Detail>
              <Detail label="Graduation">{[data.graduationYear, data.academicScore !== null ? `${data.academicScore}%` : null].filter(Boolean).join(" · ")}</Detail>
              <Detail label="Products">{data.products.map(({ product }) => product.name).join(", ")}</Detail>
              <Detail label="Skills">{data.skills.join(", ")}</Detail>
              <Detail label="Location">{[data.currentCity, data.state].filter(Boolean).join(", ")}</Detail>
              <Detail label="Category">
                {canEdit ? (
                  <Select value={data.category ?? "NONE"} onValueChange={(value) => update.mutate({ category: value === "NONE" ? null : value })}>
                    <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Not set</SelectItem>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : data.category ? CATEGORY_LABELS[data.category] : null}
              </Detail>
              <Detail label="Assessed pool">
                {canEdit ? (
                  <Select value={data.assessedPool} onValueChange={(value) => update.mutate({ assessedPool: value })}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(ASSESSED_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : ASSESSED_LABELS[data.assessedPool]}
              </Detail>
            </dl>
          </Card>
        </TabsContent>
        <TabsContent value="changes"><Card className="overflow-hidden"><HistoryList entries={data.history} /></Card></TabsContent>
      </Tabs>
    </div>
  );
}
