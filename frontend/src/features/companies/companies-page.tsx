import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Building2, BriefcaseBusiness, Target, Users } from "lucide-react";
import { DataTable, SortableHeader } from "../../components/data-table";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { PreviewBadge } from "../../components/preview-badge";
import { Badge } from "../../components/ui/badge";
import { companyPreviewRows, type CompanyPreviewRow } from "./mock";

const columns: ColumnDef<CompanyPreviewRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column} title="Company" />,
    cell: ({ row }) => (
      <div>
        <p className="font-semibold text-slate-800">{row.original.name}</p>
        <p className="text-xs text-slate-400">
          {row.original.hubspotCompanyId ? `HubSpot ${row.original.hubspotCompanyId}` : "No HubSpot ID yet"}
        </p>
      </div>
    ),
  },
  {
    id: "industry",
    accessorFn: (row) => `${row.industry} ${row.location}`,
    header: "Industry · location",
    cell: ({ row }) => (
      <div>
        <p>{row.original.industry}</p>
        <p className="text-xs text-slate-400">{row.original.location}</p>
      </div>
    ),
  },
  {
    accessorKey: "openJobRequests",
    header: ({ column }) => <SortableHeader column={column} title="Open requests" />,
  },
  {
    accessorKey: "openPositions",
    header: ({ column }) => <SortableHeader column={column} title="Open positions" />,
  },
  {
    id: "psmOwners",
    accessorFn: (row) => row.psmOwners.join(", "),
    header: "PSM owners",
    cell: ({ row }) => row.original.psmOwners.length
      ? row.original.psmOwners.join(", ")
      : <span className="text-slate-400">—</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={row.original.status === "ACTIVE"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500"}
      >
        {row.original.status === "ACTIVE" ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    accessorKey: "lastActivity",
    header: ({ column }) => <SortableHeader column={column} title="Last activity" />,
    cell: ({ row }) => format(new Date(row.original.lastActivity), "d MMM yyyy"),
  },
];

export function CompaniesPage() {
  const rows = companyPreviewRows;
  const active = rows.filter((row) => row.status === "ACTIVE");
  const owners = new Set(rows.flatMap((row) => row.psmOwners));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Companies"
        description="Hiring partners, their open job requests and the PSMs who own them."
        actions={<PreviewBadge />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active companies" value={active.length} icon={Building2} />
        <KpiCard label="Open job requests" value={active.reduce((sum, row) => sum + row.openJobRequests, 0)} icon={BriefcaseBusiness} tone="sky" />
        <KpiCard label="Open positions" value={active.reduce((sum, row) => sum + row.openPositions, 0)} icon={Target} tone="emerald" />
        <KpiCard label="PSMs with ownership" value={owners.size} icon={Users} tone="amber" />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search companies, industries, PSMs…"
        emptyTitle="No companies yet"
        emptyDescription="Companies you add will appear here."
      />
      <p className="text-[11px] text-slate-400">
        Fictional sample companies. Company records, ownership and history arrive with Phase 2.
      </p>
    </div>
  );
}
