import type { ColumnDef } from "@tanstack/react-table";
import { differenceInCalendarDays, format } from "date-fns";
import { useMemo, useState } from "react";
import { DataTable, SortableHeader } from "../../components/data-table";
import { PageHeader } from "../../components/page-header";
import { PreviewBadge } from "../../components/preview-badge";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { jobRequestPreviewRows, type JobRequestPreviewRow, type JobRequestStatus } from "./mock";

// Fixed "today" for the fictional sample data so deadline labels stay stable.
const PREVIEW_TODAY = new Date("2026-10-31");

const statusStyles: Record<JobRequestStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "border-slate-200 bg-slate-50 text-slate-600" },
  OPEN: { label: "Open", className: "border-sky-200 bg-sky-50 text-sky-700" },
  ON_HOLD: { label: "On hold", className: "border-amber-200 bg-amber-50 text-amber-700" },
  FILLED: { label: "Filled", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  CANCELLED: { label: "Cancelled", className: "border-rose-200 bg-rose-50 text-rose-700" },
  CLOSED: { label: "Closed", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

const columns: ColumnDef<JobRequestPreviewRow>[] = [
  {
    accessorKey: "jobId",
    header: ({ column }) => <SortableHeader column={column} title="Job ID" />,
    cell: ({ row }) => <span className="font-mono text-xs font-semibold text-slate-700">{row.original.jobId}</span>,
  },
  {
    id: "role",
    // Includes the company so search matches either.
    accessorFn: (row) => `${row.roleTitle} ${row.company}`,
    header: "Role",
    cell: ({ row }) => (
      <div>
        <p className="font-semibold text-slate-800">{row.original.roleTitle}</p>
        <p className="text-xs text-slate-400">{row.original.company}</p>
      </div>
    ),
  },
  { accessorKey: "product", header: "Product" },
  {
    id: "techStack",
    accessorFn: (row) => row.techStack.join(" "),
    header: "Tech stack",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.techStack.map((skill) => (
          <span key={skill} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{skill}</span>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "openings",
    header: ({ column }) => <SortableHeader column={column} title="Openings" />,
    cell: ({ row }) => `${row.original.openings} · need ${row.original.requiredCandidates}`,
  },
  { accessorKey: "psmOwner", header: "PSM owner" },
  {
    accessorKey: "deadline",
    header: ({ column }) => <SortableHeader column={column} title="Deadline" />,
    cell: ({ row }) => {
      const { deadline, status } = row.original;
      if (!deadline) return <span className="text-slate-400">—</span>;
      const daysLeft = differenceInCalendarDays(new Date(deadline), PREVIEW_TODAY);
      const urgent = status === "OPEN" && daysLeft >= 0 && daysLeft <= 7;
      return (
        <div>
          <p>{format(new Date(deadline), "d MMM yyyy")}</p>
          {status === "OPEN" && (
            <p className={urgent ? "text-xs text-rose-600" : "text-xs text-slate-400"}>
              {daysLeft < 0 ? `${-daysLeft} days overdue` : `${daysLeft} days left`}
            </p>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const style = statusStyles[row.original.status];
      return <Badge variant="outline" className={style.className}>{style.label}</Badge>;
    },
  },
];

const views = {
  active: (row: JobRequestPreviewRow) => row.status === "OPEN" || row.status === "ON_HOLD" || row.status === "DRAFT",
  closed: (row: JobRequestPreviewRow) => row.status === "FILLED" || row.status === "CLOSED" || row.status === "CANCELLED",
  all: () => true,
};

export function JobRequestsPage() {
  const [view, setView] = useState<keyof typeof views>("active");
  const rows = useMemo(() => jobRequestPreviewRows.filter(views[view]), [view]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Job requests"
        description="Each request is identified by the Job ID the PSM enters, and owned by one PSM."
        actions={<PreviewBadge />}
      />
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search Job ID, role, company, skill…"
        emptyTitle="No job requests in this view"
        toolbar={(
          <Tabs value={view} onValueChange={(value) => setView(value as keyof typeof views)}>
            <TabsList>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="closed">Closed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
      <p className="text-[11px] text-slate-400">
        Fictional sample job requests. Creating and managing job requests arrives with Phase 2.
      </p>
    </div>
  );
}
