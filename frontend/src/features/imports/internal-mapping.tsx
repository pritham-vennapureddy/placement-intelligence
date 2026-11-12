import { useQuery } from "@tanstack/react-query";
import { DECISION_STAGES, SCREENING_SKIP_REASON_LABELS, SCREENING_SKIP_REASONS, STAGE_LABELS, STAGE_OUTCOME_LABELS, STAGE_OUTCOMES, type DecisionStage, type ScreeningSkipReason, type StageOutcome } from "@placement/shared";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { importsApi } from "../../services/workflow-api";
import type { ImportBatch } from "../../types/workflow";
import { cn } from "../../utils/cn";
import {
  ColumnSelect,
  columnOptions,
  Field,
  guessColumn,
  guessColumnByValues,
  SheetPreview,
  SheetSelect,
  unmappedValues,
  useSheetPreview,
  ValueMeaningTable,
  withSuggestions,
} from "./sheet-controls";

const UUID_VALUE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const APPLICATION_FIELDS = [
  { key: "candidateId", label: "Candidate ID", pattern: /user\s*id|candidate\s*id|^uid$/i, hint: "Lets stage tabs that list only candidate IDs find the applicant; identity itself is the mobile number." },
  { key: "fullName", label: "Full name", pattern: /^(full\s*)?name$|candidate name|username/i, required: true, hint: "New candidates need a name; normalized mobile matches existing profiles." },
  { key: "email", label: "Email", pattern: /e-?mail/i },
  { key: "mobile", label: "Mobile (required identity)", pattern: /mobile|phone/i, hint: "Normalized mobile number is the sole identity key and must be unique." },
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
  reason?: string | undefined;
  skipReason?: ScreeningSkipReason | undefined;
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
  selectionBasisColumn?: number | undefined;
}

export interface InternalMappingState {
  applications: { sheet?: string | undefined; headerRow: number; columns: Partial<Record<AppField, number>> };
  profileLookups: {
    sheet: string;
    headerRow: number;
    keyType: MatchBy;
    keyColumn: number;
    columns: Record<string, number>;
  }[];
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
  const manualSheetSelection = batch.sourceType === "GOOGLE_SHEETS";
  const sheetNamed = (pattern: RegExp) => batch.sheets.find((sheet) => pattern.test(sheet.name))?.name;
  const exists = (name?: string) => (name && batch.sheets.some((sheet) => sheet.name === name) ? name : undefined);
  const stage = (key: DecisionStage, code: string): StageConfig => {
    const prior = saved?.stages?.[key];
    if (prior && (prior.mode !== "SHEET" || exists(prior.sheet))) return {
      headerRow: 1,
      valueMap: {},
      ...prior,
      // Stage tabs are matched by mobile or by candidate ID; email is not used.
      matchBy: prior.matchBy === "candidateId" ? "candidateId" : "mobile",
      ...(prior.mode === "SHEET" && prior.matchBy === "email" ? { matchColumn: undefined } : {}),
    };
    const sheet = sheetNamed(new RegExp(`(^|[^a-z])${code}([^a-z]|$)`, "i"));
    return {
      mode: manualSheetSelection || sheet ? "SHEET" : "MANUAL",
      ...(sheet ? { sheet } : {}),
      headerRow: 1,
      matchBy: "mobile",
      valueMap: {},
    };
  };
  // Default product tab: the platform's Applied Users export, else an eligible-students tab.
  // A choice the PSM confirmed on an earlier import is kept whatever the tab is called.
  const defaultProductSheet = sheetNamed(/applied|application/i) ?? sheetNamed(/eligible|product/i);
  const confirmedProducts = Boolean(saved?.productTabConfirmed);
  // The server suggests this batch's TA tab (e.g. "TA" for batch 1, "TA-1" for the next) in
  // batch.mapping; without a suggestion, the first TA-style tab is offered.
  const taSheet = batch.sheets.find((sheet) => /^ta(?:[\s_\-.#]*\(?\d+\)?)?$/i.test(sheet.name.trim()))?.name;
  const savedApplications = saved?.applications && exists(saved.applications.sheet) ? saved.applications : undefined;
  return {
    applications: savedApplications
      ?? { sheet: taSheet ?? sheetNamed(/applied|application/i) ?? (manualSheetSelection ? undefined : batch.sheets[0]?.name), headerRow: 1, columns: {} },
    profileLookups: (saved?.profileLookups ?? []).filter((lookup: { sheet: string; columns?: Record<string, number> }) => Boolean(exists(lookup.sheet)) && lookup.columns?.mobile !== undefined),
    productSource: confirmedProducts
      ? saved?.productsLookup ? "LOOKUP" : saved?.applications?.columns?.product !== undefined ? "COLUMN" : "NONE"
      : defaultProductSheet ? "LOOKUP" : manualSheetSelection ? "NONE" : "COLUMN",
    productsLookup: confirmedProducts && saved?.productsLookup && exists(saved.productsLookup.sheet)
      ? { ...saved.productsLookup, keyType: "mobile", ...(saved.productsLookup.keyType !== "mobile" ? { keyColumn: undefined } : {}) }
      : { sheet: defaultProductSheet, headerRow: 1, keyType: "mobile" },
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
export function toInternalPayload(state: InternalMappingState, automatic = false): { payload?: unknown; missing: string[] } {
  const missing: string[] = [];
  const { applications } = state;
  if (automatic) {
    if (!applications.sheet) missing.push("Choose the applications tab.");
    if (state.productSource === "LOOKUP" && !state.productsLookup.sheet) missing.push("Choose the tab that gives each applicant's product.");
    const stages: Record<string, unknown> = {};
    for (const key of DECISION_STAGES) {
      const stage = state.stages[key];
      if (stage.mode === "SHEET") {
        if (!stage.sheet) missing.push(`${STAGE_LABELS[key].code}: choose the tab to include.`);
        else stages[key] = { mode: "SHEET", sheet: stage.sheet };
      } else {
        stages[key] = { mode: stage.mode, ...(stage.mode === "NOT_CONDUCTED" ? { reason: stage.reason?.trim(), ...(stage.skipReason ? { skipReason: stage.skipReason } : {}) } : {}) };
        if (key === "SCREENING_SHORTLIST" && stage.mode === "NOT_CONDUCTED" && !stage.reason?.trim()) {
          missing.push("Give a reason when screening was not conducted.");
        }
        if (key === "SCREENING_SHORTLIST" && stage.mode === "NOT_CONDUCTED" && !stage.skipReason) {
          missing.push("Choose why screening was not conducted (time constraint, …).");
        }
      }
    }
    return {
      missing,
      payload: missing.length ? undefined : {
        applications: { sheet: applications.sheet },
        productLookupSheet: state.productSource === "LOOKUP" ? state.productsLookup.sheet ?? null : null,
        productTabConfirmed: true,
        stages,
        acceptOtherJobIds: state.acceptOtherJobIds,
        overwriteManualDecisions: state.overwriteManualDecisions,
      },
    };
  }
  if (!applications.sheet) missing.push("Choose the applications tab.");
  if (applications.columns.fullName === undefined) missing.push("Choose the full-name column.");
  if (applications.columns.mobile === undefined) missing.push("Choose the mobile-number column; mobile is the required candidate identity.");
  const columns = { ...applications.columns };
  if (state.productSource !== "COLUMN") delete columns.product;
  const lookup = state.productsLookup;
  if (state.productSource === "LOOKUP" && (!lookup.sheet || lookup.keyColumn === undefined || lookup.productColumn === undefined)) {
    missing.push("Finish the product tab: tab, mobile-number column and product column.");
  }
  const stages: Record<string, unknown> = {};
  for (const key of DECISION_STAGES) {
    const stage = state.stages[key];
    if (stage.mode !== "SHEET") {
      stages[key] = { mode: stage.mode, ...(stage.mode === "NOT_CONDUCTED" ? { reason: stage.reason?.trim(), ...(stage.skipReason ? { skipReason: stage.skipReason } : {}) } : {}) };
      if (key === "SCREENING_SHORTLIST" && stage.mode === "NOT_CONDUCTED" && !stage.reason?.trim()) {
        missing.push("Give a reason when screening was not conducted.");
      }
      if (key === "SCREENING_SHORTLIST" && stage.mode === "NOT_CONDUCTED" && !stage.skipReason) {
        missing.push("Choose why screening was not conducted (time constraint, …).");
      }
      continue;
    }
    if (!stage.sheet || stage.matchColumn === undefined) missing.push(`${STAGE_LABELS[key].code}: choose the tab and the column that identifies the applicant.`);
    stages[key] = key === "FINAL_SHORTLIST"
      ? {
        mode: "SHEET",
        sheet: stage.sheet,
        headerRow: stage.headerRow,
        matchBy: stage.matchBy,
        matchColumn: stage.matchColumn,
        // No Selection_Basis column: the Remarks column is the selection basis.
        ...(stage.selectionBasisColumn ?? stage.remarksColumn) !== undefined ? { selectionBasisColumn: stage.selectionBasisColumn ?? stage.remarksColumn } : {},
        ...(stage.remarksColumn !== undefined ? { remarksColumn: stage.remarksColumn } : {}),
      }
      : { ...stage };
  }
  return {
    missing,
    payload: missing.length ? undefined : {
      applications: { sheet: applications.sheet, headerRow: applications.headerRow, columns },
      ...(state.profileLookups.length > 0 ? { profileLookups: state.profileLookups } : {}),
      ...(state.productSource === "LOOKUP" ? { productsLookup: { ...lookup, keyType: "mobile" as const } } : {}),
      productTabConfirmed: true,
      stages,
      acceptOtherJobIds: state.acceptOtherJobIds,
      overwriteManualDecisions: state.overwriteManualDecisions,
    },
  };
}

function ApplicationsSection({ batch, state, onChange, automatic }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void; automatic: boolean }) {
  const { applications } = state;
  const preview = useSheetPreview(batch.id, applications.sheet);
  const headerRow = preview.data?.headerRow ?? applications.headerRow;
  const options = useMemo(() => columnOptions(preview.data?.rows, headerRow), [preview.data, headerRow]);

  useEffect(() => {
    if (preview.data && applications.headerRow !== preview.data.headerRow) {
      onChange({ ...state, applications: { ...applications, headerRow: preview.data.headerRow } });
    }
  }, [preview.data?.headerRow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guess columns once the header is known and nothing is chosen yet.
  useEffect(() => {
    if (!preview.data) return;
    const guessed: Partial<Record<AppField, number>> = { ...applications.columns };
    let changed = false;
    for (const field of APPLICATION_FIELDS) {
      if (guessed[field.key] !== undefined) continue;
      const alreadyGuessed = Object.values(guessed);
      const byHeader = guessColumn(options, field.pattern, alreadyGuessed);
      const byValues = field.key === "email"
        ? guessColumnByValues(preview.data.rows, headerRow, (value) => /^\S+@\S+\.\S+$/.test(value), alreadyGuessed)
        : field.key === "mobile"
          ? guessColumnByValues(preview.data.rows, headerRow, (value) => {
            const digits = value.replace(/\D/g, "");
            return /^[+\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 13;
          }, alreadyGuessed)
          : undefined;
      const column = byHeader ?? byValues;
      if (column !== undefined) {
        guessed[field.key] = column;
        changed = true;
      }
    }
    if (changed) onChange({ ...state, applications: { ...applications, headerRow, columns: guessed } });
  }, [preview.data, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: AppField, column: number | undefined) => {
    const columns = { ...applications.columns };
    if (column === undefined) delete columns[key];
    else columns[key] = column;
    onChange({ ...state, applications: { ...applications, headerRow, columns } });
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">1 · Total applications (TA)</h2>
        <p className="text-xs text-slate-400">
          {automatic
            ? "The tab listing applicants. Candidate records are matched across tabs by normalized mobile number."
            : "The tab listing everyone who applied, one row per applicant. Map the name and unique mobile number before checking the file."}
        </p>
      </div>
      <Field label="Applications tab">
        <SheetSelect batch={batch} value={applications.sheet} onChange={(sheet) => onChange({ ...state, applications: { sheet, headerRow: 1, columns: {} } })} />
      </Field>
      {batch.sourceType === "GOOGLE_SHEETS" && (
        <SheetPreview rows={preview.data?.rows} isLoading={preview.isPending && Boolean(applications.sheet)} headerRow={headerRow} />
      )}
      {automatic ? (
        <p className="text-xs text-slate-500">Student details and column meanings are detected automatically. Only this tab will be used for applications.</p>
      ) : <div className="grid gap-3 sm:grid-cols-2">
        {APPLICATION_FIELDS.filter((field) => ["candidateId", "fullName", "email", "mobile"].includes(field.key)).map((field) => (
          <Field key={field.key} label={`${field.label}${"required" in field && field.required ? " *" : ""}`} hint={"hint" in field ? field.hint : undefined}>
            <ColumnSelect options={options} value={applications.columns[field.key]} onChange={(column) => set(field.key, column)} />
          </Field>
        ))}
      </div>}
      {!automatic && <details open={batch.sourceType === "GOOGLE_SHEETS"} className="rounded-lg border border-slate-100 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Optional header and applicant details</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <SheetPreview rows={preview.data?.rows} isLoading={preview.isPending && Boolean(applications.sheet)} headerRow={headerRow} />
          </div>
          {APPLICATION_FIELDS.filter((field) => field.key !== "product" || state.productSource === "COLUMN").map((field) => (
            ["candidateId", "fullName", "email", "mobile"].includes(field.key) ? null :
            <Field key={field.key} label={`${field.label}${"required" in field && field.required ? " *" : ""}`} hint={"hint" in field ? field.hint : undefined}>
              <ColumnSelect options={options} value={applications.columns[field.key]} onChange={(column) => set(field.key, column)} />
            </Field>
          ))}
        </div>
      </details>}
    </Card>
  );
}

function ProductsSection({ batch, state, onChange, automatic }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void; automatic: boolean }) {
  const lookup = state.productsLookup;
  const preview = useSheetPreview(batch.id, state.productSource === "LOOKUP" ? lookup.sheet : undefined);
  const headerRow = preview.data?.headerRow ?? lookup.headerRow;
  const options = useMemo(() => columnOptions(preview.data?.rows, headerRow), [preview.data, headerRow]);
  const setLookup = (next: Partial<InternalMappingState["productsLookup"]>) => onChange({
    ...state,
    productsLookup: { ...lookup, ...next, ...(preview.data ? { headerRow: preview.data.headerRow } : {}) },
  });

  useEffect(() => {
    if (preview.data && lookup.headerRow !== preview.data.headerRow) setLookup({ headerRow: preview.data.headerRow });
  }, [preview.data?.headerRow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.productSource !== "LOOKUP" || !preview.data || lookup.keyColumn !== undefined) return;
    const mobileColumn = guessColumn(options, /mobile|phone/i)
      ?? guessColumnByValues(preview.data.rows, headerRow, (value) => {
        const digits = value.replace(/\D/g, "");
        return /^[+\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 13;
      });
    const keyColumn = mobileColumn;
    const productColumn = guessColumn(options, /product/i);
    if (keyColumn !== undefined || productColumn !== undefined) {
      const keyType: MatchBy | undefined = mobileColumn !== undefined ? "mobile" : undefined;
      setLookup({ ...(keyColumn !== undefined ? { keyColumn } : {}), ...(keyType ? { keyType } : {}), ...(productColumn !== undefined ? { productColumn } : {}) });
    }
  }, [preview.data, options, state.productSource]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">2 · Candidate products</h2>
        <p className="text-xs text-slate-400">Which tab tells each applicant's product (Academy, Intensive…)? Choose it here; tab names do not matter.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([["LOOKUP", "A product tab (e.g. Applied Users)"], ["COLUMN", "A product column in the TA tab"], ["NONE", "Not in this file"]] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => onChange({ ...state, productSource: value })}
            className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", state.productSource === value ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
            {label}
          </button>
        ))}
      </div>
      {state.productSource === "LOOKUP" && (
        <div className="space-y-3">
          <Field label="Product tab" hint="Each applicant's product is read from this tab by mobile number. Applicants who are not on it are marked External.">
            <SheetSelect batch={batch} value={lookup.sheet} onChange={(sheet) => setLookup({ sheet, headerRow: 1, keyColumn: undefined, productColumn: undefined })} />
          </Field>
          <SheetPreview rows={preview.data?.rows} isLoading={preview.isPending && Boolean(lookup.sheet)} headerRow={headerRow} />
          {automatic ? (
            <p className="text-xs text-slate-500">The mobile-number and Product columns of this tab are detected from their headers.</p>
          ) : <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Applicant identity" hint="Product rows are matched by normalized mobile number.">
              <div className="flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm">Mobile number</div>
            </Field>
            <Field label="…in column"><ColumnSelect options={options} value={lookup.keyColumn} onChange={(keyColumn) => setLookup({ keyColumn })} optional={false} /></Field>
            <Field label="Product column"><ColumnSelect options={options} value={lookup.productColumn} onChange={(productColumn) => setLookup({ productColumn })} optional={false} /></Field>
          </div>}
        </div>
      )}
    </Card>
  );
}

function StageSection({ batch, stageKey, config, onChange, automatic }: { batch: ImportBatch; stageKey: DecisionStage; config: StageConfig; onChange: (config: StageConfig) => void; automatic: boolean }) {
  const preview = useSheetPreview(batch.id, config.mode === "SHEET" ? config.sheet : undefined);
  const headerRow = preview.data?.headerRow ?? config.headerRow;
  const options = useMemo(() => columnOptions(preview.data?.rows, headerRow), [preview.data, headerRow]);
  const values = useQuery({
    queryKey: ["imports", batch.id, "values", config.sheet, headerRow, config.decisionColumn],
    queryFn: () => importsApi.values(batch.id, config.sheet!, headerRow, [config.decisionColumn!]),
    enabled: config.mode === "SHEET" && Boolean(config.sheet) && config.decisionColumn !== undefined,
  });
  const set = (next: Partial<StageConfig>) => onChange({ ...config, ...next, ...(preview.data ? { headerRow: preview.data.headerRow } : {}) });
  const selectableModes: StageMode[] = batch.sourceType === "GOOGLE_SHEETS"
    ? ["SHEET", ...(stageKey === "SCREENING_SHORTLIST" ? ["NOT_CONDUCTED" as const] : [])]
    : Object.keys(MODE_LABELS) as StageMode[];
  if (!selectableModes.includes(config.mode)) selectableModes.push(config.mode);

  useEffect(() => {
    if (preview.data && config.headerRow !== preview.data.headerRow) set({ headerRow: preview.data.headerRow });
  }, [preview.data?.headerRow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (config.mode !== "SHEET" || !preview.data || config.matchColumn !== undefined) return;
    const mobile = guessColumn(options, /mobile|phone/i)
      ?? guessColumnByValues(preview.data.rows, headerRow, (value) => {
        const digits = value.replace(/\D/g, "");
        return /^[+\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 13;
      });
    // No mobile column: a candidate-ID column, looked up in the TA / student-detail tabs on check.
    const candidateId = mobile === undefined
      ? guessColumnByValues(preview.data.rows, headerRow, (value) => UUID_VALUE.test(value.trim())) ?? guessColumn(options, /candidate\s*id|user\s*id|^uid$|uuid/i)
      : undefined;
    set(mobile !== undefined || candidateId === undefined
      ? { matchBy: "mobile", matchColumn: mobile ?? 0 }
      : { matchBy: "candidateId", matchColumn: candidateId });
  }, [preview.data, options, config.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stageKey !== "FINAL_SHORTLIST" || config.mode !== "SHEET" || !preview.data) return;
    if (config.selectionBasisColumn === undefined) {
      const selectionBasisColumn = guessColumn(options, /selection[ _-]?basis|selection\s*reason|why selected/i);
      if (selectionBasisColumn !== undefined) set({ selectionBasisColumn });
    }
    if (config.remarksColumn === undefined) {
      const remarksColumn = guessColumn(options, /^remarks?$|^comments?$/i);
      if (remarksColumn !== undefined) set({ remarksColumn });
    }
  }, [stageKey, preview.data, options, config.mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <p className="text-xs text-slate-400">
            {batch.sourceType === "GOOGLE_SHEETS"
              ? "Choose the sheet tab containing this stage’s decisions."
              : "Some stages have their own tab, some are a decision column in another tab, and some are not conducted."}
          </p>
        </div>
        <Select value={config.mode} onValueChange={(mode) => set({ mode: mode as StageMode })}>
          <SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {selectableModes.map((mode) => <SelectItem key={mode} value={mode}>{MODE_LABELS[mode]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {config.mode === "NOT_CONDUCTED" && (
        <div className="space-y-2 rounded-lg bg-violet-50 p-3 text-xs text-violet-700">
          <p>This stage will be tracked as not conducted.{stageKey === "SCREENING_SHORTLIST" ? " Profiles go straight to SP; record each student's selection basis in the SP tab." : ""}</p>
          {stageKey === "SCREENING_SHORTLIST" && (
            <Field label="Reason *">
              <Select value={config.skipReason ?? ""} onValueChange={(value) => set({ skipReason: value as ScreeningSkipReason })}>
                <SelectTrigger className="h-9 w-full bg-white"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>{SCREENING_SKIP_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{SCREENING_SKIP_REASON_LABELS[reason]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {stageKey === "SCREENING_SHORTLIST" && (
            <Field label="Details: why was screening skipped, and which signals were used for SP? *">
              <Textarea
                value={config.reason ?? ""}
                onChange={(event) => set({ reason: event.target.value })}
                rows={2}
                maxLength={1000}
                placeholder="Enter the reason"
                className="bg-white"
              />
            </Field>
          )}
        </div>
      )}
      {config.mode === "MANUAL" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Nothing is imported for this stage; select candidates on the job's Internal screening tab.</p>}
      {config.mode === "UNCHANGED" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Existing decisions for this stage stay as they are.</p>}
      {config.mode === "SHEET" && (
        <div className="space-y-3">
          <Field label="Tab"><SheetSelect batch={batch} value={config.sheet} onChange={(sheet) => set({ sheet, headerRow: 1, valueMap: {}, matchColumn: undefined, decisionColumn: undefined })} /></Field>
          {automatic ? (
            <p className="text-xs text-slate-500">{stageKey === "FINAL_SHORTLIST" ? "Mobile, Selection_Basis and Remarks are detected automatically; without a Selection_Basis column, Remarks are used as the selection basis. Listing a candidate in SP marks them selected." : "Mobile identity, shortlist status, and any stage-specific details are detected automatically from this tab."}</p>
          ) : stageKey === "FINAL_SHORTLIST" && (
            <Field label="Selection_Basis column" hint="Optional. Without it, the Remarks column is used as the selection basis. Listing the candidate in SP marks them selected.">
              <ColumnSelect options={options} value={config.selectionBasisColumn} onChange={(selectionBasisColumn) => set({ selectionBasisColumn })} />
              <Field label="Remarks"><ColumnSelect options={options} value={config.remarksColumn} onChange={(remarksColumn) => set({ remarksColumn })} /></Field>
            </Field>
          )}
          {!automatic && <details className="rounded-lg border border-slate-100 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Optional column settings</summary>
            <div className="mt-3 space-y-3">
              <SheetPreview rows={preview.data?.rows} isLoading={preview.isPending && Boolean(config.sheet)} headerRow={headerRow} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Find the applicant by" hint="Mobile number, or candidate ID looked up in the TA / student-detail tabs. Each value is read for what it is, so a mixed column also works.">
                  <Select value={config.matchBy === "candidateId" ? "candidateId" : "mobile"} onValueChange={(matchBy) => set({ matchBy: matchBy as MatchBy })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mobile">Mobile number</SelectItem>
                      <SelectItem value="candidateId">Candidate ID (UUID)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="…in column *"><ColumnSelect options={options} value={config.matchColumn} onChange={(matchColumn) => set({ matchColumn })} optional={false} /></Field>
                {stageKey !== "FINAL_SHORTLIST" && <>
                  <Field label="Decision column" hint="Leave empty if being on this tab means selected."><ColumnSelect options={options} value={config.decisionColumn} onChange={(decisionColumn) => set({ decisionColumn, valueMap: {} })} /></Field>
                  <Field label="Priority (P1–P3)"><ColumnSelect options={options} value={config.priorityColumn} onChange={(priorityColumn) => set({ priorityColumn })} /></Field>
                  <Field label="Technical score"><ColumnSelect options={options} value={config.techScoreColumn} onChange={(techScoreColumn) => set({ techScoreColumn })} /></Field>
                  <Field label="Communication score"><ColumnSelect options={options} value={config.commScoreColumn} onChange={(commScoreColumn) => set({ commScoreColumn })} /></Field>
                  <Field label="Rejection reason"><ColumnSelect options={options} value={config.reasonColumn} onChange={(reasonColumn) => set({ reasonColumn })} /></Field>
                </>}
                {stageKey !== "FINAL_SHORTLIST" && <Field label="Remarks"><ColumnSelect options={options} value={config.remarksColumn} onChange={(remarksColumn) => set({ remarksColumn })} /></Field>}
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
          </details>}
        </div>
      )}
    </Card>
  );
}

export function InternalMappingForm({ batch, state, onChange, automatic = false }: { batch: ImportBatch; state: InternalMappingState; onChange: (state: InternalMappingState) => void; automatic?: boolean }) {
  return (
    <div className="space-y-4">
      <ApplicationsSection batch={batch} state={state} onChange={onChange} automatic={automatic} />
      <ProductsSection batch={batch} state={state} onChange={onChange} automatic={automatic} />
      {DECISION_STAGES.map((key) => (
        <StageSection key={key} batch={batch} stageKey={key} config={state.stages[key]} onChange={(config) => onChange({ ...state, stages: { ...state.stages, [key]: config } })} automatic={automatic} />
      ))}
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">More options</summary>
        <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox checked={state.acceptOtherJobIds} onCheckedChange={(checked) => onChange({ ...state, acceptOtherJobIds: checked === true })} />
          <span>Re-use rows whose Job ID belongs to another job request <span className="block text-xs text-slate-400">For a sheet carried over from an earlier drive of this company.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <Checkbox checked={state.overwriteManualDecisions} onCheckedChange={(checked) => onChange({ ...state, overwriteManualDecisions: checked === true })} />
          <span>Let the sheet replace decisions entered by hand in the dashboard <span className="block text-xs text-slate-400">Off by default: hand-entered decisions are kept and shown as conflicts.</span></span>
        </label>
        </div>
      </details>
    </div>
  );
}

export function useInternalMapping(batch: ImportBatch) {
  return useState<InternalMappingState>(() => initialInternalMapping(batch));
}
