import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, Pencil, Plus, Trash2, UploadCloud } from "lucide-react";
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
import { companiesApi, dashboardApi } from "../../services/api";
import type { CompanyAnalytics, CompanyJobCandidates } from "../../types/api";
import { RefreshFromGoogleButton } from "../imports/refresh-button";
import { SupportBadge } from "../tracking/student-support";
import { CompanyStatusCell, ProcessBadge, ProcessStatusDialog } from "../tracking/tracking-dialogs";
import { CompanyFormDialog } from "./company-form-dialog";
import { CATEGORY_LABELS, OutcomeBadge } from "../screening/badges";
import { PIPELINE_STATUS_LABELS, STAGE_LABELS, STAGE_OUTCOME_LABELS, STAGE_OUTCOMES, type DecisionStage, type PipelineStatus, type StageOutcome } from "@placement/shared";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-700">{children || "—"}</dd>
    </div>
  );
}

const STAGE_COLUMNS = [
  ["RESUME_SHORTLIST", "RS"],
  ["SCREENING_SHORTLIST", "SC"],
  ["ASSIGNMENT_SHORTLIST", "AS"],
  ["FINAL_SHORTLIST", "SP"],
] as const satisfies readonly (readonly [DecisionStage, string])[];

function JobCandidates({ companyId, jobId, roleTitle, applications, batches }: { companyId: string; jobId: string; roleTitle: string; applications: number; batches: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [batchId, setBatchId] = useState("");
  const [stage, setStage] = useState<DecisionStage | "">("");
  const [outcome, setOutcome] = useState<StageOutcome | "NONE" | "">("");
  const [search, setSearch] = useState("");
  const q = search.trim().length >= 2 ? search.trim() : "";
  const candidates = useQuery({
    queryKey: ["dashboard", "company", companyId, "job", jobId, "candidates", batchId, stage, outcome, q, page],
    queryFn: () => dashboardApi.getCompanyJobCandidates(companyId, jobId, page, 25, batchId || undefined, {
      ...(stage ? { stage } : {}),
      ...(stage && outcome ? { outcome } : {}),
      ...(q ? { q } : {}),
    }),
    enabled: open,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const selectClass = "h-9 rounded-md border border-slate-200 bg-white px-2 text-xs";
  const reset = () => setPage(1);
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">{roleTitle} · candidates and stages</h2>
        <p className="mt-1 text-xs text-slate-500">Every applicant in TA ({applications}) with their RS, SC, AS and SP result, product and assessed-pool record.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>{open ? "Hide candidates" : "Show candidates"}</Button>
    </div>
    {open && <>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <select aria-label="Recruitment batch" className={selectClass} value={batchId} onChange={(event) => { setBatchId(event.target.value); reset(); }}>
          <option value="">All batches</option>
          {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}
        </select>
        <select aria-label="Stage" className={selectClass} value={stage} onChange={(event) => { setStage(event.target.value as DecisionStage | ""); if (!event.target.value) setOutcome(""); reset(); }}>
          <option value="">All of TA</option>
          {STAGE_COLUMNS.map(([key, code]) => <option key={key} value={key}>{code} · {STAGE_LABELS[key].label}</option>)}
        </select>
        <select aria-label="Outcome at stage" className={selectClass} value={outcome} disabled={!stage} onChange={(event) => { setOutcome(event.target.value as StageOutcome | "NONE" | ""); reset(); }}>
          <option value="">{stage ? "Listed in this stage" : "Choose a stage first"}</option>
          {STAGE_OUTCOMES.map((value) => <option key={value} value={value}>{STAGE_OUTCOME_LABELS[value]}</option>)}
          <option value="NONE">Not in this stage</option>
        </select>
        <input aria-label="Search by name or mobile" className={`${selectClass} w-56`} placeholder="Search name or mobile" value={search} onChange={(event) => { setSearch(event.target.value); reset(); }} />
      </div>
      {candidates.isPending ? <div className="p-5"><LoadingRows rows={3} /></div>
        : candidates.error ? <div className="p-5"><ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} /></div>
          : <CandidateRows data={candidates.data} page={page} setPage={setPage} />}
    </>}
  </Card>;
}

type CandidateItem = CompanyJobCandidates["items"][number];

function StageCell({ outcome }: { outcome: CandidateItem["outcomes"][number] | undefined }) {
  if (!outcome) return <span className="text-xs text-slate-300">—</span>;
  const notes = [
    outcome.priority,
    outcome.techScore !== null ? `Tech ${outcome.techScore}` : null,
    outcome.commScore !== null ? `Comm ${outcome.commScore}` : null,
    outcome.selectionBasis ? `Basis: ${outcome.selectionBasis}` : null,
  ].filter(Boolean);
  const title = [...notes, outcome.rejectionReason ? `Reason: ${outcome.rejectionReason}` : null, outcome.remarks ? `Remarks: ${outcome.remarks}` : null].filter(Boolean).join("\n");
  return <div title={title || undefined} className="space-y-1">
    <OutcomeBadge outcome={outcome.outcome} />
    {notes.length > 0 && <p className="text-[10px] text-slate-500">{notes.join(" · ")}</p>}
  </div>;
}

function PoolCell({ pool }: { pool: CandidateItem["assessedPool"] }) {
  if (!pool) return <span className="text-xs text-slate-400">Not in pool</span>;
  const tr = [pool.tr1Status ? `TR1 ${pool.tr1Status}` : null, pool.tr2Status ? `TR2 ${pool.tr2Status}` : null].filter(Boolean).join(" · ");
  return <div className="space-y-1 text-xs text-slate-600">
    <div className="flex flex-wrap gap-1">
      <Badge variant="secondary">In pool</Badge>
      {pool.bucketTier && <Badge variant="secondary">Bucket {pool.bucketTier}</Badge>}
      {pool.competencyLevel && <Badge variant="secondary">{pool.competencyLevel}</Badge>}
      {pool.isCompetencyPoolMember && <Badge variant="outline">Competency pool</Badge>}
    </div>
    {tr && <p className="text-[10px] text-slate-500">{tr}</p>}
  </div>;
}

function categoryLabel(value: string | null | undefined) {
  if (!value) return null;
  return CATEGORY_LABELS[value as keyof typeof CATEGORY_LABELS] ?? value;
}

function CandidateRows({ data, page, setPage }: { data: CompanyJobCandidates; page: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <>
    <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
        <th className="px-5 py-2">Candidate</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Assessed pool</th>
        <th className="px-3 py-2">TA</th>{STAGE_COLUMNS.map(([key, code]) => <th key={key} className="px-3 py-2">{code}</th>)}
        <th className="px-3 py-2">With company</th><th className="px-3 py-2">Guidance</th><th className="px-3 py-2">RSA</th><th className="px-5 py-2">Details</th>
      </tr></thead>
      <tbody>{data.items.map((candidate) => {
        const byStage = new Map(candidate.outcomes.map((outcome) => [outcome.stage, outcome]));
        const category = categoryLabel(candidate.product?.category ?? candidate.category);
        return <tr key={`${candidate.candidateId}:${candidate.recruitmentBatchId}`} className="border-t border-slate-100 align-top">
          <td className="px-5 py-3">
            <Link to={`/candidates/${candidate.candidateId}`} className="font-medium text-indigo-700 hover:underline">{candidate.fullName}</Link>
            <p className="mt-0.5 text-xs text-slate-500">{candidate.mobile || "No mobile"}</p>
            <p className="text-[10px] text-slate-400">{candidate.recruitmentBatchName}</p>
          </td>
          <td className="px-3 py-3 text-xs text-slate-600">
            {candidate.product?.name ?? "—"}
            {category && <p className="text-[10px] text-slate-400">{category}</p>}
          </td>
          <td className="px-3 py-3"><PoolCell pool={candidate.assessedPool} /></td>
          <td className="px-3 py-3"><Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">Applied</Badge></td>
          {STAGE_COLUMNS.map(([key]) => <td key={key} className="px-3 py-3"><StageCell outcome={byStage.get(key)} /></td>)}
          <td className="px-3 py-3">
            <CompanyStatusCell shareStatus={candidate.shareStatus} pipelineStatus={candidate.pipelineStatus} />
          </td>
          {([candidate.guidance, candidate.rsa] as const).map((support, index) => <td key={index} className="px-3 py-3">
            {support ? <div className="space-y-0.5">
              <SupportBadge label={support.status} tone={support.tone} />
              {(support.contributors.length > 0 || support.doneOn) && <p className="text-[10px] text-slate-500">{[support.contributors.join(", "), support.doneOn ? format(new Date(support.doneOn), "d MMM") : null].filter(Boolean).join(" · ")}</p>}
            </div> : <span className="text-xs text-slate-300">—</span>}
          </td>)}
          <td className="px-5 py-3 text-xs text-slate-600">
            {candidate.resumeUrl && <a className="text-indigo-600 hover:underline" href={candidate.resumeUrl} target="_blank" rel="noreferrer">Resume</a>}
            {candidate.skills.length > 0 && <p className="mt-1">{candidate.skills.join(", ")}</p>}
            {candidate.resumeAssessment && <details className="mt-1"><summary className="cursor-pointer text-indigo-600">Resume analysis</summary><pre className="mt-2 max-w-xs whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(candidate.resumeAssessment, null, 2)}</pre></details>}
            {candidate.additionalProfiles.map((profile, index) => <details className="mt-1" key={`${profile.sourceSheet}-${profile.classification}-${index}`}><summary className="cursor-pointer text-indigo-600">{profile.sourceSheet}</summary><pre className="mt-2 max-w-xs whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(profile.data, null, 2)}</pre></details>)}
          </td>
        </tr>;
      })}{data.items.length === 0 && <tr><td colSpan={12} className="px-5 py-6 text-center text-xs text-slate-400">No candidates match these filters.</td></tr>}</tbody>
    </table></div>
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><span>{data.total} candidates · page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
  </>;
}

type AnalyticsJob = CompanyAnalytics["jobs"][number];

const SELECTED_STATUSES = ["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"];
const OFFER_STATUSES = ["OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"];

function StageStep({ label, value, detail, tone = "slate" }: { label: string; value: number | string; detail?: string | undefined; tone?: "slate" | "sky" | "indigo" | "emerald" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    sky: "border-sky-200 bg-sky-50/60",
    indigo: "border-indigo-200 bg-indigo-50/60",
    emerald: "border-emerald-200 bg-emerald-50/60",
  } as const;
  return (
    <div className={`min-w-[120px] flex-1 rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {detail && <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{detail}</p>}
    </div>
  );
}

/**
 * Where the company's own process stands for one job: the status the PSM sets,
 * plus the stages read from the company's Google Sheet (CVs provided, each round,
 * selections and offers).
 */
function CompanyProcessCard({ job, companyName }: { job: AnalyticsJob; companyName: string }) {
  const { can } = usePermissions();
  const [editing, setEditing] = useState(false);
  const count = (statuses: string[]) => job.companyPipeline.filter(({ status }) => statuses.includes(status)).reduce((sum, entry) => sum + entry.count, 0);
  const cvsProvided = job.companyPipeline.reduce((sum, entry) => sum + entry.count, 0);
  const selected = count(SELECTED_STATUSES);
  const offers = count(OFFER_STATUSES);
  const joined = count(["JOINED"]);
  const rejected = count(["REJECTED"]);
  const finalShortlisted = job.stages.FINAL_SHORTLIST?.selected ?? 0;
  const imported = job.companyImport;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{job.roleTitle} · company process</h2>
          <p className="mt-1 text-xs text-slate-500">
            {job.psmOwner ? `Owner: ${job.psmOwner.fullName} · ` : ""}
            {imported?.committedAt
              ? <>Stages from the company sheet, last saved {format(new Date(imported.committedAt), "d MMM yyyy, h:mm a")} (<Link className="text-indigo-600 hover:underline" to={`/imports/${imported.id}`}>{imported.batchCode}</Link>)</>
              : "The company sheet has not been imported for this job yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProcessBadge phase={job.process.phase} label={job.process.label} />
          {job.process.updatedAt && <span className="text-[11px] text-slate-400">since {format(new Date(job.process.updatedAt), "d MMM")}</span>}
          {can("pipeline:write") && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil size={13} /> Change status</Button>}
          {job.companySheetUrl && <Button size="sm" variant="outline" asChild><a href={job.companySheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Company sheet</a></Button>}
          {can("import:run") && (imported
            ? <RefreshFromGoogleButton jobRequestId={job.id} target="COMPANY_PIPELINE" />
            : <Button size="sm" asChild><Link to={`/job-requests/${job.id}/imports/new?target=COMPANY_PIPELINE`}><UploadCloud size={13} /> Import company sheet</Link></Button>)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <StageStep label="Final shortlist (SP)" value={finalShortlisted} detail="Shortlisted internally" />
        <StageStep label="CVs provided" value={cvsProvided} detail="Profiles in the company sheet" tone="sky" />
        {job.companyRounds.map((round) => {
          const appeared = round.cleared + round.rejected + round.onHold;
          const parts = [
            round.rejected ? `${round.rejected} rejected` : null,
            round.onHold ? `${round.onHold} on hold` : null,
            round.scheduled ? `${round.scheduled} scheduled` : null,
            round.noShow ? `${round.noShow} no-show` : null,
          ].filter(Boolean);
          return <StageStep key={round.id} label={`${round.sequence}. ${round.name} cleared`} value={appeared || round.scheduled ? round.cleared : "—"} detail={parts.join(" · ") || (appeared ? undefined : "Not started")} tone="indigo" />;
        })}
        <StageStep label="Selected" value={selected} detail={rejected ? `${rejected} rejected by company` : undefined} tone="emerald" />
        <StageStep label="Offers released" value={offers} detail={joined ? `${joined} joined` : undefined} tone="emerald" />
      </div>
      {job.companyRounds.length === 0 && cvsProvided > 0 && (
        <p className="mt-3 text-xs text-slate-400">No interview rounds were found in the company sheet. Map the round columns when importing it to see each round here.</p>
      )}
      {job.companyPipeline.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.companyPipeline.map(({ status, count: total }) => <Badge key={status} variant="outline" className="text-[11px]">{PIPELINE_STATUS_LABELS[status as PipelineStatus] ?? status} · {total}</Badge>)}
        </div>
      )}
      <ProcessStatusDialog
        open={editing}
        onOpenChange={setEditing}
        job={{ id: job.id, roleTitle: job.roleTitle, companyName, phase: job.process.phase, roundId: job.process.roundId, rounds: job.companyRounds.map(({ id, name }) => ({ id, name })) }}
      />
    </Card>
  );
}

function CompanyAnalytics({ companyId, canViewCandidates }: { companyId: string; canViewCandidates: boolean }) {
  const analytics = useQuery({
    queryKey: ["dashboard", "company", companyId],
    queryFn: () => dashboardApi.getCompanyAnalytics(companyId),
  });
  if (analytics.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (analytics.error) return <Card><ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} /></Card>;
  const { totals, products, jobs, company } = analytics.data;
  const metrics = [
    ["Total applications (TA)", totals.applications],
    ["Resume shortlisted (RS)", totals.resumeShortlisted],
    ["Screening shortlisted (SC)", totals.screeningShortlisted],
    ["Assignment shortlisted (AS)", totals.assignmentShortlisted],
    ["Final shortlisted (SP)", totals.finalShortlisted],
    ["Applicants in assessed pool", totals.inAssessedPool],
    ["Screening no-shows", totals.screeningNoShow],
  ] as const;
  return (
    <div className="space-y-4">
      {jobs.map((job) => <CompanyProcessCard key={`${job.id}-process`} job={job} companyName={company.name} />)}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {metrics.map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-800">Product funnel · all batches</h2>
        {products.length === 0
          ? <p className="mt-3 text-sm text-slate-500">Product counts will appear after the product tab is imported.</p>
          : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-slate-500"><tr><th className="py-2">Product</th><th>TA</th><th>RS</th><th>SC</th><th>AS</th><th>SP</th><th>TA in assessed pool</th><th>SP from assessed pool</th></tr></thead>
            <tbody className="border-t border-slate-100 text-slate-700">{products.map((product) => (
              <tr key={product.id} className="border-b border-slate-100"><th className="py-2 pr-3 font-medium">{product.name} <span className="font-normal text-slate-400">· {CATEGORY_LABELS[product.category as keyof typeof CATEGORY_LABELS] ?? product.category}</span></th><td>{product.applicants}</td><td>{product.resumeShortlisted}</td><td>{product.screeningShortlisted}</td><td>{product.assignmentShortlisted}</td><td>{product.finalShortlisted}</td><td>{product.inPool}</td><td>{product.poolFinalShortlisted}</td></tr>
            ))}</tbody>
          </table></div>}
      </Card>
      {jobs.map((job) => <Card key={`${job.id}-batches`} className="overflow-x-auto p-5">
        <h2 className="text-sm font-semibold text-slate-800">{job.roleTitle} · recruitment batches</h2>
        <p className="mt-1 text-xs text-slate-500">TA source rows are from the latest committed TA-tab import; saved TA counts include active applications in that batch. Excluded rows need correction in the import review.</p>
        {job.batches.length === 0 ? <p className="mt-3 text-xs text-slate-400">No recruitment batches are configured.</p> : <table className="mt-3 w-full min-w-[850px] text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-2">Batch</th><th>Status</th><th>TA source rows</th><th>Saved TA</th><th>Excluded</th><th>RS</th><th>SC</th><th>AS</th><th>SP</th></tr></thead>
          <tbody className="border-t border-slate-100 text-slate-700">{job.batches.map((batch) => (
            <tr key={batch.id} className="border-b border-slate-100 align-top">
              <th className="py-2 pr-3 font-medium">{batch.name}{batch.importBatchId && <Link className="ml-2 text-indigo-600 hover:underline" to={`/imports/${batch.importBatchId}`}>{batch.importBatchCode}</Link>}</th>
              <td className="py-2">{batch.status.toLowerCase()}</td>
              <td className="py-2">{batch.sourceRows ?? "—"}</td>
              <td className="py-2 font-semibold">{batch.applications}</td>
              <td className="py-2">{batch.excludedRows ?? "—"}</td>
              {(["RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST", "FINAL_SHORTLIST"] as const).map((stage) => {
                const counts = batch.stages[stage];
                const parts = [
                  counts.selected ? `${counts.selected} selected` : null,
                  counts.rejected ? `${counts.rejected} rejected` : null,
                  counts.onHold ? `${counts.onHold} on hold` : null,
                  counts.noShow ? `${counts.noShow} no-show` : null,
                  counts.pending ? `${counts.pending} pending` : null,
                ].filter(Boolean);
                const notConducted = job.stages[stage]?.status === "NOT_CONDUCTED";
                return <td key={stage} className="py-2 pr-2">{notConducted ? <span className="text-amber-700">Not conducted{job.stages[stage]?.remarks ? ` · ${job.stages[stage]?.remarks}` : ""}</span> : parts.join(" · ") || "—"}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>}
        {job.batches.some((batch) => batch.products.length > 0) && <div className="mt-4 space-y-3">
          {job.batches.filter((batch) => batch.products.length > 0).map((batch) => <div key={`${batch.id}-products`}>
            <h3 className="text-xs font-semibold text-slate-600">{batch.name} · product-stage counts</h3>
            <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-1">Product</th><th>TA</th><th>RS</th><th>SC</th><th>AS</th><th>SP</th><th>TA in assessed pool</th><th>SP from assessed pool</th></tr></thead>
              <tbody className="border-t border-slate-100">{batch.products.map((product) => <tr key={product.id} className="border-b border-slate-100"><th className="py-2 pr-3 font-medium">{product.name}</th><td>{product.applicants}</td><td>{product.resumeShortlisted}</td><td>{product.screeningShortlisted}</td><td>{product.assignmentShortlisted}</td><td>{product.finalShortlisted}</td><td>{product.inPool}</td><td>{product.poolFinalShortlisted}</td></tr>)}</tbody>
            </table></div>
          </div>)}
        </div>}
      </Card>)}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">Job / role</th><th className="px-4 py-2">TA</th><th className="px-4 py-2">RS</th><th className="px-4 py-2">SC</th><th className="px-4 py-2">AS</th><th className="px-4 py-2">SP</th><th className="px-4 py-2">Products</th></tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-100">
                <td className="px-4 py-3"><Link to={`/job-requests/${job.id}?tab=screening`} className="font-medium text-indigo-700 hover:underline">{job.roleTitle}</Link><p className="text-xs text-slate-400">{job.jobId}</p></td>
                <td className="px-4 py-3">
                  {job.applications}
                  {canViewCandidates && <Link to={`/candidates?jobRequestId=${job.id}`} className="mt-1 block text-xs text-indigo-600 hover:underline">View candidates</Link>}
                </td>
                {(["RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST", "FINAL_SHORTLIST"] as const).map((stage) => {
                  const data = job.stages[stage];
                  return <td key={stage} className="px-4 py-3">
                    {data?.status === "NOT_CONDUCTED"
                      ? <span title={data.remarks ?? "No reason recorded"} className="text-xs text-amber-700">Not conducted{data.remarks ? ` · ${data.remarks}` : " · reason not recorded"}</span>
                      : data?.selected ?? 0}
                  </td>;
                })}
                <td className="px-4 py-3 text-xs text-slate-600">{job.products.map((product) => `${product.name} (${product.applicants})`).join(", ") || "—"}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No visible job requests yet. Create a role and import its Google Sheet to see analytics.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {jobs.map((job) => <Card key={`${job.id}-breakdown`} className="overflow-x-auto p-5">
          <h2 className="text-sm font-semibold text-slate-800">{job.roleTitle} · stage breakdown by category and assessed pool</h2>
          <p className="mt-1 text-xs text-slate-500">TA counts every applicant; each stage row counts candidates selected at that stage. Assessed-pool columns are matched by mobile number.</p>
          <table className="mt-4 w-full min-w-[760px] text-left text-xs">
            <thead className="text-slate-500"><tr><th className="py-2">Stage</th><th>Total</th><th>Intensive</th><th>Academy</th><th>External</th><th>In pool</th><th>Competency pool</th><th>TR cleared</th><th>Bucket A</th><th>Bucket B</th><th>Bucket C</th><th>Bucket D</th></tr></thead>
            <tbody className="border-t border-slate-100 text-slate-700">
              {(["applications", "resumeShortlisted", "screeningShortlisted", "assignmentShortlisted", "finalShortlisted", "shortlisted"] as const).map((measure) => {
                const row = job.breakdown[measure];
                const label = measure === "applications" ? "TA" : measure === "resumeShortlisted" ? "RS"
                  : measure === "screeningShortlisted" ? "SC" : measure === "assignmentShortlisted" ? "AS"
                    : measure === "finalShortlisted" ? "SP" : "Any stage";
                return <tr key={measure} className="border-b border-slate-100"><th className="py-2 pr-2 font-medium">{label}</th><td>{row.total}</td><td>{row.intensive}</td><td>{row.academy}</td><td>{row.external}</td><td>{row.inPool}</td><td>{row.competencyPool}</td><td>{row.trCleared}</td><td>{row.buckets.A}</td><td>{row.buckets.B}</td><td>{row.buckets.C}</td><td>{row.buckets.D}</td></tr>;
              })}
            </tbody>
          </table>
          {(["applications", "resumeShortlisted", "screeningShortlisted", "assignmentShortlisted", "finalShortlisted", "shortlisted"] as const).map((measure) => {
            const levels = Object.entries(job.breakdown[measure].competencyLevels).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
            return <div key={`${measure}-competencies`} className="mt-3"><p className="text-xs font-medium text-slate-600">{measure === "applications" ? "TA" : measure === "resumeShortlisted" ? "RS" : measure === "screeningShortlisted" ? "SC" : measure === "assignmentShortlisted" ? "AS" : measure === "finalShortlisted" ? "SP" : "Any stage"} · competency levels</p><div className="mt-1 flex flex-wrap gap-2">{levels.length ? levels.map(([level, count]) => <Badge key={level} variant="secondary">{level} · {count}</Badge>) : <span className="text-xs text-slate-400">No competency levels matched to this cohort.</span>}</div></div>;
          })}
        </Card>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {jobs.map((job) => (
          <Card key={`${job.id}-profiles`} className="p-5">
            <h2 className="text-sm font-semibold text-slate-800">{job.roleTitle} · additional profiles</h2>
            <p className="mt-1 text-xs text-slate-500">These profile records are tracked separately and do not add to recruitment stages.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.additionalProfiles.length === 0
                ? <span className="text-xs text-slate-400">No extra profile records imported.</span>
                : job.additionalProfiles.map((profile) => <Badge key={profile.classification} variant="secondary">{profile.classification} · {profile.count}</Badge>)}
            </div>
            {job.selectionBasisBreakdown.length > 0 && <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">SP selection basis</h3>
              <div className="mt-2 flex flex-wrap gap-2">{job.selectionBasisBreakdown.map((item) => <Badge key={item.selectionBasis} variant="outline">{item.selectionBasis} · {item.count}</Badge>)}</div>
            </>}
          </Card>
        ))}
      </div>
      {canViewCandidates && jobs.map((job) => <JobCandidates key={`${job.id}-candidates`} companyId={companyId} jobId={job.id} roleTitle={job.roleTitle} applications={job.applications} batches={job.batches} />)}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changingJobId, setChangingJobId] = useState<string | null>(null);
  const company = useQuery({ queryKey: ["companies", companyId], queryFn: () => companiesApi.get(companyId) });

  const toggleStatus = useMutation({
    mutationFn: () => companiesApi.update(companyId, { status: company.data?.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Company status updated");
    },
  });
  const deleteCompany = useMutation({
    mutationFn: () => companiesApi.delete(companyId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["companies"] }),
        queryClient.invalidateQueries({ queryKey: ["job-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success("Company and its job requests permanently deleted");
      navigate("/companies");
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
            {data.canDelete && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete
              </Button>
            )}
            {can("job:write") && data.status === "ACTIVE" && (
              <Button size="sm" onClick={() => navigate(`/job-requests/new?companyId=${data.id}`)}><Plus size={15} /> New job request</Button>
            )}
            {can("import:run") && data.jobRequests.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/imports?companyId=${data.id}`)}>Import Google Sheet</Button>
            )}
          </>
        )}
      />

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="jobs">JDs & hiring status ({data.jobRequests.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics"><CompanyAnalytics companyId={data.id} canViewCandidates={can("candidate:read")} /></TabsContent>

        <TabsContent value="jobs">
          <Card className="overflow-hidden">
            {data.jobRequests.length === 0 ? (
              <EmptyState title="No job requests for this company yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/60">
                    <TableHead className="px-4 text-xs">JD / role</TableHead>
                    <TableHead className="px-4 text-xs">Openings</TableHead>
                    <TableHead className="px-4 text-xs">Employee owner</TableHead>
                    <TableHead className="px-4 text-xs">Requested</TableHead>
                    <TableHead className="px-4 text-xs">Deadline</TableHead>
                    <TableHead className="px-4 text-xs">Hiring status</TableHead>
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
                      <TableCell className="px-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <ProcessBadge phase={job.processPhase} label={job.processLabel} />
                          {can("pipeline:write") && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-indigo-600" onClick={(event) => { event.stopPropagation(); setChangingJobId(job.id); }}>
                              <Pencil size={12} /> Change
                            </Button>
                          )}
                        </div>
                        {job.processPhaseAt && <p className="mt-0.5 text-[10px] text-slate-400">since {format(new Date(job.processPhaseAt), "d MMM yyyy")}</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="details">
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
              <Detail label="Employee owners">
                {[...new Set(openJobs.flatMap(({ psmOwner }) => (psmOwner ? [psmOwner.fullName] : [])))].join(", ")}
              </Detail>
              <Detail label="Added">{`${format(new Date(data.createdAt), "d MMM yyyy")} by ${data.createdBy.fullName}`}</Detail>
              <Detail label="Notes">{data.notes}</Detail>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="overflow-hidden"><HistoryList entries={data.history} /></Card>
        </TabsContent>
      </Tabs>

      {(() => {
        const job = data.jobRequests.find(({ id }) => id === changingJobId);
        return job ? (
          <ProcessStatusDialog
            open
            onOpenChange={(open) => !open && setChangingJobId(null)}
            job={{ id: job.id, roleTitle: job.roleTitle, companyName: data.name, phase: job.processPhase, roundId: job.processRound?.id ?? null, rounds: job.interviewRounds }}
          />
        ) : null;
      })()}
      <CompanyFormDialog open={editing} onOpenChange={setEditing} company={data} />
      <ConfirmDialog
        open={confirmStatus}
        onOpenChange={setConfirmStatus}
        title={data.status === "ACTIVE" ? "Mark this company inactive?" : "Reactivate this company?"}
        description={data.status === "ACTIVE"
          ? "New job requests cannot be added while the company is inactive. Existing job requests are not changed."
          : "Employees will be able to add job requests for this company again."}
        confirmLabel={data.status === "ACTIVE" ? "Mark inactive" : "Reactivate"}
        destructive={data.status === "ACTIVE"}
        onConfirm={() => toggleStatus.mutateAsync()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Permanently delete this company?"
        description={<>This permanently deletes <strong>{data.name}</strong>, all of its job requests, their applications and pipeline data, and import files. Student profiles are not deleted. Audit history is retained. This cannot be undone.</>}
        confirmLabel="Delete company"
        destructive
        onConfirm={() => deleteCompany.mutateAsync()}
      />
    </div>
  );
}
