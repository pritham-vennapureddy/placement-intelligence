import { useQuery } from "@tanstack/react-query";
import { columnLetter, normalizeValueKey } from "@placement/shared";
import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { importsApi } from "../../services/workflow-api";
import type { ImportBatch, ValueSuggestion } from "../../types/workflow";
import { cn } from "../../utils/cn";

const NONE = "__none__";

/** Top rows of a sheet, used to identify headers and label columns automatically. */
export function useSheetPreview(batchId: string, sheet: string | undefined) {
  return useQuery({
    queryKey: ["imports", batchId, "preview", sheet],
    queryFn: () => importsApi.preview(batchId, sheet!, 15),
    enabled: Boolean(sheet),
    staleTime: Infinity,
  });
}

/** Labels columns with detected headers, or sample values when the sheet has no header. */
export function columnOptions(rows: { rowNumber: number; cells: string[] }[] | undefined, headerRow: number) {
  const header = rows?.find((row) => row.rowNumber === headerRow)?.cells ?? [];
  const sampleRow = rows?.find((row) => row.rowNumber > headerRow && row.cells.some(Boolean))
    ?? rows?.find((row) => row.cells.some(Boolean));
  const width = Math.max(header.length, ...(rows ?? []).map((row) => row.cells.length));
  return Array.from({ length: width }, (_, index) => ({
    index,
    header: header[index]?.trim() ?? "",
    label: header[index]?.trim()
      ? `${columnLetter(index)} · ${header[index]!.trim()}`
      : sampleRow?.cells[index]?.trim()
        ? `${columnLetter(index)} · e.g. ${sampleRow.cells[index]!.trim().slice(0, 28)}`
        : columnLetter(index),
  })).filter((option) => option.header || (rows ?? []).some((row) => row.cells[option.index]));
}

/** Index of the first column whose header matches, for sensible defaults. */
export function guessColumn(options: ReturnType<typeof columnOptions>, pattern: RegExp, exclude: number[] = []): number | undefined {
  return options.find((option) => pattern.test(option.header.replace(/[_-]+/g, " ")) && !exclude.includes(option.index))?.index;
}

/** Uses the first data rows to recognize common contact columns when headers are absent. */
export function guessColumnByValues(
  rows: { rowNumber: number; cells: string[] }[] | undefined,
  headerRow: number,
  matches: (value: string) => boolean,
  exclude: number[] = [],
): number | undefined {
  const dataRows = (rows ?? []).filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...dataRows.map((row) => row.cells.length));
  let best: { index: number; ratio: number } | undefined;
  for (let index = 0; index < width; index++) {
    if (exclude.includes(index)) continue;
    const values = dataRows.map((row) => row.cells[index]?.trim()).filter((value): value is string => Boolean(value));
    if (values.length === 0) continue;
    const ratio = values.filter(matches).length / values.length;
    if (ratio >= 0.8 && (!best || ratio > best.ratio)) best = { index, ratio };
  }
  return best?.index;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function SheetSelect({ batch, value, onChange, id }: { batch: ImportBatch; value: string | undefined; onChange: (sheet: string) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-9 w-full"><SelectValue placeholder="Choose a tab" /></SelectTrigger>
      <SelectContent>
        {batch.sheets.map((sheet) => (
          <SelectItem key={sheet.name} value={sheet.name}>{sheet.name} <span className="text-slate-400">· {sheet.rowCount} rows</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ColumnSelect({
  options,
  value,
  onChange,
  optional = true,
  placeholder = "Choose a column",
}: {
  options: ReturnType<typeof columnOptions>;
  value: number | undefined;
  onChange: (column: number | undefined) => void;
  optional?: boolean;
  placeholder?: string;
}) {
  return (
    <Select value={value === undefined ? (optional ? NONE : undefined) : String(value)} onValueChange={(next) => onChange(next === NONE ? undefined : Number(next))}>
      <SelectTrigger className="h-9 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {optional && <SelectItem value={NONE}>— Not in this tab —</SelectItem>}
        {options.map((option) => <SelectItem key={option.index} value={String(option.index)}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Preview table with the detected header row highlighted, when one is present. */
export function SheetPreview({
  rows,
  headerRow,
  isLoading,
}: {
  rows: { rowNumber: number; cells: string[] }[] | undefined;
  headerRow: number;
  isLoading?: boolean;
}) {
  if (isLoading) return <p className="py-6 text-center text-xs text-slate-400">Reading the tab…</p>;
  if (!rows?.length) return <p className="py-6 text-center text-xs text-slate-400">This tab is empty.</p>;
  const width = Math.min(14, Math.max(...rows.map((row) => row.cells.length)));
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        {headerRow > 0
          ? `Header detected in row ${headerRow}.`
          : "No header detected; all rows will be treated as data."}
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-400">
            <tr>
              <th className="px-2 py-1">#</th>
              {Array.from({ length: width }, (_, index) => <th key={index} className="px-2 py-1 font-semibold">{columnLetter(index)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.rowNumber}
                className={cn("border-t border-slate-100", row.rowNumber === headerRow && "bg-indigo-50 font-semibold text-indigo-800")}
              >
                <td className="px-2 py-1 text-slate-400">{row.rowNumber}</td>
                {Array.from({ length: width }, (_, index) => (
                  <td key={index} className="max-w-40 truncate px-2 py-1" title={row.cells[index]}>{row.cells[index]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Lets the PSM say what each value found in a column means. Values without a
 * meaning are highlighted; the import refuses rows that still have one.
 */
export function ValueMeaningTable<T extends string>({
  values,
  mapping,
  onChange,
  options,
  suggest,
  isLoading,
}: {
  values: ValueSuggestion[] | undefined;
  mapping: Record<string, T>;
  onChange: (mapping: Record<string, T>) => void;
  options: { value: T; label: string }[];
  suggest: (value: ValueSuggestion) => T | null;
  isLoading?: boolean;
}) {
  if (isLoading) return <p className="text-xs text-slate-400">Reading values…</p>;
  if (!values?.length) return <p className="text-xs text-slate-400">No values found in this column.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
          <tr><th className="px-3 py-2">Value in the sheet</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">Means</th></tr>
        </thead>
        <tbody>
          {values.map((entry) => {
            const key = normalizeValueKey(entry.value);
            const current = mapping[key] ?? null;
            return (
              <tr key={key} className={cn("border-t border-slate-100", !current && "bg-rose-50/60")}>
                <td className="px-3 py-1.5 font-mono text-xs">{entry.value}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{entry.count}</td>
                <td className="px-3 py-1.5">
                  <Select value={current ?? undefined} onValueChange={(next) => onChange({ ...mapping, [key]: next as T })}>
                    <SelectTrigger className="h-8 w-52"><SelectValue placeholder={suggest(entry) ? "Choose" : "Choose a meaning"} /></SelectTrigger>
                    <SelectContent>
                      {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Fills in suggested meanings for values the PSM has not decided yet. */
export function withSuggestions<T extends string>(values: ValueSuggestion[] | undefined, mapping: Record<string, T>, suggest: (value: ValueSuggestion) => T | null) {
  const next = { ...mapping };
  let changed = false;
  for (const value of values ?? []) {
    const key = normalizeValueKey(value.value);
    const suggestion = suggest(value);
    if (!next[key] && suggestion) {
      next[key] = suggestion;
      changed = true;
    }
  }
  return changed ? next : mapping;
}

export function unmappedValues<T extends string>(values: ValueSuggestion[] | undefined, mapping: Record<string, T>) {
  return (values ?? []).filter((value) => !mapping[normalizeValueKey(value.value)]);
}
