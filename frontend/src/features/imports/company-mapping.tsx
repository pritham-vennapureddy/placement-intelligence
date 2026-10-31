import { useQueries } from "@tanstack/react-query";
import {
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_OUTCOMES,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUSES,
  ROUND_TYPE_LABELS,
  ROUND_TYPES,
  normalizeValueKey,
  type InterviewOutcome,
  type PipelineStatus,
  type RoundType,
} from "@placement/shared";
import { useEffect, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { importsApi } from "../../services/workflow-api";
import type { ImportBatch, ValueSuggestion } from "../../types/workflow";
import {
  ColumnSelect,
  columnOptions,
  Field,
  guessColumn,
  SheetPreview,
  unmappedValues,
  useSheetPreview,
  ValueMeaningTable,
  withSuggestions,
} from "./sheet-controls";

export interface CompanyTabState {
  sheet: string;
  headerRow: number;
  columns: { fullName?: number | undefined; email?: number | undefined; mobile?: number | undefined };
  rounds: { column: number; roundName: string; roundType: RoundType }[];
  finalStatusColumn?: number | undefined;
  guessed?: boolean;
}

export interface CompanyMappingState {
  tabs: CompanyTabState[];
  roundValueMap: Record<string, InterviewOutcome | "IGNORE">;
  finalValueMap: Record<string, PipelineStatus | "IGNORE">;
  addJobSkills: boolean;
}

const ROUND_PATTERN = /round|screen|^tr\b|^mr\b|^hr\b|assign|interview|technical|manager|client|test/i;
const FINAL_PATTERN = /final|^status$|result|outcome/i;

export function guessRoundType(name: string): RoundType {
  if (/assign/i.test(name)) return "ASSIGNMENT";
  if (/^tr\b|tech/i.test(name)) return "TECHNICAL";
  if (/^mr\b|manag/i.test(name)) return "MANAGERIAL";
  if (/^hr\b|human/i.test(name)) return "HR";
  if (/client/i.test(name)) return "CLIENT";
  if (/screen|resume|shortlist/i.test(name)) return "RESUME_SCREENING";
  return "OTHER";
}

export function initialCompanyMapping(batch: ImportBatch): CompanyMappingState {
  const saved = batch.mapping as (Omit<CompanyMappingState, "tabs"> & { tabs: CompanyTabState[] }) | null;
  if (saved?.tabs?.length) {
    const tabs = saved.tabs.filter((tab) => batch.sheets.some((sheet) => sheet.name === tab.sheet)).map((tab) => ({ ...tab, guessed: true }));
    if (tabs.length) return { tabs, roundValueMap: saved.roundValueMap ?? {}, finalValueMap: saved.finalValueMap ?? {}, addJobSkills: saved.addJobSkills ?? true };
  }
  const withRows = batch.sheets.filter((sheet) => sheet.rowCount > 1);
  return {
    tabs: (withRows.length === 1 ? withRows : []).map((sheet) => ({ sheet: sheet.name, headerRow: 1, columns: {}, rounds: [] })),
    roundValueMap: {},
    finalValueMap: {},
    addJobSkills: true,
  };
}

export function toCompanyPayload(state: CompanyMappingState): { payload?: unknown; missing: string[] } {
  const missing: string[] = [];
  if (state.tabs.length === 0) missing.push("Choose at least one tab that belongs to this job.");
  for (const tab of state.tabs) {
    if (tab.columns.email === undefined && tab.columns.mobile === undefined) missing.push(`${tab.sheet}: choose the email or mobile column.`);
    if (tab.rounds.some((round) => !round.roundName.trim())) missing.push(`${tab.sheet}: give every round a name.`);
  }
  return {
    missing,
    payload: missing.length ? undefined : {
      tabs: state.tabs.map(({ guessed: _guessed, ...tab }) => tab),
      roundValueMap: state.roundValueMap,
      finalValueMap: state.finalValueMap,
      addJobSkills: state.addJobSkills,
    },
  };
}

function TabSection({ batch, tab, onChange }: { batch: ImportBatch; tab: CompanyTabState; onChange: (tab: CompanyTabState) => void }) {
  const preview = useSheetPreview(batch.id, tab.sheet);
  const options = useMemo(() => columnOptions(preview.data, tab.headerRow), [preview.data, tab.headerRow]);

  useEffect(() => {
    if (!preview.data || tab.guessed) return;
    const fullName = guessColumn(options, /name/i);
    const email = guessColumn(options, /e-?mail/i);
    const mobile = guessColumn(options, /mobile|phone/i);
    const finalStatusColumn = guessColumn(options, FINAL_PATTERN);
    const taken = [fullName, email, mobile, finalStatusColumn].filter((value): value is number => value !== undefined);
    const rounds = options
      .filter((option) => ROUND_PATTERN.test(option.header) && !taken.includes(option.index))
      .map((option) => ({ column: option.index, roundName: option.header, roundType: guessRoundType(option.header) }));
    onChange({
      ...tab,
      guessed: true,
      columns: { ...(fullName !== undefined ? { fullName } : {}), ...(email !== undefined ? { email } : {}), ...(mobile !== undefined ? { mobile } : {}) },
      rounds,
      ...(finalStatusColumn !== undefined ? { finalStatusColumn } : {}),
    });
  }, [preview.data, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const identity = [tab.columns.fullName, tab.columns.email, tab.columns.mobile, tab.finalStatusColumn];
  const toggleRound = (column: number, header: string, on: boolean) =>
    onChange({
      ...tab,
      rounds: on
        ? [...tab.rounds, { column, roundName: header || `Round ${tab.rounds.length + 1}`, roundType: guessRoundType(header) }].sort((a, b) => a.column - b.column)
        : tab.rounds.filter((round) => round.column !== column),
    });

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-800">Tab “{tab.sheet}”</h2>
      <SheetPreview rows={preview.data} isLoading={preview.isPending} headerRow={tab.headerRow} onHeaderRow={(headerRow) => onChange({ ...tab, headerRow, guessed: false })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name"><ColumnSelect options={options} value={tab.columns.fullName} onChange={(fullName) => onChange({ ...tab, columns: { ...tab.columns, fullName } })} /></Field>
        <Field label="Email" hint="Profiles are matched by email first…"><ColumnSelect options={options} value={tab.columns.email} onChange={(email) => onChange({ ...tab, columns: { ...tab.columns, email } })} /></Field>
        <Field label="Mobile" hint="…then by mobile."><ColumnSelect options={options} value={tab.columns.mobile} onChange={(mobile) => onChange({ ...tab, columns: { ...tab.columns, mobile } })} /></Field>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">Which columns are company rounds?</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.filter((option) => !identity.includes(option.index)).map((option) => {
            const round = tab.rounds.find((entry) => entry.column === option.index);
            return (
              <div key={option.index} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                <Checkbox checked={Boolean(round)} onCheckedChange={(checked) => toggleRound(option.index, option.header, checked === true)} aria-label={`Round ${option.label}`} />
                <span className="w-32 truncate text-xs text-slate-600" title={option.label}>{option.label}</span>
                {round && (
                  <>
                    <Input value={round.roundName} onChange={(event) => onChange({ ...tab, rounds: tab.rounds.map((entry) => entry.column === option.index ? { ...entry, roundName: event.target.value } : entry) })} className="h-8 flex-1" />
                    <Select value={round.roundType} onValueChange={(roundType) => onChange({ ...tab, rounds: tab.rounds.map((entry) => entry.column === option.index ? { ...entry, roundType: roundType as RoundType } : entry) })}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROUND_TYPES.map((type) => <SelectItem key={type} value={type}>{ROUND_TYPE_LABELS[type]}</SelectItem>)}</SelectContent>
                    </Select>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Field label="Final status column" hint="E.g. “Final Status”: selected, rejected, offer released, joined…">
        <ColumnSelect options={options} value={tab.finalStatusColumn} onChange={(finalStatusColumn) => onChange({ ...tab, finalStatusColumn })} />
      </Field>
    </Card>
  );
}

function useDistinctValues(batch: ImportBatch, tabs: CompanyTabState[], columnsOf: (tab: CompanyTabState) => number[]) {
  const queries = useQueries({
    queries: tabs.map((tab) => ({
      queryKey: ["imports", batch.id, "values", tab.sheet, tab.headerRow, columnsOf(tab).join(",")],
      queryFn: () => importsApi.values(batch.id, tab.sheet, tab.headerRow, columnsOf(tab)),
      enabled: columnsOf(tab).length > 0,
    })),
  });
  return useMemo(() => {
    const merged = new Map<string, ValueSuggestion>();
    for (const query of queries) {
      for (const value of query.data ?? []) {
        const key = normalizeValueKey(value.value);
        const existing = merged.get(key);
        merged.set(key, existing ? { ...existing, count: existing.count + value.count } : value);
      }
    }
    return { values: [...merged.values()], isLoading: queries.some((query) => query.isLoading) };
  }, [queries]);
}

export function CompanyMappingForm({ batch, state, onChange }: { batch: ImportBatch; state: CompanyMappingState; onChange: (state: CompanyMappingState) => void }) {
  const roundValues = useDistinctValues(batch, state.tabs, (tab) => tab.rounds.map((round) => round.column));
  const finalValues = useDistinctValues(batch, state.tabs, (tab) => (tab.finalStatusColumn === undefined ? [] : [tab.finalStatusColumn]));

  useEffect(() => {
    const roundValueMap = withSuggestions(roundValues.values, state.roundValueMap, (value) => value.suggested.interview);
    const finalValueMap = withSuggestions(finalValues.values, state.finalValueMap, (value) => value.suggested.pipeline);
    if (roundValueMap !== state.roundValueMap || finalValueMap !== state.finalValueMap) onChange({ ...state, roundValueMap, finalValueMap });
  }, [roundValues.values, finalValues.values]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSheet = (sheet: string, on: boolean) =>
    onChange({ ...state, tabs: on ? [...state.tabs, { sheet, headerRow: 1, columns: {}, rounds: [] }] : state.tabs.filter((tab) => tab.sheet !== sheet) });
  const unmappedRounds = unmappedValues(roundValues.values, state.roundValueMap);
  const unmappedFinal = unmappedValues(finalValues.values, state.finalValueMap);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">1 · Which tabs belong to this job?</h2>
          <p className="text-xs text-slate-400">Company sheets often have one tab per role. Tick only this job's tab(s).</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {batch.sheets.map((sheet) => (
            <label key={sheet.name} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <Checkbox checked={state.tabs.some((tab) => tab.sheet === sheet.name)} onCheckedChange={(checked) => toggleSheet(sheet.name, checked === true)} />
              {sheet.name}<span className="text-xs text-slate-400">· {Math.max(0, sheet.rowCount - 1)} profiles</span>
            </label>
          ))}
        </div>
      </Card>
      {state.tabs.map((tab) => (
        <TabSection key={tab.sheet} batch={batch} tab={tab} onChange={(next) => onChange({ ...state, tabs: state.tabs.map((entry) => (entry.sheet === tab.sheet ? next : entry)) })} />
      ))}
      {state.tabs.length > 0 && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">2 · What do the values mean?</h2>
            <p className="text-xs text-slate-400">Suggestions are filled in; check them. “Ignore” leaves that cell out.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">Round results</p>
              <ValueMeaningTable values={roundValues.values} isLoading={roundValues.isLoading} mapping={state.roundValueMap}
                onChange={(roundValueMap) => onChange({ ...state, roundValueMap })}
                options={[...INTERVIEW_OUTCOMES.map((value) => ({ value, label: value === "SCHEDULED" ? "In progress / scheduled" : INTERVIEW_OUTCOME_LABELS[value] })), { value: "IGNORE" as const, label: "Ignore" }]}
                suggest={(value) => value.suggested.interview} />
              {unmappedRounds.length > 0 && <p className="text-xs text-rose-600">{unmappedRounds.length} value(s) still need a meaning.</p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">Final status</p>
              <ValueMeaningTable values={finalValues.values} isLoading={finalValues.isLoading} mapping={state.finalValueMap}
                onChange={(finalValueMap) => onChange({ ...state, finalValueMap })}
                options={[...PIPELINE_STATUSES.filter((status) => status !== "NOT_SUBMITTED").map((value) => ({ value, label: PIPELINE_STATUS_LABELS[value] })), { value: "IGNORE" as const, label: "Ignore" }]}
                suggest={(value) => value.suggested.pipeline} />
              {unmappedFinal.length > 0 && <p className="text-xs text-rose-600">{unmappedFinal.length} value(s) still need a meaning.</p>}
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <Checkbox checked={state.addJobSkills} onCheckedChange={(checked) => onChange({ ...state, addJobSkills: checked === true })} />
            <span>Add this job's tech stack to matched candidates' skills</span>
          </label>
        </Card>
      )}
    </div>
  );
}
