import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { companyProcessLabel, SCREENING_SKIP_REASON_LABELS, STAGE_LABELS, type InternalStage } from "@placement/shared";
import { format } from "date-fns";
import { Award, GraduationCap, ListChecks, Send, UserMinus, Users, UserX, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { usePermissions } from "../../hooks/use-permissions";
import { insightsApi } from "../../services/tracking-api";
import type { InsightCategory, InsightFilters, InsightMetrics, StudentStatusFilter } from "../../types/tracking";
import { BigPicture } from "./big-picture";
import { CompanyStatusCell } from "./tracking-dialogs";

const ALL = "__all__";
const CATEGORY_LABELS: Record<string, string> = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Academy Intensive", EXTERNAL: "External", UNKNOWN: "Unknown" };
const STATUS_LABELS: Record<StudentStatusFilter, string> = {
  INTERNAL_REJECTED: "Rejected internally (RS/SC/AS)",
  FINAL_SHORTLIST: "Final shortlist (SP)",
  NOT_SHARED: "Not shared with company",
  SHARED: "Shared with company",
  IN_PROCESS: "In company process",
  COMPANY_REJECTED: "Rejected by company",
  SELECTED: "Selected by company",
  JOINED: "Joined",
};
const monthLabel = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yyyy");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

type Column = { key: string; label: string; title?: string; render: (row: InsightMetrics) => ReactNode };
const n = (value: number, tone?: string) => <span className={value === 0 ? "text-slate-300" : tone}>{value}</span>;
const METRIC_COLUMNS: Column[] = [
  { key: "ta", label: "TA", title: "Applications", render: (row) => n(row.applications) },
  { key: "academy", label: "Academy TA", render: (row) => n(row.academyApplications) },
  { key: "rej", label: "Int. rejected", title: "Rejected at RS, SC or AS", render: (row) => <>{n(row.internalRejected, "text-rose-600")} <span className="text-[11px] text-slate-400">{pct(row.internalRejected, row.applications)}</span></> },
  { key: "arej", label: "Academy int. rejected", render: (row) => <>{n(row.academyInternalRejected, "font-semibold text-rose-700")} <span className="text-[11px] text-slate-400">{pct(row.academyInternalRejected, row.academyApplications)}</span></> },
  { key: "rs", label: "RS rej.", render: (row) => n(row.rejectedAt.RS) },
  { key: "sc", label: "SC rej.", render: (row) => n(row.rejectedAt.SC) },
  { key: "as", label: "AS rej.", render: (row) => n(row.rejectedAt.AS) },
  { key: "ns", label: "SC no-show", render: (row) => n(row.screeningNoShow) },
  { key: "sp", label: "SP", render: (row) => n(row.finalShortlisted) },
  { key: "shared", label: "Shared", render: (row) => n(row.shared) },
  { key: "notshared", label: "Not shared", render: (row) => n(row.notShared, "font-semibold text-amber-700") },
  { key: "inproc", label: "In process", render: (row) => n(row.inProcess) },
  { key: "corej", label: "Co. rejected", render: (row) => n(row.companyRejected) },
  { key: "sel", label: "Selects", render: (row) => n(row.selected, "font-semibold text-emerald-700") },
  { key: "off", label: "Offers", render: (row) => n(row.offers) },
  { key: "join", label: "Joined", render: (row) => n(row.joined, "font-semibold text-emerald-700") },
];

function MetricsTable<T extends InsightMetrics>({ rows, lead, rowKey }: { rows: T[]; lead: { label: string; render: (row: T) => ReactNode }[]; rowKey: (row: T) => string }) {
  if (rows.length === 0) return <EmptyState title="No data for these filters" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
          <tr>
            {lead.map((column) => <th key={column.label} className="whitespace-nowrap px-4 py-2">{column.label}</th>)}
            {METRIC_COLUMNS.map((column) => <th key={column.key} title={column.title} className="whitespace-nowrap px-3 py-2 text-right">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-slate-100">
              {lead.map((column) => <td key={column.label} className="whitespace-nowrap px-4 py-2">{column.render(row)}</td>)}
              {METRIC_COLUMNS.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right">{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentsTable({ filters, companyName, onClearCompany }: { filters: InsightFilters; companyName: string | null; onClearCompany: () => void }) {
  const [status, setStatus] = useState<StudentStatusFilter | undefined>("INTERNAL_REJECTED");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim(), 300);
  const students = useQuery({
    queryKey: ["insights", "students", filters, status, q, page],
    queryFn: () => insightsApi.students({ ...filters, status, q: q || undefined, page }),
    placeholderData: keepPreviousData,
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Select value={status ?? ALL} onValueChange={(value) => { setStatus(value === ALL ? undefined : value as StudentStatusFilter); setPage(1); }}>
          <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All applications</SelectItem>
            {(Object.keys(STATUS_LABELS) as StudentStatusFilter[]).map((key) => <SelectItem key={key} value={key}>{STATUS_LABELS[key]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or mobile" className="h-9 w-56" />
        {companyName && <Button size="sm" variant="outline" onClick={onClearCompany}>{companyName} <X size={13} /></Button>}
        {students.data && <span className="ml-auto text-xs text-slate-500">{students.data.meta.total} applications</span>}
      </div>
      {students.isPending ? <LoadingRows rows={6} /> : students.error ? <ErrorState error={students.error} /> : students.data.items.length === 0 ? (
        <EmptyState icon={Users} title="No students match" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Student</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Company / role</th><th className="px-3 py-2">Month</th><th className="px-3 py-2">Internal</th><th className="px-3 py-2">With company</th><th className="px-3 py-2">Guidance</th><th className="px-4 py-2">RSA</th></tr>
            </thead>
            <tbody>
              {students.data.items.map((row) => (
                <tr key={row.applicationId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2">
                    <Link to={`/candidates/${row.candidateId}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.fullName}</Link>
                    <p className="text-xs text-slate-400">{row.mobile ?? row.candidateCode}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{CATEGORY_LABELS[row.category] ?? row.category}{row.productName && <p className="text-slate-400">{row.productName}</p>}</td>
                  <td className="px-3 py-2 text-xs"><Link to={`/companies/${row.companyId}`} className="font-medium text-slate-700 hover:text-indigo-700">{row.companyName}</Link><p className="text-slate-500">{row.roleTitle}</p></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{monthLabel(row.month)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.rejectedAt ? <span className="text-rose-600">Rejected at {row.rejectedAt}{row.rejectionReason && <span className="block text-slate-500">{row.rejectionReason}</span>}</span>
                      : row.finalShortlisted ? <span className="text-emerald-700">SP</span>
                        : row.screeningNoShow ? <span className="text-violet-700">SC no-show</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2"><CompanyStatusCell shareStatus={row.shareStatus} pipelineStatus={row.pipelineStatus} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.guidance ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{row.rsa ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {students.data && students.data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Page {page} of {students.data.meta.totalPages}
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= students.data.meta.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </Card>
  );
}

export function InsightsPage() {
  const { can } = usePermissions();
  const [filters, setFilters] = useState<InsightFilters>({});
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [tab, setTab] = useState("companies");
  const overview = useQuery({ queryKey: ["insights", "overview", filters], queryFn: () => insightsApi.overview(filters), placeholderData: keepPreviousData });
  const set = (patch: Partial<InsightFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stakeholder view"
        title="Placement insights"
        description="Internal screening and company outcomes by company, month and student. A drive counts in the month its job was requested."
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-xs text-slate-500">From<Input type="month" value={filters.from ?? ""} onChange={(event) => set({ from: event.target.value || undefined })} className="h-9 w-40" /></label>
        <label className="grid gap-1 text-xs text-slate-500">To<Input type="month" value={filters.to ?? ""} onChange={(event) => set({ to: event.target.value || undefined })} className="h-9 w-40" /></label>
        <label className="grid gap-1 text-xs text-slate-500">Category
          <Select value={filters.category ?? ALL} onValueChange={(value) => set({ category: value === ALL ? undefined : value as InsightCategory })}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              <SelectItem value="ACADEMY">Academy</SelectItem>
              <SelectItem value="ACADEMY_INTENSIVE">Academy Intensive</SelectItem>
              <SelectItem value="EXTERNAL">External</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {companyName && <Button size="sm" variant="outline" onClick={() => { set({ companyId: undefined }); setCompanyName(null); }}>{companyName} <X size={13} /></Button>}
        {Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setCompanyName(null); }}>Reset</Button>}
      </Card>

      <BigPicture from={filters.from} to={filters.to} />

      {overview.isPending ? <Card><LoadingRows rows={6} /></Card> : overview.error ? <Card><ErrorState error={overview.error} onRetry={() => void overview.refetch()} /></Card> : (() => {
        const data = overview.data;
        const t = data.totals;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Applications" value={t.applications} hint={`${t.students} students · ${t.academyApplications} Academy`} icon={Users} />
              <KpiCard label="Academy rejected internally" value={t.academyInternalRejected} hint={`${pct(t.academyInternalRejected, t.academyApplications)} of Academy · ${t.internalRejected} all categories`} icon={UserMinus} tone="rose" />
              <KpiCard label="Final shortlist (SP)" value={t.finalShortlisted} hint={`${t.shared} shared · ${t.notShared} not shared`} icon={ListChecks} tone="sky" />
              <KpiCard label="Selects" value={t.selected} hint={`${t.offers} offers · ${t.joined} joined · ${pct(t.selected, t.shared)} of shared`} icon={Award} tone="emerald" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Rejected at RS / SC / AS" value={`${t.rejectedAt.RS} / ${t.rejectedAt.SC} / ${t.rejectedAt.AS}`} hint={`${t.screeningNoShow} SC no-shows`} icon={UserMinus} tone="slate" />
              <KpiCard label="Not shared after SP" value={t.notShared} hint="Shortlisted, but the job is still at “Yet to share CVs” or the imported company sheet does not list them" icon={UserX} tone="amber" />
              <KpiCard label="Shared with company" value={t.shared} hint={`${t.inProcess} in process · ${t.companyRejected} rejected`} icon={Send} tone="sky" />
              <KpiCard label="Drives with screening skipped" value={data.screeningSkipped.total} hint={data.screeningSkipped.byReason[0] ? `Most often: ${data.screeningSkipped.byReason[0].reason === "UNSPECIFIED" ? "no reason chosen" : SCREENING_SKIP_REASON_LABELS[data.screeningSkipped.byReason[0].reason]}` : "Every drive was screened"} icon={GraduationCap} tone="slate" />
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
                <TabsTrigger value="companies">By company</TabsTrigger>
                <TabsTrigger value="months">By month</TabsTrigger>
                <TabsTrigger value="categories">By category</TabsTrigger>
                {can("candidate:read") && <TabsTrigger value="students">Students</TabsTrigger>}
                <TabsTrigger value="skipped">Screening skipped ({data.screeningSkipped.total})</TabsTrigger>
                <TabsTrigger value="reasons">Rejection reasons</TabsTrigger>
              </TabsList>
              <TabsContent value="companies">
                <Card className="overflow-hidden">
                  <MetricsTable rows={data.byCompany} rowKey={(row) => row.companyId} lead={[
                    {
                      label: "Company",
                      render: (row) => (
                        <button type="button" className="text-left font-medium text-slate-800 hover:text-indigo-700" title="Show this company only"
                          onClick={() => { set({ companyId: row.companyId }); setCompanyName(row.companyName); }}>
                          {row.companyName}
                        </button>
                      ),
                    },
                    { label: "Jobs", render: (row) => row.jobs },
                  ]} />
                </Card>
              </TabsContent>
              <TabsContent value="months">
                <Card className="overflow-hidden">
                  <MetricsTable rows={data.byMonth} rowKey={(row) => row.month} lead={[
                    { label: "Month", render: (row) => <span className="font-medium text-slate-800">{monthLabel(row.month)}</span> },
                    { label: "Companies / jobs", render: (row) => `${row.companies} / ${row.jobs}` },
                  ]} />
                </Card>
              </TabsContent>
              <TabsContent value="categories">
                <Card className="overflow-hidden">
                  <MetricsTable rows={data.byCategory} rowKey={(row) => row.category} lead={[{ label: "Category", render: (row) => <span className="font-medium text-slate-800">{CATEGORY_LABELS[row.category] ?? row.category}</span> }]} />
                </Card>
              </TabsContent>
              {can("candidate:read") && (
                <TabsContent value="students">
                  <StudentsTable filters={filters} companyName={companyName} onClearCompany={() => { set({ companyId: undefined }); setCompanyName(null); }} />
                </TabsContent>
              )}
              <TabsContent value="skipped">
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
                    {data.screeningSkipped.byReason.map((row) => (
                      <span key={row.reason} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs text-violet-700">
                        {row.reason === "UNSPECIFIED" ? "No reason chosen" : SCREENING_SKIP_REASON_LABELS[row.reason]} · {row.count}
                      </span>
                    ))}
                  </div>
                  {data.screeningSkipped.jobs.length === 0 ? <EmptyState title="Screening was conducted for every drive" /> : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50/60 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Company / role</th><th className="px-3 py-2">Month</th><th className="px-3 py-2">PSM</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2 text-right">SP</th></tr></thead>
                      <tbody>
                        {data.screeningSkipped.jobs.map((row) => (
                          <tr key={row.jobRequestId} className="border-t border-slate-100 align-top">
                            <td className="px-4 py-2"><Link to={`/job-requests/${row.jobRequestId}?tab=screening`} className="font-medium text-slate-800 hover:text-indigo-700">{row.companyName}</Link><p className="text-xs text-slate-500">{row.roleTitle}</p></td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{monthLabel(row.month)}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.ownerName ?? "—"}</td>
                            <td className="px-3 py-2 text-xs"><span className="font-medium text-violet-700">{row.reason ? SCREENING_SKIP_REASON_LABELS[row.reason] : "No reason chosen"}</span>{row.note && <p className="text-slate-500">{row.note}</p>}</td>
                            <td className="px-3 py-2 text-right">{row.finalShortlisted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </TabsContent>
              <TabsContent value="reasons">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-semibold text-slate-800">Top internal rejection reasons</p></div>
                    {data.rejectionReasons.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">No rejection reasons were recorded in the sheets.</p> : (
                      <ul className="divide-y divide-slate-100">
                        {data.rejectionReasons.map((row) => (
                          <li key={`${row.stage}-${row.reason}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                            <span><span className="mr-2 text-xs font-bold text-indigo-600">{STAGE_LABELS[row.stage as InternalStage]?.code ?? row.stage}</span>{row.reason}</span>
                            <span className="text-slate-600">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card className="overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-semibold text-slate-800">Active jobs by company status</p></div>
                    {data.activeJobsByPhase.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">No active jobs.</p> : (
                      <ul className="divide-y divide-slate-100">
                        {data.activeJobsByPhase.map((row) => (
                          <li key={row.phase} className="flex items-center justify-between px-4 py-2 text-sm"><span>{companyProcessLabel(row.phase)}</span><span className="text-slate-600">{row.count}</span></li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        );
      })()}
    </div>
  );
}
