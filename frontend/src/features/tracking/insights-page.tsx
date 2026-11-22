import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { companyProcessLabel, DIRECT_SHARE_REASON_LABELS, PIPELINE_STATUS_LABELS, SCREENING_SKIP_REASON_LABELS, STAGE_LABELS, type InternalStage } from "@placement/shared";
import { format } from "date-fns";
import { Award, Download, GraduationCap, ListChecks, Send, UserMinus, Users, UserX, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
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
import type { CompanyRejectStage, InsightCategory, InsightDateBasis, InsightFilters, InsightMetrics, Insights, StudentInsight, StudentStatusFilter } from "../../types/tracking";
import { downloadCsv, type CsvValue } from "../../utils/csv";
import { BigPicture } from "./big-picture";
import { CompanyStatusCell } from "./tracking-dialogs";
import { ProductBadge } from "../../components/student-tags";

const ALL = "__all__";
const CATEGORY_LABELS: Record<string, string> = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Academy Intensive", EXTERNAL: "External", UNKNOWN: "Unknown" };
const STATUS_LABELS: Record<StudentStatusFilter, string> = {
  INTERNAL_REJECTED: "Rejected in our shortlisting",
  FINAL_SHORTLIST: "Made our final shortlist",
  NOT_SHARED: "Not shared with company",
  SHARED: "Shared with company",
  DIRECT: "Direct to company (skipped shortlisting)",
  IN_PROCESS: "In company process",
  COMPANY_REJECTED: "Rejected by company",
  SELECTED: "Selected by company",
  JOINED: "Joined",
};
const monthLabel = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yyyy");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** `when`: shown only if some row has a value (company rounds differ by job). */
type Column = { key: string; label: string; title?: string; render: (row: InsightMetrics) => ReactNode; when?: (row: InsightMetrics) => number };
const n = (value: number, tone?: string) => <span className={value === 0 ? "text-slate-300" : tone}>{value}</span>;
const COMPANY_REJECT_STAGES: [CompanyRejectStage, string, string][] = [
  ["CV", "Company CV screen rejected", "Rejected at the company's CV / resume screen"],
  ["ASSESSMENT", "Company assessment rejected", "Rejected at the company's assessment / assignment"],
  ["TR1", "Technical round 1 rejected", "Rejected in the first technical round"],
  ["TR2", "Technical round 2 rejected", "Rejected in the second technical round"],
  ["TR3", "Technical round 3+ rejected", "Rejected in the third or a later technical round"],
  ["MR", "Managerial round rejected", "Rejected in the managerial round"],
  ["CLIENT", "Client round rejected", "Rejected in the client round"],
  ["HR", "HR round rejected", "Rejected in the HR round"],
  ["OTHER", "Other round rejected", "Rejected in a round of type Other"],
  ["UNKNOWN", "Company rejected (round not recorded)", "Rejected in the company's final status, with no round result recorded"],
];

const METRIC_COLUMNS: Column[] = [
  { key: "ta", label: "Applied", title: "Applications", render: (row) => n(row.applications) },
  { key: "academy", label: "Academy applied", render: (row) => n(row.academyApplications) },
  { key: "rej", label: "Rejected by us", title: "Rejected at resume shortlist, screening or assignment", render: (row) => <>{n(row.internalRejected, "text-rose-600")} <span className="text-[11px] text-slate-400">{pct(row.internalRejected, row.applications)}</span></> },
  { key: "arej", label: "Academy int. rejected", render: (row) => <>{n(row.academyInternalRejected, "font-semibold text-rose-700")} <span className="text-[11px] text-slate-400">{pct(row.academyInternalRejected, row.academyApplications)}</span></> },
  { key: "rs", label: "Resume rejected", render: (row) => n(row.rejectedAt.RS) },
  { key: "sc", label: "Screening rejected", render: (row) => n(row.rejectedAt.SC) },
  { key: "as", label: "Assignment rejected", render: (row) => n(row.rejectedAt.AS) },
  { key: "ns", label: "Missed screening", render: (row) => n(row.screeningNoShow) },
  { key: "sp", label: "Final shortlist", render: (row) => n(row.finalShortlisted) },
  { key: "shared", label: "Shared", render: (row) => n(row.shared) },
  { key: "direct", label: "Direct", title: "Reached the company without our final shortlist", render: (row) => n(row.direct, "text-sky-700") },
  { key: "notshared", label: "Not shared", render: (row) => n(row.notShared, "font-semibold text-amber-700") },
  { key: "inproc", label: "In process", render: (row) => n(row.inProcess) },
  { key: "corej", label: "Co. rejected", title: "Rejected by the company, all rounds", render: (row) => <>{n(row.companyRejected, "text-rose-600")} <span className="text-[11px] text-slate-400">{pct(row.companyRejected, row.shared)}</span></> },
  ...COMPANY_REJECT_STAGES.map(([stage, label, title]): Column => ({
    key: `corej-${stage}`, label, title, when: (row) => row.companyRejectedAt[stage], render: (row) => n(row.companyRejectedAt[stage], "text-rose-500"),
  })),
  { key: "sel", label: "Selects", render: (row) => n(row.selected, "font-semibold text-emerald-700") },
  { key: "off", label: "Offers", render: (row) => n(row.offers) },
  { key: "join", label: "Joined", render: (row) => n(row.joined, "font-semibold text-emerald-700") },
];

const METRIC_CSV: [string, (row: InsightMetrics) => CsvValue][] = [
  ["Applied", (row) => row.applications],
  ["Academy applied", (row) => row.academyApplications],
  ["Internally rejected", (row) => row.internalRejected],
  ["Internally rejected %", (row) => pct(row.internalRejected, row.applications)],
  ["Academy internally rejected", (row) => row.academyInternalRejected],
  ["Academy internally rejected %", (row) => pct(row.academyInternalRejected, row.academyApplications)],
  ["Resume shortlist rejected", (row) => row.rejectedAt.RS],
  ["Screening rejected", (row) => row.rejectedAt.SC],
  ["Assignment rejected", (row) => row.rejectedAt.AS],
  ["Missed screening", (row) => row.screeningNoShow],
  ["Final shortlist", (row) => row.finalShortlisted],
  ["Shared", (row) => row.shared],
  ["Not shared", (row) => row.notShared],
  ["Direct to company (no final shortlist)", (row) => row.direct],
  ["In process", (row) => row.inProcess],
  ["Company rejected", (row) => row.companyRejected],
  ...COMPANY_REJECT_STAGES.map(([stage, label]): [string, (row: InsightMetrics) => CsvValue] => [label, (row) => row.companyRejectedAt[stage]]),
  ["Selects", (row) => row.selected],
  ["Offers", (row) => row.offers],
  ["Joined", (row) => row.joined],
];

function metricsCsv<T extends InsightMetrics>(filename: string, lead: [string, (row: T) => CsvValue][], rows: T[]) {
  downloadCsv(filename, [...lead.map(([label]) => label), ...METRIC_CSV.map(([label]) => label)],
    rows.map((row) => [...lead.map(([, value]) => value(row)), ...METRIC_CSV.map(([, value]) => value(row))]));
}

const csvName = (part: string, filters: InsightFilters) => ["insights", part, filters.from, filters.to].filter(Boolean).join("-");
const directLabel = (reason: string | null) => (!reason || reason === "UNTAGGED" ? "Reason not tagged" : DIRECT_SHARE_REASON_LABELS[reason as keyof typeof DIRECT_SHARE_REASON_LABELS] ?? reason);
const skipReasonLabel = (reason: string | null) => (!reason || reason === "UNSPECIFIED" ? "No reason chosen" : SCREENING_SKIP_REASON_LABELS[reason as keyof typeof SCREENING_SKIP_REASON_LABELS] ?? reason);

/** Downloads the open Insights tab as CSV (Students has its own button, since it pages through the server). */
function downloadInsightsTab(tab: string, data: Insights, filters: InsightFilters) {
  if (tab === "companies") metricsCsv(csvName("by-company", filters), [["Company", (row) => row.companyName], ["Jobs", (row) => row.jobs]], data.byCompany);
  else if (tab === "months") metricsCsv(csvName("by-month", filters), [["Month", (row) => row.month], ["Companies", (row) => row.companies], ["Jobs", (row) => row.jobs]], data.byMonth);
  else if (tab === "categories") metricsCsv(csvName("by-category", filters), [["Category", (row) => CATEGORY_LABELS[row.category] ?? row.category]], data.byCategory);
  else if (tab === "skipped") {
    downloadCsv(csvName("screening-skipped", filters), ["Company", "Role", "Month", "PSM", "Reason", "Note", "Final shortlist"],
      data.screeningSkipped.jobs.map((row) => [row.companyName, row.roleTitle, row.month, row.ownerName, skipReasonLabel(row.reason), row.note, row.finalShortlisted]));
  } else if (tab === "reasons") {
    downloadCsv(csvName("funnels-and-reasons", filters), ["Type", "Stage / round / status", "Reason", "Count", "Appeared", "Cleared", "Rejected", "No-show", "Scheduled"], [
      ...data.companyRounds.map((row): CsvValue[] => ["Company funnel", row.label, "", "", row.appeared, row.cleared, row.rejected, row.noShow, row.scheduled]),
      ...data.rejectionReasons.map((row): CsvValue[] => ["Internal rejection reason", STAGE_LABELS[row.stage as InternalStage]?.code ?? row.stage, row.reason, row.count]),
      ...data.companyRejectionReasons.map((row): CsvValue[] => ["Company rejection reason", row.round, row.reason, row.count]),
      ...data.directByReason.map((row): CsvValue[] => ["Direct to company (skipped shortlisting)", "", directLabel(row.reason), row.count]),
      ...data.activeJobsByPhase.map((row): CsvValue[] => ["Active jobs by company status", companyProcessLabel(row.phase), "", row.count]),
    ]);
  }
}

const STEP_WORDS: Record<string, string> = { RS: "resume shortlist", SC: "screening", AS: "assignment" };
const rejectedAtText = (step: string) => `Rejected at ${STEP_WORDS[step] ?? step}`;
const internalResult = (row: StudentInsight) => (row.rejectedAt ? rejectedAtText(row.rejectedAt) : row.finalShortlisted ? "Final shortlist" : row.screeningNoShow ? "Missed screening" : "");
const companyResult = (row: StudentInsight) => row.shareStatus === "NOT_SHARED" ? "Not shared with company"
  : row.shareStatus === "SHARED" ? (!row.pipelineStatus || row.pipelineStatus === "NOT_SUBMITTED" ? "Shared · sheet pending"
    : `${PIPELINE_STATUS_LABELS[row.pipelineStatus]}${row.companyRejectedRound ? ` at ${row.companyRejectedRound}` : ""}`) : "";

/** Company funnel: how shared students fared in each company round, next to the internal one. */
function CompanyFunnel({ rounds, shared, selected }: { rounds: Insights["companyRounds"]; shared: number; selected: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Company funnel</p>
        <p className="text-xs text-slate-500">Shared with company → each company round → selected. Rounds are grouped across jobs (TR1, TR2… by order within a drive).</p>
      </div>
      {rounds.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">No company round results recorded for these filters yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Step</th>
                <th className="px-3 py-2 text-right">Appeared</th><th className="px-3 py-2 text-right">Cleared</th><th className="px-3 py-2 text-right">Rejected</th>
                <th className="px-3 py-2 text-right">No-show</th><th className="px-3 py-2 text-right">Scheduled</th><th className="px-4 py-2 text-right">Clear rate</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 bg-slate-50/40">
                <td className="px-4 py-2 font-medium text-slate-700">Shared with company</td>
                <td className="px-3 py-2 text-right font-semibold" colSpan={6}>{shared}</td>
              </tr>
              {rounds.map((row) => (
                <tr key={row.label} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-700">{row.label}</td>
                  <td className="px-3 py-2 text-right">{n(row.appeared)}</td>
                  <td className="px-3 py-2 text-right">{n(row.cleared, "text-emerald-700")}</td>
                  <td className="px-3 py-2 text-right">{n(row.rejected, "text-rose-600")}</td>
                  <td className="px-3 py-2 text-right">{n(row.noShow, "text-violet-700")}</td>
                  <td className="px-3 py-2 text-right">{n(row.scheduled, "text-slate-500")}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{pct(row.cleared, row.appeared)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-100 bg-emerald-50/40">
                <td className="px-4 py-2 font-medium text-slate-700">Selected by company</td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700" colSpan={5}>{selected}</td>
                <td className="px-4 py-2 text-right text-slate-600">{pct(selected, shared)} of shared</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MetricsTable<T extends InsightMetrics>({ rows, lead, rowKey }: { rows: T[]; lead: { label: string; render: (row: T) => ReactNode }[]; rowKey: (row: T) => string }) {
  if (rows.length === 0) return <EmptyState title="No data for these filters" />;
  const columns = METRIC_COLUMNS.filter((column) => !column.when || rows.some((row) => column.when!(row) > 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
          <tr>
            {lead.map((column) => <th key={column.label} className="whitespace-nowrap px-4 py-2">{column.label}</th>)}
            {columns.map((column) => <th key={column.key} title={column.title} className="whitespace-nowrap px-3 py-2 text-right">{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-slate-100">
              {lead.map((column) => <td key={column.label} className="whitespace-nowrap px-4 py-2">{column.render(row)}</td>)}
              {columns.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-right">{column.render(row)}</td>)}
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
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      const items: StudentInsight[] = [];
      for (let next = 1, pages = 1; next <= pages; next += 1) {
        const result = await insightsApi.students({ ...filters, status, q: q || undefined, page: next, pageSize: 100 });
        items.push(...result.items);
        pages = result.meta.totalPages;
      }
      downloadCsv(csvName(status ? `students-${status.toLowerCase()}` : "students", filters),
        ["Student", "Mobile", "Candidate code", "Category", "Product", "Company", "Role", "Month", "Internal", "Rejection reason", "Direct to company", "With company", "Guidance", "RSA"],
        items.map((row) => [row.fullName, row.mobile, row.candidateCode, CATEGORY_LABELS[row.category] ?? row.category, row.category === "ACADEMY" ? "" : row.productName,
          row.companyName, row.roleTitle, row.month, internalResult(row), row.rejectionReason, row.directShare ? directLabel(row.directShare.reason) : "", companyResult(row), row.guidance, row.rsa]));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the students.");
    } finally {
      setDownloading(false);
    }
  };
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
        <Button size="sm" variant="outline" disabled={downloading || !students.data?.meta.total} onClick={() => void download()}><Download size={13} /> {downloading ? "Preparing…" : "Download CSV"}</Button>
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
                    <div className="mt-0.5"><ProductBadge products={row.productName} /></div>
                    <p className="text-xs text-slate-400">{row.mobile ?? row.candidateCode}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{CATEGORY_LABELS[row.category] ?? row.category}{row.productName && row.category !== "ACADEMY" && <p className="text-slate-400">{row.productName}</p>}</td>
                  <td className="px-3 py-2 text-xs"><Link to={`/companies/${row.companyId}`} className="font-medium text-slate-700 hover:text-indigo-700">{row.companyName}</Link><p className="text-slate-500">{row.roleTitle}</p></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{monthLabel(row.month)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.rejectedAt ? <span className="text-rose-600">{rejectedAtText(row.rejectedAt)}{row.rejectionReason && <span className="block text-slate-500">{row.rejectionReason}</span>}</span>
                      : row.finalShortlisted ? <span className="text-emerald-700">Final shortlist</span>
                        : row.screeningNoShow ? <span className="text-violet-700">Missed screening</span> : !row.directShare && <span className="text-slate-300">—</span>}
                    {row.directShare && (
                      <span className={`block ${row.directShare.reason ? "text-sky-700" : "text-amber-700"}`} title="Reached the company without the internal shortlist">
                        Direct to company<span className="block text-slate-500">{directLabel(row.directShare.reason)}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <CompanyStatusCell shareStatus={row.shareStatus} pipelineStatus={row.pipelineStatus} />
                    {row.companyRejectedRound && <p className="mt-0.5 text-[11px] text-rose-600">at {row.companyRejectedRound}</p>}
                  </td>
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
  const [moreNumbers, setMoreNumbers] = useState(false);
  const overview = useQuery({ queryKey: ["insights", "overview", filters], queryFn: () => insightsApi.overview(filters), placeholderData: keepPreviousData });
  const set = (patch: Partial<InsightFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const [jobIdsText, setJobIdsText] = useState("");
  const jobIds = useDebouncedValue(jobIdsText.trim(), 400);
  useEffect(() => { setFilters((current) => ({ ...current, jobIds: jobIds || undefined })); }, [jobIds]);
  const jobIdCount = jobIdsText.split(/[\s,;]+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stakeholder view"
        title="Placement insights"
        description={filters.dateBy === "processEnd"
          ? "How students moved through our shortlisting and the companies' rounds, by company, month and student. Showing drives whose company process has ended, in the month it ended."
          : "How students moved through our shortlisting and the companies' rounds, by company, month and student. A drive counts in the month its job was requested."}
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-xs text-slate-500">Date
          <Select value={filters.dateBy ?? "requested"} onValueChange={(value) => set({ dateBy: value === "requested" ? undefined : value as InsightDateBasis })}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="requested">Job requested</SelectItem>
              <SelectItem value="processEnd">Process ended</SelectItem>
            </SelectContent>
          </Select>
        </label>
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
        <label className="grid min-w-64 flex-1 gap-1 text-xs text-slate-500">
          <span>Job IDs {jobIdCount > 1 && <span className="text-slate-400">· {jobIdCount} IDs</span>}</span>
          <Input value={jobIdsText} onChange={(event) => setJobIdsText(event.target.value)} placeholder="One or more Job IDs, separated by commas or spaces" className="h-9 font-mono text-xs" />
        </label>
        {companyName && <Button size="sm" variant="outline" onClick={() => { set({ companyId: undefined }); setCompanyName(null); }}>{companyName} <X size={13} /></Button>}
        {(Object.values(filters).some(Boolean) || jobIdsText) && <Button size="sm" variant="ghost" onClick={() => { setFilters({}); setJobIdsText(""); setCompanyName(null); }}>Reset</Button>}
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
              <KpiCard label="Made our final shortlist" value={t.finalShortlisted} hint={`${t.shared} shared · ${t.notShared} not shared`} icon={ListChecks} tone="sky" />
              <KpiCard label="Selected by companies" value={t.selected} hint={`${t.offers} offers · ${t.joined} joined · ${pct(t.selected, t.shared)} of shared`} icon={Award} tone="emerald" />
            </div>
            <div className="-mt-3 flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => setMoreNumbers(!moreNumbers)}>{moreNumbers ? "Hide extra numbers" : "Show more numbers"}</Button>
            </div>
            {moreNumbers && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Rejected by us: resume / screening / assignment" value={`${t.rejectedAt.RS} / ${t.rejectedAt.SC} / ${t.rejectedAt.AS}`} hint={`${t.screeningNoShow} missed screening`} icon={UserMinus} tone="slate" />
              <KpiCard label="Shortlisted but not shared" value={t.notShared} hint="Shortlisted, but the job is still at “Yet to share CVs” or the imported company sheet does not list them" icon={UserX} tone="amber" />
              <KpiCard label="Shared with company" value={t.shared} hint={`${t.inProcess} in process · ${t.companyRejected} rejected · ${t.direct} sent direct (skipped our shortlist)`} icon={Send} tone="sky" />
              <KpiCard label="Drives with screening skipped" value={data.screeningSkipped.total} hint={data.screeningSkipped.byReason[0] ? `Most often: ${data.screeningSkipped.byReason[0].reason === "UNSPECIFIED" ? "no reason chosen" : SCREENING_SKIP_REASON_LABELS[data.screeningSkipped.byReason[0].reason]}` : "Every drive was screened"} icon={GraduationCap} tone="slate" />
            </div>}

            <Tabs value={tab} onValueChange={setTab}>
              <div className="flex flex-wrap items-start gap-2">
              <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
                <TabsTrigger value="companies">By company</TabsTrigger>
                <TabsTrigger value="months">By month</TabsTrigger>
                <TabsTrigger value="categories">By category</TabsTrigger>
                {can("candidate:read") && <TabsTrigger value="students">Students</TabsTrigger>}
                <TabsTrigger value="skipped">Screening skipped ({data.screeningSkipped.total})</TabsTrigger>
                <TabsTrigger value="reasons">Rounds &amp; rejection reasons</TabsTrigger>
              </TabsList>
              {tab !== "students" && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => downloadInsightsTab(tab, data, filters)}><Download size={13} /> Download CSV</Button>
              )}
              </div>
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
              <TabsContent value="reasons" className="space-y-4">
                <CompanyFunnel rounds={data.companyRounds} shared={t.shared} selected={t.selected} />
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
                    <div className="border-b border-slate-100 px-4 py-3"><p className="text-sm font-semibold text-slate-800">Top company rejection reasons</p></div>
                    {data.companyRejectionReasons.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">No company rejection reasons recorded yet. Add them in a round result, or map the optional reason column when importing the company sheet.</p> : (
                      <ul className="divide-y divide-slate-100">
                        {data.companyRejectionReasons.map((row) => (
                          <li key={`${row.round}-${row.reason}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                            <span><span className="mr-2 text-xs font-bold text-sky-700">{row.round}</span>{row.reason}</span>
                            <span className="text-slate-600">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card className="overflow-hidden">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">Direct to company · why shortlisting was skipped</p>
                      <p className="text-xs text-slate-500">Profiles with the company that were not on our final shortlist, e.g. added straight to the company sheet.</p>
                    </div>
                    {data.directByReason.length === 0 ? <p className="px-4 py-4 text-xs text-slate-400">Every profile with the company came through the internal shortlist.</p> : (
                      <ul className="divide-y divide-slate-100">
                        {data.directByReason.map((row) => (
                          <li key={row.reason} className="flex items-center justify-between px-4 py-2 text-sm">
                            <span className={row.reason === "UNTAGGED" ? "text-amber-700" : undefined}>{directLabel(row.reason)}</span><span className="text-slate-600">{row.count}</span>
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
