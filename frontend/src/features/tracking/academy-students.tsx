import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { INTERVIEW_OUTCOME_LABELS, PIPELINE_STATUS_LABELS } from "@placement/shared";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Download, FileText, Users, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { PoolBadge, ProductBadge } from "../../components/student-tags";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { academyInsightsApi } from "../../services/tracking-api";
import type { AcademyCandidate, AcademyCandidateFilters, AcademyCandidateView, AcademyCompanyStage, AcademyFilters, AcademyPoolFilter, AcademyStageFilter, StageResult } from "../../types/academy";
import { downloadCsv } from "../../utils/csv";
import { useRejectionReasons } from "../pipeline/rejection-reason-fields";

const PAGE_SIZE = 50;
const ANY = "__any__";

/** Who to list. The assessed-pool and stage filters narrow it further. */
const ACTIVITY_LABELS: Partial<Record<AcademyCandidateView, string>> = {
  ALL: "Everyone",
  APPLIED: "Applied in this period",
  ZERO_APPLICATIONS: "Did not apply in this period",
};
const POOL_LABELS: Record<AcademyPoolFilter, string> = {
  ANY: "In the assessed pool (any)",
  OFFLINE: "Assessed pool · Offline assessment",
  COMPETENCY: "Assessed pool · Competency assessment",
  BOTH: "Assessed pool · both assessments",
  NONE: "Not in the assessed pool",
};
export const STAGE_FILTER_LABELS: Record<AcademyStageFilter, string> = {
  RESUME_REJECTED: "Rejected at resume shortlist (internal)",
  SCREENING_REJECTED: "Rejected at screening (internal)",
  SCREENING_NO_SHOW: "Did not attend screening",
  ASSIGNMENT_REJECTED: "Rejected at assignment (internal)",
  INTERNAL_REJECTED: "Rejected at any internal step",
  FINAL_SHORTLISTED: "Made the final shortlist",
  SHARED: "Profile shared with a company",
  NOT_SHARED: "Applied but never shared with a company",
  INTERVIEWED: "Attended a company interview",
  COMPANY_REJECTED: "Rejected by a company",
  SELECTED: "Selected by a company",
};
export const COMPANY_STAGES: [AcademyCompanyStage, string][] = [
  ["CV", "Company CV screen"], ["ASSESSMENT", "Assessment"], ["TR1", "Technical round 1"], ["TR2", "Technical round 2"], ["TR3", "Technical round 3+"],
  ["MR", "Managerial round"], ["CLIENT", "Client round"], ["HR", "HR round"], ["OTHER", "Other rounds"],
];

const monthLabel = (month: string | null) => (month ? format(new Date(`${month}-01T00:00:00`), "MMM yyyy") : "—");
const num = (value: number, tone?: string) => <span className={value === 0 ? "text-slate-300" : tone}>{value}</span>;

/** "3 / 1": passed (green) / rejected (red); a dash when neither. */
export function PassFail({ pass, fail }: { pass: number; fail: number }) {
  if (!pass && !fail) return <span className="text-slate-300">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className={pass ? "text-emerald-700" : "text-slate-300"} title="Passed">{pass}</span>
      <span className="text-slate-300"> / </span>
      <span className={fail ? "text-rose-600" : "text-slate-300"} title="Rejected">{fail}</span>
    </span>
  );
}

function FilterSelect<T extends string>({ label, value, options, onChange, width = "w-56" }: { label: string; value: T | undefined; options: [T, string][]; onChange: (value: T | undefined) => void; width?: string }) {
  return (
    <label className="grid gap-1 text-xs text-slate-500">{label}
      <Select value={value ?? ANY} onValueChange={(next) => onChange(next === ANY ? undefined : next as T)}>
        <SelectTrigger className={`h-9 ${width} ${value ? "border-indigo-300 bg-indigo-50/50 text-indigo-900" : ""}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          <SelectSeparator />
          {options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * Every Academy / assessed-pool student with their product, pool tag and how far
 * they got. Filters combine: e.g. Offline pool + "Rejected at resume shortlist".
 */
export function StudentsPanel({ filters, initial }: { filters: AcademyFilters; initial?: Partial<AcademyCandidateFilters> }) {
  const [list, setList] = useState<AcademyCandidateFilters>({ view: "ALL", ...initial });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim(), 300);
  const set = (patch: Partial<AcademyCandidateFilters>) => { setList((current) => ({ ...current, ...patch })); setPage(1); };
  const reasons = useRejectionReasons();
  const students = useQuery({
    queryKey: ["academy-insights", "candidates", filters, list, q],
    queryFn: () => academyInsightsApi.candidates({ ...filters, ...list, q: q || undefined }),
    placeholderData: keepPreviousData,
  });
  const items = students.data ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reasonOptions: [string, string][] = [
    ...(reasons.data ?? []).filter((reason) => !reason.archivedAt || reason.inUse).map((reason): [string, string] => [reason.id, reason.label]),
    ["untagged", "Rejected, no reason tagged yet"],
  ];
  const chips: { key: keyof AcademyCandidateFilters; text: string }[] = [
    ...(list.view !== "ALL" ? [{ key: "view" as const, text: ACTIVITY_LABELS[list.view] ?? list.view }] : []),
    ...(list.poolSource ? [{ key: "poolSource" as const, text: POOL_LABELS[list.poolSource] }] : []),
    ...(list.product ? [{ key: "product" as const, text: list.product === "NONE" ? "No product on record" : list.product }] : []),
    ...(list.stage ? [{ key: "stage" as const, text: STAGE_FILTER_LABELS[list.stage] }] : []),
    ...(list.reasonTagId ? [{ key: "reasonTagId" as const, text: `Company reason: ${reasonOptions.find(([id]) => id === list.reasonTagId)?.[1] ?? "…"}` }] : []),
  ];

  const download = () => downloadCsv(["students", filters.from, filters.to].filter(Boolean).join("-"),
    ["Name", "Mobile", "Candidate code", "Product", "Assessed pool", "Pool tab", "Bucket", "TR1", "TR2", "Applications", "Companies",
      "Resume shortlist passed", "Resume shortlist rejected", "Screening passed", "Screening rejected", "Screening no-show", "Assignment passed", "Assignment rejected",
      "Rejected internally", "Final shortlist", "Shared with company", ...COMPANY_STAGES.flatMap(([, label]) => [`${label} cleared`, `${label} rejected`]),
      "Interviewed", "Rejected by company", "Company rejection reasons", "Selected", "Last applied"],
    items.map((row) => [row.fullName, row.mobile, row.candidateCode, row.product ?? "", row.inPool ? "Yes" : "No", row.poolSource ?? "", row.tier, row.tr1Status, row.tr2Status, row.applications, row.companies,
      row.internalStages.RS.selected, row.internalStages.RS.rejected, row.internalStages.SC.selected, row.internalStages.SC.rejected, row.internalStages.SC.noShow,
      row.internalStages.AS.selected, row.internalStages.AS.rejected, row.internalRejected, row.finalShortlisted, row.shared,
      ...COMPANY_STAGES.flatMap(([stage]) => [row.companyStages[stage]?.cleared ?? 0, row.companyStages[stage]?.rejected ?? 0]),
      row.interviewed, row.companyRejected, row.rejectionReasons.join("; "), row.selected, row.lastMonth]));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Students</p>
          <p className="mt-0.5 text-xs text-slate-500">Every Academy and assessed-pool student. Combine the filters, e.g. “Offline assessment” + “Rejected at resume shortlist”. Click a row to see each company they applied to.</p>
        </div>
        <Button size="sm" variant="outline" disabled={items.length === 0} onClick={download}><Download size={13} /> Download CSV</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/40 px-4 py-3">
        <label className="grid gap-1 text-xs text-slate-500">Search
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or mobile" className="h-9 w-48 bg-white" />
        </label>
        <FilterSelect label="Applied?" width="w-48" value={list.view === "ALL" ? undefined : list.view}
          options={(Object.entries(ACTIVITY_LABELS) as [AcademyCandidateView, string][]).filter(([key]) => key !== "ALL")}
          onChange={(value) => set({ view: value ?? "ALL" })} />
        <FilterSelect label="Assessed pool" value={list.poolSource} options={Object.entries(POOL_LABELS) as [AcademyPoolFilter, string][]} onChange={(value) => set({ poolSource: value })} />
        <FilterSelect label="Product" width="w-52" value={list.product}
          options={[["Academy", "Academy"], ["Intensive", "Intensive"], ["External", "External"], ["NONE", "No product on record"]]}
          onChange={(value) => set({ product: value })} />
        <FilterSelect label="Where they got to" width="w-64" value={list.stage} options={Object.entries(STAGE_FILTER_LABELS) as [AcademyStageFilter, string][]} onChange={(value) => set({ stage: value })} />
        <FilterSelect label="Company rejection reason" width="w-56" value={list.reasonTagId} options={reasonOptions} onChange={(value) => set({ reasonTagId: value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        <span className="font-semibold text-slate-800">{students.data ? `${items.length}${items.length === 5000 ? "+" : ""} students` : "…"}</span>
        {chips.map((chip) => (
          <button key={chip.key} type="button" onClick={() => set(chip.key === "view" ? { view: "ALL" } : { [chip.key]: undefined })}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-800 hover:bg-indigo-100">
            {chip.text} <X size={11} />
          </button>
        ))}
        {chips.length > 1 && <button type="button" className="text-slate-500 underline-offset-2 hover:underline" onClick={() => { setList({ view: "ALL" }); setPage(1); }}>Clear all</button>}
      </div>
      {students.isPending ? <LoadingRows rows={6} /> : students.error ? <ErrorState error={students.error} /> : shown.length === 0 ? <EmptyState icon={Users} title="No students match these filters" description="Remove a filter to widen the list." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                <th colSpan={2} />
                <th colSpan={5} className="border-l border-slate-100 px-3 pt-2 text-center">Our internal shortlisting · passed / rejected</th>
                <th colSpan={4} className="border-l border-slate-100 px-3 pt-2 text-center">With companies</th>
                <th />
              </tr>
              <tr>
                <th className="px-4 py-2">Student</th>
                <th className="px-3 py-2 text-right" title="Applications in the period · different companies">Applied</th>
                <th className="border-l border-slate-100 px-3 py-2 text-right">Resume shortlist</th>
                <th className="px-3 py-2 text-right">Screening</th>
                <th className="px-3 py-2 text-right">Assignment</th>
                <th className="px-3 py-2 text-right" title="Rejected at resume shortlist, screening or assignment">Rejected internally</th>
                <th className="px-3 py-2 text-right">Final shortlist</th>
                <th className="border-l border-slate-100 px-3 py-2 text-right">Shared</th>
                <th className="px-3 py-2 text-right" title="Attended at least one company round">Interviewed</th>
                <th className="px-3 py-2">Rejected by company · why</th>
                <th className="px-3 py-2 text-right">Selected</th>
                <th className="px-3 py-2">Last applied</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shown.map((row, index) => {
                const key = row.candidateId ?? `${row.mobile}-${index}`;
                const expandable = Boolean(row.candidateId && row.applications > 0);
                const expanded = expandable && open === key;
                return (
                  <Fragment key={key}>
                    <tr className={`border-t border-slate-100 align-top ${expandable ? "cursor-pointer hover:bg-slate-50/70" : ""} ${expanded ? "bg-indigo-50/40" : ""}`}
                      onClick={expandable ? () => setOpen(expanded ? null : key) : undefined}>
                      <td className="px-4 py-2">
                        <div className="flex items-start gap-1.5">
                          {expandable ? (expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-indigo-600" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />) : <span className="w-3.5 shrink-0" />}
                          <div className="min-w-0">
                            {row.candidateId
                              ? <Link to={`/candidates/${row.candidateId}`} onClick={(event) => event.stopPropagation()} className="font-medium text-slate-800 hover:text-indigo-700">{row.fullName}</Link>
                              : <span className="font-medium text-slate-800">{row.fullName}</span>}
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <ProductBadge products={row.product} />
                              <PoolBadge source={row.poolSource} />
                              {row.tier && <span className="text-[10px] text-slate-500" title="Assessed-pool bucket">Bucket {row.tier}</span>}
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-400">{row.mobile ?? row.candidateCode}{!row.candidateId && " · not in any job sheet yet"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right"><span className="font-medium">{row.applications}</span>{row.applications > 0 && <p className="text-[11px] text-slate-400">{row.companies} {row.companies === 1 ? "company" : "companies"}</p>}</td>
                      <td className="border-l border-slate-100 px-3 py-2 text-right"><PassFail pass={row.internalStages.RS.selected} fail={row.internalStages.RS.rejected} /></td>
                      <td className="px-3 py-2 text-right">
                        <PassFail pass={row.internalStages.SC.selected} fail={row.internalStages.SC.rejected} />
                        {row.internalStages.SC.noShow > 0 && <p className="text-[10px] text-violet-700">{row.internalStages.SC.noShow} did not attend</p>}
                      </td>
                      <td className="px-3 py-2 text-right"><PassFail pass={row.internalStages.AS.selected} fail={row.internalStages.AS.rejected} /></td>
                      <td className="px-3 py-2 text-right">{num(row.internalRejected, "text-rose-600")}</td>
                      <td className="px-3 py-2 text-right">{num(row.finalShortlisted)}</td>
                      <td className="border-l border-slate-100 px-3 py-2 text-right">{num(row.shared)}</td>
                      <td className="px-3 py-2 text-right">{num(row.interviewed)}</td>
                      <td className="px-3 py-2">
                        {row.companyRejected === 0 ? <span className="text-slate-300">—</span> : (
                          <div className="flex max-w-60 flex-wrap items-center gap-1">
                            <span className="font-medium text-rose-600">{row.companyRejected}</span>
                            {row.rejectionReasons.map((reason) => (
                              <span key={reason} className={`rounded-full px-1.5 py-px text-[10px] ${reason === "No reason tagged" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{reason}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{num(row.selected, "font-semibold text-emerald-700")}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{monthLabel(row.lastMonth)}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-t border-indigo-100 bg-indigo-50/20">
                        <td colSpan={12} className="px-4 py-3"><StudentApplications candidate={row} filters={filters} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Page {page} of {pages}
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </Card>
  );
}

const STAGE_STYLE: Record<NonNullable<StageResult>, [string, string]> = {
  SELECTED: ["✓ Passed", "text-emerald-700"],
  REJECTED: ["✗ Rejected", "font-medium text-rose-600"],
  NO_SHOW: ["Did not attend", "text-violet-700"],
};

function StageCell({ result }: { result: StageResult }) {
  if (!result) return <span className="text-slate-300">—</span>;
  const [text, tone] = STAGE_STYLE[result];
  return <span className={tone}>{text}</span>;
}

function Strong({ children, tone }: { children: ReactNode; tone?: string }) {
  return <strong className={tone}>{children}</strong>;
}

/** Each application of one student: company, internal steps, company rounds (with reasons) and final status. */
function StudentApplications({ candidate, filters }: { candidate: AcademyCandidate; filters: AcademyFilters }) {
  const applications = useQuery({
    queryKey: ["academy-insights", "student", candidate.candidateId, filters],
    queryFn: () => academyInsightsApi.studentApplications(candidate.candidateId!, filters),
  });
  if (applications.isPending) return <LoadingRows rows={2} />;
  if (applications.error) return <ErrorState error={applications.error} />;
  const rows = applications.data;
  const companies = new Set(rows.map((row) => row.companyId)).size;
  const rejectedAt = (stage: "RS" | "SC" | "AS") => rows.filter((row) => row.internal[stage] === "REJECTED").length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{candidate.fullName}</span> applied <Strong>{rows.length}</Strong> {rows.length === 1 ? "time" : "times"} to <Strong>{companies}</Strong> {companies === 1 ? "company" : "companies"}.
        Rejected internally at resume shortlist <Strong tone="text-rose-600">{rejectedAt("RS")}</Strong>, screening <Strong tone="text-rose-600">{rejectedAt("SC")}</Strong>, assignment <Strong tone="text-rose-600">{rejectedAt("AS")}</Strong> times ·
        final shortlist <Strong>{rows.filter((row) => row.internal.SP).length}</Strong> · shared with <Strong>{rows.filter((row) => row.shared).length}</Strong> · selected by <Strong tone="text-emerald-700">{rows.filter((row) => row.selected).length}</Strong>
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-1.5">Company · role</th><th className="px-3 py-1.5">Month</th>
              <th className="px-3 py-1.5">Resume shortlist</th><th className="px-3 py-1.5">Screening</th><th className="px-3 py-1.5">Assignment</th><th className="px-3 py-1.5">Final shortlist</th>
              <th className="px-3 py-1.5">Internal rejection reason</th><th className="px-3 py-1.5">Shared</th><th className="px-3 py-1.5">Company rounds</th><th className="px-3 py-1.5">Final status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.applicationId} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5">
                  <Link to={`/job-requests/${row.jobRequestId}`} onClick={(event) => event.stopPropagation()} className="font-medium text-slate-800 hover:text-indigo-700">{row.companyName}</Link>
                  <p className="text-slate-500">{row.roleTitle}{row.jobCode ? ` · ${row.jobCode}` : ""}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{monthLabel(row.month)}</td>
                <td className="whitespace-nowrap px-3 py-1.5"><StageCell result={row.internal.RS} /></td>
                <td className="whitespace-nowrap px-3 py-1.5"><StageCell result={row.internal.SC} /></td>
                <td className="whitespace-nowrap px-3 py-1.5"><StageCell result={row.internal.AS} /></td>
                <td className="whitespace-nowrap px-3 py-1.5"><StageCell result={row.internal.SP} /></td>
                <td className="max-w-56 px-3 py-1.5 text-slate-600">{row.rejectionReason ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-1.5">{row.shared ? <span className="text-sky-700">Yes</span> : <span className="text-slate-300">No</span>}</td>
                <td className="px-3 py-1.5">
                  {row.rounds.length === 0 ? <span className="text-slate-300">—</span> : (
                    <div className="flex flex-col gap-1">
                      {row.rounds.map((round, index) => (
                        <span key={`${round.label}-${index}`} className="flex flex-wrap items-center gap-1">
                          <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 ${round.outcome === "CLEARED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : round.outcome === "REJECTED" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                            {round.label}: {INTERVIEW_OUTCOME_LABELS[round.outcome] ?? round.outcome}
                          </span>
                          {round.outcome === "REJECTED" && <span className="text-slate-600">{round.reason ?? <span className="text-amber-700">no reason tagged</span>}</span>}
                          {round.docUrl && <a href={round.docUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-0.5 text-indigo-600 hover:underline"><FileText size={10} /> Doc</a>}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  {row.pipelineStatus && row.pipelineStatus !== "NOT_SUBMITTED"
                    ? <span className={row.selected ? "font-medium text-emerald-700" : row.pipelineStatus === "REJECTED" ? "text-rose-600" : "text-slate-700"}>{PIPELINE_STATUS_LABELS[row.pipelineStatus]}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
