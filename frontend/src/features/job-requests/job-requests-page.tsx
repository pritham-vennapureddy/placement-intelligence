import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { COMPANY_PROCESS_PHASES, companyProcessLabel, type CompanyProcessPhase } from "@placement/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { differenceInCalendarDays, format } from "date-fns";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DataTable, SortableHeader } from "../../components/data-table";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { usePermissions } from "../../hooks/use-permissions";
import { jobRequestsApi, type ProcessSummaryGroup } from "../../services/api";
import type { JobRequestListItem } from "../../types/api";
import { ProcessBadge } from "../tracking/tracking-dialogs";
import { cn } from "../../utils/cn";

const PAGE_SIZE = 20;
const VIEWS = ["active", "closed", "all"] as const;
type View = (typeof VIEWS)[number];

const columns: ColumnDef<JobRequestListItem>[] = [
  {
    id: "role",
    accessorFn: (row) => row.roleTitle,
    header: ({ column }) => <SortableHeader column={column} title="Role" />,
    cell: ({ row }) => (
      <div>
        <Link to={`/job-requests/${row.original.id}`} className="font-semibold text-slate-800 hover:text-indigo-700">{row.original.roleTitle}</Link>
        <p className="text-xs text-slate-400">{row.original.company.name}</p>
      </div>
    ),
  },
  {
    id: "techStack",
    header: "Tech stack",
    cell: ({ row }) => (
      <div className="flex max-w-56 flex-wrap gap-1">
        {row.original.techStack.map((skill) => (
          <span key={skill} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{skill}</span>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "openings",
    header: ({ column }) => <SortableHeader column={column} title="Openings" />,
    cell: ({ row }) => `${row.original.openings} · need ${row.original.requiredCandidateCount}${row.original.ctcLpa !== null ? ` · ${row.original.ctcLpa} LPA` : ""}`,
  },
  {
    id: "owner",
    accessorFn: (row) => row.psmOwner?.fullName ?? "",
    header: ({ column }) => <SortableHeader column={column} title="Employee owner" />,
    cell: ({ row }) => row.original.psmOwner?.fullName ?? <span className="text-slate-400">Unassigned</span>,
  },
  {
    accessorKey: "requestDate",
    header: ({ column }) => <SortableHeader column={column} title="Requested" />,
    cell: ({ row }) => format(new Date(row.original.requestDate), "d MMM yyyy"),
  },
  {
    accessorKey: "deadline",
    header: ({ column }) => <SortableHeader column={column} title="Deadline" />,
    cell: ({ row }) => {
      const { deadline, status } = row.original;
      if (!deadline) return <span className="text-slate-400">—</span>;
      const daysLeft = differenceInCalendarDays(new Date(deadline), new Date());
      const active = status === "OPEN" || status === "ON_HOLD";
      return (
        <div>
          <p>{format(new Date(deadline), "d MMM yyyy")}</p>
          {active && (
            <p className={daysLeft <= 7 ? "text-xs text-rose-600" : "text-xs text-slate-400"}>
              {daysLeft < 0 ? `${-daysLeft} days overdue` : `${daysLeft} days left`}
            </p>
          )}
        </div>
      );
    },
  },
  {
    id: "process",
    header: "Hiring status",
    cell: ({ row }) => <ProcessBadge phase={row.original.processPhase} label={row.original.processLabel} />,
  },
];

export function JobRequestsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "active";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search);
  const processParam = params.get("process") as CompanyProcessPhase | null;
  const process = processParam && COMPANY_PROCESS_PHASES.includes(processParam) ? processParam : null;
  const round = process ? params.get("round") : null;

  const setParam = (key: string, value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });

  const jobs = useQuery({
    queryKey: ["job-requests", { page, view, search: debouncedSearch, process, round }],
    queryFn: () => jobRequestsApi.list({
      page, pageSize: PAGE_SIZE, view,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(process ? { process } : {}),
      ...(round ? { round } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: ["job-requests", "process-summary", { view, search: debouncedSearch }],
    queryFn: () => jobRequestsApi.processSummary({ view, ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
    placeholderData: keepPreviousData,
  });
  const chooseProcess = (group: ProcessSummaryGroup | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("page");
      next.delete("round");
      if (group) next.set("process", group.phase); else next.delete("process");
      if (group?.round) next.set("round", group.round);
      return next;
    }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Job requests"
        description="Each request is identified by its HubSpot Job ID and owned by one employee."
        actions={can("job:write") && (
          <Button asChild><Link to="/job-requests/new"><Plus size={16} /> New job request</Link></Button>
        )}
      />
      <ProcessFilter groups={summary.data} process={process} round={round} onChoose={chooseProcess} />
      <DataTable
        columns={columns}
        data={jobs.data?.items}
        isLoading={jobs.isPending}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        onRowClick={(row) => navigate(`/job-requests/${row.id}`)}
        searchPlaceholder="Search Job ID, role, company, skill…"
        emptyTitle={process ? "No job requests at this hiring status" : view === "active" ? "No active job requests" : "No job requests in this view"}
        emptyDescription={can("job:write") ? "Create one from a HubSpot deal to get started." : undefined}
        server={{
          page,
          pageCount: jobs.data?.meta.totalPages ?? 1,
          total: jobs.data?.meta.total ?? 0,
          onPageChange: (next) => setParam("page", String(next)),
          search,
          onSearchChange: (value) => {
            setSearch(value);
            setParam("q", value || null);
          },
        }}
        toolbar={(
          <Tabs value={view} onValueChange={(value) => setParam("view", value === "active" ? null : value)}>
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="closed">Closed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
    </div>
  );
}

/** One chip per hiring status with its job count; round stages get a chip per round name. */
function ProcessFilter({ groups, process, round, onChoose }: {
  groups: ProcessSummaryGroup[] | undefined;
  process: CompanyProcessPhase | null;
  round: string | null;
  onChoose: (group: ProcessSummaryGroup | null) => void;
}) {
  if (!groups) return null;
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const isActive = (group: ProcessSummaryGroup) =>
    group.phase === process && (group.round ?? "").toLowerCase() === (round ?? "").toLowerCase();
  // A status chosen from a link can have no jobs in this view; keep it visible so it can be cleared.
  const shown = process && !groups.some(isActive)
    ? [...groups, { phase: process, round, label: companyProcessLabel(process, round), count: 0 }]
    : groups;
  const chip = (key: string, label: string, count: number, active: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
        active ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200",
      )}
    >
      {label}
      <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-indigo-100" : "bg-slate-100 text-slate-500")}>{count}</span>
    </button>
  );
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-500">Hiring status</p>
      <div className="flex flex-wrap gap-1.5">
        {chip("all", "All", total, !process, () => onChoose(null))}
        {shown.map((group) => chip(`${group.phase}|${group.round ?? ""}`, group.label, group.count, isActive(group), () => onChoose(isActive(group) ? null : group)))}
      </div>
    </div>
  );
}
