import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  nextMonthKey,
  POTENTIAL_COMPANY_STATUS_LABELS,
  POTENTIAL_COMPANY_STATUSES,
  type PotentialCompanyStatus,
} from "@placement/shared";
import { addMonths, format } from "date-fns";
import { ArrowRightLeft, Building2, ChevronLeft, ChevronRight, Download, History, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormField } from "../../components/form-field";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { usePermissions } from "../../hooks/use-permissions";
import { catalogApi } from "../../services/api";
import { monthlyPipelineApi } from "../../services/pulse-api";
import { guidanceApi } from "../../services/tracking-api";
import type { GuidanceJobOption } from "../../types/tracking";
import type { PipelineEntry } from "../../types/pulse";
import { cn } from "../../utils/cn";
import { downloadCsv } from "../../utils/csv";
import { MonthBigPictureCard } from "./month-big-picture";
import {
  applyFilters, buildRows, FILTER_COLUMNS, INACTIVE_STATUSES, matchesSearch, PROCESS_STATE_LABELS, summarize,
  type BoardRow, type ColumnFilters, type FilterKey,
} from "./potential-board";
import { ColumnPicker, PotentialGrid, sortRows, useHiddenColumns, type GridSort } from "./potential-grid";
import { OUTCOME_LABELS, StudentFunnelView, type OutcomeView, type StudentGroup } from "./student-funnel-view";

const TABS = ["companies", "students", "unique"] as const;
type Tab = (typeof TABS)[number];

const currentMonth = () => format(new Date(), "yyyy-MM");
const monthText = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMMM yyyy");
const shortMonth = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yy");
const shiftMonth = (month: string, by: number) => format(addMonths(new Date(`${month}-01T00:00:00`), by), "yyyy-MM");
const NONE = "__none__";

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["monthly-pipeline"] });
}

/** Add (by job ID) or edit one job drive on the month's potential list. */
function EntryDialog({ month, entry, open, onOpenChange }: { month: string; entry: PipelineEntry | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh();
  const [jobSearch, setJobSearch] = useState("");
  const [job, setJob] = useState<GuidanceJobOption | null>(null);
  const [status, setStatus] = useState<PotentialCompanyStatus>("POTENTIAL");
  const [note, setNote] = useState("");
  const [openings, setOpenings] = useState("");
  const [startDate, setStartDate] = useState("");
  const [crmOwnerId, setCrmOwnerId] = useState(NONE);
  const [remarks, setRemarks] = useState("");
  useEffect(() => {
    if (!open) return;
    setJobSearch("");
    setJob(null);
    setStatus(entry?.status ?? "POTENTIAL");
    setNote("");
    setOpenings(entry?.expectedOpenings ? String(entry.expectedOpenings) : "");
    setStartDate(entry?.expectedStartDate ?? "");
    setCrmOwnerId(entry?.crmOwner?.id ?? NONE);
    setRemarks(entry?.remarks ?? "");
  }, [open, entry]);

  const search = useDebouncedValue(jobSearch.trim(), 300);
  const jobs = useQuery({ queryKey: ["guidance", "jobs", search], queryFn: () => guidanceApi.searchJobs(search), enabled: open && !entry && !job });
  const owners = useQuery({ queryKey: ["catalog", "owners"], queryFn: catalogApi.owners, enabled: open, staleTime: 300_000 });

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        expectedOpenings: openings ? Number(openings) : null,
        expectedStartDate: startDate || null,
        crmOwnerId: crmOwnerId === NONE ? null : crmOwnerId,
        remarks: remarks.trim() || null,
      };
      if (entry) await monthlyPipelineApi.update(entry.id, { ...fields, status, ...(note.trim() ? { note: note.trim() } : {}) });
      else await monthlyPipelineApi.create({ month, jobRequestId: job!.id, status, ...fields });
    },
    onSuccess: async () => { await refresh(); toast.success(entry ? "Entry updated" : "Added to the list"); onOpenChange(false); },
  });
  const statusChanged = entry && status !== entry.status;

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? entry.company.name : "Add to the potential list"}</DialogTitle>
          <DialogDescription>{monthText(month)} · CRM potential list{entry?.carriedFrom ? ` · carried from ${monthText(entry.carriedFrom.month)}` : ""}</DialogDescription>
        </DialogHeader>
        <form id="entry-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          {entry ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:col-span-2">
              <p className="font-medium text-slate-800">{entry.jobRequest.roleTitle}</p>
              <p className="font-mono text-xs text-slate-500">Job ID {entry.jobRequest.jobId} · {entry.jobRequest.openings} openings</p>
            </div>
          ) : job ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm sm:col-span-2">
              <div>
                <p className="font-medium text-slate-900">{job.company.name} · {job.roleTitle}</p>
                <p className="font-mono text-xs text-slate-500">Job ID {job.jobId}</p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setJob(null)}>Change</Button>
            </div>
          ) : (
            <FormField id="entry-job-search" label="Job ID" required hint="Paste the job ID (or type the company or role) and pick the job request." className="sm:col-span-2">
              <Input id="entry-job-search" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="e.g. 98edf8f6" autoFocus />
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {jobs.isPending ? <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>
                  : (jobs.data ?? []).length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">No job request found. Create the job request first, then add it here.</p>
                    : (jobs.data ?? []).map((option) => (
                      <button key={option.id} type="button" onClick={() => setJob(option)} className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50">
                        <span className="text-sm font-medium text-slate-800">{option.company.name} · {option.roleTitle}</span>
                        <span className="block font-mono text-[11px] text-slate-400">{option.jobId}</span>
                      </button>
                    ))}
              </div>
            </FormField>
          )}
          <FormField id="entry-status" label="Status" required>
            <Select value={status} onValueChange={(value) => setStatus(value as PotentialCompanyStatus)}>
              <SelectTrigger id="entry-status"><SelectValue /></SelectTrigger>
              <SelectContent>{POTENTIAL_COMPANY_STATUSES.map((value) => <SelectItem key={value} value={value}>{POTENTIAL_COMPANY_STATUS_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField id="entry-owner" label="CRM owner">
            <Select value={crmOwnerId} onValueChange={setCrmOwnerId}>
              <SelectTrigger id="entry-owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not set</SelectItem>
                {(owners.data ?? []).map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          {entry && (
            <FormField id="entry-note" label={statusChanged ? "Why the status changed" : "Add an update (optional)"} hint="Saved to the history, so the month shows what moved and why." className="sm:col-span-2">
              <Input id="entry-note" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="e.g. HR confirmed drive dates on call" />
            </FormField>
          )}
          <FormField id="entry-openings" label="Expected openings" hint="Leave blank to use the job's openings.">
            <Input id="entry-openings" type="number" min={1} max={10000} value={openings} onChange={(event) => setOpenings(event.target.value)} />
          </FormField>
          <FormField id="entry-start" label="Expected process start">
            <Input id="entry-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </FormField>
          <FormField id="entry-remarks" label="Remarks" className="sm:col-span-2">
            <Textarea id="entry-remarks" rows={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Where things stand with the company" />
          </FormField>
        </form>
        {entry && entry.history.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><History size={13} /> History</p>
            <ol className="grid max-h-48 gap-2 overflow-y-auto">
              {entry.history.map((item) => (
                <li key={item.id} className="text-xs text-slate-600">
                  <span className="text-slate-400">{format(new Date(item.changedAt), "d MMM, HH:mm")}</span> · {item.changedBy.fullName}:{" "}
                  {item.fromStatus && item.fromStatus !== item.toStatus ? <>{POTENTIAL_COMPANY_STATUS_LABELS[item.fromStatus]} → </> : null}
                  <strong className="font-medium text-slate-800">{POTENTIAL_COMPANY_STATUS_LABELS[item.toStatus]}</strong>
                  {item.note && <> — “{item.note}”</>}
                </li>
              ))}
            </ol>
          </div>
        )}
        {save.error && <p role="alert" className="text-sm text-rose-600">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="entry-form" disabled={save.isPending || (!entry && !job)}>{save.isPending ? "Saving…" : entry ? "Save" : "Add to list"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Scope = "active" | "all" | "inactive";
const FILTER_KEYS = Object.keys(FILTER_COLUMNS) as FilterKey[];

/** Grid filters, sort, search and tab live in the URL, so a filtered view can be shared as a link. */
function useBoardParams() {
  const [params, setParams] = useSearchParams();
  const update = (changes: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) if (value === null || value === "") next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const filters: ColumnFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(`f_${key}`);
    if (value) filters[key] = value.split("|");
  }
  const sortParam = params.get("sort");
  const [sortKey, sortDir] = sortParam?.split(":") ?? [];
  return {
    month: params.get("month") ?? currentMonth(),
    tab: (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "companies") as Tab,
    q: params.get("q") ?? "",
    scope: (["all", "inactive"].includes(params.get("scope") ?? "") ? params.get("scope") : "active") as Scope,
    filters,
    sort: sortKey && (sortDir === "asc" || sortDir === "desc") ? { key: sortKey, dir: sortDir } as GridSort : null,
    group: (["ACADEMY", "POOL", "EXTERNAL"].includes(params.get("group") ?? "") ? params.get("group") : "ALL") as StudentGroup,
    view: (params.get("view") && params.get("view")! in OUTCOME_LABELS ? params.get("view") : "ALL") as OutcomeView,
    /** Jobs chosen in the student funnels (job request ids); none = every job in the grid. */
    jobs: params.get("jobs")?.split("|").filter(Boolean) ?? [],
    update,
    setFilter: (key: FilterKey, values: string[] | undefined) => update({ [`f_${key}`]: values && values.length ? values.join("|") : null }),
    clearAll: () => update({ q: null, ...Object.fromEntries(FILTER_KEYS.map((key) => [`f_${key}`, null])) }),
  };
}

/**
 * The month's potential companies (CRM's list, by job ID) and nothing else:
 * a big picture that follows the grid's filters, an Excel-style grid with one
 * row per job drive, and the Academy / pool students on those drives.
 */
export function MonthlyPipelinePage() {
  const board = useBoardParams();
  const { month, tab, scope, filters, sort } = board;
  const { can } = usePermissions();
  const canWrite = can("pipeline:write");
  const canNote = can("job:read");
  const [hiddenColumns, setHiddenColumns] = useHiddenColumns();
  const refresh = useRefresh();
  const query = useQuery({ queryKey: ["monthly-pipeline", month], queryFn: () => monthlyPipelineApi.month(month), placeholderData: keepPreviousData });
  const data = query.data;

  const [search, setSearch] = useState(board.q);
  useEffect(() => setSearch(board.q), [board.q]);
  const debounced = useDebouncedValue(search.trim(), 200);
  useEffect(() => { if (debounced !== board.q) board.update({ q: debounced || null }); }, [debounced]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PipelineEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<BoardRow | null>(null);
  const [carryOpen, setCarryOpen] = useState(false);

  const allRows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const scopeCount = {
    active: allRows.filter((row) => !INACTIVE_STATUSES.includes(row.crmStatus)).length,
    all: allRows.length,
    inactive: allRows.filter((row) => INACTIVE_STATUSES.includes(row.crmStatus)).length,
  };
  const scopedRows = useMemo(() => allRows.filter((row) =>
    (scope === "all" || (scope === "active" ? !INACTIVE_STATUSES.includes(row.crmStatus) : INACTIVE_STATUSES.includes(row.crmStatus)))
    && matchesSearch(row, board.q)), [allRows, scope, board.q]);
  const rows = useMemo(() => sortRows(applyFilters(scopedRows, filters), sort), [scopedRows, filters, sort]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const uniqueStudents = useMemo(() => new Set(rows.flatMap((row) => row.people.map((person) => person.candidateId))).size, [rows]);
  const applications = useMemo(() => rows.reduce((total, row) => total + row.people.length, 0), [rows]);
  const activeFilters = FILTER_KEYS.filter((key) => filters[key]?.length);
  const filtered = activeFilters.length > 0 || Boolean(board.q);

  const next = nextMonthKey(month);
  const carriable = data ? data.potential.entries.filter((entry) => !entry.carriedTo && !INACTIVE_STATUSES.includes(entry.status)).length : 0;
  const toggleFilter = (key: FilterKey, value: string) => {
    const current = filters[key] ?? [];
    board.setFilter(key, current.length === 1 && current[0] === value ? undefined : [value]);
  };

  const exportGrid = () => downloadCsv(`company-funnel-${month}`, [
    "Company", "Role", "Job ID", "Product", "CTC (LPA)", "Tech stack", "CRM status", "Process stage", "Company stage", "Openings",
    "Academy students", "Academy in process", "Academy completed", "Academy selected",
    "Pool students", "Pool in process", "Pool completed", "Pool selected",
    "CRM", "Placement owner", "Job requested date", "Expected start", "Started on", "Done on", "Company sheet", "Internal sheet",
    "On list since", "On list", "Latest CRM update", "Went right", "Went wrong", "What to change",
  ], rows.map((row) => [
    row.company, row.role, row.jobCode, row.products.join(", "), row.ctcLpa ?? "", row.techStack.join(", "),
    POTENTIAL_COMPANY_STATUS_LABELS[row.crmStatus], PROCESS_STATE_LABELS[row.state], row.phaseLabel, row.openings,
    row.academy.total, row.academy.inProcess, row.academy.completed, row.academy.selected,
    row.pool.total, row.pool.inProcess, row.pool.completed, row.pool.selected,
    row.crmOwner, row.psm, row.requestDate ?? "", row.entry.expectedStartDate ?? "", row.processStart ?? "", row.processEnd ?? "", row.companySheetUrl ?? "", row.internalSheetUrl ?? "",
    row.listedSince, row.origin, row.lastUpdate?.text ?? "", row.review.wentRight ?? "", row.review.wentWrong ?? "", row.review.actionItems ?? "",
  ]));

  const empty = allRows.length === 0 ? (
    <EmptyState icon={Building2} title={`No potential companies for ${monthText(month)} yet`}
      description={<>Add job drives by job ID, or open <Link className="text-indigo-700 underline" to={`/monthly?month=${shiftMonth(month, -1)}`}>{monthText(shiftMonth(month, -1))}</Link> and carry its active companies forward.</>}
      className="py-12" />
  ) : (
    <EmptyState icon={Search} title="No job drives match" description="Change the search or filters." className="py-10" />
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Workspace"
        title="Monthly pipeline · potential companies"
        description="Only the job drives on CRM's potential list for the month. Filter the grid like Excel: the big picture above follows every filter."
        actions={(
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => board.update({ month: shiftMonth(month, -1) })}><ChevronLeft size={16} /></Button>
            <Input type="month" aria-label="Month" className="w-40" value={month} onChange={(event) => event.target.value && board.update({ month: event.target.value })} />
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => board.update({ month: shiftMonth(month, 1) })}><ChevronRight size={16} /></Button>
            {month !== currentMonth() && <Button variant="ghost" size="sm" onClick={() => board.update({ month: null })}>This month</Button>}
          </div>
        )}
      />
      {query.error ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : !data ? <Card><LoadingRows rows={10} /></Card> : (
        <>
          {/* Toolbar: search by job ID, list scope, actions. */}
          <Card className={cn("flex flex-wrap items-center gap-2 p-3", query.isFetching && "opacity-80")}>
            <div className="relative min-w-[260px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search job ID, company, role or owner" className="h-9 pl-9" aria-label="Search job ID, company, role or owner" />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search"><X size={14} /></button>}
            </div>
            <div className="flex rounded-md border border-slate-200 p-0.5" role="group" aria-label="Which companies">
              {([["active", "Active"], ["all", "All on list"], ["inactive", "Dropped / no response"]] as const).map(([value, label]) => (
                <Button key={value} size="sm" variant={scope === value ? "secondary" : "ghost"} className="h-8" aria-pressed={scope === value} onClick={() => board.update({ scope: value === "active" ? null : value })}>
                  {label} <span className="tabular-nums text-slate-500">{scopeCount[value]}</span>
                </Button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {canWrite && (
                <Button size="sm" variant="outline" className="h-9" onClick={() => setCarryOpen(true)} disabled={carriable === 0} title="Copy the still-active companies to next month's list">
                  <ArrowRightLeft size={14} /> Carry to {shortMonth(next)} ({carriable})
                </Button>
              )}
              {canWrite && <Button size="sm" className="h-9" onClick={() => setAdding(true)}><Plus size={14} /> Add by job ID</Button>}
            </div>
          </Card>

          {filtered && (
            <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Filtered by</span>
              {board.q && (
                <button type="button" onClick={() => setSearch("")} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-800 hover:bg-indigo-100">
                  Search: “{board.q}” <X size={12} />
                </button>
              )}
              {activeFilters.map((key) => (
                <button key={key} type="button" onClick={() => board.setFilter(key, undefined)} className="inline-flex max-w-md items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-800 hover:bg-indigo-100" title="Remove this filter">
                  <span className="truncate"><b className="font-medium">{FILTER_COLUMNS[key]?.label ?? key}:</b> {filters[key]!.join(", ")}</span> <X size={12} className="shrink-0" />
                </button>
              ))}
              <button type="button" onClick={() => { setSearch(""); board.clearAll(); }} className="ml-1 font-medium text-rose-600 hover:underline">Clear all</button>
            </div>
          )}

          <MonthBigPictureCard
            summary={summary}
            filtered={filtered}
            totalDrives={scopeCount[scope]}
            actions={{
              onProcess: (state) => toggleFilter("state", PROCESS_STATE_LABELS[state]),
              onCrmStatus: (status) => toggleFilter("crmStatus", POTENTIAL_COMPANY_STATUS_LABELS[status]),
              onStudents: (group, view) => board.update({ tab: "unique", group: group === "ALL" ? null : group, view: view === "ALL" ? null : view, jobs: null }),
              activeProcess: filters.state,
              activeCrmStatus: filters.crmStatus,
            }}
          />

          <Tabs value={tab} onValueChange={(value) => board.update({ tab: value === "companies" ? null : value })}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="companies">Company funnel · {rows.length}</TabsTrigger>
                <TabsTrigger value="students">Student funnel · {applications} applications</TabsTrigger>
                <TabsTrigger value="unique">Unique students · {uniqueStudents}</TabsTrigger>
              </TabsList>
              {tab === "companies" && (
                <div className="flex items-center gap-2">
                  <ColumnPicker hidden={hiddenColumns} onChange={setHiddenColumns} />
                  {rows.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(rows.every((row) => expanded.has(row.id)) ? new Set() : new Set(rows.map((row) => row.id)))}>
                      {rows.every((row) => expanded.has(row.id)) ? "Collapse all" : "Expand all"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={exportGrid}><Download size={14} /> CSV ({rows.length})</Button>
                </div>
              )}
            </div>
            <TabsContent value="companies" className="mt-2">
              <PotentialGrid
                rows={rows}
                scopedRows={scopedRows}
                filters={filters}
                onFilter={board.setFilter}
                sort={sort}
                onSort={(value) => board.update({ sort: value ? `${value.key}:${value.dir}` : null })}
                expanded={expanded}
                onToggle={(id) => setExpanded((current) => { const nextSet = new Set(current); if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id); return nextSet; })}
                canWrite={canWrite}
                canNote={canNote}
                hidden={hiddenColumns}
                onEdit={(row) => setEditing(row.entry)}
                onDelete={setDeleting}
                empty={empty}
              />
              <p className="mt-2 text-xs text-slate-500">
                Click a column header to sort or filter by its values; pick columns with "Columns". Click ▸ on a row for that company's funnel, CRM updates and the went right / wrong summary.
                <b> Completed</b> = shared with the company and the company is done with them (selected ✓, rejected, or the process ended). Totals in the grid add up per drive; the big picture counts each student once.
              </p>
            </TabsContent>
            {(["students", "unique"] as const).map((value) => (
              <TabsContent key={value} value={value} className="mt-2">
                <StudentFunnelView
                  rows={rows}
                  mode={value === "unique" ? "unique" : "applications"}
                  group={board.group}
                  onGroup={(group) => board.update({ group: group === "ALL" ? null : group })}
                  jobs={board.jobs.filter((id) => rows.some((row) => row.jobRequestId === id))}
                  onJobs={(ids) => board.update({ jobs: ids.length ? ids.join("|") : null })}
                  outcome={board.view}
                  onOutcome={(view) => board.update({ view: view === "ALL" ? null : view })}
                />
              </TabsContent>
            ))}
          </Tabs>

          <EntryDialog month={month} entry={editing} open={adding || editing !== null} onOpenChange={(open) => { if (!open) { setAdding(false); setEditing(null); } }} />
          <ConfirmDialog
            open={carryOpen}
            onOpenChange={setCarryOpen}
            title={`Carry ${carriable} job drives to ${monthText(next)}?`}
            description="Every job drive still active this month (not dropped, no response, or already carried) is copied to next month's list with its status, owner and remarks. This month's list stays as it is."
            confirmLabel="Carry forward"
            onConfirm={async () => {
              const result = await monthlyPipelineApi.carryForward(month);
              await refresh();
              toast.success(`${result.carried} carried to ${monthText(result.toMonth)}${result.skipped ? `, ${result.skipped} already there` : ""}`);
              setCarryOpen(false);
            }}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(open) => !open && setDeleting(null)}
            title="Remove from this month's list?"
            description={deleting ? <>Removes <strong>{deleting.company}</strong> ({deleting.jobCode}) from {monthText(month)} only, with its history for this month. To record that the company backed out, set the CRM status to Dropped instead.</> : ""}
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              if (!deleting) return;
              await monthlyPipelineApi.remove(deleting.id);
              await refresh();
              toast.success("Removed from the list");
              setDeleting(null);
            }}
          />
        </>
      )}
    </div>
  );
}
