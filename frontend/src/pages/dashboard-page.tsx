import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  FileSpreadsheet,
  Link2,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../contexts/auth-context";
import { dashboardApi } from "../services/api";

const numberFormat = new Intl.NumberFormat("en-IN");

const companies = [
  { name: "Northstar Labs", initials: "N", tone: "bg-indigo-100 text-indigo-700", product: "Software Engineering", roles: 3, applied: 42, shortlisted: 16, interviews: 11, offers: 4, placed: 3, rejected: 18, owner: "Ananya Rao", sync: "4 min ago" },
  { name: "Vertex Systems", initials: "V", tone: "bg-sky-100 text-sky-700", product: "Data & AI", roles: 2, applied: 36, shortlisted: 12, interviews: 8, offers: 3, placed: 2, rejected: 17, owner: "Rahul Mehta", sync: "12 min ago" },
  { name: "Mosaic Finance", initials: "M", tone: "bg-amber-100 text-amber-700", product: "Product & Design", roles: 2, applied: 28, shortlisted: 9, interviews: 6, offers: 2, placed: 2, rejected: 12, owner: "Ananya Rao", sync: "18 min ago" },
  { name: "Cloudline", initials: "C", tone: "bg-emerald-100 text-emerald-700", product: "Software Engineering", roles: 1, applied: 24, shortlisted: 7, interviews: 5, offers: 1, placed: 1, rejected: 13, owner: "Dev Shah", sync: "31 min ago" },
  { name: "Orbit Health", initials: "O", tone: "bg-rose-100 text-rose-700", product: "Data & AI", roles: 2, applied: 31, shortlisted: 10, interviews: 7, offers: 1, placed: 1, rejected: 16, owner: "Rahul Mehta", sync: "1 hr ago" },
];

const assessedCandidates = [
  { name: "Aarav Sharma", initials: "AS", role: "Full-stack engineer", skills: "React · Node.js · SQL", score: 88, stage: "Company interview", company: "Northstar Labs", activity: "Interview tomorrow", priority: "High" },
  { name: "Meera Iyer", initials: "MI", role: "Data analyst", skills: "Python · SQL · Tableau", score: 82, stage: "Resume shortlisted", company: "Vertex Systems", activity: "Needs mock interview", priority: "High" },
  { name: "Ishaan Kapoor", initials: "IK", role: "Product designer", skills: "Figma · Research · UX", score: 76, stage: "Assessment complete", company: "Mosaic Finance", activity: "No activity for 6 days", priority: "Follow up" },
  { name: "Diya Nair", initials: "DN", role: "Backend engineer", skills: "Java · Spring · AWS", score: 91, stage: "Final round", company: "Cloudline", activity: "Round feedback pending", priority: "High" },
  { name: "Kabir Patel", initials: "KP", role: "ML engineer", skills: "Python · PyTorch · NLP", score: 73, stage: "Ready for matching", company: "—", activity: "Review target companies", priority: "Follow up" },
];

const pipeline = [
  { label: "Applications", count: 486, percent: 100, color: "bg-indigo-500" },
  { label: "Resume shortlisted", count: 164, percent: 76, color: "bg-violet-500" },
  { label: "Screened", count: 110, percent: 58, color: "bg-sky-500" },
  { label: "Interviewing", count: 68, percent: 42, color: "bg-teal-500" },
  { label: "Selected", count: 42, percent: 27, color: "bg-emerald-500" },
];

const pageDetails: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Placement overview", subtitle: "A clear view of placement outcomes, company pipelines and team activity." },
  "/companies": { title: "Company pipeline", subtitle: "Track applications, interview stages and outcomes across every employer." },
  "/assessed-pool": { title: "Assessed candidate pool", subtitle: "Keep assessed candidates moving with focused, timely PSM follow-up." },
  "/sheets": { title: "Spreadsheet connections", subtitle: "Set up the source sheets that will keep your placement data in sync." },
  "/psm-workspace": { title: "My PSM workspace", subtitle: "Your owned companies, candidate actions and upcoming placement priorities." },
};

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Building2;
  accent: string;
  trend?: string;
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
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          {trend && <ArrowUpRight size={14} className="text-emerald-600" />}
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function PreviewLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
      <Sparkles size={12} /> Preview data
    </span>
  );
}

function WorkspaceMetrics() {
  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: dashboardApi.getSummary });
  const metrics = [
    { label: "Companies", value: summary.data?.totalCompanies, icon: Building2, color: "bg-indigo-50 text-indigo-600" },
    { label: "Open job requests", value: summary.data?.activeJobRequests, icon: BriefcaseBusiness, color: "bg-sky-50 text-sky-600" },
    { label: "Open positions", value: summary.data?.openPositions, icon: Target, color: "bg-emerald-50 text-emerald-600" },
    { label: "Active PSMs", value: summary.data?.psmCount, icon: Users, color: "bg-amber-50 text-amber-600" },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Live workspace totals</h2>
          <p className="mt-0.5 text-xs text-slate-400">From the current PlacementOS database</p>
        </div>
        {summary.isError && <span className="text-xs text-rose-600">Could not load live counts</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}><Icon size={17} /></span>
            <div className="min-w-0">
              <p className="text-xl font-semibold text-slate-900">{summary.isPending ? "—" : numberFormat.format(value ?? 0)}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineCard() {
  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <CardHeader className="mb-6">
          <div>
            <CardTitle>Candidate funnel</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Progress by latest recorded stage</p>
          </div>
          <PreviewLabel />
        </CardHeader>
        <div className="space-y-4">
          {pipeline.map((stage) => (
            <div key={stage.label}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{stage.label}</span>
                <span className="font-semibold tabular-nums text-slate-800">{numberFormat.format(stage.count)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${stage.color}`} style={{ width: `${stage.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
          <div><p className="text-xs text-slate-400">Shortlist → selected</p><p className="mt-1 text-lg font-semibold text-slate-800">25.6%</p></div>
          <div><p className="text-xs text-slate-400">Application → selected</p><p className="mt-1 text-lg font-semibold text-slate-800">8.6%</p></div>
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyTable({ onSelect }: { onSelect: (name: string) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Company performance</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Active pipelines and hiring outcomes</p>
          </div>
          <PreviewLabel />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3 font-semibold">Company</th><th className="px-3 py-3 font-semibold">Roles</th>
                <th className="px-3 py-3 font-semibold">Applied</th><th className="px-3 py-3 font-semibold">Shortlisted</th>
                <th className="px-3 py-3 font-semibold">Selected</th><th className="px-5 py-3 text-right font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.slice(0, 4).map((company) => (
                <tr key={company.name} className="cursor-pointer hover:bg-slate-50/80" onClick={() => onSelect(company.name)}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold ${company.tone}`}>{company.initials}</span>
                      <div><p className="text-sm font-semibold text-slate-800">{company.name}</p><p className="mt-0.5 text-xs text-slate-400">{company.product}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-sm text-slate-600">{company.roles}</td>
                  <td className="px-3 py-3.5 text-sm text-slate-600">{company.applied}</td>
                  <td className="px-3 py-3.5 text-sm text-slate-600">{company.shortlisted}</td>
                  <td className="px-3 py-3.5 text-sm font-semibold text-slate-800">{company.placed}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-slate-500">{company.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Overview({ isAdmin, onSelectCompany }: { isAdmin: boolean; onSelectCompany: (name: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-indigo-700 p-5 text-white sm:flex-row sm:items-center sm:p-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-200"><Activity size={15} /><span className="text-xs font-semibold uppercase tracking-wide">{isAdmin ? "Admin overview" : "PSM overview"} · October 2026</span></div>
          <h2 className="mt-2 text-xl font-semibold">Good morning. Here&apos;s your placement pulse.</h2>
          <p className="mt-1 text-sm text-indigo-200">Track outcomes and spot the next action across your placement pipeline.</p>
        </div>
        <Button className="shrink-0 bg-white text-indigo-700 hover:bg-indigo-50"><CalendarDays size={16} /> This month</Button>
      </div>

      <WorkspaceMetrics />

      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-semibold text-slate-800">Placement outcomes</h2><p className="mt-0.5 text-xs text-slate-400">Monthly targets and conversion performance</p></div>
        <PreviewLabel />
      </div>
      <section aria-label="Monthly placement metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Placements" value="42 / 50" detail="8 more to reach monthly target" icon={Target} accent="bg-indigo-50 text-indigo-600" trend="8% vs last month" />
        <MetricCard label="Positions closed" value="18 / 29" detail="62% of open positions filled" icon={Check} accent="bg-emerald-50 text-emerald-600" />
        <MetricCard label="Companies hiring" value="15 / 21" detail="71% of active companies hired" icon={Building2} accent="bg-sky-50 text-sky-600" />
        <MetricCard label="Shortlist → selected" value="38.2%" detail="42 selections from 110 screened" icon={ArrowUpRight} accent="bg-amber-50 text-amber-600" trend="4.3% vs last month" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_1.6fr]">
        <PipelineCard />
        <CompanyTable onSelect={onSelectCompany} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <CardHeader className="mb-4"><div><CardTitle>Assessed pool to action</CardTitle><p className="mt-1 text-xs text-slate-400">Candidates who need a PSM next step</p></div><PreviewLabel /></CardHeader>
            <div className="grid grid-cols-3 gap-3">
              {[["128", "Assessed"], ["34", "Interview-ready"], ["12", "Need follow-up"]].map(([value, label]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{label}</p></div>
              ))}
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-amber-700"><CircleAlert size={14} /> 8 candidates have no recorded activity in 7+ days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <CardHeader className="mb-4"><div><CardTitle>Sheet sync health</CardTitle><p className="mt-1 text-xs text-slate-400">Company and candidate sources</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">Not connected</span></CardHeader>
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-slate-200 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><FileSpreadsheet size={18} /></span>
              <div className="flex-1"><p className="text-sm font-semibold text-slate-700">Connect your Google Sheets</p><p className="mt-1 text-xs leading-5 text-slate-500">Map company and student tabs to stages before enabling automatic sync.</p></div>
              <Link to="/sheets" className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">Set up <ChevronRight className="inline" size={14} /></Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function CompaniesPage({ selectedCompany, onSelect }: { selectedCompany: string | null; onSelect: (name: string | null) => void }) {
  const [query, setQuery] = useState("");
  const filteredCompanies = companies.filter((company) => `${company.name} ${company.product} ${company.owner}`.toLowerCase().includes(query.toLowerCase()));
  const company = companies.find((item) => item.name === selectedCompany);

  if (company) {
    const stages = [
      ["Applied", company.applied, "bg-indigo-500"],
      ["Resume shortlisted", company.shortlisted, "bg-violet-500"],
      ["Screened", company.interviews + 5, "bg-sky-500"],
      ["Interviewing", company.interviews, "bg-teal-500"],
      ["Selected", company.placed, "bg-emerald-500"],
      ["Rejected", company.rejected, "bg-rose-400"],
    ] as const;
    return (
      <div className="space-y-5">
        <button onClick={() => onSelect(null)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">← All companies</button>
        <Card><CardContent className="p-5 md:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4"><span className={`flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold ${company.tone}`}>{company.initials}</span><div><h2 className="text-xl font-semibold text-slate-900">{company.name}</h2><p className="mt-1 text-sm text-slate-500">{company.product} · PSM owner: {company.owner}</p></div></div>
            <PreviewLabel />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Applied", company.applied], ["Interviewing", company.interviews], ["Rejected", company.rejected], ["Placed", company.placed]].map(([label, count]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xl font-semibold text-slate-900">{count}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 md:p-6">
          <CardHeader className="mb-5"><div><CardTitle>Hiring stages</CardTitle><p className="mt-1 text-xs text-slate-400">Candidate outcomes across this company&apos;s process</p></div></CardHeader>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stages.map(([label, count, color]) => <div key={label} className="flex items-center justify-between rounded-xl border border-slate-100 p-4"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /><span className="text-sm text-slate-600">{label}</span></div><span className="text-lg font-semibold text-slate-900">{count}</span></div>)}
          </div>
          <div className="mt-5 rounded-xl bg-indigo-50 p-4"><p className="text-xs font-semibold text-indigo-800">Spreadsheet breakdown</p><p className="mt-1 text-xs leading-5 text-indigo-700">When connected, this view will combine the company hiring sheet and student application sheet, retaining each interview round and rejection reason.</p></div>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <Card><CardContent className="p-0">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
        <div><CardTitle>All companies</CardTitle><p className="mt-1 text-xs text-slate-400">Company-level funnel and PSM ownership</p></div>
        <label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies..." className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 sm:w-56" /></label>
      </div>
      <div className="divide-y divide-slate-100">
        {filteredCompanies.map((item) => <button key={item.name} onClick={() => onSelect(item.name)} className="flex w-full flex-col gap-3 px-5 py-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${item.tone}`}>{item.initials}</span><div><p className="text-sm font-semibold text-slate-800">{item.name}</p><p className="mt-0.5 text-xs text-slate-400">{item.product} · {item.roles} open roles</p></div></div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500"><span><strong className="text-slate-700">{item.applied}</strong> applied</span><span><strong className="text-slate-700">{item.shortlisted}</strong> shortlisted</span><span><strong className="text-slate-700">{item.placed}</strong> selected</span><span>Owner: {item.owner}</span></div>
        </button>)}
        {filteredCompanies.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No companies match that search.</p>}
      </div>
      <div className="border-t border-slate-100 p-4"><PreviewLabel /></div>
    </CardContent></Card>
  );
}

function AssessedPoolPage() {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => assessedCandidates.filter((candidate) => `${candidate.name} ${candidate.role} ${candidate.company} ${candidate.skills}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Assessed candidates" value="128" detail="Across active academic cohorts" icon={Users} accent="bg-indigo-50 text-indigo-600" />
        <MetricCard label="Ready for company" value="34" detail="Passed assessment and resume review" icon={CircleCheck} accent="bg-emerald-50 text-emerald-600" />
        <MetricCard label="Follow-up needed" value="12" detail="No activity in the last 7 days" icon={Clock3} accent="bg-amber-50 text-amber-600" />
      </section>
      <Card><CardContent className="p-0">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
          <div><CardTitle>Candidate actions</CardTitle><p className="mt-1 text-xs text-slate-400">Prioritize coaching, interview prep and company matching</p></div>
          <div className="flex items-center gap-2"><PreviewLabel /><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates..." className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 sm:w-52" /></label></div>
        </div>
        <div className="divide-y divide-slate-100">
          {candidates.map((candidate) => <div key={candidate.name} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
            <div className="flex min-w-[210px] items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{candidate.initials}</span><div><p className="text-sm font-semibold text-slate-800">{candidate.name}</p><p className="mt-0.5 text-xs text-slate-400">{candidate.role}</p></div></div>
            <div className="flex-1"><p className="text-xs text-slate-600">{candidate.skills}</p><p className="mt-1 text-xs text-slate-400">{candidate.company} · {candidate.stage}</p></div>
            <div className="flex items-center gap-4"><div className="text-center"><p className="text-sm font-semibold text-slate-800">{candidate.score}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">RSA</p></div><div className="min-w-[155px]"><p className="text-xs text-slate-600">{candidate.activity}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${candidate.priority === "High" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"}`}>{candidate.priority}</span></div><Button size="sm" variant="outline">Plan action</Button></div>
          </div>)}
          {candidates.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No candidates match that search.</p>}
        </div>
      </CardContent></Card>
      <Card><CardContent className="flex gap-3 p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Sparkles size={18} /></span><div><p className="text-sm font-semibold text-slate-800">Future placement-readiness insights</p><p className="mt-1 text-xs leading-5 text-slate-500">RSA scores, round transcripts and activity history can inform candidate coaching recommendations. Predictive placement estimates should only be enabled after those sources, consent rules and evaluation criteria are defined.</p></div></CardContent></Card>
    </div>
  );
}

function PsmWorkspace({ teamLead }: { teamLead: boolean }) {
  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: dashboardApi.getSummary });
  const owned = summary.data?.companies ?? [];
  const toneClasses = [
    "bg-indigo-100 text-indigo-700",
    "bg-sky-100 text-sky-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700",
    "bg-rose-100 text-rose-700",
  ];
  return (
    <div className="space-y-5">
      {summary.isError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Could not load your live workspace: {summary.error instanceof Error ? summary.error.message : "Unknown error"}</div>}
      <div className="rounded-2xl bg-indigo-700 p-5 text-white sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">{teamLead ? "Team lead workspace" : "PSM workspace"}{summary.data?.teamName ? ` · ${summary.data.teamName}` : ""}</p>
        <h2 className="mt-2 text-xl font-semibold">{teamLead ? "Your team’s placement work" : "Your assigned company pipelines"}</h2>
        <p className="mt-1 text-sm text-indigo-200">Live counts from your database assignments. Student analytics will appear after the mapped sheet data is imported.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Assigned companies" value={numberFormat.format(summary.data?.totalCompanies ?? 0)} detail="Based on current ownership" icon={Building2} accent="bg-indigo-50 text-indigo-600" />
        <MetricCard label="Open job requests" value={numberFormat.format(summary.data?.activeJobRequests ?? 0)} detail="In your team’s scope" icon={BriefcaseBusiness} accent="bg-sky-50 text-sky-600" />
        <MetricCard label={teamLead ? "PSMs in your team" : "Open positions"} value={numberFormat.format(teamLead ? summary.data?.psmCount ?? 0 : summary.data?.openPositions ?? 0)} detail={teamLead ? "Active team members" : "Across your open requests"} icon={teamLead ? Users : Clock3} accent="bg-amber-50 text-amber-600" />
      </div>
      <Card><CardContent className="p-5">
        <CardHeader className="mb-4"><div><CardTitle>Assigned companies</CardTitle><p className="mt-1 text-xs text-slate-400">Live companies and open roles from your scope</p></div></CardHeader>
        {summary.isPending ? <div className="h-24 animate-pulse rounded-xl bg-slate-50" /> : owned.length === 0
          ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No companies have been assigned to {teamLead ? "your PSM team" : "you"} yet.</p>
          : <div className="divide-y divide-slate-100">{owned.map((company, index) => {
            const openRoles = company.jobRequests.filter((job) => job.status === "OPEN").length;
            const openPositions = company.jobRequests.filter((job) => job.status === "OPEN").reduce((total, job) => total + job.openings, 0);
            return <div key={company.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${toneClasses[index % toneClasses.length]}`}>{company.name.slice(0, 1).toUpperCase()}</span><div><p className="text-sm font-semibold text-slate-800">{company.name}</p><p className="mt-1 text-xs text-slate-400">{company.jobRequests.length} job requests · {openPositions} open positions</p></div></div>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">{openRoles} open roles</span>
            </div>;
          })}</div>}
      </CardContent></Card>
      <Card><CardContent className="flex gap-3 p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><FileSpreadsheet size={18} /></span><div><p className="text-sm font-semibold text-slate-800">Student pipeline is not imported yet</p><p className="mt-1 text-xs leading-5 text-slate-500">After your team lead maps application and interview tabs, the next phase can import candidate rows and provide live shortlist, interview and selection metrics. No sample candidate totals are shown here.</p></div></CardContent></Card>
    </div>
  );
}

export function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const isAdmin = user?.roles.includes("ADMIN") ?? false;
  const isManager = user?.roles.includes("MANAGER") ?? false;
  const isPsmView = location.pathname === "/psm-workspace" || (!isAdmin && (user?.roles.includes("PSM") || isManager));
  const page = location.pathname === "/" && isPsmView
    ? { title: isManager ? "Team lead dashboard" : "My placement dashboard", subtitle: isManager ? "Review the placement workload and company ownership of your PSM team." : "Your assigned companies and open placement work." }
    : pageDetails[location.pathname] ?? {
      title: "Placement overview",
      subtitle: "A clear view of placement outcomes, company pipelines and team activity.",
    };

  const openCompany = (name: string) => {
    setSelectedCompany(name);
    if (location.pathname !== "/companies") navigate("/companies");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-indigo-600">{isPsmView ? (isManager ? "Team operations" : "PSM operations") : "Placement operations"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">{page.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{page.subtitle}</p>
        </div>
        {location.pathname === "/" && <span className="flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 sm:self-auto"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Workspace connected</span>}
      </div>

      {location.pathname === "/" && (isAdmin ? <Overview isAdmin onSelectCompany={openCompany} /> : <PsmWorkspace teamLead={isManager} />)}
      {location.pathname === "/companies" && <CompaniesPage selectedCompany={selectedCompany} onSelect={setSelectedCompany} />}
      {location.pathname === "/assessed-pool" && <AssessedPoolPage />}
      {location.pathname === "/psm-workspace" && <PsmWorkspace teamLead={isManager} />}
      <p className="border-t border-slate-200 pt-4 text-[11px] text-slate-400">
        Placement funnel, company details and assessed-pool records on this screen are preview data. Live database metrics are labeled separately.
      </p>
    </div>
  );
}
