import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Building2,
  Clock3,
  Target,
  Users,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../contexts/auth-context";
import { FilterBar } from "../components/filter-bar";
import { LiveFunnel } from "../components/live-funnel";
import { PlacementKpiPanel } from "../components/placement-kpi-panel";
import { useDashboardFilters } from "../hooks/use-dashboard-filters";
import { ProcessBadge } from "../features/tracking/tracking-dialogs";
import { dashboardApi } from "../services/api";

const numberFormat = new Intl.NumberFormat("en-IN");

const pageDetails: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Companies", subtitle: "Choose a company to review its job applicants and Google Sheets analytics." },
  "/assessed-pool": { title: "Assessed candidate pool", subtitle: "Candidates from the assessed pools synced from Google Sheets." },
  "/sheets": { title: "Spreadsheet connections", subtitle: "Set up the source sheets that will keep your placement data in sync." },
  "/my-work": { title: "My work dashboard", subtitle: "Your owned companies, candidate actions and upcoming placement priorities." },
};

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Building2;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-3 text-[28px] font-semibold tracking-tight text-slate-900">{value}</p>
          </div>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}><Icon size={19} /></span>
        </div>
        <p className="mt-2 text-xs text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function CompanyTable({ onSelect }: { onSelect: (companyId: string) => void }) {
  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: () => dashboardApi.getSummary() });
  const companies = summary.data?.companies ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Companies and job requests</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Applicants from imported Google Sheets</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3 font-semibold">Company</th>
                <th className="px-3 py-3 font-semibold">Job requests</th>
                <th className="px-3 py-3 font-semibold">Applicants</th>
                <th className="px-3 py-3 font-semibold">Open positions</th>
                <th className="px-5 py-3 text-right font-semibold">Hiring status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => {
                const applicants = company.jobRequests.reduce((total, job) => total + job.applications, 0);
                const openPositions = company.jobRequests.reduce((total, job) => total + (job.status === "OPEN" ? job.openings : 0), 0);
                return (
                  <tr key={company.id} className="cursor-pointer hover:bg-slate-50/80" onClick={() => onSelect(company.id)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-sm font-bold text-indigo-700">{company.name.slice(0, 1).toUpperCase()}</span>
                        <div><p className="text-sm font-semibold text-slate-800">{company.name}</p><p className="mt-0.5 text-xs text-slate-400">{company.jobRequests.map((job) => job.roleTitle).join(" · ")}</p></div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-sm text-slate-600">{company.jobRequests.length}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-600">{numberFormat.format(applicants)}</td>
                    <td className="px-3 py-3.5 text-sm text-slate-600">{numberFormat.format(openPositions)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {company.jobRequests.map((job) => (
                          <span key={job.id} className="flex items-center gap-1.5" title={job.roleTitle}>
                            {company.jobRequests.length > 1 && <span className="max-w-[140px] truncate text-[10px] text-slate-400">{job.roleTitle}</span>}
                            <ProcessBadge phase={job.processPhase} label={job.processLabel} />
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {summary.isPending && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">Loading company analytics…</td></tr>}
              {summary.isError && <tr><td colSpan={5} role="alert" className="px-5 py-8 text-center text-sm text-rose-600">Could not load company analytics.</td></tr>}
              {!summary.isPending && !summary.isError && companies.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">No companies are available in your workspace yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Overview({ onSelectCompany, showKpis }: { onSelectCompany: (companyId: string) => void; showKpis: boolean }) {
  return (
    <div className="space-y-8">
      {showKpis && <PlacementKpiPanel />}
      <CompanyTable onSelect={onSelectCompany} />
    </div>
  );
}

function WorkDashboard({ manager: isManager, employee }: { manager: boolean; employee: boolean }) {
  const { filters } = useDashboardFilters();
  const summary = useQuery({ queryKey: ["dashboard", "summary", filters], queryFn: () => dashboardApi.getSummary(filters) });
  const owned = summary.data?.companies ?? [];
  const workspaceRole = isManager ? "Manager" : employee ? "Employee" : "Stakeholder";
  const toneClasses = [
    "bg-indigo-100 text-indigo-700",
    "bg-sky-100 text-sky-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700",
    "bg-rose-100 text-rose-700",
  ];
  return (
    <div className="space-y-5">
      <LiveFunnel />
      {summary.isError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Could not load your live workspace: {summary.error instanceof Error ? summary.error.message : "Unknown error"}</div>}
      <div className="rounded-2xl bg-indigo-700 p-5 text-white sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">{workspaceRole} workspace{summary.data?.teamName ? ` · ${summary.data.teamName}` : ""}</p>
        <h2 className="mt-2 text-xl font-semibold">{isManager ? "Your team’s placement work" : "Your assigned company pipelines"}</h2>
        <p className="mt-1 text-sm text-indigo-200">Live counts for the job requests you own{isManager ? " or your team owns" : ""}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Assigned companies" value={numberFormat.format(summary.data?.totalCompanies ?? 0)} detail="Based on current ownership" icon={Building2} accent="bg-indigo-50 text-indigo-600" />
        <MetricCard label="Open job requests" value={numberFormat.format(summary.data?.activeJobRequests ?? 0)} detail="In your team’s scope" icon={BriefcaseBusiness} accent="bg-sky-50 text-sky-600" />
        <MetricCard label={isManager ? "Employees in workspace" : "Open positions"} value={numberFormat.format(isManager ? summary.data?.employeeCount ?? 0 : summary.data?.openPositions ?? 0)} detail={isManager ? "Active employees" : "Across your open requests"} icon={isManager ? Users : Clock3} accent="bg-amber-50 text-amber-600" />
      </div>
      <Card><CardContent className="p-5">
        <CardHeader className="mb-4"><div><CardTitle>Assigned companies</CardTitle><p className="mt-1 text-xs text-slate-400">Live companies and open roles from your scope</p></div></CardHeader>
        {summary.isPending ? <div className="h-24 animate-pulse rounded-xl bg-slate-50" /> : owned.length === 0
          ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No companies have been assigned to {isManager ? "your workspace" : "you"} yet.</p>
          : <div className="divide-y divide-slate-100">{owned.map((company, index) => {
            const openRoles = company.jobRequests.filter((job) => job.status === "OPEN").length;
            const openPositions = company.jobRequests.filter((job) => job.status === "OPEN").reduce((total, job) => total + job.openings, 0);
            return <div key={company.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${toneClasses[index % toneClasses.length]}`}>{company.name.slice(0, 1).toUpperCase()}</span><div><p className="text-sm font-semibold text-slate-800">{company.name}</p><p className="mt-1 text-xs text-slate-400">{company.jobRequests.length} job requests · {openPositions} open positions</p></div></div>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">{openRoles} open roles</span>
            </div>;
          })}</div>}
      </CardContent></Card>
    </div>
  );
}

export function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = user?.roles.includes("MANAGER") ?? false;
  const isEmployee = user?.roles.includes("EMPLOYEE") ?? false;
  const isWorkView = location.pathname === "/my-work";
  const page = pageDetails[location.pathname] ?? {
      title: "Placement overview",
      subtitle: "A clear view of placement outcomes, company pipelines and team activity.",
    };

  const openCompany = (companyId: string) => navigate(`/companies/${companyId}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">{isWorkView ? (isManager ? "Workspace operations" : "My work") : "Placement operations"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">{page.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{page.subtitle}</p>
        </div>
      </div>

      {location.pathname === "/my-work" && <FilterBar />}
      {location.pathname === "/" && <Overview onSelectCompany={openCompany} showKpis />}
      {location.pathname === "/my-work" && <WorkDashboard manager={isManager} employee={isEmployee} />}
      <p className="border-t border-slate-200 pt-4 text-[11px] text-slate-400">
        Company analytics come from imported Google Sheets. Stage decisions remain in Google Sheets.</p>
    </div>
  );
}
