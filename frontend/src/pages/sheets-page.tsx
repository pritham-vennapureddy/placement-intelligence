import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileSpreadsheet, Link2, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { columnLetter } from "@placement/shared";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { usePermissions } from "../hooks/use-permissions";
import { sheetsApi } from "../services/api";
import type { SheetConnection, SheetHeader, SheetTab } from "../types/api";

const sourceTypes = [
  ["INTERNAL_PROCESS", "Internal process"],
  ["COMPANY_PROCESS", "Company process"],
  ["ASSESSED_POOL", "Assessed pools"],
] as const;

function sourceTypeLabel(sourceType: string): string {
  if (sourceType === "COMPANY_PROCESS") return "Company process";
  if (sourceType === "ASSESSED_POOL") return "Assessed pools";
  return "Internal process";
}

const poolStages = ["BUCKET_POOL", "TR_POOL", "COMPETENCY_POOL"];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

function SheetConnectionCard({
  connection,
  workflowStages,
  columnKeys,
  canConfigure,
}: {
  connection: SheetConnection;
  workflowStages: string[];
  columnKeys: string[];
  canConfigure: boolean;
}) {
  const queryClient = useQueryClient();
  const [showTabs, setShowTabs] = useState(false);
  const [selectedTab, setSelectedTab] = useState("");
  const [headerRow, setHeaderRow] = useState(0);
  const [stage, setStage] = useState("");
  const [headers, setHeaders] = useState<SheetHeader[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableStages = connection.sourceType === "ASSESSED_POOL"
    ? poolStages
    : workflowStages.filter((item) => !poolStages.includes(item));
  const availableColumns = connection.sourceType === "ASSESSED_POOL" ? ["candidate_id"] : columnKeys;
  const savedPoolStages = connection.tabMappings.filter(({ workflowStage }) => poolStages.includes(workflowStage));
  const poolMappingComplete = poolStages.every((stage) => savedPoolStages.some((mapping) => mapping.workflowStage === stage && mapping.columnMapping?.candidate_id));

  const tabsQuery = useQuery({
    queryKey: ["sheets", connection.id, "tabs"],
    queryFn: () => sheetsApi.listTabs(connection.id),
    enabled: showTabs,
  });
  const headerMutation = useMutation({
    mutationFn: () => sheetsApi.getHeaders(connection.id, Number(selectedTab)),
    onSuccess: ({ headerRow: detectedHeaderRow, headers: items }) => {
      setHeaderRow(detectedHeaderRow);
      setHeaders(items);
      setColumnMapping({});
      setError(null);
    },
    onError: (reason) => setError(errorText(reason)),
  });
  const mappingMutation = useMutation({
    mutationFn: async () => {
      const tab = tabsQuery.data?.find(({ sheetId }) => sheetId === Number(selectedTab));
      if (!tab || !stage) throw new Error("Choose a tab and workflow stage first.");
      return sheetsApi.saveMapping({
        connectionId: connection.id,
        workflowStage: stage,
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        headerRow,
        columnMapping,
      });
    },
    onSuccess: async () => {
      setError(null);
      setSyncResult(null);
      setHeaders([]);
      setStage("");
      await queryClient.invalidateQueries({ queryKey: ["sheets"] });
    },
    onError: (reason) => setError(errorText(reason)),
  });
  const poolSyncMutation = useMutation({
    mutationFn: () => sheetsApi.syncAssessedPools(connection.id),
    onSuccess: async ({ counts, matchedCandidates }) => {
      setError(null);
      setSyncResult(`Synced ${counts.BUCKET} Bucket, ${counts.TR} TR, and ${counts.COMPETENCY} Competency pool IDs. ${matchedCandidates} already match candidates in the database.`);
      await queryClient.invalidateQueries({ queryKey: ["sheets"] });
      await queryClient.invalidateQueries({ queryKey: ["screening"] });
    },
    onError: (reason) => setError(errorText(reason)),
  });

  const onLoadHeaders = () => {
    setError(null);
    if (!selectedTab) {
      setError("Choose a tab first.");
      return;
    }
    headerMutation.mutate();
  };

  return (
    <Card>
      <CardContent className="p-5">
        <CardHeader className="mb-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><FileSpreadsheet size={19} /></span>
            <div><CardTitle>{connection.title}</CardTitle><p className="mt-1 text-xs text-slate-400">{sourceTypeLabel(connection.sourceType)}{connection.team ? ` · ${connection.team.name}` : " · All teams"}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">{connection.sourceType === "ASSESSED_POOL" ? "Pool tabs" : "Mapping required"}</span>
            {canConfigure && <Button size="sm" variant="outline" onClick={() => setConfirmRemove(true)}><Trash2 size={14} /> Delete</Button>}
          </div>
        </CardHeader>
        <div className="mb-4 flex flex-wrap gap-2">
          {connection.tabMappings.map((mapping) => <span key={mapping.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"><Check size={11} /> {mapping.workflowStage.replaceAll("_", " ")} → {mapping.sheetTitle}</span>)}
          {connection.tabMappings.length === 0 && <span className="text-xs text-slate-400">No stage tabs have been mapped yet.</span>}
        </div>

        {canConfigure && (
          <div className="border-t border-slate-100 pt-4">
            {!showTabs ? (
              <Button variant="outline" size="sm" onClick={() => setShowTabs(true)}><RefreshCw size={14} /> Load workbook tabs</Button>
            ) : (
              <div className="space-y-3">
                {tabsQuery.isPending && <p className="text-xs text-slate-500">Reading workbook tab names…</p>}
                {tabsQuery.isError && <p role="alert" className="text-xs text-rose-600">{errorText(tabsQuery.error)}</p>}
                {tabsQuery.data && (
                  <>
                    <p className="text-xs leading-5 text-slate-500">Choose a workbook tab and workflow stage. Headers are detected automatically; if none are found, sample data is used to label columns and every row stays available.</p>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                      <label className="text-xs font-medium text-slate-600">Subsheet
                        <select value={selectedTab} onChange={(event) => { setSelectedTab(event.target.value); setHeaders([]); setColumnMapping({}); }} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                          <option value="">Select a tab</option>
                          {tabsQuery.data.map((tab) => <option key={tab.sheetId} value={tab.sheetId}>{tab.title}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">Workflow stage
                        <select value={stage} onChange={(event) => setStage(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                          <option value="">Select a stage</option>
                          {availableStages.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").toLowerCase()}</option>)}
                        </select>
                      </label>
                    </div>
                    <Button size="sm" variant="outline" disabled={!selectedTab || headerMutation.isPending} onClick={onLoadHeaders}>
                      {headerMutation.isPending && <LoaderCircle className="animate-spin" size={14} />} Analyze tab
                    </Button>
                    {headers.length > 0 && (
                      <div className="rounded-xl border border-slate-100 p-3">
                        <p className="mb-3 text-xs font-semibold text-slate-700">
                          {headerRow > 0 ? `Header detected in row ${headerRow}.` : "No header detected; every row is treated as data."} Map source columns (optional)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {availableColumns.map((key) => (
                            <label key={key} className="text-[11px] font-medium text-slate-500">{key.replaceAll("_", " ")}
                              <select value={columnMapping[key] ?? ""} onChange={(event) => {
                                const value = event.target.value;
                                setColumnMapping((current) => {
                                  const next = { ...current };
                                  if (value) next[key] = value;
                                  else delete next[key];
                                  return next;
                                });
                              }} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                                <option value="">Not mapped</option>
                                {headers.map(({ column, header, sample, value }) => (
                                  <option key={column} value={value}>
                                    {columnLetter(column)} · {header || (sample ? `Example: ${sample.slice(0, 32)}` : "No header")}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                        <Button className="mt-3" size="sm" disabled={!stage || mappingMutation.isPending || (connection.sourceType === "ASSESSED_POOL" && !columnMapping.candidate_id)} onClick={() => mappingMutation.mutate()}>
                          {mappingMutation.isPending && <LoaderCircle className="animate-spin" size={14} />} Save stage mapping
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {connection.sourceType === "ASSESSED_POOL" && (
              <div className="mt-3 space-y-2">
                <Button size="sm" disabled={!poolMappingComplete || poolSyncMutation.isPending} onClick={() => poolSyncMutation.mutate()}>
                  {poolSyncMutation.isPending && <LoaderCircle className="animate-spin" size={14} />}
                  Sync Bucket, TR and Competency pools
                </Button>
                {!poolMappingComplete && <p className="text-xs text-slate-500">Map a UID/User ID column for each of the three pool tabs first.</p>}
                {syncResult && <p role="status" className="text-xs text-emerald-700">{syncResult}</p>}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Delete this connection?"
          description="The link, its tab mappings and any pool IDs it synced are removed. Candidate profiles and the Google Sheet itself are not changed."
          confirmLabel="Delete connection"
          destructive
          onConfirm={async () => {
            await sheetsApi.remove(connection.id);
            await queryClient.invalidateQueries({ queryKey: ["sheets"] });
            await queryClient.invalidateQueries({ queryKey: ["assessed-pool"] });
          }}
        />
      </CardContent>
    </Card>
  );
}

export function SheetsPage() {
  const { can } = usePermissions();
  const canConfigure = can("sheet:manage");
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<(typeof sourceTypes)[number][0]>("INTERNAL_PROCESS");
  const [error, setError] = useState<string | null>(null);
  const sheetsQuery = useQuery({ queryKey: ["sheets"], queryFn: sheetsApi.list });
  const connectMutation = useMutation({
    mutationFn: (input: Parameters<typeof sheetsApi.connect>[0]) => sheetsApi.connect(input),
    onSuccess: async () => {
      setUrl("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["sheets"] });
    },
    onError: (reason) => setError(errorText(reason)),
  });

  const onConnect = () => {
    setError(null);
    connectMutation.mutate({ url, sourceType });
  };

  return (
    <div className="space-y-5">
      {canConfigure && <Card><CardContent className="p-5 md:p-6">
        <CardHeader className="mb-5">
          <div><CardTitle>Connect a Google workbook</CardTitle><p className="mt-1 text-xs text-slate-400">Add a source, then manually select the tabs and stages it should represent.</p></div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Link2 size={18} /></span>
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as (typeof sourceTypes)[number][0])} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            {sourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button disabled={!url || connectMutation.isPending} onClick={onConnect}>{connectMutation.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <Link2 size={15} />} Connect</Button>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-800"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span>Share each private workbook with {sheetsQuery.data?.googleServiceAccountEmail ? <strong>{sheetsQuery.data.googleServiceAccountEmail}</strong> : "the service-account email configured on the backend"}. Credentials stay server-side. Tab setup reads a short sample to detect headers and label columns. Assessed-pool sync reads only the mapped UID/User ID columns.</span></div>
      </CardContent></Card>}

      {sheetsQuery.isError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{errorText(sheetsQuery.error)}</p>}
      {sheetsQuery.isPending && <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}
      {sheetsQuery.data && sheetsQuery.data.connections.length === 0 && <Card><CardContent className="p-8 text-center"><FileSpreadsheet className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-700">No workbooks connected yet</p><p className="mt-1 text-xs text-slate-500">{canConfigure ? "Add a Google Sheets URL above to begin the human-reviewed tab setup." : "Ask your team lead to connect the team workbooks."}</p></CardContent></Card>}
      {sheetsQuery.data?.connections.map((connection) => (
        <SheetConnectionCard key={connection.id} connection={connection} workflowStages={sheetsQuery.data.workflowStages} columnKeys={sheetsQuery.data.columnKeys} canConfigure={canConfigure} />
      ))}
    </div>
  );
}
