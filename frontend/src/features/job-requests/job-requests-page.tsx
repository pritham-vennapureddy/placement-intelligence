import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { jobRequestsApi } from "../../services/api";
import type { JobRequestListItem } from "../../types/api";
import { JobStatusBadge } from "./job-status-badge";

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
    cell: ({ row }) => `${row.original.openings} · need ${row.original.requiredCandidateCount}`,
  },
  {
    id: "owner",
    accessorFn: (row) => row.psmOwner?.fullName ?? "",
    header: ({ column }) => <SortableHeader column={column} title="PSM owner" />,
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
  { accessorKey: "status", header: "Status", cell: ({ row }) => <JobStatusBadge status={row.original.status} /> },
];

export function JobRequestsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const view: View = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "active";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search);

  const setParam = (key: string, value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });

  const jobs = useQuery({
    queryKey: ["job-requests", { page, view, search: debouncedSearch }],
    queryFn: () => jobRequestsApi.list({ page, pageSize: PAGE_SIZE, view, ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Job requests"
        description="Each request is identified by its HubSpot Job ID and owned by one PSM."
        actions={can("job:write") && (
          <Button asChild><Link to="/job-requests/new"><Plus size={16} /> New job request</Link></Button>
        )}
      />
      <DataTable
        columns={columns}
        data={jobs.data?.items}
        isLoading={jobs.isPending}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        onRowClick={(row) => navigate(`/job-requests/${row.id}`)}
        searchPlaceholder="Search Job ID, role, company, skill…"
        emptyTitle={view === "active" ? "No active job requests" : "No job requests in this view"}
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
