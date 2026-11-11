/**
 * The tabs of a job's internal sheet that belong to one recruitment batch.
 *
 * A job request owns the internal sheet; batch 1 and every later batch read
 * from it unless a batch names its own workbook. The PSM chooses, per batch,
 * which tab is TA (applications) and which are RS / SC / AS / SP. Those
 * choices pre-fill the import's mapping screen, and the tabs the PSM confirms
 * there are written back, so the batch always shows what it really imports.
 */
import { DECISION_STAGES, STAGE_LABELS, type DecisionStage } from "@placement/shared";
import type { GoogleInternalSelection } from "./imports.validators.js";
import { sheetsInMapping } from "./tab-names.js";

export const BATCH_TAB_CODES = ["TA", "RS", "SC", "AS", "SP"] as const;
export type BatchTabCode = (typeof BATCH_TAB_CODES)[number];
export type BatchTabs = Partial<Record<BatchTabCode, string | null>>;

const STAGE_BY_CODE = Object.fromEntries(
  DECISION_STAGES.map((stage) => [STAGE_LABELS[stage].code, stage]),
) as Record<Exclude<BatchTabCode, "TA">, DecisionStage>;

/** Reads the stored JSON, keeping only non-empty tab names. Null when nothing is chosen. */
export function parseBatchTabs(value: unknown): BatchTabs | null {
  if (!value || typeof value !== "object") return null;
  const tabs: BatchTabs = {};
  for (const code of BATCH_TAB_CODES) {
    const name = (value as Record<string, unknown>)[code];
    if (typeof name === "string" && name.trim()) tabs[code] = name.trim();
  }
  return Object.keys(tabs).length > 0 ? tabs : null;
}

/** Tab names used by a batch, without blanks. */
export function tabNames(tabs: BatchTabs | null | undefined): string[] {
  return tabs ? BATCH_TAB_CODES.map((code) => tabs[code]).filter((name): name is string => Boolean(name)) : [];
}

/** The tabs a saved internal mapping reads: applications → TA, each SHEET stage → its code. */
export function tabsFromMapping(mapping: unknown): BatchTabs | null {
  const value = mapping as { applications?: { sheet?: string }; stages?: Record<string, { mode?: string; sheet?: string }> } | null;
  const tabs: BatchTabs = {};
  if (value?.applications?.sheet) tabs.TA = value.applications.sheet;
  for (const [code, stage] of Object.entries(STAGE_BY_CODE)) {
    const config = value?.stages?.[stage];
    if (config?.mode === "SHEET" && config.sheet) tabs[code as BatchTabCode] = config.sheet;
  }
  return parseBatchTabs(tabs);
}

/**
 * Turns the batch's tabs into an import selection for this workbook. Null when
 * the TA tab is not chosen or no longer exists (the importer then falls back
 * to detecting tabs). A chosen stage tab that is missing from the workbook is
 * listed in `missing`, and that stage is left for the PSM to map.
 */
export function selectionFromTabs(tabs: BatchTabs | null, workbookSheets: readonly string[]): { selection: GoogleInternalSelection; missing: string[] } | null {
  if (!tabs?.TA) return null;
  const available = new Set(workbookSheets);
  if (!available.has(tabs.TA)) return null;
  const missing: string[] = [];
  const stages = {} as GoogleInternalSelection["stages"];
  for (const stage of DECISION_STAGES) {
    const sheet = tabs[STAGE_LABELS[stage].code as BatchTabCode];
    if (sheet && available.has(sheet)) stages[stage] = { mode: "SHEET", sheet };
    else {
      if (sheet) missing.push(sheet);
      stages[stage] = { mode: "MANUAL" };
    }
  }
  return {
    selection: { applications: { sheet: tabs.TA }, stages, acceptOtherJobIds: false, overwriteManualDecisions: false },
    missing,
  };
}

/** True when a saved mapping reads exactly the batch's chosen tabs (so its column choices can be kept). */
export function mappingMatchesTabs(mapping: unknown, tabs: BatchTabs): boolean {
  const used = new Set(sheetsInMapping(mapping));
  const chosen = tabNames(tabs);
  return chosen.every((name) => used.has(name)) && (tabsFromMapping(mapping)?.TA ?? null) === (tabs.TA ?? null);
}

/** Tab names in `tabs` that appear more than once (one tab cannot be two stages). */
export function duplicateTabs(tabs: BatchTabs | null | undefined): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of tabNames(tabs)) {
    const key = name.toLowerCase();
    if (seen.has(key)) duplicates.add(name);
    seen.add(key);
  }
  return [...duplicates];
}
