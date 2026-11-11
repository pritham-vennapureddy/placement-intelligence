import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DECISION_STAGES, PIPELINE_STATUS_LABELS, STAGE_LABELS, STAGE_OUTCOME_LABELS, type PipelineStatus, type StageOutcome } from "@placement/shared";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Info, Trash2, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { PageHeader } from "../../components/page-header";
import { ErrorState, LoadingRows } from "../../components/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { importsApi, pipelineApi } from "../../services/workflow-api";
import { usePermissions } from "../../hooks/use-permissions";
import type { CompanySummary, ImportBatch, ImportIssue, ImportRow, InternalSummary } from "../../types/workflow";
import { cn } from "../../utils/cn";
import { CompanyMappingForm, initialCompanyMapping, toCompanyPayload, type CompanyMappingState } from "./company-mapping";
import { initialInternalMapping, InternalMappingForm, toInternalPayload, type InternalMappingState } from "./internal-mapping";

const STEPS = ["Map the sheet", "Review", "Saved"] as const;

function Steps({ current }: { current: number }) {
  const steps = STEPS;
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-medium">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span className={cn("flex h-6 items-center gap-1.5 rounded-full px-2.5", index === current ? "bg-indigo-600 text-white" : index < current ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500")}>
            {index + 1}. {step}
          </span>
          {index < steps.length - 1 && <span className="text-slate-300">→</span>}
        </li>
      ))}
    </ol>
  );
}

const ISSUE_STYLE = {
  ERROR: { icon: XCircle, className: "border-rose-200 bg-rose-50 text-rose-800" },
  WARNING: { icon: AlertTriangle, className: "border-amber-200 bg-amber-50 text-amber-800" },
  INFO: { icon: Info, className: "border-sky-200 bg-sky-50 text-sky-800" },
} as const;

function IssueBox({ issue }: { issue: ImportIssue }) {
  const { icon: Icon, className } = ISSUE_STYLE[issue.severity];
  return <div className={cn("flex gap-2 rounded-lg border px-3 py-2 text-xs", className)}><Icon size={14} className="mt-0.5 shrink-0" />{issue.message}</div>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "rose" | "emerald" | "amber" | undefined }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className={cn("text-lg font-semibold", tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-900")}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function InternalSummaryView({ summary }: { summary: InternalSummary }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rows in applications tab" value={summary.applications.total} />
        <Stat label="New candidates" value={summary.applications.newCandidates} tone="emerald" />
        <Stat label="New applications" value={summary.applications.newApplications} tone="emerald" />
        <Stat label="Profiles filled in" value={summary.applications.updated} />
        <Stat label="Unchanged" value={summary.applications.unchanged} />
        <Stat label="Rows with errors" value={summary.applications.errors} tone={summary.applications.errors ? "rose" : undefined} />
      </div>
      {(summary.applications.duplicates ?? 0) > 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {summary.applications.duplicates} applicant row(s) repeat a mobile number from an earlier row (the same person applied twice). Each person is counted once, from their first row; the repeats are listed under “Left out”. Nothing needs to be fixed in the sheet.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DECISION_STAGES.map((stage) => {
          const stats = summary.stages[stage];
          return (
            <div key={stage} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
              <p className="text-sm font-semibold text-slate-800">{STAGE_LABELS[stage].code} · {STAGE_LABELS[stage].label}</p>
              {!stats || stats.mode !== "SHEET" ? (
                <p className="mt-1 text-slate-500">
                  {stats?.mode === "NOT_CONDUCTED"
                    ? <>Not conducted{stats.reason ? ` · ${stats.reason}` : ""}</>
                    : stats?.mode === "MANUAL" ? "Select in the dashboard" : "Left as it is"}
                </p>
              ) : (
                <p className="mt-1 leading-5 text-slate-600">
                  {stats.selected} selected · {stats.rejected} rejected · {stats.onHold} on hold · {stats.noShow ?? 0} no-show · {stats.pending} pending
                  {stats.errors > 0 && <span className="block text-rose-600">{stats.errors} rows with errors</span>}
                  {stats.conflicts > 0 && <span className="block text-amber-700">{stats.conflicts} differ from decisions entered by hand</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompanySummaryView({ summary }: { summary: CompanySummary }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Profiles in the sheet" value={summary.rows} />
        <Stat label="Matched to applicants" value={summary.matched} tone="emerald" />
        <Stat label="Need your decision" value={summary.unmatched} tone={summary.unmatched ? "rose" : undefined} />
        <Stat label="Will be nominated now" value={summary.newNominations} tone={summary.newNominations ? "amber" : undefined} />
        <Stat label="Status changes" value={summary.statusChanges} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {summary.rounds.map((round) => (
          <Badge key={round.name} variant="outline" className={round.exists ? "border-slate-200 text-slate-600" : "border-indigo-200 bg-indigo-50 text-indigo-700"}>
            {round.name}{round.exists ? "" : " · new round"}
          </Badge>
        ))}
        {Object.entries(summary.byStatus).map(([status, count]) => (
          <Badge key={status} variant="outline" className="border-slate-200 text-slate-600">{PIPELINE_STATUS_LABELS[status as PipelineStatus]}: {count}</Badge>
        ))}
      </div>
    </div>
  );
}

function describeRow(row: ImportRow): string {
  const data = row.normalizedData as Record<string, any>;
  if (data.kind === "application") {
    if (row.action === "SKIP") return "Not imported";
    if (!data.candidateId) return "New candidate and application";
    if (data.createApplication) return "Existing candidate · new application";
    return row.action === "UPDATE" ? "Fills blank profile fields" : "No change";
  }
  if (data.kind === "stage") {
    const outcome = data.outcome ? STAGE_OUTCOME_LABELS[data.outcome as StageOutcome] : "—";
    return row.action === "CONFLICT" ? `Sheet says ${outcome.toLowerCase()} (differs)` : row.action === "NO_CHANGE" ? `${outcome} (no change)` : outcome;
  }
  if (data.kind === "company") {
    const status = data.toStatus ? PIPELINE_STATUS_LABELS[data.toStatus as PipelineStatus] : "—";
    const rounds = (data.rounds as { roundName: string; outcome: string }[]).map((round) => `${round.roundName}: ${round.outcome.toLowerCase()}`).join(", ");
    return `${data.createNomination ? "Nominate · " : ""}${status}${rounds ? ` · ${rounds}` : ""}`;
  }
  return "";
}

const NEEDS_MATCH = new Set(["NO_MATCH", "AMBIGUOUS_MATCH", "NOT_APPLIED", "INVALID_MATCH"]);

function ReviewStep({ batch, onEdit }: { batch: ImportBatch; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [role, setRole] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const isCompany = batch.target === "COMPANY_PIPELINE";

  const rows = useQuery({
    queryKey: ["imports", batch.id, "rows", filter, role, page, batch.summary],
    queryFn: () => importsApi.rows(batch.id, { page, filter, ...(role !== "all" ? { role } : {}) }),
    placeholderData: keepPreviousData,
  });
  const applicants = useQuery({
    queryKey: ["imports", batch.id, "applicants"],
    queryFn: async () => {
      const [view, eligible] = await Promise.all([pipelineApi.get(batch.jobRequestId), pipelineApi.eligible(batch.jobRequestId)]);
      const options = [
        ...eligible.map((app) => ({ id: app.id, label: `${app.candidate.fullName} · ${app.candidate.mobile ?? app.candidate.email ?? ""}` })),
        ...view.nominations.map((nom) => ({ id: nom.application.id, label: `${nom.application.candidate.fullName} · nominated` })),
      ];
      return options.sort((a, b) => a.label.localeCompare(b.label));
    },
    enabled: isCompany,
  });

  const setBatch = (next: ImportBatch) => queryClient.setQueryData(["imports", batch.id], next);
  const updateRow = useMutation({
    mutationFn: ({ rowId, input }: { rowId: string; input: { included?: boolean; applicationId?: string | null } }) => importsApi.updateRow(batch.id, rowId, input),
    onSuccess: (next) => {
      setBatch(next);
      void queryClient.invalidateQueries({ queryKey: ["imports", batch.id, "rows"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const approve = useMutation({
    mutationFn: () => importsApi.approve(batch.id),
    onSuccess: async ({ batch: next, counts }) => {
      setBatch(next);
      queryClient.setQueryData(["imports", batch.id, "counts"], counts);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["companies"] }),
      ]);
      toast.success("Import saved");
    },
  });
  const cancel = useMutation({ mutationFn: () => importsApi.cancel(batch.id), onSuccess: setBatch });

  const roles = isCompany ? [] : ["APPLICATIONS", ...DECISION_STAGES];
  const summary = batch.summary;
  return (
    <div className="space-y-4">
      {summary && (isCompany ? <CompanySummaryView summary={summary as CompanySummary} /> : <InternalSummaryView summary={summary as InternalSummary} />)}
      {(batch.batchIssues ?? []).map((issue) => <IssueBox key={issue.message} issue={issue} />)}
      {summary && summary.issues.ERROR > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {summary.issues.ERROR} rows with errors are excluded from saving. Review the row notes, then use Change mapping to correct headers and check again, or save only the valid rows.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <Tabs value={filter} onValueChange={(value) => { setFilter(value); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="all">All rows</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="warnings">Warnings</TabsTrigger>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="excluded">Left out</TabsTrigger>
            </TabsList>
          </Tabs>
          {roles.length > 0 && (
            <Select value={role} onValueChange={(value) => { setRole(value); setPage(1); }}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tabs</SelectItem>
                {roles.map((entry) => (
                  <SelectItem key={entry} value={entry}>{entry === "APPLICATIONS" ? "TA · Applications" : `${STAGE_LABELS[entry as keyof typeof STAGE_LABELS].code} · ${STAGE_LABELS[entry as keyof typeof STAGE_LABELS].label}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {rows.isPending ? <LoadingRows /> : rows.error ? <ErrorState error={rows.error} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Include</th><th className="px-4 py-2">Tab · row</th><th className="px-4 py-2">Who</th>
                  <th className="px-4 py-2">What happens</th><th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.items.map((row) => {
                  const data = row.normalizedData as Record<string, any>;
                  const needsMatch = isCompany && row.issues.some((issue) => NEEDS_MATCH.has(issue.code));
                  return (
                    <tr key={row.id} className={cn("border-t border-slate-100 align-top", row.approvalStatus === "EXCLUDED" && "bg-slate-50/70 text-slate-500")}>
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={row.approvalStatus === "INCLUDED"}
                          disabled={row.validationStatus === "INVALID" || batch.status !== "VALIDATED" || updateRow.isPending}
                          onCheckedChange={(checked) => updateRow.mutate({ rowId: row.id, input: { included: checked === true } })}
                          aria-label="Include row"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{row.sheetMapping.worksheetName} · {row.sourceRowNumber}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{data.candidate?.fullName ?? data.candidateName ?? row.rawData["Full Name"] ?? row.sourceRowRef ?? "—"}</p>
                        <p className="text-xs text-slate-400">{row.sourceRowRef}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{describeRow(row)}</td>
                      <td className="space-y-1 px-4 py-2.5">
                        {row.issues.map((issue) => (
                          <p key={issue.code + issue.message} className={cn("text-xs", issue.severity === "ERROR" ? "text-rose-600" : issue.severity === "WARNING" ? "text-amber-700" : "text-slate-500")}>{issue.message}</p>
                        ))}
                        {needsMatch && batch.status === "VALIDATED" && (
                          <Select onValueChange={(applicationId) => updateRow.mutate({ rowId: row.id, input: { applicationId } })}>
                            <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Match to an applicant…" /></SelectTrigger>
                            <SelectContent>{applicants.data?.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {data.matchedBy === "manual" && batch.status === "VALIDATED" && (
                          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => updateRow.mutate({ rowId: row.id, input: { applicationId: null } })}>Undo manual match</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.data.items.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">No rows in this view.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {rows.data && rows.data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>{rows.data.meta.total} rows · page {page} of {rows.data.meta.totalPages}</span>
            <div className="flex gap-1">
              <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
              <Button size="icon-sm" variant="outline" disabled={page >= rows.data.meta.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
            </div>
          </div>
        )}
      </Card>

      {batch.status === "VALIDATED" && (
        <div className="flex flex-wrap justify-end gap-2 pb-6">
          <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel import</Button>
          <Button variant="outline" onClick={onEdit}>Change mapping</Button>
          <Button onClick={() => setConfirming(true)}>Approve and save</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save this import?"
        description="Included rows are written to the dashboard in one step. Rows left out are not saved. Nothing already in the dashboard is deleted."
        confirmLabel="Approve and save"
        onConfirm={async () => { await approve.mutateAsync(); }}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this import?"
        description="Nothing from this file will be saved. The upload is kept in the import history."
        confirmLabel="Cancel import"
        destructive
        onConfirm={async () => { await cancel.mutateAsync(); }}
      />
    </div>
  );
}

function MappingStep({ batch, onValidated }: { batch: ImportBatch; onValidated: (batch: ImportBatch) => void }) {
  const isCompany = batch.target === "COMPANY_PIPELINE";
  const automatic = batch.sourceType === "GOOGLE_SHEETS";
  const [internal, setInternal] = useState<InternalMappingState>(() => initialInternalMapping(batch));
  const [company, setCompany] = useState<CompanyMappingState>(() => initialCompanyMapping(batch));
  const detectedSheets = isCompany
    ? company.tabs.map((tab) => ({ sheet: tab.sheet, purpose: "Company candidates and rounds" }))
    : [
      ...(internal.applications.sheet ? [{ sheet: internal.applications.sheet, purpose: "Applications and student details" }] : []),
      ...(automatic && internal.productsLookup.sheet ? [{ sheet: internal.productsLookup.sheet, purpose: "Product lookup" }] : []),
      ...(!automatic ? internal.profileLookups.map(({ sheet }) => ({ sheet, purpose: "Supplemental student details" })) : []),
      ...DECISION_STAGES.flatMap((stage) => {
        const config = internal.stages[stage];
        return config.mode === "SHEET" && config.sheet
          ? [{ sheet: config.sheet, purpose: `${STAGE_LABELS[stage].code} · ${STAGE_LABELS[stage].label}` }]
          : [];
      }),
    ];
  const detectedNames = new Set(detectedSheets.map(({ sheet }) => sheet));
  const ignoredSheets = batch.sheets.filter(({ name }) => !detectedNames.has(name));
  const { payload, missing } = useMemo(
    () => (isCompany ? toCompanyPayload(company, automatic) : toInternalPayload(internal, automatic)),
    [isCompany, automatic, company, internal],
  );
  const queryClient = useQueryClient();
  const validate = useMutation({
    mutationFn: () => importsApi.validate(batch.id, payload),
    onSuccess: onValidated,
  });

  return (
    <div className="space-y-4">
      {batch.sourceType === "GOOGLE_SHEETS" && (
        <Card className="space-y-3 border-indigo-100 bg-indigo-50/50 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Google Sheets analysis</p>
            <p className="mt-1 text-xs text-slate-600">
              {isCompany
                ? "Select only the company candidate and interview tabs to use; all other tabs are ignored."
                : "TA, RS, SC, AS and SP use normalized mobile numbers as the candidate identity. Candidate UUIDs and emails are ignored for matching."}
            </p>
          </div>
          {detectedSheets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detectedSheets.map(({ sheet, purpose }) => (
                <Badge key={`${sheet}-${purpose}`} variant="outline" className="border-indigo-200 bg-white text-indigo-800">
                  {sheet} · {purpose}
                </Badge>
              ))}
            </div>
          )}
          {!isCompany && automatic && (
            <label className="block max-w-lg space-y-1">
              <span className="text-xs font-semibold text-slate-600">Product details tab (optional)</span>
              <Select
                value={internal.productsLookup.sheet ?? "__none__"}
                onValueChange={(sheet) => setInternal({
                  ...internal,
                  productsLookup: { ...internal.productsLookup, sheet: sheet === "__none__" ? undefined : sheet },
                })}
              >
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No product lookup</SelectItem>
                  {batch.sheets.map(({ name }) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="block text-[11px] text-slate-400">
                Choose the tab with candidate mobile numbers and product. Other detail tabs are checked automatically.
              </span>
            </label>
          )}
          {automatic && !isCompany && (
            <p className="text-[11px] leading-5 text-slate-500">
              TA and shortlist tabs use normalized mobile numbers. Other tabs are matched by mobile for candidate details.
            </p>
          )}
          {ignoredSheets.length > 0 && !(automatic && !isCompany) && (
            <p className="text-[11px] leading-5 text-slate-500">
              Ignored: {ignoredSheets.map(({ name }) => name).join(", ")}
            </p>
          )}
        </Card>
      )}
      {isCompany
        ? <CompanyMappingForm batch={batch} state={company} onChange={setCompany} automatic={automatic} />
        : <InternalMappingForm batch={batch} state={internal} onChange={setInternal} automatic={automatic} />}
      <Card className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg">
        <div className="text-xs">
          {missing.length ? missing.map((message) => <p key={message} className="text-rose-600">{message}</p>)
            : <p className="text-slate-500">Checking reads the whole file and shows what would change. Nothing is saved yet.</p>}
          {validate.error && <p className="text-rose-600">{validate.error.message}</p>}
        </div>
        <Button disabled={missing.length > 0 || validate.isPending} onClick={() => validate.mutate()}>
          {validate.isPending ? "Checking the file…" : "Check the file"}
        </Button>
      </Card>
    </div>
  );
}

function DoneStep({ batch }: { batch: ImportBatch }) {
  const queryClient = useQueryClient();
  const counts = queryClient.getQueryData<Record<string, number>>(["imports", batch.id, "counts"]);
  const internalSummary = batch.target === "INTERNAL_SCREENING" ? batch.summary as InternalSummary | null : null;
  const labels: Record<string, string> = {
    candidatesCreated: "Candidates added", candidatesUpdated: "Profiles filled in", applicationsCreated: "Applications added",
    decisionsWritten: "Stage decisions saved", stagesMarkedNotConducted: "Stages marked not conducted", roundsCreated: "Rounds added",
    nominationsCreated: "Nominated", outcomesWritten: "Round results saved", statusChanges: "Status changes", skillsAdded: "Skills added",
  };
  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="text-emerald-600" size={28} />
        <div>
          <p className="text-base font-semibold text-slate-800">Import saved</p>
          <p className="text-xs text-slate-500">Saved {batch.committedAt ? format(new Date(batch.committedAt), "d MMM yyyy, HH:mm") : ""} · {batch.batchCode}</p>
        </div>
      </div>
      {counts && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(counts).map(([key, value]) => <Stat key={key} label={labels[key] ?? key} value={value} />)}
        </div>
      )}
      {internalSummary && <InternalSummaryView summary={internalSummary} />}
      {internalSummary && internalSummary.issues.ERROR > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {internalSummary.issues.ERROR} rows with errors were not imported. Correct them in the sheet and import again.
        </p>
      )}
      <div className="flex gap-2">
        <Button asChild><Link to={`/job-requests/${batch.jobRequestId}?tab=${batch.target === "COMPANY_PIPELINE" ? "pipeline" : "screening"}`}>Open the job request</Link></Button>
        <Button variant="outline" asChild><Link to="/imports">Import history</Link></Button>
      </div>
    </Card>
  );
}

export function ImportBatchPage() {
  const { batchId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const batch = useQuery({ queryKey: ["imports", batchId], queryFn: () => importsApi.get(batchId) });
  const { can } = usePermissions();
  const deleteBatch = useMutation({
    mutationFn: () => importsApi.delete(batchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      toast.success("Import removed from history");
      navigate("/imports");
    },
  });

  if (batch.isPending) return <Card><LoadingRows rows={6} /></Card>;
  if (batch.error) return <Card><ErrorState error={batch.error} onRetry={() => void batch.refetch()} /></Card>;
  const data = batch.data;
  const mapping = data.status === "UPLOADED" || (data.status === "VALIDATED" && editing);
  const step = data.status === "COMMITTED" ? 2 : mapping ? 0 : 1;

  return (
    <div className="space-y-5">
      <Link to={`/job-requests/${data.jobRequestId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> {data.jobRequest.company.name} · {data.jobRequest.roleTitle}{data.recruitmentBatch ? ` · ${data.recruitmentBatch.name}` : ""}
      </Link>
      <PageHeader
        eyebrow={data.target === "COMPANY_PIPELINE" ? "Company sheet import" : "Internal sheet import"}
        title={data.sourceFileName}
        description={(
          <>
            {data.batchCode} · {data.sourceType === "GOOGLE_SHEETS" ? "read from Google Sheets" : "uploaded"} by {data.importedBy.fullName} on {format(new Date(data.createdAt), "d MMM yyyy, HH:mm")}
            {data.sourceUrl && <> · <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">open the sheet</a></>}
          </>
        )}
        actions={(
          <>
            {data.status !== "CANCELLED" && <Steps current={step} />}
            {can("import:run") && data.status !== "COMMITTED" && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete import
              </Button>
            )}
          </>
        )}
      />
      {data.status === "CANCELLED" && <IssueBox issue={{ severity: "INFO", code: "CANCELLED", message: "This import was cancelled; nothing from it was saved." }} />}
      {data.status === "COMMITTED" && <IssueBox issue={{ severity: "INFO", code: "ROLLBACK_UNAVAILABLE", message: "Saved imports cannot be deleted independently yet because they may have updated shared student or pipeline data. Delete the job request to remove all of its imported data." }} />}
      {mapping && (
        <MappingStep
          batch={data}
          onValidated={(next) => {
            queryClient.setQueryData(["imports", batchId], next);
            setEditing(false);
            window.scrollTo({ top: 0 });
          }}
        />
      )}
      {!mapping && data.status === "VALIDATED" && <ReviewStep batch={data} onEdit={() => setEditing(true)} />}
      {data.status === "COMMITTED" && <DoneStep batch={data} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Permanently delete this import?"
        description="This removes the source snapshot and all staged rows for this import. Saved imports are not eligible because their changes cannot currently be rolled back safely. Audit history is retained."
        confirmLabel="Delete import"
        destructive
        onConfirm={() => deleteBatch.mutateAsync()}
      />
    </div>
  );
}
