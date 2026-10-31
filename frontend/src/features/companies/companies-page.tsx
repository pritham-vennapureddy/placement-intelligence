import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DataTable, SortableHeader } from "../../components/data-table";
import { PageHeader } from "../../components/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { usePermissions } from "../../hooks/use-permissions";
import { companiesApi } from "../../services/api";
import type { CompanyListItem } from "../../types/api";
import { CompanyFormDialog } from "./company-form-dialog";

const PAGE_SIZE = 20;

const columns: ColumnDef<CompanyListItem>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Company" />,
    cell: ({ row }) => (
      <div>
        <Link to={`/companies/${row.original.id}`} className="font-semibold text-slate-800 hover:text-indigo-700">
          {row.original.name}
        </Link>
        <p className="text-xs text-slate-400">
          {row.original.hubspotUrl ? (
            <a
              href={row.original.hubspotUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-indigo-600"
              onClick={(event) => event.stopPropagation()}
            >
              HubSpot {row.original.hubspotCompanyId} <ExternalLink size={11} />
            </a>
          ) : row.original.hubspotCompanyId ? `HubSpot ${row.original.hubspotCompanyId}` : "No HubSpot ID"}
        </p>
      </div>
    ),
  },
  {
    id: "industry",
    accessorFn: (row) => `${row.industry ?? ""} ${row.location ?? ""}`,
    header: "Industry · location",
    cell: ({ row }) => (
      <div>
        <p>{row.original.industry ?? "—"}</p>
        <p className="text-xs text-slate-400">{row.original.location ?? ""}</p>
      </div>
    ),
  },
  { accessorKey: "openJobRequests", header: ({ column }) => <SortableHeader column={column} title="Open requests" /> },
  { accessorKey: "openPositions", header: ({ column }) => <SortableHeader column={column} title="Open positions" /> },
  {
    id: "psmOwners",
    header: "PSM owners",
    cell: ({ row }) => row.original.psmOwners.length
      ? row.original.psmOwners.map(({ fullName }) => fullName).join(", ")
      : <span className="text-slate-400">—</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={row.original.status === "ACTIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}
      >
        {row.original.status === "ACTIVE" ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => <SortableHeader column={column} title="Updated" />,
    cell: ({ row }) => format(new Date(row.original.updatedAt), "d MMM yyyy"),
  },
];

export function CompaniesPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const status = params.get("status") === "INACTIVE" ? "INACTIVE" : params.get("status") === "all" ? undefined : "ACTIVE";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search);

  const setParam = (key: string, value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });

  const companies = useQuery({
    queryKey: ["companies", { page, status, search: debouncedSearch }],
    queryFn: () => companiesApi.list({ page, pageSize: PAGE_SIZE, ...(status ? { status } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Companies"
        description="Hiring partners, their open job requests and the PSMs who own them."
        actions={can("company:write") && (
          <Button onClick={() => setCreating(true)}><Plus size={16} /> Add company</Button>
        )}
      />
      <DataTable
        columns={columns}
        data={companies.data?.items}
        isLoading={companies.isPending}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        onRowClick={(row) => navigate(`/companies/${row.id}`)}
        searchPlaceholder="Search name, HubSpot ID, industry, location…"
        emptyTitle="No companies yet"
        emptyDescription="Add a company from its HubSpot record to start a drive."
        server={{
          page,
          pageCount: companies.data?.meta.totalPages ?? 1,
          total: companies.data?.meta.total ?? 0,
          onPageChange: (next) => setParam("page", String(next)),
          search,
          onSearchChange: (value) => {
            setSearch(value);
            setParam("q", value || null);
          },
        }}
        toolbar={(
          <Tabs value={status ?? "all"} onValueChange={(value) => setParam("status", value === "ACTIVE" ? null : value)}>
            <TabsList>
              <TabsTrigger value="ACTIVE">Active</TabsTrigger>
              <TabsTrigger value="INACTIVE">Inactive</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
      <CompanyFormDialog open={creating} onOpenChange={setCreating} onSaved={(company) => navigate(`/companies/${company.id}`)} />
    </div>
  );
}
