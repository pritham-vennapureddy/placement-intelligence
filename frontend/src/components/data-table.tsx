import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { EmptyState, ErrorState, LoadingRows } from "./states";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/** Column header that toggles sorting. */
export function SortableHeader<T>({ column, title }: { column: Column<T>; title: string }) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-slate-800"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {title}
      <Icon size={13} className={cn(!sorted && "opacity-40")} />
    </button>
  );
}

/** Paging and search done by the API; the table shows one page at a time. */
export interface ServerPaging {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

/**
 * Searchable, sortable, paginated table. By default it works on the rows it is
 * given; pass `server` when the API pages and searches (sorting then applies
 * to the current page only).
 */
export function DataTable<T>({
  columns,
  data,
  isLoading = false,
  error,
  onRetry,
  searchPlaceholder = "Search…",
  toolbar,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  pageSize = 10,
  onRowClick,
  server,
}: {
  columns: ColumnDef<T, any>[];
  data: T[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  server?: ServerPaging;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [localFilter, setLocalFilter] = useState("");
  const globalFilter = server ? server.search : localFilter;
  const setGlobalFilter = server ? server.onSearchChange : setLocalFilter;

  const table = useReactTable({
    data: data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    ...(server
      ? {
        state: { sorting, pagination: { pageIndex: server.page - 1, pageSize: Math.max(1, data?.length ?? 1) } },
        manualPagination: true,
        manualFiltering: true,
        pageCount: server.pageCount,
      }
      : {
        state: { sorting, globalFilter: localFilter },
        onGlobalFilterChange: setLocalFilter,
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        initialState: { pagination: { pageSize } },
      }),
  });

  const rows = table.getRowModel().rows;
  const filteredCount = server ? server.total : table.getFilteredRowModel().rows.length;
  const pageIndex = server ? server.page - 1 : table.getState().pagination.pageIndex;
  const pageCount = server ? server.pageCount : table.getPageCount();
  const goTo = (index: number) => (server ? server.onPageChange(index + 1) : table.setPageIndex(index));

  let body: ReactNode;
  if (isLoading) {
    body = <LoadingRows />;
  } else if (error) {
    body = <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  } else if (filteredCount === 0) {
    body = globalFilter
      ? <EmptyState icon={Search} title="No matches" description={`Nothing matches “${globalFilter}”.`} />
      : <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 pl-9"
          />
        </label>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      {body ?? (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-slate-50/60 hover:bg-slate-50/60">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-10 px-4 text-xs font-semibold text-slate-500">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-4 py-3 text-sm text-slate-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!isLoading && !error && filteredCount > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            {filteredCount} {filteredCount === 1 ? "record" : "records"}
            {pageCount > 1 && ` · page ${pageIndex + 1} of ${pageCount}`}
          </span>
          {pageCount > 1 && (
            <div className="flex gap-1">
              <Button
                aria-label="Previous page"
                size="icon-sm"
                variant="outline"
                disabled={pageIndex <= 0}
                onClick={() => goTo(pageIndex - 1)}
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                aria-label="Next page"
                size="icon-sm"
                variant="outline"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => goTo(pageIndex + 1)}
              >
                <ChevronRight size={15} />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
