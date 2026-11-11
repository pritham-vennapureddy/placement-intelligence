import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { columnLetter } from "@placement/shared";
import { format } from "date-fns";
import { LoaderCircle, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { usePermissions } from "../../hooks/use-permissions";
import {
  ApiError,
  assessedPoolApi,
  type AssessedPoolColumn,
  type AssessedPoolLookupResult,
  type AssessedPoolSourcePreview,
  type AssessedPoolWorkbookPreview,
} from "../../services/api";

const FIELD_OPTIONS = [
  ["mobile", "Student mobile number", true],
  ["sourceUserId", "UUID / User ID", false],
  ["bucketTier", "Bucket tier (A / B / C)", false],
  ["tr1Status", "TR1 status", false],
  ["tr2Status", "TR2 status", false],
  ["competencyStatus", "Competency status", false],
  ["competencyLevel", "Competency level (C1 / C2)", false],
  ["spReason", "SP / final shortlist reason", false],
] as const;

type Mapping = Record<string, number>;
type PoolPreview = Pick<AssessedPoolSourcePreview, "sheets" | "spreadsheetTitle">;
const SYNC_TABS = ["Offline Pool Main", "Competency Pool Main"] as const;

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.requestId) {
    return `${error.message} (Request ID: ${error.requestId})`;
  }
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {note && <p className="mt-1 text-[11px] leading-4 text-slate-400">{note}</p>}
    </Card>
  );
}

function Breakdown({ title, rows, emptyText }: { title: string; rows: { label: string; count: number }[]; emptyText: string }) {
  return (
    <Card className="p-5">
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? <p className="mt-3 text-xs text-slate-400">{emptyText}</p> : (
        <div className="mt-3 divide-y divide-slate-100">
          {rows.map(({ label, count }) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="truncate text-slate-600">{label}</span>
              <span className="font-semibold tabular-nums text-slate-800">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function autoMapping(headers: AssessedPoolColumn[]): Mapping {
  const mapping: Mapping = {};
  const match = (pattern: RegExp) => headers.find(({ header }) => pattern.test(header.replace(/[_-]+/g, " ")));
  const looksLikeMobile = ({ sample }: AssessedPoolColumn) => {
    const digits = sample.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13 && /^[+\d\s().-]+$/.test(sample);
  };
  const looksLikeBucket = ({ sample }: AssessedPoolColumn) => /^(?:bucket\s*)?[abc]$/i.test(sample.trim());
  const fields: [string, RegExp][] = [
    ["mobile", /mobile|phone/i],
    ["sourceUserId", /\buuid\b|\buid\b|user id/i],
    ["bucketTier", /^(?:bucket(?: tier)?(?: \(.*\))?|tier(?: \(.*\))?)$/i],
    ["tr1Status", /\btr\s*1\b.*status|tr1 status/i],
    ["tr2Status", /\btr\s*2\b.*status|tr2 status/i],
    ["competencyStatus", /competenc.*status/i],
    ["competencyLevel", /competenc(?!.*status)(?:.*(?:level|tier|class|group|category))?/i],
    ["spReason", /\bsp\b.*reason|final.*shortlist.*reason/i],
  ];
  for (const [field, pattern] of fields) {
    const column = match(pattern)
      ?? (field === "mobile" ? headers.find(looksLikeMobile) : undefined)
      ?? (field === "bucketTier" ? headers.find(looksLikeBucket) : undefined);
    if (column) mapping[field] = column.column;
  }
  return mapping;
}

function displayFieldName(value: string): string {
  return FIELD_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
}

function LookupResult({ result }: { result: AssessedPoolLookupResult }) {
  const sourceSheets = Object.entries(result.sourceData ?? {});
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{result.name || "Name not provided"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {result.userId ? `UUID / User ID: ${result.userId}` : "No UUID / User ID"}
            {result.mobile ? ` · Mobile: ${result.mobile}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          Assessed
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>Process: {result.processType === "NEW" ? "New" : result.processType === "OLD" ? "Old" : "Unknown"}</span>
        <span>Category: Academy</span>
        {result.bucketTier && <span>Bucket: {result.bucketTier}</span>}
        {result.tr1Status && <span>TR1: {result.tr1Status}</span>}
        {result.tr2Status && <span>TR2: {result.tr2Status}</span>}
        <span>Competency pool: {result.isCompetencyPoolMember ? "Yes" : "No"}</span>
        {result.competencyLevel && <span>Competency level: {result.competencyLevel}</span>}
        {result.competencyStatus && <span>Competency status: {result.competencyStatus}</span>}
        {result.spReason && <span>SP reason: {result.spReason}</span>}
      </div>
      {sourceSheets.length > 0 && (
        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-indigo-700">View all imported sheet details</summary>
          <div className="mt-3 space-y-4">
            {sourceSheets.map(([sheetName, data]) => (
              <section key={sheetName}>
                <h4 className="mb-2 text-xs font-semibold text-slate-700">{sheetName}</h4>
                {(data.rows ?? [data]).map((row, rowIndex) => (
                  <div key={`${sheetName}-${row.rowNumber ?? rowIndex}`} className="mb-3">
                    {data.rows && <p className="mb-2 text-[10px] font-medium text-slate-400">Source row {row.rowNumber}</p>}
                    {row.competencies && row.competencies.length > 0 && (
                      <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {row.competencies.map((assessment) => (
                          <div key={assessment.code} className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5">
                            <p className="text-[10px] font-semibold text-indigo-800">{assessment.code} · {assessment.title}</p>
                            <p className="mt-1 text-[11px] text-slate-600">
                              Score: {assessment.score === null ? "—" : `${assessment.score}/100`}
                              {" · "}Verdict: {assessment.verdictBand || "—"}
                            </p>
                            <p className="text-[11px] text-slate-600">
                              Clearance: {assessment.clearanceStatus || "—"} · Level: {assessment.level || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {(row.columns ?? []).map((column) => {
                        let link: string | null = null;
                        if (column.link) {
                          try {
                            const parsed = new URL(column.link);
                            if (parsed.protocol === "https:") link = parsed.href;
                          } catch {
                            link = null;
                          }
                        }
                        return (
                          <div key={`${sheetName}-${rowIndex}-${column.column}`} className="min-w-0 rounded-lg bg-slate-50 p-2.5">
                            <p className="truncate text-[10px] font-medium text-slate-400">{column.header || `Column ${column.column}`}</p>
                            {link ? (
                              <a className="mt-1 block truncate text-xs text-indigo-700 underline" href={link} target="_blank" rel="noreferrer">
                                {column.value || "Open link"}
                              </a>
                            ) : (
                              <p className="mt-1 break-words text-xs text-slate-700">{column.value || "—"}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function MappingFields({ columns, mapping, onChange }: { columns: AssessedPoolColumn[]; mapping: Mapping; onChange: (next: Mapping) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {FIELD_OPTIONS.map(([key, label, required]) => (
        <label key={key} className="text-xs font-medium text-slate-600">
          {label}{required && <span className="text-rose-500"> *</span>}
          <select
            value={mapping[key] === undefined ? "" : String(mapping[key])}
            onChange={(event) => {
              const next = { ...mapping };
              if (event.target.value === "") delete next[key];
              else next[key] = Number(event.target.value);
              onChange(next);
            }}
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"
          >
            <option value="">Not mapped</option>
            {columns.map(({ column, header, sample }) => (
              <option key={column} value={column}>
                {columnLetter(column)} · {header || (sample ? `Example: ${sample.slice(0, 32)}` : "No header")}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function SheetSourceCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PoolPreview | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const source = useQuery({ queryKey: ["assessed-pool", "source"], queryFn: assessedPoolApi.getSource });

  const invalidatePool = async () => {
    await queryClient.invalidateQueries({ queryKey: ["assessed-pool"] });
  };
  const reportImport = (result: { importedCount: number; updatedCount: number; skippedCount: number; skippedMissingMobile: number; skippedInvalidMobile: number; mergedDuplicateMobile: number }) => {
    toast.success(`Assessed pool updated: ${result.importedCount} added, ${result.updatedCount} merged by mobile within this pool.`);
    if (result.mergedDuplicateMobile > 0) {
      toast.info(`${result.mergedDuplicateMobile} duplicate-mobile source rows were merged; none were discarded.`);
    }
    if (result.skippedCount > 0) {
      toast.warning(`${result.skippedCount} rows skipped: ${result.skippedMissingMobile} missing and ${result.skippedInvalidMobile} invalid mobile numbers.`);
    }
  };

  const readMutation = useMutation({
    mutationFn: () => assessedPoolApi.previewSource(url.trim()),
    onSuccess: (result) => {
      setPreview(result);
    },
  });
  const connectMutation = useMutation({
    mutationFn: () => {
      const available = new Set(preview?.sheets.map(({ name }) => name) ?? []);
      const missing = SYNC_TABS.filter((title) => !available.has(title));
      if (missing.length > 0) throw new Error(`The spreadsheet is missing required tabs: ${missing.join(", ")}.`);
      return assessedPoolApi.connectSource(url.trim());
    },
    onSuccess: async (result) => {
      reportImport(result.import);
      setUrl("");
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["assessed-pool", "source"] });
      await invalidatePool();
    },
  });
  const syncMutation = useMutation({
    mutationFn: () => assessedPoolApi.syncSource(),
    onSuccess: async (result) => {
      reportImport(result.import);
      await queryClient.invalidateQueries({ queryKey: ["assessed-pool", "source"] });
      await invalidatePool();
    },
    onError: (reason) => toast.error(errorText(reason)),
  });

  const connected = source.data;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <CardTitle>Google Sheet source</CardTitle>
        <p className="mt-1 text-xs leading-5 text-slate-500">
        Syncs “Offline Pool Main” and “Competency Pool Main” as a standalone Academy pool. Rows are merged only between these assessed-pool tabs by normalized mobile; no candidate profiles or other sheets are queried or updated. Every source value and link is retained.
        </p>
      </div>

      {source.isPending && <div className="h-16 animate-pulse rounded-xl bg-slate-100" />}
      {source.isError && <p role="alert" className="text-xs text-rose-600">{errorText(source.error)}</p>}

      {connected && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <p><span className="text-slate-400">Spreadsheet:</span> {connected.spreadsheetTitle}</p>
            <p><span className="text-slate-400">Tabs:</span> {connected.sheetTitles.join(", ")}</p>
            <p><span className="text-slate-400">Last synced:</span> {connected.lastSyncedAt ? format(new Date(connected.lastSyncedAt), "d MMM yyyy, h:mm a") : "Never"}</p>
            <p><span className="text-slate-400">Saved fields:</span> All source columns and links</p>
          </div>
          <a href={connected.spreadsheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline">
            <Link2 size={13} /> Open the Google Sheet
          </a>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
                {syncMutation.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <RefreshCw size={14} />} Sync now
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDisconnect(true)}>Disconnect sheet</Button>
            </div>
          )}
        </div>
      )}

      {!connected && canManage && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1 text-xs font-medium text-slate-600">
              Google Sheets link
              <input
                type="url"
                value={url}
                onChange={(event) => { setUrl(event.target.value); setPreview(null); }}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            <Button variant="outline" disabled={!url.trim() || readMutation.isPending} onClick={() => readMutation.mutate()}>
              {readMutation.isPending ? "Reading sheet…" : "Read sheet"}
            </Button>
          </div>
          {readMutation.error && <p role="alert" className="text-xs text-rose-600">{errorText(readMutation.error)}</p>}

          {preview && (
            <div className="space-y-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-700">Tabs in {preview.spreadsheetTitle}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SYNC_TABS.map((title) => {
                  const tab = preview.sheets.find((item) => item.name === title);
                  return (
                    <div key={title} className={`rounded-lg border p-3 text-xs ${tab ? "border-emerald-200 bg-emerald-50/50 text-slate-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                      <p className="font-semibold">{title}</p>
                      <p className="mt-1">{tab ? `${tab.rowCount.toLocaleString()} rows · mobile column detected automatically` : "Required tab not found"}</p>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-slate-400">Sync is manual. Use “Sync now” after updating the Google Sheet.</p>
                <Button disabled={SYNC_TABS.some((title) => !preview.sheets.some((item) => item.name === title)) || connectMutation.isPending} onClick={() => connectMutation.mutate()}>
                  {connectMutation.isPending ? "Saving and syncing…" : "Save link and sync"}
                </Button>
              </div>
              {connectMutation.error && <p role="alert" className="text-xs text-rose-600">{errorText(connectMutation.error)}</p>}
            </div>
          )}
        </div>
      )}

      {!connected && !canManage && !source.isPending && (
        <p className="text-xs text-slate-400">No Google Sheet is connected for the assessed pool yet.</p>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect this sheet?"
        description="The saved link and column mapping are removed. Assessed-pool records already synced stay until you delete them. You can connect the sheet again at any time."
        confirmLabel="Disconnect"
        destructive
        onConfirm={async () => {
          await assessedPoolApi.disconnectSource();
          await queryClient.invalidateQueries({ queryKey: ["assessed-pool", "source"] });
          toast.success("Google Sheet disconnected.");
        }}
      />
    </Card>
  );
}

export function AssessedPoolPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canImport = can("import:run");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AssessedPoolWorkbookPreview | null>(null);
  const [sheet, setSheet] = useState("");
  const [columnsReady, setColumnsReady] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({});
  const [confirmDeleteUpload, setConfirmDeleteUpload] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [lookupText, setLookupText] = useState("");
  const analytics = useQuery({ queryKey: ["assessed-pool", "analytics"], queryFn: assessedPoolApi.analytics });
  const lookupSearch = lookupText.trim();
  const lookup = useQuery({
    queryKey: ["assessed-pool", "lookup", lookupSearch],
    queryFn: () => assessedPoolApi.lookup(lookupSearch),
    enabled: lookupSearch.length >= 2,
  });

  const previewMutation = useMutation({
    mutationFn: ({ selectedSheet }: { selectedSheet?: string }) =>
      assessedPoolApi.preview(file!, selectedSheet),
    onSuccess: (result) => {
      setPreview(result);
      setSheet(result.selectedSheet ?? "");
      setColumnsReady(true);
      setMapping(autoMapping(result.headers));
    },
  });
  const importMutation = useMutation({
    mutationFn: () => {
      if (!file || !sheet || mapping.mobile === undefined) throw new Error("Choose a worksheet and map its mobile number column.");
      return assessedPoolApi.importFile(file, sheet, mapping);
    },
    onSuccess: async (result) => {
      toast.success(`Assessed pool updated: ${result.importedCount} added, ${result.updatedCount} merged by mobile within this pool.`);
      if (result.skippedCount > 0) toast.warning(`${result.skippedCount} rows skipped because mobile numbers were missing, invalid, or duplicated in the source tab.`);
      setFile(null);
      setPreview(null);
      setSheet("");
      setColumnsReady(false);
      setMapping({});
      await queryClient.invalidateQueries({ queryKey: ["assessed-pool"] });
    },
  });

  const invalidatePool = async () => {
    await queryClient.invalidateQueries({ queryKey: ["assessed-pool"] });
  };

  const loadColumns = () => {
    if (!file) return;
    previewMutation.mutate({ ...(sheet ? { selectedSheet: sheet } : {}) });
  };
  const columns = columnsReady ? preview?.headers ?? [] : [];
  const availableFields = analytics.data?.availableFields;
  const latestImport = analytics.data?.latestImport;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Placements"
        title="Assessed pool"
        description="Connect the assessment-pool Google Sheet, or upload a file, and review Academy candidates, process type, buckets, TR, Competency, and SP details."
      />

      <Card className="space-y-4 p-5">
        <div>
          <CardTitle>Find a candidate</CardTitle>
          <p className="mt-1 text-xs text-slate-500">Search this standalone Academy pool by UUID, name, or mobile number and view imported sheet details.</p>
        </div>
        <input
          type="search"
          value={lookupText}
          onChange={(event) => setLookupText(event.target.value)}
          placeholder="Enter UUID / User ID, name, or mobile number"
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          aria-label="Search the assessed-pool data by UUID, name, or mobile number"
        />
        {lookupSearch.length < 2 && <p className="text-xs text-slate-400">Enter at least 2 characters to search.</p>}
        {lookup.isFetching && <p className="text-xs text-slate-500">Searching assessed-pool data…</p>}
        {lookup.isError && <p role="alert" className="text-xs text-rose-600">Could not search assessed-pool data: {errorText(lookup.error)}</p>}
        {lookup.data && lookup.data.results.length === 0 && <p className="text-xs text-slate-500">No record in the assessed-pool data matches this search.</p>}
        {lookup.data && lookup.data.results.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">{lookup.data.results.length} matching result{lookup.data.results.length === 1 ? "" : "s"} (up to {lookup.data.limit}).</p>
            {lookup.data.results.map((result) => <LookupResult key={`${result.status}-${result.id}`} result={result} />)}
          </div>
        )}
      </Card>

      {canImport && <SheetSourceCard canManage={canImport} />}

      {canImport && (
        <details className="group rounded-2xl border border-slate-200 bg-white p-5">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Upload a file instead</summary>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs leading-5 text-slate-500">
                Upload an .xlsx or .csv file. Rows merge only with assessed-pool data by normalized mobile; no other spreadsheet or candidate data is consulted. New rows are added and matching assessed-pool rows are updated. Rows with missing, invalid, or duplicate numbers are skipped.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-60 flex-1 text-xs font-medium text-slate-600">
                Assessed-pool file
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-indigo-700"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setSheet("");
                    setColumnsReady(false);
                    setMapping({});
                  }}
                />
              </label>
              <Button
                variant="outline"
                disabled={!file || previewMutation.isPending}
                onClick={() => previewMutation.mutate({})}
              >
                {previewMutation.isPending ? "Reading workbook…" : "Read workbook"}
              </Button>
            </div>

            {previewMutation.error && <p role="alert" className="text-xs text-rose-600">{previewMutation.error.message}</p>}
            {preview && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label className="text-xs font-medium text-slate-600">
                    Worksheet
                    <select
                      value={sheet}
                      onChange={(event) => { setSheet(event.target.value); setColumnsReady(false); setMapping({}); }}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                    >
                      {preview.sheets.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.rowCount} rows)</option>)}
                    </select>
                  </label>
                  <Button className="self-end" variant="outline" disabled={!sheet || previewMutation.isPending} onClick={loadColumns}>
                    Analyze worksheet
                  </Button>
                </div>

                {columns.length > 0 && (
                  <>
                    <p className="text-xs text-slate-500">
                      {preview.headerRow > 0
                        ? `Header automatically detected in row ${preview.headerRow}.`
                        : "No header detected; all rows will be analyzed as data."}
                    </p>
                    <MappingFields columns={columns} mapping={mapping} onChange={setMapping} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] text-slate-400">All student details are stored within the standalone assessed-pool dataset.</p>
                      <Button disabled={mapping.mobile === undefined || importMutation.isPending} onClick={() => importMutation.mutate()}>
                        {importMutation.isPending ? "Updating pool…" : "Upload and merge pool"}
                      </Button>
                    </div>
                  </>
                )}
                {importMutation.error && <p role="alert" className="text-xs text-rose-600">{importMutation.error.message}</p>}
              </div>
            )}
          </div>
        </details>
      )}

      {analytics.isPending && <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />}
      {analytics.isError && <Card className="p-4 text-sm text-rose-700">Could not load assessed-pool analytics: {analytics.error.message}</Card>}
      {analytics.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Assessed-pool records" value={analytics.data.total.toLocaleString()} note="Unique normalized mobile numbers" />
            <StatCard label="Academy candidates" value={analytics.data.academyCandidates.toLocaleString()} note="All assessed-pool candidates are classified as Academy" />
            <StatCard label="Competency pool members" value={analytics.data.competency.included.toLocaleString()} note="Consolidated from Competency Pool Main and positive status values" />
            <StatCard label="Old process" value={analytics.data.processTypes.OLD.toLocaleString()} note="Old Process tab is excluded from this Google Sheet sync" />
            <StatCard label="New process" value={analytics.data.processTypes.NEW.toLocaleString()} note="Offline Pool Main" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Bucket A" value={availableFields?.bucketTier ? analytics.data.buckets.A : "—"} note={availableFields?.bucketTier ? `${analytics.data.buckets.other} other bucket labels` : "Map a bucket-tier column to enable"} />
            <StatCard label="Bucket B" value={availableFields?.bucketTier ? analytics.data.buckets.B : "—"} />
            <StatCard label="Bucket C" value={availableFields?.bucketTier ? analytics.data.buckets.C : "—"} />
            <StatCard label="TR1 cleared" value={availableFields?.tr1Status ? analytics.data.tr.tr1Cleared : "—"} note="Only exact Clear/Cleared values count" />
            <StatCard label="TR2 cleared" value={availableFields?.tr2Status ? analytics.data.tr.tr2Cleared : "—"} note="Only exact Clear/Cleared values count" />
            <StatCard label="Cleared both TR rounds" value={availableFields?.tr1Status && availableFields.tr2Status ? analytics.data.tr.bothCleared : "—"} />
            <StatCard label="Process unknown" value={analytics.data.processTypes.UNKNOWN.toLocaleString()} note="Process tab was not classified" />
          </div>

          <Card className="p-5">
            <CardTitle>C1–C7 competency analytics</CardTitle>
            <p className="mt-1 text-xs text-slate-500">Each candidate is counted once per competency; scores outside 0–100 are excluded.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {analytics.data.competencies.map((assessment) => {
                const formatCounts = (values: { value: string; count: number }[]) =>
                  values.map(({ value, count }) => `${value} (${count})`).join(", ") || "—";
                return (
                  <section key={assessment.code} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{assessment.code} · {assessment.title}</p>
                      <p className="text-xs text-slate-500">
                        Avg. {assessment.averageScore === null ? "—" : `${assessment.averageScore}/100`}
                        {" · "}{assessment.scoredCount} scored
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">Verdict: {formatCounts(assessment.verdictCounts)}</p>
                    <p className="mt-1 text-xs text-slate-600">Clearance: {formatCounts(assessment.clearanceCounts)}</p>
                    <p className="mt-1 text-xs text-slate-600">Levels: {formatCounts(assessment.levelCounts)}</p>
                  </section>
                );
              })}
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Breakdown
              title="TR1 status values"
              rows={analytics.data.tr.tr1StatusCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="Map a TR1 Status column to show its values."
            />
            <Breakdown
              title="TR2 status values"
              rows={analytics.data.tr.tr2StatusCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="Map a TR2 Status column to show its values."
            />
            <Breakdown
              title="Competency status values"
              rows={analytics.data.competency.statusCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="Map a Competency status column to show its values."
            />
            <Breakdown
              title="Competency levels"
              rows={analytics.data.competency.levelCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="No C1/C2 competency levels found. Map the competency level column when uploading a file."
            />
            <Breakdown
              title="SP / final shortlist reasons"
              rows={analytics.data.spReasons.map(({ value, count }) => ({ label: value, count }))}
              emptyText={analytics.data.availableFields.spReason
                ? "No SP reason values were provided."
                : "No SP/final-shortlist reason column exists in the connected tabs. The available check fields are shown below."}
            />
            <Breakdown
              title="Role rank checks"
              rows={analytics.data.spChecks.roleRankCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="No Role Rank Checks values were found in the source."
            />
            <Breakdown
              title="Final pool checks"
              rows={analytics.data.spChecks.finalPoolCounts.map(({ value, count }) => ({ label: value, count }))}
              emptyText="No Final Pool Checks values were found in the source."
            />
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle>Latest assessed-pool import</CardTitle>
              {canImport && latestImport && (
                <Button size="sm" variant="outline" onClick={() => setConfirmDeleteUpload(true)}>
                  <Trash2 size={14} /> Delete this import
                </Button>
              )}
            </div>
            {latestImport ? (
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                <p><span className="text-slate-400">Source:</span> {latestImport.sourceFileName}</p>
                <p><span className="text-slate-400">Worksheet:</span> {latestImport.sourceSheet}</p>
                <p><span className="text-slate-400">Added / updated / skipped:</span> {latestImport.importedCount} / {latestImport.updatedCount} / {latestImport.skippedCount}</p>
                <p><span className="text-slate-400">Imported by:</span> {latestImport.importedBy}</p>
                <p className="sm:col-span-2"><span className="text-slate-400">Mapped:</span> {latestImport.mappedFields.map(displayFieldName).join(", ") || "No fields"}</p>
                <p><span className="text-slate-400">Date:</span> {format(new Date(latestImport.createdAt), "d MMM yyyy, h:mm a")}</p>
              </div>
            ) : <p className="mt-2 text-xs text-slate-400">No assessed-pool data has been imported yet.</p>}
          </Card>

          {canImport && (
            <Card className="flex flex-wrap items-center justify-between gap-3 border-rose-100 p-5">
              <div>
                <CardTitle>Clear assessed-pool data</CardTitle>
                <p className="mt-1 text-xs text-slate-500">Removes the assessed-pool records and import history only. The saved Google Sheet connection and unrelated data are kept.</p>
              </div>
              <Button variant="destructive" size="sm" disabled={analytics.data.total === 0} onClick={() => setConfirmClear(true)}>
                <Trash2 size={14} /> Clear all data
              </Button>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDeleteUpload}
        onOpenChange={setConfirmDeleteUpload}
        title="Delete this import?"
        description="Removes the records this import last wrote (rows it added or matched) and its history entry. Records that a later sync or upload changed are not affected."
        confirmLabel="Delete import"
        destructive
        onConfirm={async () => {
          if (!latestImport) return;
          const result = await assessedPoolApi.deleteImport(latestImport.id);
          toast.success(`Deleted the import and ${result.removedRecords} records.`);
          await invalidatePool();
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all assessed-pool data?"
        description={`This removes all ${analytics.data?.total.toLocaleString() ?? ""} assessed-pool records and their import history. This cannot be undone.`}
        confirmLabel="Clear all data"
        destructive
        onConfirm={async () => {
          const result = await assessedPoolApi.clearAll();
          toast.success(`Cleared ${result.removedRecords} records.`);
          await invalidatePool();
        }}
      />
    </div>
  );
}
