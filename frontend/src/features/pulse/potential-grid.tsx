import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CRM_CHANNEL_LABELS, CRM_CHANNELS, POTENTIAL_COMPANY_STATUS_LABELS, POTENTIAL_COMPANY_STATUSES,
  type CrmChannel, type PotentialCompanyStatus,
} from "@placement/shared";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Columns3, ExternalLink, FileSpreadsheet, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { driveNotesApi, monthlyPipelineApi } from "../../services/pulse-api";
import type { DriveStages, DriveStepCounts, MonthlyStudent } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { ProcessStatusDialog } from "../tracking/tracking-dialogs";
import { ColumnFilter, type SortDir } from "./column-filter";
import { STATUS_TONE } from "./month-big-picture";
import { POOL_SOURCE_LABELS, productNames, type PoolSource } from "../../components/student-tags";
import { applyFilters, filterValues, INTERNAL_LABELS, notWithCompany, PROCESS_STATE_LABELS, type BoardRow, type ColumnFilters, type DriveStudentCounts, type FilterKey, type ProcessState } from "./potential-board";

const dateText = (value: string | null | undefined) => (value ? format(new Date(`${value}T00:00:00`), "d MMM yy") : "—");
const today = () => format(new Date(), "yyyy-MM-dd");

const STATE_TONE: Record<ProcessState, string> = {
  YET_TO_START: "bg-amber-50 text-amber-800 ring-amber-200",
  STARTED: "bg-sky-50 text-sky-800 ring-sky-200",
  ENDED: "bg-slate-100 text-slate-600 ring-slate-200",
};
const STATE_ORDER: Record<ProcessState, number> = { YET_TO_START: 0, STARTED: 1, ENDED: 2 };

function useMonthRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["monthly-pipeline"] });
}

export interface GridSort { key: string; dir: SortDir }

// ───────────────────────────── Cells that edit in place ─────────────────────────────

/** CRM status straight from the grid; the change goes into the entry's history. */
function StatusCell({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const refresh = useMonthRefresh();
  const save = useMutation({
    mutationFn: (status: PotentialCompanyStatus) => monthlyPipelineApi.update(row.id, { status }),
    onSuccess: async (_, status) => { await refresh(); toast.success(`${row.company}: ${POTENTIAL_COMPANY_STATUS_LABELS[status]}`); },
    onError: (error) => toast.error(error.message),
  });
  const badge = cn("inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-medium", STATUS_TONE[row.crmStatus]);
  if (!canWrite) return <span className={badge}>{POTENTIAL_COMPANY_STATUS_LABELS[row.crmStatus]}</span>;
  return (
    <Select value={row.crmStatus} onValueChange={(value) => save.mutate(value as PotentialCompanyStatus)} disabled={save.isPending}>
      <SelectTrigger size="sm" className={cn(badge, "w-auto gap-1 py-0 shadow-none data-[size=sm]:h-6 [&_svg]:size-3")} aria-label={`CRM status for ${row.company}`}><SelectValue /></SelectTrigger>
      <SelectContent>{POTENTIAL_COMPANY_STATUSES.map((status) => <SelectItem key={status} value={status}>{POTENTIAL_COMPANY_STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** The company's stage (CV provided, TR1 in progress, done…); opens the same dialog as the job page. */
function StageCell({ row, canEdit }: { row: BoardRow; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const pill = <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", STATE_TONE[row.state])}>{row.phaseLabel}</span>;
  if (!canEdit) return pill;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group/stage inline-flex items-center gap-1" title="Change the company stage">
        {pill}<Pencil size={11} className="text-slate-300 group-hover/stage:text-indigo-600" />
      </button>
      {open && (
        <ProcessStatusDialog
          open={open}
          onOpenChange={setOpen}
          job={{ id: row.jobRequestId, roleTitle: row.role, companyName: row.company, phase: row.phase, roundId: row.drive?.processRoundId ?? null, rounds: row.drive?.rounds ?? [] }}
        />
      )}
    </>
  );
}

/** CRM's expected process start, editable as a date. */
function ExpectedStartCell({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const refresh = useMonthRefresh();
  const value = row.entry.expectedStartDate ?? "";
  const save = useMutation({
    mutationFn: (date: string) => monthlyPipelineApi.update(row.id, { expectedStartDate: date || null }),
    onSuccess: async () => { await refresh(); toast.success(`${row.company}: expected start saved`); },
    onError: (error) => toast.error(error.message),
  });
  if (!canWrite) return <span>{dateText(value || null)}</span>;
  return (
    <input type="date" defaultValue={value} key={value} disabled={save.isPending} aria-label={`Expected process start for ${row.company}`}
      onBlur={(event) => event.target.value !== value && save.mutate(event.target.value)}
      className="h-7 w-[8.5rem] rounded border border-transparent bg-transparent px-1 text-xs text-slate-700 hover:border-slate-200 focus:border-indigo-300 focus:outline-none" />
  );
}

/** Today's update from the company, added in two clicks. */
function AddRemark({ row, onDone, compact }: { row: BoardRow; onDone?: () => void; compact?: boolean }) {
  const refresh = useMonthRefresh();
  const queryClient = useQueryClient();
  const [on, setOn] = useState(today());
  const [channel, setChannel] = useState<CrmChannel>("CALL");
  const [remark, setRemark] = useState("");
  const [nextStep, setNextStep] = useState("");
  const save = useMutation({
    mutationFn: () => driveNotesApi.addRemark(row.jobRequestId, { interactionOn: on, channel, remark: remark.trim(), nextStep: nextStep.trim() || null }),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["drive-notes", row.jobRequestId] })]);
      toast.success(`Update saved for ${row.company}`);
      setRemark(""); setNextStep("");
      onDone?.();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (remark.trim()) save.mutate(); }}>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={on} max={today()} onChange={(event) => setOn(event.target.value)} className="h-8 text-xs" aria-label="Date of the update" />
        <Select value={channel} onValueChange={(value) => setChannel(value as CrmChannel)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-label="Channel"><SelectValue /></SelectTrigger>
          <SelectContent>{CRM_CHANNELS.map((value) => <SelectItem key={value} value={value}>{CRM_CHANNEL_LABELS[value]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Textarea autoFocus={!compact} rows={compact ? 2 : 3} maxLength={4000} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="What the company said today" className="text-xs" />
      <Input value={nextStep} maxLength={1000} onChange={(event) => setNextStep(event.target.value)} placeholder="Next step (optional)" className="h-8 text-xs" />
      <Button type="submit" size="sm" disabled={!remark.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save update"}</Button>
    </form>
  );
}

function RemarkCell({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const last = row.drive?.lastCrmRemark;
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        {last ? (
          <p className="line-clamp-2" title={`${last.remark}${last.nextStep ? `\nNext: ${last.nextStep}` : ""}`}>
            <span className="text-slate-400">{dateText(last.on)}{last.by ? ` · ${last.by.split(" ")[0]}` : ""}: </span>{last.remark}
          </p>
        ) : <span className="text-slate-300">No update yet</span>}
        {(row.drive?.crmRemarkCount ?? 0) > 1 && <span className="text-[10px] text-slate-400">{row.drive!.crmRemarkCount} updates</span>}
      </div>
      {canWrite && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6 shrink-0 text-indigo-600" aria-label={`Add today's update for ${row.company}`} title="Add today's update"><MessageSquarePlus size={14} /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">{row.company} · update from CRM</p>
            <AddRemark row={row} onDone={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function SheetLinks({ row }: { row: BoardRow }) {
  const link = (url: string | null, label: string) => url
    ? <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-emerald-300 hover:text-emerald-700" title={`Open the ${label.toLowerCase()} sheet`}><FileSpreadsheet size={12} />{label}</a>
    : <span className="inline-flex rounded border border-dashed border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-300" title={`No ${label.toLowerCase()} sheet linked`}>{label}</span>;
  return <div className="flex gap-1">{link(row.companySheetUrl, "Company")}{link(row.internalSheetUrl, "Internal")}</div>;
}

const num = (value: number, tone?: string) => <span className={cn("tabular-nums", value === 0 ? "text-slate-300" : tone)}>{value}</span>;
const completedCell = (counts: DriveStudentCounts) => (
  <>
    {num(counts.completed, "text-slate-700")}
    {counts.selected > 0 && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700" title="Selected">{counts.selected}✓</span>}
  </>
);

// ───────────────────────────── Column set ─────────────────────────────

interface Column {
  key: string;
  label: string;
  /** Group header shown above (Academy / pool). */
  group?: "all" | "academy" | "pool";
  align?: "right";
  filter?: FilterKey;
  sort?: (row: BoardRow) => string | number;
  className?: string;
  defaultHidden?: boolean;
  cell: (row: BoardRow, ctx: { canWrite: boolean; canNote: boolean }) => ReactNode;
  footer?: (rows: BoardRow[]) => ReactNode;
}

const sum = (rows: BoardRow[], pick: (row: BoardRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

const COLUMNS: Column[] = [
  { key: "products", label: "Product", filter: "products", sort: (row) => row.products.join(), className: "min-w-[110px]",
    cell: (row) => row.products.length ? <div className="flex flex-wrap gap-1">{row.products.map((name) => <span key={name} className="rounded bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700">{name}</span>)}</div> : <span className="text-slate-300">—</span> },
  { key: "ctc", label: "CTC", align: "right", sort: (row) => row.ctcLpa ?? -1,
    cell: (row) => row.ctcLpa === null ? <span className="text-slate-300">—</span> : <span className="tabular-nums">{row.ctcLpa} LPA</span> },
  { key: "requestDate", label: "Job requested date", filter: "requestMonth", sort: (row) => row.requestDate ?? "", className: "whitespace-nowrap",
    cell: (row) => dateText(row.requestDate) },
  { key: "techStack", label: "Tech stack", filter: "techStack", sort: (row) => row.techStack.join(), className: "min-w-[180px] max-w-[240px]",
    cell: (row) => row.techStack.length ? <p className="line-clamp-2 text-slate-600" title={row.techStack.join(", ")}>{row.techStack.join(", ")}</p> : <span className="text-slate-300">—</span> },
  { key: "crmStatus", label: "CRM status", filter: "crmStatus", sort: (row) => POTENTIAL_COMPANY_STATUSES.indexOf(row.crmStatus),
    cell: (row, ctx) => <StatusCell row={row} canWrite={ctx.canWrite} /> },
  { key: "state", label: "Process stage", filter: "state", sort: (row) => STATE_ORDER[row.state], defaultHidden: true,
    cell: (row) => <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", STATE_TONE[row.state])}>{PROCESS_STATE_LABELS[row.state]}</span> },
  { key: "phase", label: "Company stage", filter: "phase", sort: (row) => row.phaseLabel,
    cell: (row, ctx) => <StageCell row={row} canEdit={ctx.canWrite} /> },
  { key: "shortlisting", label: "Our shortlisting", filter: "shortlisting", sort: (row) => row.stagesRun.length, className: "min-w-[140px]",
    cell: (row) => row.stagesRun.length ? (
      <span className="text-slate-700" title="Stages with results recorded">{row.stagesRun.map((stage) => INTERNAL_LABELS[stage]).join(" → ")}</span>
    ) : (
      <span className="inline-flex flex-col">
        <span className="w-fit rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-800" title="No resume shortlist and no final shortlist sheet: the company sheet alone decided">Not done</span>
        {row.fromCompanySheet > 0 && <span className="text-[10px] text-slate-400">{row.fromCompanySheet} added from company sheet</span>}
      </span>
    ) },
  { key: "openings", label: "Openings", align: "right", sort: (row) => row.openings,
    cell: (row) => <span className="font-semibold tabular-nums text-slate-900">{row.openings}</span>, footer: (rows) => sum(rows, (row) => row.openings) },
  { key: "allTotal", label: "Total", group: "all", align: "right", sort: (row) => row.all.total,
    cell: (row) => num(row.all.total, "font-medium text-slate-800"), footer: (rows) => sum(rows, (row) => row.all.total) },
  { key: "allInProcess", label: "In process", group: "all", align: "right", sort: (row) => row.all.inProcess,
    cell: (row) => num(row.all.inProcess, "font-medium text-sky-700"), footer: (rows) => <span className="text-sky-700">{sum(rows, (row) => row.all.inProcess)}</span> },
  { key: "allCompleted", label: "Completed", group: "all", align: "right", sort: (row) => row.all.completed,
    cell: (row) => completedCell(row.all), footer: (rows) => <>{sum(rows, (row) => row.all.completed)} <span className="text-emerald-700">({sum(rows, (row) => row.all.selected)}✓)</span></> },
  { key: "academyTotal", label: "Total", group: "academy", align: "right", sort: (row) => row.academy.total,
    cell: (row) => num(row.academy.total, "font-medium text-slate-800"), footer: (rows) => sum(rows, (row) => row.academy.total) },
  { key: "academyNotWithCompany", label: "Not with company", group: "academy", align: "right", sort: (row) => row.academy.notWithCompany,
    cell: (row) => num(row.academy.notWithCompany, "font-medium text-amber-700"), footer: (rows) => <span className="text-amber-700">{sum(rows, (row) => row.academy.notWithCompany)}</span> },
  { key: "academyInProcess", label: "In process", group: "academy", align: "right", sort: (row) => row.academy.inProcess,
    cell: (row) => num(row.academy.inProcess, "font-medium text-sky-700"), footer: (rows) => <span className="text-sky-700">{sum(rows, (row) => row.academy.inProcess)}</span> },
  { key: "academyCompleted", label: "Completed", group: "academy", align: "right", sort: (row) => row.academy.completed,
    cell: (row) => completedCell(row.academy), footer: (rows) => <>{sum(rows, (row) => row.academy.completed)} <span className="text-emerald-700">({sum(rows, (row) => row.academy.selected)}✓)</span></> },
  { key: "poolTotal", label: "Total", group: "pool", align: "right", sort: (row) => row.pool.total,
    cell: (row) => num(row.pool.total, "font-medium text-slate-800"), footer: (rows) => sum(rows, (row) => row.pool.total) },
  { key: "poolNotWithCompany", label: "Not with company", group: "pool", align: "right", sort: (row) => row.pool.notWithCompany,
    cell: (row) => num(row.pool.notWithCompany, "font-medium text-amber-700"), footer: (rows) => <span className="text-amber-700">{sum(rows, (row) => row.pool.notWithCompany)}</span> },
  { key: "poolInProcess", label: "In process", group: "pool", align: "right", sort: (row) => row.pool.inProcess,
    cell: (row) => num(row.pool.inProcess, "font-medium text-sky-700"), footer: (rows) => <span className="text-sky-700">{sum(rows, (row) => row.pool.inProcess)}</span> },
  { key: "poolCompleted", label: "Completed", group: "pool", align: "right", sort: (row) => row.pool.completed,
    cell: (row) => completedCell(row.pool), footer: (rows) => <>{sum(rows, (row) => row.pool.completed)} <span className="text-emerald-700">({sum(rows, (row) => row.pool.selected)}✓)</span></> },
  { key: "crmOwner", label: "CRM", filter: "crmOwner", sort: (row) => row.crmOwner,
    cell: (row) => row.crmOwner === "Not set" ? <span className="text-slate-400">Not set</span> : row.crmOwner },
  { key: "psm", label: "Placement owner", filter: "psm", sort: (row) => row.psm, defaultHidden: true,
    cell: (row) => row.psm === "Not set" ? <span className="text-slate-400">Not set</span> : row.psm },
  { key: "expectedStart", label: "Expected start", sort: (row) => row.entry.expectedStartDate ?? "9999",
    cell: (row, ctx) => <ExpectedStartCell row={row} canWrite={ctx.canWrite} /> },
  { key: "processStart", label: "Started on", sort: (row) => row.processStart ?? "9999", className: "whitespace-nowrap",
    cell: (row) => dateText(row.processStart) },
  { key: "processEnd", label: "Done on", sort: (row) => row.processEnd ?? "9999", className: "whitespace-nowrap",
    cell: (row) => row.processEnd ? <span className="text-slate-700">{dateText(row.processEnd)}</span> : <span className="text-slate-300">—</span> },
  { key: "sheets", label: "Sheets",
    cell: (row) => <SheetLinks row={row} /> },
  { key: "listedSince", label: "On list since", filter: "listedSince", sort: (row) => row.entry.firstListedMonth, defaultHidden: true, className: "whitespace-nowrap",
    cell: (row) => row.listedSince },
  { key: "remarks", label: "CRM updates", sort: (row) => row.drive?.lastCrmRemark?.on ?? "", className: "min-w-[240px] max-w-[300px]",
    cell: (row, ctx) => <RemarkCell row={row} canWrite={ctx.canNote} /> },
  { key: "review", label: "Went right / wrong", filter: "review", sort: (row) => (row.review.wentRight || row.review.wentWrong ? 1 : 0), className: "min-w-[200px] max-w-[260px]",
    cell: (row) => row.review.wentRight || row.review.wentWrong ? (
      <div className="space-y-0.5">
        {row.review.wentRight && <p className="line-clamp-1 text-emerald-700" title={row.review.wentRight}>+ {row.review.wentRight}</p>}
        {row.review.wentWrong && <p className="line-clamp-1 text-rose-600" title={row.review.wentWrong}>− {row.review.wentWrong}</p>}
      </div>
    ) : <span className="text-slate-300">Not written</span> },
];

const COMPANY_SORT = (row: BoardRow) => `${row.company} ${row.role}`.toLowerCase();

export function sortRows(rows: BoardRow[], sort: GridSort | null) {
  const value = sort?.key === "company" ? COMPANY_SORT : COLUMNS.find((column) => column.key === sort?.key)?.sort;
  if (!sort || !value) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    return (a < b ? -1 : a > b ? 1 : 0) * sign || x.company.localeCompare(y.company);
  });
}

// v2: "Job requested date" became a default column, so earlier saved choices are reset once.
const STORAGE_KEY = "monthly.hiddenColumns.v2";

/** Which columns are hidden, remembered on this computer. */
export function useHiddenColumns() {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* first visit */ }
    return new Set(COLUMNS.filter((column) => column.defaultHidden).map((column) => column.key));
  });
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden])); }, [hidden]);
  return [hidden, setHidden] as const;
}

export function ColumnPicker({ hidden, onChange }: { hidden: Set<string>; onChange: (next: Set<string>) => void }) {
  const toggle = (key: string) => { const next = new Set(hidden); if (next.has(key)) next.delete(key); else next.add(key); onChange(next); };
  const label = (column: Column) => (column.group ? `${column.group === "all" ? "All students" : column.group === "academy" ? "Academy" : "Pool"} · ${column.label.toLowerCase()}` : column.label);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><Columns3 size={14} /> Columns{hidden.size ? ` (${COLUMNS.length - hidden.size}/${COLUMNS.length})` : ""}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <div className="mb-1 flex justify-between px-1.5 text-xs">
          <button type="button" className="text-indigo-700 hover:underline" onClick={() => onChange(new Set())}>Show all</button>
          <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange(new Set(COLUMNS.filter((column) => column.defaultHidden).map((column) => column.key)))}>Default</button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {COLUMNS.map((column) => (
            <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <Checkbox checked={!hidden.has(column.key)} onCheckedChange={() => toggle(column.key)} /> {label(column)}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ───────────────────────────── The grid ─────────────────────────────

export function PotentialGrid({
  rows, scopedRows, filters, onFilter, sort, onSort, expanded, onToggle, canWrite, canNote, onEdit, onDelete, empty, hidden,
}: {
  /** Rows after every filter, sorted. */
  rows: BoardRow[];
  /** Rows before column filters, for each column's value list. */
  scopedRows: BoardRow[];
  filters: ColumnFilters;
  onFilter: (key: FilterKey, values: string[] | undefined) => void;
  sort: GridSort | null;
  onSort: (sort: GridSort | null) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  canWrite: boolean;
  /** May add CRM updates and write the went right / wrong summary. */
  canNote: boolean;
  onEdit: (row: BoardRow) => void;
  onDelete: (row: BoardRow) => void;
  empty: ReactNode;
  hidden: Set<string>;
}) {
  const columns = COLUMNS.filter((column) => !hidden.has(column.key));
  /** Excel shows each column's values given the other columns' filters. */
  const valuesFor = (key: FilterKey) => {
    const counts = new Map<string, number>();
    for (const row of applyFilters(scopedRows, filters, key)) for (const value of filterValues(key, row)) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => x.value.localeCompare(y.value));
  };
  const header = (title: string, sortKey: string, filterKey?: FilterKey, align: "left" | "right" = "left") => (
    <ColumnFilter
      title={title}
      align={align}
      values={filterKey ? () => valuesFor(filterKey) : []}
      selected={filterKey ? filters[filterKey] : undefined}
      onChange={(next) => filterKey && onFilter(filterKey, next)}
      sort={sort?.key === sortKey ? sort.dir : null}
      onSort={(dir) => onSort(dir ? { key: sortKey, dir } : null)}
    />
  );
  const ctx = { canWrite, canNote };
  const span = columns.length + 2;
  // Group header cells: consecutive columns with the same group share one cell.
  const groups: { group: "all" | "academy" | "pool" | undefined; span: number }[] = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.group === column.group) last.span++;
    else groups.push({ group: column.group, span: 1 });
  }
  const groupStyle = { all: "bg-slate-100 text-slate-700", academy: "bg-indigo-50/70 text-indigo-700", pool: "bg-emerald-50/70 text-emerald-700" };
  const th = "whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-slate-600";
  const edge = (column: Column, index: number) => column.group && columns[index - 1]?.group !== column.group ? "border-l border-slate-200" : column.group === undefined && columns[index - 1]?.group ? "border-l border-slate-200" : "";

  return (
    <div className="max-h-[72vh] overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-slate-50 [&_th]:border-b [&_th]:border-slate-200">
          <tr className="text-[11px] uppercase tracking-wide">
            <th colSpan={2} className="sticky left-0 z-30 bg-slate-50" />
            {groups.map((item, index) => (
              <th key={index} colSpan={item.span} className={cn("px-2 pt-1.5 text-center font-semibold", item.group ? cn(groupStyle[item.group], "border-l border-slate-200") : "")}>
                {item.group === "all" ? "All students (incl. External)" : item.group === "academy" ? "Academy students" : item.group === "pool" ? "Assessed-pool students" : ""}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-30 w-8 bg-slate-50" />
            <th className={cn(th, "sticky left-8 z-30 min-w-[250px] bg-slate-50 shadow-[1px_0_0_#e2e8f0]")}>{header("Company · role · job ID", "company", "company")}</th>
            {columns.map((column, index) => (
              <th key={column.key} className={cn(th, column.align === "right" && "text-right", edge(column, index))}>
                {header(column.label, column.key, column.filter, column.align === "right" ? "right" : "left")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-slate-100">
          {rows.length === 0 && <tr><td colSpan={span} className="p-0">{empty}</td></tr>}
          {rows.map((row) => {
            const open = expanded.has(row.id);
            return (
              <Fragment key={row.id}>
                <tr className={cn("group align-middle hover:bg-indigo-50/30", open && "bg-indigo-50/40")}>
                  <td className="sticky left-0 z-10 bg-white px-1 group-hover:bg-indigo-50/30">
                    <button type="button" onClick={() => onToggle(row.id)} className="grid size-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-expanded={open} aria-label={open ? "Hide company funnel" : "Show company funnel"}>
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </td>
                  <td className="sticky left-8 z-10 bg-white px-2 py-2 shadow-[1px_0_0_#f1f5f9] group-hover:bg-indigo-50/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link to={`/job-requests/${row.jobRequestId}`} className="font-medium text-slate-900 hover:text-indigo-700">{row.company}</Link>
                        <p className="truncate text-xs text-slate-500" title={row.role}>{row.role}</p>
                        <p className="font-mono text-[10px] text-slate-400">{row.jobCode}{row.entry.carriedFrom && <span className="ml-1.5 font-sans text-amber-700">carried in</span>}</p>
                      </div>
                      {canWrite && (
                        <div className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <Button variant="ghost" size="icon" className="size-6" aria-label={`Edit ${row.company}`} onClick={() => onEdit(row)}><Pencil size={12} /></Button>
                          <Button variant="ghost" size="icon" className="size-6 text-rose-600" aria-label={`Remove ${row.company}`} onClick={() => onDelete(row)}><Trash2 size={12} /></Button>
                        </div>
                      )}
                    </div>
                  </td>
                  {columns.map((column, index) => (
                    <td key={column.key} className={cn("px-2 py-1.5 text-xs text-slate-700", column.align === "right" && "text-right", edge(column, index), column.className)}>
                      {column.cell(row, ctx)}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr>
                    <td colSpan={span} className="bg-slate-50/70 px-4 py-3">
                      <CompanyFunnel row={row} canWrite={canNote} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="sticky bottom-0 z-20 bg-slate-100/95 text-xs font-semibold text-slate-800 [&_td]:border-t [&_td]:border-slate-300 [&_td]:py-2">
            <tr>
              <td className="sticky left-0 z-30 bg-slate-100" />
              <td className="sticky left-8 z-30 bg-slate-100 px-2" title="A student in two drives counts in both rows; the big picture counts each student once.">
                Total · {rows.length} job drives <span className="font-normal text-slate-500">(students per drive)</span>
              </td>
              {columns.map((column, index) => (
                <td key={column.key} className={cn("px-2 tabular-nums", column.align === "right" && "text-right", edge(column, index))}>{column.footer?.(rows)}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ───────────────────────────── One company's funnel (expanded row) ─────────────────────────────

/** One drive's student journey: each step and each of the company's rounds, Academy / pool / everyone. */
type GroupKey = "academy" | "pool" | "all";
type StepCounts = DriveStepCounts & { appliedThemselves: number; fromSheet: number; notInSheet: number };

/** Unique students in each group who applied, were added from the company sheet, or applied but were not in it. */
function entryCounts(row: BoardRow): Record<GroupKey, { appliedThemselves: number; fromSheet: number; notInSheet: number }> {
  const keep: Record<GroupKey, (person: MonthlyStudent) => boolean> = { academy: (p) => p.academy, pool: (p) => p.inPool, all: () => true };
  const count = (people: MonthlyStudent[]) => new Set(people.map((person) => person.candidateId)).size;
  const result = {} as Record<GroupKey, { appliedThemselves: number; fromSheet: number; notInSheet: number }>;
  for (const key of ["academy", "pool", "all"] as const) {
    const people = row.people.filter(keep[key]);
    const applied = people.filter((person) => !person.fromCompanySheet);
    result[key] = { appliedThemselves: count(applied), fromSheet: count(people.filter((person) => person.fromCompanySheet)), notInSheet: count(applied.filter((person) => !person.shared)) };
  }
  return result;
}

function DriveStagesTable({ stages, row }: { stages: DriveStages; row: BoardRow }) {
  const groups = [
    { key: "academy", label: "Academy" },
    { key: "pool", label: "Assessed pool" },
    { key: "all", label: "All students" },
  ] as const;
  const extra = useMemo(() => entryCounts(row), [row]);
  const counts = (key: GroupKey): StepCounts => ({ ...stages.steps[key], ...extra[key] });
  const ours = row.stagesRun.length > 0;
  const anyFromSheet = extra.all.fromSheet > 0;
  type Step = { label: string; hint?: string; value: (counts: StepCounts) => number; tone?: string };
  const steps: Step[] = [
    { label: "Applied", value: (c) => c.appliedThemselves },
    ...(ours ? [
      { label: "Rejected in our shortlisting", hint: row.stagesRun.map((stage) => INTERNAL_LABELS[stage]).join(" → "), value: (c: StepCounts) => c.internalRejected, tone: "text-rose-600" },
      ...(row.stagesRun.includes("final") ? [{ label: "Made our final shortlist", value: (c: StepCounts) => c.finalShortlisted }] : []),
    ] : [
      { label: "Applied, not in company sheet", hint: "No shortlisting by us: the company picked from the applicants", value: (c: StepCounts) => c.notInSheet, tone: "text-slate-500" },
    ]),
    ...(anyFromSheet ? [{ label: "Added from company sheet (did not apply)", value: (c: StepCounts) => c.fromSheet, tone: "text-violet-700" }] : []),
    { label: ours ? "Shared with company" : "In company sheet", value: (c) => c.shared, tone: "font-medium text-slate-900" },
    { label: "Got an interview", value: (c) => c.interviewed },
  ];
  const outcomes: Step[] = [
    { label: "Still in company process", value: (c) => c.inProcess },
    { label: "Rejected by company", value: (c) => c.companyRejected, tone: "text-rose-600" },
    { label: "Selected", value: (c) => c.selected, tone: "font-semibold text-emerald-700" },
  ];
  const stepRow = (step: Step) => (
    <tr key={step.label}>
      <td className="py-1 pr-3 text-slate-700">{step.label}{step.hint && <span className="block text-[10px] text-slate-400">{step.hint}</span>}</td>
      {groups.map((group) => <td key={group.key} className={cn("px-2 text-right tabular-nums", step.tone)} colSpan={4}>{step.value(counts(group.key))}</td>)}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      {!ours && (
        <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          <b>No shortlisting by us</b> on this drive (no resume shortlist, no final shortlist sheet). The company sheet decided who went ahead.
        </p>
      )}
      <table className="w-full min-w-[640px] text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1 text-left font-medium">Unique students</th>
            {groups.map((group) => <th key={group.key} colSpan={4} className="px-2 pb-1 text-right font-semibold text-slate-700">{group.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {steps.map(stepRow)}
          {stages.rounds.length > 0 && (
            <tr className="text-slate-500">
              <td className="pb-1 pt-3 font-medium">Company rounds</td>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <td className="px-1 pt-3 text-right">Attended</td>
                  <td className="px-1 pt-3 text-right text-emerald-700">Cleared</td>
                  <td className="px-1 pt-3 text-right text-rose-600">Rejected</td>
                  <td className="px-1 pt-3 text-right" title="Scheduled, not yet attended">Sched.</td>
                </Fragment>
              ))}
            </tr>
          )}
          {stages.rounds.map((round) => (
            <tr key={round.roundId}>
              <td className="py-1 pr-3 font-medium text-slate-800">{round.name}</td>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <td className="px-1 text-right tabular-nums">{round[group.key].attended}</td>
                  <td className="px-1 text-right tabular-nums text-emerald-700">{round[group.key].cleared}</td>
                  <td className="px-1 text-right tabular-nums text-rose-600">{round[group.key].rejected}</td>
                  <td className="px-1 text-right tabular-nums text-slate-500">{round[group.key].scheduled}</td>
                </Fragment>
              ))}
            </tr>
          ))}
          {outcomes.map(stepRow)}
        </tbody>
      </table>
    </div>
  );
}

/** What went right / wrong with this company, and what to change; saved as the drive's RSA review. */
function ReviewEditor({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const refresh = useMonthRefresh();
  const [right, setRight] = useState(row.review.wentRight ?? "");
  const [wrong, setWrong] = useState(row.review.wentWrong ?? "");
  const [actions, setActions] = useState(row.review.actionItems ?? "");
  useEffect(() => { setRight(row.review.wentRight ?? ""); setWrong(row.review.wentWrong ?? ""); setActions(row.review.actionItems ?? ""); }, [row.review]);
  const dirty = right !== (row.review.wentRight ?? "") || wrong !== (row.review.wentWrong ?? "") || actions !== (row.review.actionItems ?? "");
  const save = useMutation({
    mutationFn: () => driveNotesApi.saveRsaReview(row.jobRequestId, { wentRight: right.trim() || null, wentWrong: wrong.trim() || null, actionItems: actions.trim() || null }),
    onSuccess: async () => { await refresh(); toast.success(`Summary saved for ${row.company}`); },
    onError: (error) => toast.error(error.message),
  });
  const field = (label: string, value: string, set: (value: string) => void, tone: string, placeholder: string) => (
    <label className="grid gap-1">
      <span className={cn("text-[11px] font-semibold uppercase tracking-wide", tone)}>{label}</span>
      <Textarea rows={3} value={value} maxLength={4000} disabled={!canWrite} onChange={(event) => set(event.target.value)} placeholder={placeholder} className="bg-white text-xs" />
    </label>
  );
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 md:grid-cols-3">
        {field("What went right", right, setRight, "text-emerald-700", "e.g. Students were well prepared for TR1")}
        {field("What went wrong", wrong, setWrong, "text-rose-600", "e.g. Many failed the DSA assessment")}
        {field("What to change", actions, setActions, "text-slate-600", "e.g. Add a mock DSA test before sharing")}
      </div>
      {canWrite && <div className="flex justify-end"><Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save summary"}</Button></div>}
    </div>
  );
}

/** Every update CRM recorded for this company, newest first, with a box to add today's. */
function CrmLog({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const notes = useQuery({ queryKey: ["drive-notes", row.jobRequestId], queryFn: () => driveNotesApi.get(row.jobRequestId) });
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
      <ol className="grid max-h-64 content-start gap-2 overflow-y-auto pr-1">
        {notes.isPending ? <li className="text-xs text-slate-400">Loading…</li>
          : (notes.data?.crmRemarks ?? []).length === 0 ? <li className="text-xs text-slate-400">No updates yet. Add the first one from today's sync.</li>
            : notes.data!.crmRemarks.map((remark) => (
              <li key={remark.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                <p className="text-[11px] text-slate-400">{dateText(remark.interactionOn)} · {CRM_CHANNEL_LABELS[remark.channel]} · {remark.createdBy.fullName}</p>
                <p className="whitespace-pre-wrap text-slate-700">{remark.remark}</p>
                {remark.nextStep && <p className="mt-0.5 text-indigo-700">Next: {remark.nextStep}</p>}
              </li>
            ))}
      </ol>
      {canWrite && <div className="rounded-md border border-slate-200 bg-white p-2.5"><p className="mb-1.5 text-xs font-semibold text-slate-700">Add today's update</p><AddRemark row={row} compact /></div>}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Academy and assessed-pool students who applied but are not with the company
 * (not in its sheet / not shared, and not rejected by us). Academy first: they
 * are the ones to push to the company.
 */
function NotWithCompany({ row }: { row: BoardRow }) {
  const people = useMemo(() => {
    const seen = new Set<string>();
    return row.people
      .filter((person) => (person.academy || person.inPool) && notWithCompany(person))
      .filter((person) => !seen.has(person.candidateId) && Boolean(seen.add(person.candidateId)))
      .sort((x, y) => Number(y.academy) - Number(x.academy) || x.fullName.localeCompare(y.fullName));
  }, [row.people]);
  const academy = people.filter((person) => person.academy).length;
  const over = row.state === "ENDED";
  return (
    <Section title={`Academy and pool students not with the company · ${people.length}`}>
      {people.length === 0 ? <p className="text-xs text-slate-500">Every Academy and assessed-pool applicant is with the company or was rejected in our shortlisting.</p> : (
        <>
          <p className="mb-2 text-xs text-slate-600">
            They applied but are {row.stagesRun.length ? "not shared with the company yet" : "not in the company sheet"}.{" "}
            {over ? "The drive is over." : <b className="text-amber-800">Push them to the company, Academy first ({academy} Academy, {people.length - academy} pool).</b>}
          </p>
          <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>{["Student name", "Group", "User ID", "Product", "Year of graduation", "College", "Mobile", "Email", "Where they are"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((person) => (
                  <tr key={person.candidateId} className={person.academy ? "bg-indigo-50/40" : ""}>
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{person.fullName}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {person.academy && <span className="mr-1 rounded-full bg-indigo-100 px-1.5 py-px text-[10px] font-medium text-indigo-700">Academy</span>}
                      {person.inPool && <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">Assessed pool{person.poolSource ? ` · ${POOL_SOURCE_LABELS[person.poolSource as PoolSource].replace("Assessed pool · ", "")}` : ""}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-slate-600">{person.userId ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1">{productNames(person.product).join(", ") || "—"}</td>
                    <td className="px-2 py-1 tabular-nums">{person.yog ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-2 py-1" title={person.college ?? ""}>{person.college ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums">{person.mobile ?? "—"}</td>
                    <td className="max-w-[200px] truncate px-2 py-1" title={person.email ?? ""}>{person.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-slate-600">{!row.stagesRun.length ? (over ? "Not in company sheet" : "Not in company sheet yet") : person.passed.finalShortlist ? "On our final shortlist, not shared" : "In our shortlisting"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

/** Everything about one company drive: details, student funnel, CRM updates, and the went right / wrong summary. */
function CompanyFunnel({ row, canWrite }: { row: BoardRow; canWrite: boolean }) {
  const { entry, drive } = row;
  const fact = (label: string, value: ReactNode) => (
    <div><dt className="text-[11px] text-slate-400">{label}</dt><dd className="text-xs text-slate-800">{value}</dd></div>
  );
  return (
    <div className="grid gap-3">
      <Section title="Job details" action={<Link to={`/job-requests/${row.jobRequestId}`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">Open job <ExternalLink size={11} /></Link>}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
          {fact("Job ID", <span className="font-mono text-[11px]">{row.jobCode}</span>)}
          {fact("Role", row.role)}
          {fact("Product", row.products.join(", ") || "—")}
          {fact("CTC", row.ctcLpa === null ? "—" : `${row.ctcLpa} LPA`)}
          {fact("Openings", `${entry.jobRequest.openings}${entry.expectedOpenings ? ` (CRM expects ${entry.expectedOpenings})` : ""}`)}
          {fact("CRM", row.crmOwner)}
          {fact("Job requested date", dateText(row.requestDate))}
          {fact("Expected start", dateText(entry.expectedStartDate))}
          {fact("Started on", dateText(row.processStart))}
          {fact("Done on", dateText(row.processEnd))}
          {fact("Placement owner", row.psm)}
          {fact("Sheets", <SheetLinks row={row} />)}
        </dl>
        {row.techStack.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">{row.techStack.map((skill) => <span key={skill} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{skill}</span>)}</div>
        )}
        {entry.remarks && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600"><span className="text-slate-400">CRM remarks: </span>{entry.remarks}</p>}
      </Section>
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Student funnel" action={<Link to={`/job-requests/${row.jobRequestId}?tab=pipeline`} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">Students <ExternalLink size={11} /></Link>}>
          {drive?.stages ? <DriveStagesTable stages={drive.stages} row={row} /> : <p className="text-xs text-slate-500">No students on this drive yet.</p>}
        </Section>
        <Section title="CRM updates from the company">
          <CrmLog row={row} canWrite={canWrite} />
        </Section>
      </div>
      <NotWithCompany row={row} />
      <Section title="Summary: what went right and what went wrong">
        <ReviewEditor row={row} canWrite={canWrite} />
      </Section>
    </div>
  );
}
