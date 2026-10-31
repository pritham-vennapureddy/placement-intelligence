import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileSpreadsheet, Link2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../contexts/auth-context";
import { sheetsApi, teamsApi } from "../services/api";
import type { SheetConnection, SheetHeader, SheetTab } from "../types/api";

const sourceTypes = [
  ["COMPANY_PROCESS", "Company interview process"],
  ["STUDENT_APPLICATIONS", "Student applications"],
  ["CANDIDATE_PROFILES", "Candidate profiles"],
  ["ASSESSED_POOL", "Assessed pool"],
] as const;

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
  const [headerRow, setHeaderRow] = useState(1);
  const [stage, setStage] = useState("");
  const [headers, setHeaders] = useState<SheetHeader[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const tabsQuery = useQuery({
    queryKey: ["sheets", connection.id, "tabs"],
    queryFn: () => sheetsApi.listTabs(connection.id),
    enabled: showTabs,
  });
  const headerMutation = useMutation({
    mutationFn: () => sheetsApi.getHeaders(connection.id, Number(selectedTab), headerRow),
    onSuccess: (items) => {
      setHeaders(items.filter(({ header }) => header.length > 0));
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
      setHeaders([]);
      setStage("");
      await queryClient.invalidateQueries({ queryKey: ["sheets"] });
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
            <div><CardTitle>{connection.title}</CardTitle><p className="mt-1 text-xs text-slate-400">{sourceTypes.find(([value]) => value === connection.sourceType)?.[1] ?? connection.sourceType}{connection.team ? ` · ${connection.team.name}` : " · All teams"}</p></div>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">Mapping required</span>
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
                    <p className="text-xs leading-5 text-slate-500">Choose a workbook tab and its header row. Only the selected header row is read for column mapping; candidate records are not imported.</p>
                    <div className="grid gap-3 sm:grid-cols-[1fr_130px_1fr]">
                      <label className="text-xs font-medium text-slate-600">Subsheet
                        <select value={selectedTab} onChange={(event) => { setSelectedTab(event.target.value); setHeaders([]); }} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                          <option value="">Select a tab</option>
                          {tabsQuery.data.map((tab) => <option key={tab.sheetId} value={tab.sheetId}>{tab.title}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">Header row
                        <input type="number" min={1} max={500} value={headerRow} onChange={(event) => setHeaderRow(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                      </label>
                      <label className="text-xs font-medium text-slate-600">Workflow stage
                        <select value={stage} onChange={(event) => setStage(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
                          <option value="">Select a stage</option>
                          {workflowStages.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ").toLowerCase()}</option>)}
                        </select>
                      </label>
                    </div>
                    <Button size="sm" variant="outline" disabled={!selectedTab || headerMutation.isPending} onClick={onLoadHeaders}>
                      {headerMutation.isPending && <LoaderCircle className="animate-spin" size={14} />} Read selected header row
                    </Button>
                    {headers.length > 0 && (
                      <div className="rounded-xl border border-slate-100 p-3">
                        <p className="mb-3 text-xs font-semibold text-slate-700">Map source columns (optional)</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {columnKeys.map((key) => (
                            <label key={key} className="text-[11px] font-medium text-slate-500">{key.replaceAll("_", " ")}
                              <select value={columnMapping[key] ?? ""} onChange={(event) => setColumnMapping((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs">
                                <option value="">Not mapped</option>
                                {headers.map(({ column, header }) => <option key={`${column}-${header}`} value={header}>{header}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                        <Button className="mt-3" size="sm" disabled={!stage || mappingMutation.isPending} onClick={() => mappingMutation.mutate()}>
                          {mappingMutation.isPending && <LoaderCircle className="animate-spin" size={14} />} Save stage mapping
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function SheetsPage() {
  const { user } = useAuth();
  const canConfigure = user?.roles.some((role) => role === "ADMIN" || role === "MANAGER") ?? false;
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<string>("COMPANY_PROCESS");
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sheetsQuery = useQuery({ queryKey: ["sheets"], queryFn: sheetsApi.list });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: teamsApi.list, enabled: user?.roles.includes("ADMIN") ?? false });
  const connectMutation = useMutation({
    mutationFn: sheetsApi.connect,
    onSuccess: async () => {
      setUrl("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["sheets"] });
    },
    onError: (reason) => setError(errorText(reason)),
  });

  const onConnect = () => {
    setError(null);
    connectMutation.mutate({ url, sourceType, ...(teamId ? { teamId } : {}) });
  };

  return (
    <div className="space-y-5">
      {canConfigure && <Card><CardContent className="p-5 md:p-6">
        <CardHeader className="mb-5">
          <div><CardTitle>Connect a Google workbook</CardTitle><p className="mt-1 text-xs text-slate-400">Add a source, then manually select the tabs and stages it should represent.</p></div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Link2 size={18} /></span>
        </CardHeader>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_200px_auto]">
          <input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" />
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            {sourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {user?.roles.includes("ADMIN") && <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">All teams</option>{(teamsQuery.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}
          <Button disabled={!url || connectMutation.isPending} onClick={onConnect}>{connectMutation.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <Link2 size={15} />} Connect</Button>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-800"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><span>Share each private workbook with {sheetsQuery.data?.googleServiceAccountEmail ? <strong>{sheetsQuery.data.googleServiceAccountEmail}</strong> : "the service-account email configured on the backend"}. Credentials stay server-side. This setup reads tab names and the header row you select only; it does not import candidate data.</span></div>
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
