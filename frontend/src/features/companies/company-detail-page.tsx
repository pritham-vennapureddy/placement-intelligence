import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { HistoryList } from "../../components/history-list";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { usePermissions } from "../../hooks/use-permissions";
import { companiesApi } from "../../services/api";
import { JobStatusBadge } from "../job-requests/job-status-badge";
import { CompanyFormDialog } from "./company-form-dialog";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-700">{children || "—"}</dd>
    </div>
  );
}

export function CompanyDetailPage() {
  const { companyId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const company = useQuery({ queryKey: ["companies", companyId], queryFn: () => companiesApi.get(companyId) });

  const toggleStatus = useMutation({
    mutationFn: () => companiesApi.update(companyId, { status: company.data?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Company status updated");
    },
  });

  if (company.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (company.error) return <Card><ErrorState error={company.error} onRetry={() => void company.refetch()} /></Card>;
  const data = company.data;
  const openJobs = data.jobRequests.filter(({ status }) => ["DRAFT", "OPEN", "ON_HOLD"].includes(status));

  return (
    <div className="space-y-6">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Companies
      </Link>
      <PageHeader
        eyebrow="Company"
        title={data.name}
        description={[data.industry, data.location].filter(Boolean).join(" · ") || undefined}
        actions={(
          <>
            <Badge
              variant="outline"
              className={data.status === "ACTIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}
            >
              {data.status === "ACTIVE" ? "Active" : "Inactive"}
            </Badge>
            {data.canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirmStatus(true)}>
                  {data.status === "ACTIVE" ? "Mark inactive" : "Reactivate"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
              </>
            )}
            {can("job:write") && data.status === "ACTIVE" && (
              <Button size="sm" onClick={() => navigate(`/job-requests/new?companyId=${data.id}`)}><Plus size={15} /> New job request</Button>
            )}
          </>
        )}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="jobs">Job requests ({data.jobRequests.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="p-5">
            <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="HubSpot company">
                {data.hubspotUrl ? (
                  <a href={data.hubspotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                    {data.hubspotCompanyId} <ExternalLink size={12} />
                  </a>
                ) : data.hubspotCompanyId}
              </Detail>
              <Detail label="Website">
                {data.website && <a href={data.website} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{data.website}</a>}
              </Detail>
              <Detail label="Open job requests">{`${openJobs.length} · ${openJobs.reduce((sum, job) => sum + job.openings, 0)} positions`}</Detail>
              <Detail label="PSM owners">
                {[...new Set(openJobs.flatMap(({ psmOwner }) => (psmOwner ? [psmOwner.fullName] : [])))].join(", ")}
              </Detail>
              <Detail label="Added">{`${format(new Date(data.createdAt), "d MMM yyyy")} by ${data.createdBy.fullName}`}</Detail>
              <Detail label="Notes">{data.notes}</Detail>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card className="overflow-hidden">
            {data.jobRequests.length === 0 ? (
              <EmptyState title="No job requests you can see" description="Job requests owned by you or your team appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/60">
                    <TableHead className="px-4 text-xs">Role</TableHead>
                    <TableHead className="px-4 text-xs">Openings</TableHead>
                    <TableHead className="px-4 text-xs">PSM owner</TableHead>
                    <TableHead className="px-4 text-xs">Requested</TableHead>
                    <TableHead className="px-4 text-xs">Deadline</TableHead>
                    <TableHead className="px-4 text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobRequests.map((job) => (
                    <TableRow key={job.id} className="cursor-pointer" onClick={() => navigate(`/job-requests/${job.id}`)}>
                      <TableCell className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{job.roleTitle}</p>
                        <p className="font-mono text-[11px] text-slate-400">{job.jobId}</p>
                      </TableCell>
                      <TableCell className="px-4">{job.openings}</TableCell>
                      <TableCell className="px-4">{job.psmOwner?.fullName ?? "—"}</TableCell>
                      <TableCell className="px-4">{format(new Date(job.requestDate), "d MMM yyyy")}</TableCell>
                      <TableCell className="px-4">{job.deadline ? format(new Date(job.deadline), "d MMM yyyy") : "—"}</TableCell>
                      <TableCell className="px-4"><JobStatusBadge status={job.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden"><HistoryList entries={data.history} /></Card>
        </TabsContent>
      </Tabs>

      <CompanyFormDialog open={editing} onOpenChange={setEditing} company={data} />
      <ConfirmDialog
        open={confirmStatus}
        onOpenChange={setConfirmStatus}
        title={data.status === "ACTIVE" ? "Mark this company inactive?" : "Reactivate this company?"}
        description={data.status === "ACTIVE"
          ? "New job requests cannot be added while the company is inactive. Existing job requests are not changed."
          : "PSMs will be able to add job requests for this company again."}
        confirmLabel={data.status === "ACTIVE" ? "Mark inactive" : "Reactivate"}
        destructive={data.status === "ACTIVE"}
        onConfirm={() => toggleStatus.mutateAsync()}
      />
    </div>
  );
}
