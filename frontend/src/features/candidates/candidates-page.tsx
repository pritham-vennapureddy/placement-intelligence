import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DataTable } from "../../components/data-table";
import { PageHeader } from "../../components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { catalogApi } from "../../services/api";
import { candidatesApi } from "../../services/workflow-api";
import type { CandidateListItem } from "../../types/workflow";
import { ASSESSED_LABELS, CATEGORY_LABELS } from "../screening/badges";

const ALL = "__all__";

const columns: ColumnDef<CandidateListItem>[] = [
  {
    accessorKey: "fullName",
    header: "Candidate",
    cell: ({ row }) => (
      <div>
        <Link to={`/candidates/${row.original.id}`} className="font-semibold text-slate-800 hover:text-indigo-700">{row.original.fullName}</Link>
        <p className="font-mono text-[11px] text-slate-400">{row.original.candidateCode}</p>
      </div>
    ),
  },
  {
    id: "contact",
    header: "Contact",
    cell: ({ row }) => (
      <div className="text-xs text-slate-600">
        <p>{row.original.email ?? "—"}</p>
        <p className="text-slate-400">{row.original.mobile ?? ""}</p>
      </div>
    ),
  },
  {
    id: "products",
    header: "Product · category",
    cell: ({ row }) => (
      <div className="text-xs">
        <p className="text-slate-700">{row.original.products.map((product) => product.name).join(", ") || "—"}</p>
        <p className="text-slate-400">{row.original.category ? CATEGORY_LABELS[row.original.category] : ""}</p>
      </div>
    ),
  },
  {
    id: "education",
    header: "College",
    cell: ({ row }) => <span className="text-xs text-slate-600">{[row.original.college, row.original.graduationYear].filter(Boolean).join(" · ") || "—"}</span>,
  },
  { accessorKey: "assessedPool", header: "Assessed pool", cell: ({ row }) => <span className="text-xs">{ASSESSED_LABELS[row.original.assessedPool]}</span> },
  { accessorKey: "applications", header: "Jobs" },
  { accessorKey: "updatedAt", header: "Updated", cell: ({ row }) => <span className="text-xs text-slate-500">{format(new Date(row.original.updatedAt), "d MMM yyyy")}</span> },
];

export function CandidatesPage({ assessedOnly = false }: { assessedOnly?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const category = params.get("category") ?? ALL;
  const assessedPool = assessedOnly ? "YES" : params.get("assessed") ?? ALL;
  const productId = params.get("product") ?? ALL;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(search);
  const products = useQuery({ queryKey: ["catalog", "products"], queryFn: catalogApi.products, staleTime: 5 * 60_000 });

  const setParam = (key: string, value: string | null) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value && value !== ALL) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    return next;
  }, { replace: true });

  const candidates = useQuery({
    queryKey: ["candidates", { page, category, assessedPool, productId, search: debounced }],
    queryFn: () => candidatesApi.list({
      page,
      ...(debounced ? { search: debounced } : {}),
      ...(category !== ALL ? { category } : {}),
      ...(assessedPool !== ALL ? { assessedPool } : {}),
      ...(productId !== ALL ? { productId } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title={assessedOnly ? "Assessed pool" : "Candidates"}
        description={assessedOnly
          ? "Candidates marked as assessed. “Unknown” is kept separate from “No”."
          : "Everyone who applied to job requests you can see, with their history across drives."}
      />
      <DataTable
        columns={columns}
        data={candidates.data?.items}
        isLoading={candidates.isPending}
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
        onRowClick={(row) => navigate(`/candidates/${row.id}`)}
        searchPlaceholder="Search name, Candidate ID, email, mobile, college…"
        emptyTitle="No candidates yet"
        emptyDescription="Candidates appear here once an internal sheet is imported for a job request."
        server={{
          page,
          pageCount: candidates.data?.meta.totalPages ?? 1,
          total: candidates.data?.meta.total ?? 0,
          onPageChange: (next) => setParam("page", String(next)),
          search,
          onSearchChange: (value) => { setSearch(value); setParam("q", value || null); },
        }}
        toolbar={(
          <>
            <Select value={productId} onValueChange={(value) => setParam("product", value)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All products</SelectItem>
                {products.data?.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={(value) => setParam("category", value)}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            {!assessedOnly && (
              <Select value={assessedPool} onValueChange={(value) => setParam("assessed", value)}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Assessed: any</SelectItem>
                  {Object.entries(ASSESSED_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>Assessed: {label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </>
        )}
      />
    </div>
  );
}
