import { useQuery } from "@tanstack/react-query";
import { DECISION_STAGES, STAGE_LABELS, STAGE_OUTCOME_LABELS, STAGE_OUTCOMES, type DecisionStage, type StageOutcome } from "@placement/shared";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { importsApi } from "../../services/workflow-api";
import type { ImportBatch } from "../../types/workflow";
import { cn } from "../../utils/cn";
import {
  ColumnSelect,
  columnOptions,
  Field,
  guessColumn,
  SheetPreview,
  SheetSelect,
  unmappedValues,
  useSheetPreview,
  ValueMeaningTable,
  withSuggestions,
} from "./sheet-controls";

const APPLICATION_FIELDS = [
  { key: "candidateId", label: "Candidate ID", pattern: /user\s*id|candidate\s*id|^uid$/i, hint: "Platform user ID; the most reliable way to recognise a candidate." },
  { key: "fullName", label: "Full name", pattern: /^(full\s*)?name$|candidate name|username/i, required: true },
  { key: "email", label: "Email", pattern: /e-?mail/i },
  { key: "mobile", label: "Mobile", pattern: /mobile|phone/i },
  { key: "product", label: "Product", pattern: /product/i },
  { key: "jobId", label: "Job ID", pattern: /job\s*id/i, hint: "Lets the dashboard notice rows from another drive." },
  { key: "appliedAt", label: "Applied on", pattern: /applied|timestamp|date/i },
  { key: "resumeUrl", label: "Resume link", pattern: /resume/i },
  { key: "gender", label: "Gender", pattern: /gender/i },
  { key: "city", label: "City / district", pattern: /city|district/i },
  { key: "state", label: "State", pattern: /state/i },
  { key: "college", label: "College", pattern: /institute|college|university/i },
  { key: "degree", label: "Degree", pattern: /course|degree/i },
  { key: "department", label: "Department", pattern: /department|branch/i },
  { key: "graduationYear", label: "Graduation year", pattern: /year/i },
  { key: "academicScore", label: "Percentage", pattern: /percent|cgpa/i },
] as const;
type AppField = (typeof APPLICATION_FIELDS)[number]["key"];

type StageMode = "SHEET" | "NOT_CONDUCTED" | "MANUAL" | "UNCHANGED";
type MatchBy = "candidateId" | "email" | "mobile";

export interface StageConfig {
  mode: StageMode;
  sheet?: string | undefined;
  headerRow: number;
  matchBy: MatchBy;
  matchColumn?: number | undefined;
  decisionColumn?: number | undefined;
  valueMap: Record<string, StageOutcome>;
  priorityColumn?: number | undefined;
  techScoreColumn?: number | undefined;
  commScoreColumn?: number | undefined;
  reasonColumn?: number | undefined;
  remarksColumn?: number | undefined;
}

export interface InternalMappingState {
  applications: { sheet?: string | undefined; headerRow: number; columns: Partial<Record<AppField, number>> };
  productSource: "COLUMN" | "LOOKUP" | "NONE";
  productsLookup: { sheet?: string | undefined; headerRow: number; keyType: MatchBy; keyColumn?: number | undefined; productColumn?: number | undefined };
  stages: Record<DecisionStage, StageConfig>;
  acceptOtherJobIds: boolean;
  overwriteManualDecisions: boolean;
}

const MODE_LABELS: Record<StageMode, string> = {
  SHEET: "From a tab",
  NOT_CONDUCTED: "Not conducted",
  MANUAL: "I'll select candidates in the dashboard",
  UNCHANGED: "Leave as it is",
};

/** Starting point: the last approved mapping for this job, else guesses from tab names. */
export function initialInternalMapping(batch: ImportBatch): InternalMappingState {
  const saved = batch.mapping as Record<string, any> | null;
  const sheetNamed = (pattern: RegExp) => batch.sheets.find((sheet) => pattern.test(sheet.name))?.name;
  const exists = (name?: string) => (name && batch.sheets.some((sheet) => sheet.name === name) ? name : undefined);
  const stage = (key: DecisionStage, code: string): StageConfig => {
    const prior = saved?.stages?.[key];
    if (prior && (prior.mode !== "SHEET" || exists(prior.sheet))) return { headerRow: 1, matchBy: "mobile", valueMap: {}, ...prior };
    const sheet = sheetNamed(new RegExp(`^${code}$`, "i"));
    return { mode: sheet ? "SHEET" : "MANUAL", ...(sheet ? { sheet } : {}), headerRow: 1, matchBy: "mobile", valueMap: {} };
  };
  return {
    applications: saved?.applications && exists(saved.applications.sheet)
      ? saved.applications
      : { sheet: sheetNamed(/applied|application|^ta$/i) ?? batch.sheets[0]?.name, headerRow: 1, columns: {} },
    productSource: saved?.productsLookup ? "LOOKUP" : "COLUMN",
    productsLookup: saved?.productsLookup ?? { sheet: sheetNamed(/eligible/i), headerRow: 1, keyType: "candidateId" },
    stages: {
      RESUME_SHORTLIST: stage("RESUME_SHORTLIST", "RS"),
      SCREENING_SHORTLIST: stage("SCREENING_SHORTLIST", "SC"),
      ASSIGNMENT_SHORTLIST: stage("ASSIGNMENT_SHORTLIST", "AS"),
      FINAL_SHORTLIST: stage("FINAL_SHORTLIST", "SP"),
    },
    acceptOtherJobIds: Boolean(saved?.acceptOtherJobIds),
    overwriteManualDecisions: false,
  };
}

/** Converts the UI state into the API's mapping, or returns what is still missing. */
export function toInternalPayload(state: InternalMappingState): { payload?: unknown; missing: string[] } {
  const missing: string[] = [];
  const { applications } = state;
  if (!applications.sheet) missing.push("Choose the applications tab.");
  if (applications.columns.fullName === undefined) missing.push("Choose the full-name column.");
  if (applications.columns.candidateId === undefined && applications.columns.email === undefined && applications.columns.mobile === undefined) {
    missing.push("Choose a Candidate ID, email or mobile column.");
  }
  const columns = { ...applications.columns };
  if (state.productSource !== "COLUMN") delete columns.product;
  const lookup = state.productsLookup;
  if (state.productSource === "LOOKUP" && (!lookup.sheet || lookup.keyColumn === undefined || lookup.productColumn === undefined)) {
    missing.push("Finish the product lookup: tab, matching column and product column.");
  }
  const stages: Record<string, unknown> = {};
  for (const key of DECISION_STAGES) {
    const stage = state.stages[key];
    if (stage.mode !== "SHEET") {
      stages[key] = { mode: stage.mode };
      continue;
    }
    if (!stage.sheet || stage.matchColumn === undefined) missing.push(`${STAGE_LABELS[key].code}: choose the tab and the column that identifies the applicant.`);
    stages[key] = { ...stage };
  }
  return {
    missing,
    payload: missing.length ? undefined : {
      applications: { sheet: applications.sheet, headerRow: applications.headerRow, columns },
      ...(state.productSource === "LOOKUP" ? { productsLookup: lookup } : {}),
      stages,
      acceptOtherJobIds: state.acceptOtherJobIds,
      overwriteManualDecisions: state.overwriteManualDecisions,
    },
  };
}

function ApplicationsSection({ batch, state, onChange }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void }) {
  const { applications } = state;
  const preview = useSheetPreview(batch.id, applications.sheet);
  const options = useMemo(() => columnOptions(preview.data, applications.headerRow), [preview.data, applications.headerRow]);

  // Guess columns once the header is known and nothing is chosen yet.
  useEffect(() => {
    if (!preview.data || Object.keys(applications.columns).length > 0) return;
    const guessed: Partial<Record<AppField, number>> = {};
    for (const field of APPLICATION_FIELDS) {
      const column = guessColumn(options, field.pattern, Object.values(guessed));
      if (column !== undefined) guessed[field.key] = column;
    }
    if (Object.keys(guessed).length) onChange({ ...state, applications: { ...applications, columns: guessed } });
  }, [preview.data, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: AppField, column: number | undefined) => {
    const columns = { ...applications.columns };
    if (column === undefined) delete columns[key];
    else columns[key] = column;
    onChange({ ...state, applications: { ...applications, columns } });
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">1 · Total applications (TA)</h2>
        <p className="text-xs text-slate-400">The tab listing everyone who applied, one row per applicant.</p>
      </div>
      <Field label="Applications tab">
        <SheetSelect batch={batch} value={applications.sheet} onChange={(sheet) => onChange({ ...state, applications: { sheet, headerRow: 1, columns: {} } })} />
      </Field>
      <SheetPreview rows={preview.data} isLoading={preview.isPending && Boolean(applications.sheet)} headerRow={applications.headerRow}
        onHeaderRow={(headerRow) => onChange({ ...state, applications: { ...applications, headerRow, columns: {} } })} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {APPLICATION_FIELDS.filter((field) => field.key !== "product" || state.productSource === "COLUMN").map((field) => (
          <Field key={field.key} label={`${field.label}${"required" in field && field.required ? " *" : ""}`} hint={"hint" in field ? field.hint : undefined}>
            <ColumnSelect options={options} value={applications.columns[field.key]} onChange={(column) => set(field.key, column)} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

function ProductsSection({ batch, state, onChange }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void }) {
  const lookup = state.productsLookup;
  const preview = useSheetPreview(batch.id, state.productSource === "LOOKUP" ? lookup.sheet : undefined);
  const options = useMemo(() => columnOptions(preview.data, lookup.headerRow), [preview.data, lookup.headerRow]);
  const setLookup = (next: Partial<InternalMappingState["productsLookup"]>) => onChange({ ...state, productsLookup: { ...lookup, ...next } });

  useEffect(() => {
    if (state.productSource !== "LOOKUP" || !preview.data || lookup.keyColumn !== undefined) return;
    const keyColumn = guessColumn(options, /user\s*id|candidate\s*id/i) ?? guessColumn(options, /e-?mail/i) ?? guessColumn(options, /mobile|phone/i);
    const productColumn = guessColumn(options, /product/i);
    if (keyColumn !== undefined || productColumn !== undefined) setLookup({ ...(keyColumn !== undefined ? { keyColumn } : {}), ...(productColumn !== undefined ? { productColumn } : {}) });
  }, [preview.data, options, state.productSource]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">2 · Candidate products</h2>
        <p className="text-xs text-slate-400">Applicants come from many products (Academy, Intensive, External…). Where does each candidate's product come from?</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([["COLUMN", "A column in the applications tab"], ["LOOKUP", "Another tab (e.g. Eligible Students)"], ["NONE", "Not in this file"]] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => onChange({ ...state, productSource: value })}
            className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", state.productSource === value ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {label}
          </button>
        ))}
      </div>
      {state.productSource === "LOOKUP" && (
        <div className="space-y-3">
          <Field label="Lookup tab"><SheetSelect batch={batch} value={lookup.sheet} onChange={(sheet) => setLookup({ sheet, headerRow: 1 })} /></Field>
          <SheetPreview rows={preview.data} isLoading={preview.isPending && Boolean(lookup.sheet)} headerRow={lookup.headerRow} onHeaderRow={(headerRow) => setLookup({ headerRow })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Match applicants by">
              <Select value={lookup.keyType} onValueChange={(keyType) => setLookup({ keyType: keyType as MatchBy })}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="candidateId">Candidate ID</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="…in column"><ColumnSelect options={options} value={lookup.keyColumn} onChange={(keyColumn) => setLookup({ keyColumn })} optional={false} /></Field>
            <Field label="Product column"><ColumnSelect options={options} value={lookup.productColumn} onChange={(productColumn) => setLookup({ productColumn })} optional={false} /></Field>
          </div>
        </div>
      )}
    </Card>
  );
}

function StageSection({ batch, stageKey, config, onChange }: { batch: ImportBatch; stageKey: DecisionStage; config: StageConfig; onChange: (config: StageConfig) => void }) {
  const preview = useSheetPreview(batch.id, config.mode === "SHEET" ? config.sheet : undefined);
  const options = useMemo(() => columnOptions(preview.data, config.headerRow), [preview.data, config.headerRow]);
  const values = useQuery({
    queryKey: ["imports", batch.id, "values", config.sheet, config.headerRow, config.decisionColumn],
    queryFn: () => importsApi.values(batch.id, config.sheet!, config.headerRow, [config.decisionColumn!]),
    enabled: config.mode === "SHEET" && Boolean(config.sheet) && config.decisionColumn !== undefined,
  });
  const set = (next: Partial<StageConfig>) => onChange({ ...config, ...next });

  useEffect(() => {
    if (config.mode !== "SHEET" || !preview.data || config.matchColumn !== undefined) return;
    const mobile = guessColumn(options, /mobile|phone/i);
    const email = guessColumn(options, /e-?mail/i);
    const id = guessColumn(options, /user\s*id|candidate\s*id/i);
    const matchBy: MatchBy = id !== undefined ? "candidateId" : mobile !== undefined || email === undefined ? "mobile" : "email";
    set({ matchBy, matchColumn: id ?? mobile ?? email ?? 0 });
  }, [preview.data, options, config.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = withSuggestions(values.data, config.valueMap, (value) => value.suggested.stage);
    if (next !== config.valueMap) set({ valueMap: next });
  }, [values.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const unmapped = unmappedValues(values.data, config.valueMap);
  const { code, label } = STAGE_LABELS[stageKey];
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{code} · {label}</h2>
          <p className="text-xs text-slate-400">Some stages have their own tab, some are a decision column in another tab, and some are not conducted.</p>
        </div>
        <Select value={config.mode} onValueChange={(mode) => set({ mode: mode as StageMode })}>
          <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as StageMode[]).map((mode) => <SelectItem key={mode} value={mode}>{MODE_LABELS[mode]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {config.mode === "NOT_CONDUCTED" && <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">The stage will be marked “Not conducted”.</p>}
      {config.mode === "MANUAL" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Nothing is imported for this stage; select candidates on the job's Internal screening tab.</p>}
      {config.mode === "UNCHANGED" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Existing decisions for this stage stay as they are.</p>}
      {config.mode === "SHEET" && (
        <div className="space-y-3">
          <Field label="Tab"><SheetSelect batch={batch} value={config.sheet} onChange={(sheet) => set({ sheet, headerRow: 1, valueMap: {}, matchColumn: undefined, decisionColumn: undefined })} /></Field>
          <SheetPreview rows={preview.data} isLoading={preview.isPending && Boolean(config.sheet)} headerRow={config.headerRow} onHeaderRow={(headerRow) => set({ headerRow })} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Find the applicant by">
              <Select value={config.matchBy} onValueChange={(matchBy) => set({ matchBy: matchBy as MatchBy })}>
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="candidateId">Candidate ID</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="…in column *"><ColumnSelect options={options} value={config.matchColumn} onChange={(matchColumn) => set({ matchColumn })} optional={false} /></Field>
            <Field label="Decision column" hint="Leave empty if being on this tab means selected.">
              <ColumnSelect options={options} value={config.decisionColumn} onChange={(decisionColumn) => set({ decisionColumn, valueMap: {} })} />
            </Field>
            <Field label="Priority (P1–P3)"><ColumnSelect options={options} value={config.priorityColumn} onChange={(priorityColumn) => set({ priorityColumn })} /></Field>
            <Field label="Technical score"><ColumnSelect options={options} value={config.techScoreColumn} onChange={(techScoreColumn) => set({ techScoreColumn })} /></Field>
            <Field label="Communication score"><ColumnSelect options={options} value={config.commScoreColumn} onChange={(commScoreColumn) => set({ commScoreColumn })} /></Field>
            <Field label="Rejection reason"><ColumnSelect options={options} value={config.reasonColumn} onChange={(reasonColumn) => set({ reasonColumn })} /></Field>
            <Field label="Remarks"><ColumnSelect options={options} value={config.remarksColumn} onChange={(remarksColumn) => set({ remarksColumn })} /></Field>
          </div>
          {config.decisionColumn !== undefined && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">What do the decision values mean?</p>
              <ValueMeaningTable
                values={values.data}
                isLoading={values.isPending}
                mapping={config.valueMap}
                onChange={(valueMap) => set({ valueMap })}
                options={STAGE_OUTCOMES.map((outcome) => ({ value: outcome, label: STAGE_OUTCOME_LABELS[outcome] }))}
                suggest={(value) => value.suggested.stage}
              />
              {unmapped.length > 0 && <p className="text-xs text-rose-600">{unmapped.length} value(s) still need a meaning; rows with them will not be imported.</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function InternalMappingForm({ batch, state, onChange }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void }) {
  return (
    <div className="space-y-4">
      <ApplicationsSection batch={batch} state={state} onChange={onChange} />
      <ProductsSection batch={batch} state={state} onChange={onChange} />
      {DECISION_STAGES.map((key) => (
        <StageSection key={key} batch={batch} stageKey={key} config={state.stages[key]} onChange={(config) => onChange({ ...state, stages: { ...state.stages, [key]: config } })} />
      ))}
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Options</h2>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox checked={state.acceptOtherJobIds} onCheckedChange={(checked) => onChange({ ...state, acceptOtherJobIds: checked === true })} />
          <span>Re-use rows whose Job ID belongs to another job request <span className="block text-xs text-slate-400">For a sheet carried over from an earlier drive of this company.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox checked={state.overwriteManualDecisions} onCheckedChange={(checked) => onChange({ ...state, overwriteManualDecisions: checked === true })} />
          <span>Let the sheet replace decisions entered by hand in the dashboard <span className="block text-xs text-slate-400">Off by default: hand-entered decisions are kept and shown as conflicts.</span></span>
        </label>
      </Card>
    </div>
  );
}

export function useInternalMapping(batch: ImportBatch) {
  return useState<InternalMappingState>(() => initialInternalMapping(batch));
}
