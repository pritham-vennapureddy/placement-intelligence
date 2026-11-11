import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  DECISION_STAGES,
  INTERNAL_STAGES,
  SCREENING_SKIP_REASON_LABELS,
  STAGE_LABELS,
  STAGE_OUTCOME_LABELS,
  STAGE_OUTCOMES,
  type InternalStage,
  type StageOutcome,
} from "@placement/shared";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Search, UploadCloud, Users } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { usePermissions } from "../../hooks/use-permissions";
import { screeningApi } from "../../services/workflow-api";
import type { ScreeningProcess, StageView } from "../../types/workflow";
import { cn } from "../../utils/cn";
import { CATEGORY_LABELS, OutcomeBadge, StageStatusBadge } from "./badges";
import { RefreshFromGoogleButton } from "../imports/refresh-button";
import { RecruitmentBatchesPanel } from "./recruitment-batches";

const ALL = "__all__";

function StageCard({ stage, total, active, onClick }: { stage: StageView; total: number; active: boolean; onClick: () => void }) {
  const { code, label } = STAGE_LABELS[stage.stage];
  const counts = stage.counts;
  const isTotal = stage.stage === "TOTAL_APPLICATIONS";
  return (
    <button type="button" onClick={onClick}
      className={cn("rounded-xl border bg-white p-3 text-left transition", active ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200 hover:border-indigo-200")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-indigo-600">{code}</span>
        <StageStatusBadge status={stage.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{isTotal ? total : counts.SELECTED ?? 0}</p>
      <p className="text-[11px] text-slate-400">
        {isTotal ? "applicants" : `selected · ${counts.REJECTED ?? 0} rejected · ${counts.ON_HOLD ?? 0} hold · ${counts.PENDING ?? 0} pending`}
      </p>
    </button>
  );
}

function StageTrackingSummary({ stage }: { stage: StageView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3 text-xs text-slate-500">
      <StageStatusBadge status={stage.status} />
      {stage.completedAt && <span>Updated {format(new Date(stage.completedAt), "d MMM yyyy")}</span>}
      {stage.status === "NOT_CONDUCTED" && stage.skipReason && <span className="font-medium text-violet-700">Skipped: {SCREENING_SKIP_REASON_LABELS[stage.skipReason]}</span>}
      {stage.remarks && <span>{stage.remarks}</span>}
      {stage.nextPlannedDate && <span>Next: {format(new Date(stage.nextPlannedDate), "d MMM yyyy")}</span>}
    </div>
  );
}

function StageCandidates({ jobRequestId, stage }: { jobRequestId: string; stage: InternalStage }) {
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<StageOutcome | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  useEffect(() => { setPage(1); setOutcome(ALL); }, [stage]);
  const isTotal = stage === "TOTAL_APPLICATIONS";
  const rows = useQuery({
    queryKey: ["screening", jobRequestId, "candidates", stage, page, outcome, search],
    queryFn: () => screeningApi.candidates(jobRequestId, stage, { page, pageSize: 25, ...(outcome !== ALL ? { outcome } : {}), ...(search ? { search } : {}) }),
    // Keep the old rows while paging or filtering, but never show another stage's rows.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === stage ? keepPreviousData(previous) : undefined),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <label className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email, mobile, ID…" className="h-9 pl-8" />
        </label>
        {!isTotal && (
          <Select value={outcome} onValueChange={(value) => { setOutcome(value as StageOutcome | typeof ALL); setPage(1); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All outcomes</SelectItem>
              {STAGE_OUTCOMES.map((value) => <SelectItem key={value} value={value}>{STAGE_OUTCOME_LABELS[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {rows.isPending ? <LoadingRows /> : rows.error ? <ErrorState error={rows.error} onRetry={() => void rows.refetch()} /> : rows.data.items.length === 0 ? (
        <EmptyState icon={Users} title={isTotal ? "No applicants yet" : "Nobody at this stage yet"}
          description="Import or refresh the job's Google Sheet to update its applicants and stage results." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Product</th>
                {isTotal ? <th className="px-4 py-2">Applied</th> : <><th className="px-4 py-2">Outcome</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Scores</th><th className="px-4 py-2">{stage === "FINAL_SHORTLIST" ? "Selection basis / remarks" : "Reason / remarks"}</th></>}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.data.items.map((row) => (
                <tr key={row.application.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2.5">
                    <Link to={`/candidates/${row.application.candidate.id}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.application.candidate.fullName}</Link>
                    <p className="text-xs text-slate-400">{[row.application.candidate.mobile, row.application.candidate.email].filter(Boolean).join(" · ")}</p>
                    {!!row.application.candidate.poolMemberships?.length && (
                      <p className="mt-1 text-[10px] text-indigo-600">
                        {row.application.candidate.poolMemberships.map(({ poolType }) => poolType).join(" · ")} pool
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {row.application.product?.name ?? "—"}
                    {row.application.candidate.category && <p className="text-slate-400">{CATEGORY_LABELS[row.application.candidate.category]}</p>}
                  </td>
                  {isTotal ? (
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {row.application.appliedAt ? format(new Date(row.application.appliedAt), "d MMM yyyy") : "—"}
                      {row.application.source === "CARRIED_OVER" && <p className="text-indigo-600">from an earlier drive</p>}
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-2.5">{row.outcome && <OutcomeBadge outcome={row.outcome} />}<p className="mt-1 text-[11px] text-slate-400">{row.source === "IMPORT" ? "from sheet" : row.decidedBy ? `by ${row.decidedBy.fullName}` : ""}</p></td>
                      <td className="px-4 py-2.5 text-xs">{row.priority ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{row.techScore !== null && row.techScore !== undefined ? `Tech ${row.techScore}` : ""}{row.commScore !== null && row.commScore !== undefined ? ` · Comm ${row.commScore}` : ""}</td>
                      <td className="max-w-64 px-4 py-2.5 text-xs text-slate-600">
                        {row.selectionBasis && <p className="font-medium text-slate-700">{row.selectionBasis}</p>}
                        {/* Remarks already shown as the selection basis are not repeated. */}
                        {[row.rejectionReason, row.remarks !== row.selectionBasis ? row.remarks : null].filter(Boolean).join(" · ")}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-right" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.data && rows.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>{rows.data.meta.total} candidates · page {page} of {rows.data.meta.totalPages}</span>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></Button>
            <Button size="icon-sm" variant="outline" disabled={page >= rows.data.meta.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ANALYTICS_STAGES = ["TOTAL_APPLICATIONS", "RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST", "FINAL_SHORTLIST"] as const;
type AnalyticsStage = (typeof ANALYTICS_STAGES)[number];
type StageCell = (count: number, base: number) => ReactNode;

function share(count: number, of: number) {
  return of > 0 && count > 0 ? `${Math.round((count / of) * 1000) / 10}%` : "";
}

function SheetAnalytics({ process }: { process: ScreeningProcess }) {
  const analytics = process.stageAnalytics;
  const stageHeaders = ANALYTICS_STAGES.map((stage) => ({ stage, code: STAGE_LABELS[stage].code }));
  const categories = (["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL", null] as const).map((category) => {
    const products = analytics.byProduct.filter((product) => product.category === category);
    const totals = Object.fromEntries(ANALYTICS_STAGES.map((stage) => [stage, products.reduce((sum, product) => sum + product.stages[stage], 0)])) as Record<AnalyticsStage, number>;
    return { category, label: category ? CATEGORY_LABELS[category] : "Product unknown", products, totals };
  }).filter(({ products }) => products.length > 0);
  const grandTotal = Object.fromEntries(ANALYTICS_STAGES.map((stage) => [stage, categories.reduce((sum, group) => sum + group.totals[stage], 0)])) as Record<AnalyticsStage, number>;
  const pool = analytics.assessedPool;
  const poolLabels = { BUCKET: "Bucket pool", TR: "TR pool", COMPETENCY: "Competency pool" } as const;
  const syncedPool = process.poolProgress.some(({ applicants }) => applicants > 0);

  const cell: StageCell = (count, base) => (
    <td className="px-2 py-2 text-right tabular-nums">
      {count}
      {base > 0 && count > 0 && <span className="ml-1 text-[10px] text-slate-400">{share(count, base)}</span>}
    </td>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-800">Applicants by product at each stage</h2>
        <p className="mt-1 text-xs text-slate-500">TA counts every applicant; RS, SC, AS and SP count the candidates selected at that stage. Percentages are of the row's TA.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-2 pr-2 font-medium">Product</th>
                {stageHeaders.map(({ stage, code }) => <th key={stage} className="px-2 py-2 text-right font-medium">{code}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((group) => <CategoryRows key={group.label} group={group} cell={cell} />)}
              <tr className="font-semibold text-slate-900">
                <td className="py-2 pr-2">Total</td>
                {ANALYTICS_STAGES.map((stage) => <Fragment key={stage}>{cell(grandTotal[stage], stage === "TOTAL_APPLICATIONS" ? 0 : grandTotal.TOTAL_APPLICATIONS)}</Fragment>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-800">Assessed-pool applicants</h2>
        {pool.poolSize === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No assessed-pool data is loaded yet. Upload it under Candidates → Assessed pool to see how pool students progress here.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500">
              {pool.stages.TOTAL_APPLICATIONS.inPool} of {grandTotal.TOTAL_APPLICATIONS} applicants are in the assessed pool ({pool.poolSize} assessed students), matched by mobile number. Each row counts the pool students who reached that stage.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="py-2 pr-2 font-medium">Stage</th>
                    <th className="px-2 py-2 text-right font-medium">All applicants</th>
                    <th className="px-2 py-2 text-right font-medium">From pool</th>
                    {(["A", "B", "C", "D"] as const).map((tier) => <th key={tier} className="px-2 py-2 text-right font-medium">Bucket {tier}</th>)}
                    <th className="px-2 py-2 text-right font-medium">No bucket</th>
                    <th className="px-2 py-2 text-right font-medium">TR cleared</th>
                    <th className="px-2 py-2 text-right font-medium">Competency pool</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stageHeaders.map(({ stage, code }) => {
                    const counts = pool.stages[stage];
                    return (
                      <tr key={stage}>
                        <td className="py-2 pr-2 font-medium text-slate-700">{code} · {STAGE_LABELS[stage].label}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{grandTotal[stage]}</td>
                        {cell(counts.inPool, grandTotal[stage])}
                        {(["A", "B", "C", "D"] as const).map((tier) => <td key={tier} className="px-2 py-2 text-right tabular-nums">{counts.buckets[tier]}</td>)}
                        <td className="px-2 py-2 text-right tabular-nums">{counts.buckets.other}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{counts.trCleared}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{counts.competencyPool}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {syncedPool && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-xs font-medium text-slate-600">Synced pool tabs (Bucket, TR, Competency UID)</p>
            <table className="mt-2 w-full min-w-[480px] text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-2 pr-2 font-medium">Pool</th>
                  <th className="px-2 py-2 font-medium">Applied</th>
                  {DECISION_STAGES.map((stage) => <th key={stage} className="px-2 py-2 font-medium">{STAGE_LABELS[stage].code} S/R</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {process.poolProgress.map((entry) => (
                  <tr key={entry.poolType}>
                    <td className="py-2 pr-2 font-medium text-slate-700">{poolLabels[entry.poolType]}</td>
                    <td className="px-2 py-2">{entry.applicants}</td>
                    {DECISION_STAGES.map((stage) => <td key={stage} className="px-2 py-2">{entry.stages[stage]?.selected ?? 0} / {entry.stages[stage]?.rejected ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CategoryRows({ group, cell }: {
  group: { label: string; products: ScreeningProcess["stageAnalytics"]["byProduct"]; totals: Record<AnalyticsStage, number> };
  cell: StageCell;
}) {
  // A category with one product of the same name (e.g. External) needs no sub-row.
  const single = group.products.length === 1 && group.products[0]!.name === group.label;
  return (
    <>
      <tr className="bg-slate-50/70 font-semibold text-slate-800">
        <td className="py-2 pr-2">{group.label}</td>
        {ANALYTICS_STAGES.map((stage) => <Fragment key={stage}>{cell(group.totals[stage], stage === "TOTAL_APPLICATIONS" ? 0 : group.totals.TOTAL_APPLICATIONS)}</Fragment>)}
      </tr>
      {!single && group.products.map((product) => (
        <tr key={product.productId ?? "unknown"} className="text-slate-600">
          <td className="py-2 pl-4 pr-2">{product.name}</td>
          {ANALYTICS_STAGES.map((stage) => <Fragment key={stage}>{cell(product.stages[stage], stage === "TOTAL_APPLICATIONS" ? 0 : product.stages.TOTAL_APPLICATIONS)}</Fragment>)}
        </tr>
      ))}
    </>
  );
}

export function ScreeningTab({ jobRequestId }: { jobRequestId: string }) {
  const { can } = usePermissions();
  const [stage, setStage] = useState<InternalStage>("TOTAL_APPLICATIONS");
  const process = useQuery({ queryKey: ["screening", jobRequestId], queryFn: () => screeningApi.get(jobRequestId) });

  if (process.isPending) return <Card><LoadingRows rows={5} /></Card>;
  if (process.error) return <Card><ErrorState error={process.error} onRetry={() => void process.refetch()} /></Card>;
  const data = process.data;
  const current = data.stages.find((entry) => entry.stage === stage)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RefreshFromGoogleButton jobRequestId={jobRequestId} target="INTERNAL_SCREENING" />
        {can("import:run") && (
          <Button size="sm" asChild><Link to={`/job-requests/${jobRequestId}/imports/new?target=INTERNAL_SCREENING`}><UploadCloud size={14} /> Read internal Google Sheet</Link></Button>
        )}
      </div>
      <RecruitmentBatchesPanel jobRequestId={jobRequestId} />
      <SheetAnalytics process={data} />
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {INTERNAL_STAGES.map((key) => (
          <StageCard key={key} stage={data.stages.find((entry) => entry.stage === key)!} total={data.totalApplications} active={key === stage} onClick={() => setStage(key)} />
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 pt-4">
          <p className="text-sm font-semibold text-slate-800">{STAGE_LABELS[stage].code} · {STAGE_LABELS[stage].label}</p>
        </div>
        <StageTrackingSummary stage={current} />
        <StageCandidates jobRequestId={jobRequestId} stage={stage} />
      </Card>
    </div>
  );
}
