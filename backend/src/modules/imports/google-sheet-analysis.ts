import {
  DECISION_STAGES,
  normalizeValueKey,
  suggestInterviewOutcome,
  suggestPipelineStatus,
  suggestStageOutcome,
  type DecisionStage,
  type InterviewOutcome,
  type PipelineStatus,
} from "@placement/shared";
import type { Workbook } from "./workbook.js";
import { detectHeaderRow } from "./workbook.js";
import { isRecruitmentTab, suggestRecruitmentTab, type RecruitmentCode } from "./tab-names.js";
import type { GoogleCompanySelection, GoogleInternalSelection } from "./imports.validators.js";

type SheetAnalysis = {
  name: string;
  headerRow: number;
  rows: ReturnType<Workbook["read"]>["rows"];
  headers: string[];
  columns: Record<string, number>;
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const emailValue = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());
const uuidValue = (value: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.trim());
const mobileValue = (value: string) => {
  const normalized = value.trim();
  if (/^[+\d\s().-]+$/.test(normalized)) {
    const digits = normalized.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13;
  }
  if (!/^\+?\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) return false;
  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) && String(Math.abs(numeric)).length >= 10 && String(Math.abs(numeric)).length <= 13;
};

function headerColumn(headers: string[], pattern: RegExp): number | undefined {
  return headers.findIndex((header) => pattern.test(normalizeHeader(header))) < 0
    ? undefined
    : headers.findIndex((header) => pattern.test(normalizeHeader(header)));
}

function valueColumn(rows: SheetAnalysis["rows"], headerRow: number, matches: (value: string) => boolean): number | undefined {
  const data = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...data.map((row) => row.cells.length));
  let bestIndex: number | undefined;
  let bestRatio = 0.8;
  for (let column = 0; column < width; column++) {
    const values = data.map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
    if (!values.length) continue;
    const ratio = values.filter(matches).length / values.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = column;
    }
  }
  return bestIndex;
}

/** True when at least 80% of the column's first non-empty data values match. */
function columnMostly(rows: SheetAnalysis["rows"], headerRow: number, column: number, matches: (value: string) => boolean): boolean {
  const values = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12)
    .map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
  return values.length > 0 && values.filter(matches).length / values.length >= 0.8;
}

function nameValueColumn(rows: SheetAnalysis["rows"], headerRow: number): number | undefined {
  const data = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...data.map((row) => row.cells.length));
  let bestIndex: number | undefined;
  let bestRatio = 0.75;
  for (let column = 0; column < width; column++) {
    const values = data.map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
    if (!values.length) continue;
    const ratio = values.filter((value) =>
      /^[a-z][a-z .'-]{1,60}$/i.test(value) && value.trim().split(/\s+/).length >= 2,
    ).length / values.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = column;
    }
  }
  return bestIndex;
}

function valueMappedColumn<T extends string>(
  rows: SheetAnalysis["rows"],
  headerRow: number,
  excluded: number[],
  suggest: (value: string) => T | null,
): number | undefined {
  const data = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...data.map((row) => row.cells.length));
  let bestIndex: number | undefined;
  let bestScore = 0;
  for (let column = 0; column < width; column++) {
    if (excluded.includes(column)) continue;
    const values = data.map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
    if (values.length < 2) continue;
    const recognized = values.filter((value) => suggest(value) !== null).length;
    const ratio = recognized / values.length;
    const score = recognized * ratio;
    if (ratio >= 0.7 && score > bestScore) {
      bestIndex = column;
      bestScore = score;
    }
  }
  return bestIndex;
}

function containsMappedValues<T extends string>(
  rows: SheetAnalysis["rows"],
  headerRow: number,
  column: number,
  suggest: (value: string) => T | null,
): boolean {
  const values = rows
    .filter((row) => row.rowNumber > headerRow)
    .slice(0, 12)
    .map((row) => row.cells[column]?.trim())
    .filter((value): value is string => Boolean(value));
  return values.length > 0 && values.filter((value) => suggest(value) !== null).length / values.length >= 0.7;
}

function valueMappedColumns<T extends string>(
  rows: SheetAnalysis["rows"],
  headerRow: number,
  excluded: number[],
  suggest: (value: string) => T | null,
): number[] {
  const data = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...data.map((row) => row.cells.length));
  const columns: number[] = [];
  for (let column = 0; column < width; column++) {
    if (excluded.includes(column)) continue;
    const values = data.map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
    if (values.length < 2) continue;
    const ratio = values.filter((value) => suggest(value) !== null).length / values.length;
    if (ratio >= 0.7) columns.push(column);
  }
  return columns;
}

function freeTextColumn(rows: SheetAnalysis["rows"], headerRow: number, excluded: number[]): number | undefined {
  const data = rows.filter((row) => row.rowNumber > headerRow).slice(0, 12);
  const width = Math.max(0, ...data.map((row) => row.cells.length));
  let bestIndex: number | undefined;
  let bestScore = 0;
  for (let column = 0; column < width; column++) {
    if (excluded.includes(column)) continue;
    const values = data.map((row) => row.cells[column]?.trim()).filter((value): value is string => Boolean(value));
    if (values.length < 2) continue;
    const descriptive = values.filter((value) => value.length >= 8 && /[a-z]{3}/i.test(value)).length;
    const ratio = descriptive / values.length;
    if (ratio >= 0.7 && descriptive > bestScore) {
      bestIndex = column;
      bestScore = descriptive;
    }
  }
  return bestIndex;
}

function analyzeSheets(workbook: Workbook): SheetAnalysis[] {
  return workbook.sheets.map(({ name }) => {
    const rows = workbook.top(name, 12);
    const headerRow = detectHeaderRow(rows);
    const headers = rows.find((row) => row.rowNumber === headerRow)?.cells ?? [];
    const email = headerColumn(headers, /e ?mail|email address/);
    const mobile = headerColumn(headers, /mobile|phone|contact\s*(?:number|no\.?)|telephone/);
    const fullName = headerColumn(headers, /^(?:(?:full|student|candidate|applicant)\s+)?name$|^(?:name\s+(?:of\s+)?(?:the\s+)?(?:student|candidate|applicant))$/);
    const candidateId = headerColumn(headers, /user id|candidate id|^uid$|uuid/);
    const columns: Record<string, number> = {
      ...(email !== undefined ? { email } : {}),
      ...(mobile !== undefined ? { mobile } : {}),
      ...(fullName !== undefined ? { fullName } : {}),
      ...(candidateId !== undefined ? { candidateId } : {}),
    };
    if (email === undefined) {
      const column = valueColumn(rows, headerRow, emailValue);
      if (column !== undefined) columns.email = column;
    }
    if (mobile === undefined) {
      const column = valueColumn(rows, headerRow, mobileValue);
      if (column !== undefined) columns.mobile = column;
    }
    // A "Name" header over candidate IDs (seen in real TA tabs) is an ID column, not names.
    if (fullName !== undefined && columnMostly(rows, headerRow, fullName, uuidValue)) {
      delete columns.fullName;
      if (columns.candidateId === undefined) columns.candidateId = fullName;
    }
    if (columns.fullName === undefined) {
      const column = nameValueColumn(rows, headerRow);
      if (column !== undefined) columns.fullName = column;
    }
    if (columns.candidateId === undefined && headerRow > 0) {
      const column = headerColumn(headers, /user id|candidate id|^uid$/);
      if (column !== undefined) columns.candidateId = column;
    }
    // Headerless or oddly named ID columns are found by their values.
    if (columns.candidateId === undefined) {
      const column = valueColumn(rows, headerRow, uuidValue);
      if (column !== undefined) columns.candidateId = column;
    }
    return { name, headerRow, rows, headers, columns };
  });
}

/**
 * Priority of supplemental student-detail tabs; lower is checked first. The
 * platform's applied-users export is the first source, then form responses,
 * then any other tab, and recruitment-stage tabs only as a last resort.
 */
export function profileSheetPriority(name: string): number {
  const value = name.trim();
  if (/applied|application/i.test(value)) return 0;
  if (/form\s*responses?|registration|response/i.test(value)) return 1;
  if (isRecruitmentTab(value) || /^tool$/i.test(value)) return 3;
  return 2;
}

function chooseApplicationSheet(sheets: SheetAnalysis[], usedSheets: ReadonlySet<string>): SheetAnalysis | undefined {
  // TA is, by definition, the total-applications tab; it wins over an
  // "Applied Users" export that may list only one application channel.
  // Tabs another batch of this job already uses (e.g. "TA" for batch 1) are skipped.
  const named = suggestRecruitmentTab(sheets, "TA", usedSheets)
    ?? sheets.find(({ name }) => /^total\s*applications?$/i.test(name.trim()))
    ?? sheets.find(({ name }) => /applied|application/i.test(name.trim()));
  if (named) return named;
  return sheets
    .filter(({ columns, name }) => columns.mobile !== undefined && !/bucket|competenc|^tr/i.test(name))
    .sort((a, b) => {
      const score = (sheet: SheetAnalysis) =>
        Number(sheet.columns.fullName !== undefined) * 4 +
        Number(sheet.columns.mobile !== undefined) * 5 +
        Number(/product|eligible/i.test(sheet.name)) * -2;
      return score(b) - score(a) || b.rows.length - a.rows.length;
    })[0];
}

function stageSheet(sheets: SheetAnalysis[], code: RecruitmentCode, usedSheets: ReadonlySet<string>): SheetAnalysis | undefined {
  const exact = suggestRecruitmentTab(sheets, code, usedSheets);
  if (exact) return exact;
  const pattern = new RegExp(`(^|[^a-z])${code}([^a-z]|$)`, "i");
  return sheets.find(({ name }) => pattern.test(name) && !usedSheets.has(name));
}

function mappingForInternal(sheets: SheetAnalysis[], selection?: GoogleInternalSelection, usedSheets: ReadonlySet<string> = new Set()) {
  const application = selection
    ? sheets.find(({ name }) => name === selection.applications.sheet)
    : chooseApplicationSheet(sheets, usedSheets);
  const productLookup = selection?.productLookupSheet !== undefined
    ? selection.productLookupSheet
      ? sheets.find(({ name }) => name === selection.productLookupSheet)
      : undefined
    : sheets.find(({ name, headers }) => /applied|application/i.test(name) && headerColumn(headers, /\bproduct\b|course|program/) !== undefined)
      ?? sheets.find(({ name }) => /eligible|product lookup/i.test(name));
  const appHeader = application?.headers ?? [];
  const appColumns = application?.columns ?? {};
  const appProduct = headerColumn(appHeader, /\bproduct\b|course|program/);
  const appColumnSet = {
    ...(appColumns.candidateId !== undefined ? { candidateId: appColumns.candidateId } : {}),
    ...(appColumns.fullName !== undefined ? { fullName: appColumns.fullName } : {}),
    ...(appColumns.email !== undefined ? { email: appColumns.email } : {}),
    ...(appColumns.mobile !== undefined ? { mobile: appColumns.mobile } : {}),
    ...(appProduct !== undefined ? { product: appProduct } : {}),
    ...(headerColumn(appHeader, /resume|cv|curriculum vitae/) !== undefined
      ? { resumeUrl: headerColumn(appHeader, /resume|cv|curriculum vitae/) }
      : {}),
  };
  const stageCodes: Record<DecisionStage, string> = {
    RESUME_SHORTLIST: "RS",
    SCREENING_SHORTLIST: "SC",
    ASSIGNMENT_SHORTLIST: "AS",
    FINAL_SHORTLIST: "SP",
  };
  const orderedSheets = sheets
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => profileSheetPriority(a.tab.name) - profileSheetPriority(b.tab.name) || a.index - b.index)
    .map(({ tab }) => tab);
  const profileLookups = orderedSheets.flatMap((tab) => {
    if (tab === application || /^(read\s*me|guide|instructions)$/i.test(tab.name.trim())) return [];
    const keyColumn = tab.columns.mobile;
    if (keyColumn === undefined) return [];
    const keyType = "mobile";
    const columns = {
      ...(tab.columns.candidateId !== undefined ? { candidateId: tab.columns.candidateId } : {}),
      ...(tab.columns.fullName !== undefined ? { fullName: tab.columns.fullName } : {}),
      ...(tab.columns.email !== undefined ? { email: tab.columns.email } : {}),
      ...(tab.columns.mobile !== undefined ? { mobile: tab.columns.mobile } : {}),
      ...(headerColumn(tab.headers, /resume|cv|curriculum vitae/) !== undefined
        ? { resumeUrl: headerColumn(tab.headers, /resume|cv|curriculum vitae/) }
        : {}),
      ...(headerColumn(tab.headers, /\bproduct\b/) !== undefined ? { product: headerColumn(tab.headers, /\bproduct\b/) } : {}),
      ...(headerColumn(tab.headers, /^gender$/) !== undefined ? { gender: headerColumn(tab.headers, /^gender$/) } : {}),
      ...(headerColumn(tab.headers, /current city|district|location/) !== undefined
        ? { city: headerColumn(tab.headers, /current city|district|location/) }
        : {}),
      ...(headerColumn(tab.headers, /^state$/) !== undefined ? { state: headerColumn(tab.headers, /^state$/) } : {}),
      ...(headerColumn(tab.headers, /college|university|institute/) !== undefined
        ? { college: headerColumn(tab.headers, /college|university|institute/) }
        : {}),
      ...(headerColumn(tab.headers, /degree|course|qualification/) !== undefined
        ? { degree: headerColumn(tab.headers, /degree|course|qualification/) }
        : {}),
      ...(headerColumn(tab.headers, /department|branch/) !== undefined
        ? { department: headerColumn(tab.headers, /department|branch/) }
        : {}),
      ...(headerColumn(tab.headers, /pass out year|graduation year|year of graduation|completion year/) !== undefined
        ? { graduationYear: headerColumn(tab.headers, /pass out year|graduation year|year of graduation|completion year/) }
        : {}),
      ...(headerColumn(tab.headers, /percentage|cgpa|academic score/) !== undefined
        ? { academicScore: headerColumn(tab.headers, /percentage|cgpa|academic score/) }
        : {}),
    };
    if (!Object.values(columns).some((column) => column !== undefined)) return [];
    return [{ sheet: tab.name, headerRow: tab.headerRow, keyType, keyColumn, columns }];
  });
  const stages: Record<string, unknown> = {};
  for (const stage of DECISION_STAGES) {
    const selected = selection?.stages[stage];
    if (selected && selected.mode !== "SHEET") {
      stages[stage] = selected;
      continue;
    }
    const tab = selected?.mode === "SHEET"
      ? sheets.find(({ name }) => name === selected.sheet)
      : stageSheet(sheets, stageCodes[stage] as RecruitmentCode, usedSheets);
    // Stage tabs list applicants by mobile or by candidate ID, whichever the tab has.
    // IDs are turned into mobiles through the TA / student-detail tabs when the plan is built.
    const matchColumn = tab?.columns.mobile ?? tab?.columns.candidateId;
    const matchBy = tab?.columns.mobile !== undefined ? "mobile" : "candidateId";
    const inferredDecisionColumn = tab
      ? valueMappedColumn(tab.rows, tab.headerRow, [matchColumn ?? -1], suggestStageOutcome)
      : undefined;
    const screeningDecisionColumn = stage === "SCREENING_SHORTLIST" && tab
      ? headerColumn(tab.headers, /\bscreening\s+(?:status|decision|outcome|result)\b|^decision$/)
      : undefined;
    const labeledDecisionColumn = tab
      ? headerColumn(tab.headers, /decision|status|outcome|result|shortlist|selection(?![ _-]?basis)/)
      : undefined;
    const genericScreeningDecisionIsReliable = stage !== "SCREENING_SHORTLIST"
      || screeningDecisionColumn !== undefined
      || labeledDecisionColumn === undefined
      || (tab !== undefined && containsMappedValues(tab.rows, tab.headerRow, labeledDecisionColumn, suggestStageOutcome));
    const decisionColumn = screeningDecisionColumn
      ?? (genericScreeningDecisionIsReliable ? labeledDecisionColumn : undefined)
      ?? inferredDecisionColumn;
    if (
      stage === "SCREENING_SHORTLIST"
      && labeledDecisionColumn !== undefined
      && screeningDecisionColumn === undefined
      && !genericScreeningDecisionIsReliable
    ) {
      stages[stage] = { mode: "MANUAL" };
      continue;
    }
    const rejectionReasonColumn = tab ? headerColumn(tab.headers, /^rejection reason$/) : undefined;
    const remarksColumn = tab ? headerColumn(tab.headers, /^remarks?$|^comments?$/) : undefined;
    // SP: a Selection_Basis column if the tab has one, else its Remarks are the selection basis.
    const selectionBasisColumn = tab && stage === "FINAL_SHORTLIST"
      ? headerColumn(tab.headers, /selection[ _-]?basis|selection reason|why selected/) ?? remarksColumn
      : undefined;
    const isMappable = Boolean(tab && matchColumn !== undefined);
    if (!isMappable || !tab) {
      stages[stage] = { mode: "MANUAL" };
      continue;
    }
    const valueMap: Record<string, string> = {};
    if (decisionColumn !== undefined) {
      for (const row of tab.rows.filter(({ rowNumber }) => rowNumber > tab.headerRow)) {
        const value = row.cells[decisionColumn]?.trim();
        const suggestion = value ? suggestStageOutcome(value) : null;
        const key = value ? normalizeValueKey(value) : null;
        if (suggestion && key) valueMap[key] = suggestion;
      }
    }
    stages[stage] = {
      mode: "SHEET",
      sheet: tab.name,
      headerRow: tab.headerRow,
      matchBy,
      matchColumn,
      ...(decisionColumn !== undefined ? { decisionColumn } : {}),
      valueMap,
      ...(headerColumn(tab.headers, /priority|bucket|tier/) !== undefined ? { priorityColumn: headerColumn(tab.headers, /priority|bucket|tier/) } : {}),
      ...(headerColumn(tab.headers, /tech.*score|technical score/) !== undefined ? { techScoreColumn: headerColumn(tab.headers, /tech.*score|technical score/) } : {}),
      ...(headerColumn(tab.headers, /comm.*score|communication score/) !== undefined ? { commScoreColumn: headerColumn(tab.headers, /comm.*score|communication score/) } : {}),
      ...(rejectionReasonColumn !== undefined ? { reasonColumn: rejectionReasonColumn } : {}),
      ...(remarksColumn !== undefined ? { remarksColumn } : {}),
      ...(selectionBasisColumn !== undefined ? { selectionBasisColumn } : {}),
    };
  }
  const lookupColumns = productLookup?.columns ?? {};
  const lookupProductColumn = productLookup ? headerColumn(productLookup.headers, /\bproduct\b|course|program/) : undefined;
  const lookupKeyColumn = lookupColumns.mobile;
  const lookupKeyType = "mobile";
  return {
    applications: {
      sheet: application?.name ?? "",
      headerRow: application?.headerRow ?? 0,
      columns: appColumnSet,
    },
    profileLookups,
    productSource: appProduct !== undefined ? "COLUMN" : productLookup && lookupKeyColumn !== undefined && lookupProductColumn !== undefined ? "LOOKUP" : "NONE",
    ...(productLookup && lookupKeyColumn !== undefined && lookupProductColumn !== undefined
      ? { productsLookup: { sheet: productLookup.name, headerRow: productLookup.headerRow, keyType: lookupKeyType, keyColumn: lookupKeyColumn, productColumn: lookupProductColumn } }
      : {}),
    stages,
    acceptOtherJobIds: false,
    overwriteManualDecisions: false,
  };
}

function mappingForCompany(sheets: SheetAnalysis[], selection?: GoogleCompanySelection) {
  const selectedSheets = selection
    ? selection.tabs.map(({ sheet }) => sheets.find(({ name }) => name === sheet)).filter((sheet): sheet is SheetAnalysis => Boolean(sheet))
    : sheets.filter(({ rows, columns, headers, name }) => {
      if (rows.length < 2 || columns.mobile === undefined) return false;
      const hasRound = headers.some((header) => /round|screen|interview|technical|manager|client|test|final status/i.test(header));
      return columns.fullName !== undefined || hasRound || /role|developer|engineer|analyst/i.test(name);
    });
  const roundValueMap: Record<string, InterviewOutcome | "IGNORE"> = {};
  const finalValueMap: Record<string, PipelineStatus | "IGNORE"> = {};
  const tabs = selectedSheets.map((tab) => {
    const identityColumns = [tab.columns.fullName, tab.columns.email, tab.columns.mobile].filter((value): value is number => value !== undefined);
    const finalStatusColumn = headerColumn(tab.headers, /final|^status$|result|outcome/)
      ?? valueMappedColumn(
        tab.rows,
        tab.headerRow,
        identityColumns,
        (value) => /offer|joined|onboard|dropped|withdrawn|backed out|in process/i.test(value) ? suggestPipelineStatus(value) : null,
      );
    const identity = [tab.columns.fullName, tab.columns.email, tab.columns.mobile, finalStatusColumn].filter((value): value is number => value !== undefined);
    const roundHeaders = tab.headers
      .map((header, column) => ({ header: header.trim(), column }))
      .filter(({ header, column }) => header && !identity.includes(column) && /round|screen|interview|technical|manager|client|test/i.test(header));
    const roundColumns = roundHeaders.length
      ? roundHeaders.map(({ column }) => column)
      : valueMappedColumns(tab.rows, tab.headerRow, identity, suggestInterviewOutcome);
    const rounds = roundColumns.slice(0, 20).map((column, index) => {
      const header = tab.headers[column]?.trim();
      const roundName = header || `Round ${index + 1}`;
      const roundType = /assign/i.test(roundName) ? "ASSIGNMENT" : /tech|^tr\b/i.test(roundName) ? "TECHNICAL" : /hr|human/i.test(roundName) ? "HR" : "OTHER";
      for (const row of tab.rows.filter(({ rowNumber }) => rowNumber > tab.headerRow)) {
        const value = row.cells[column]?.trim();
        const suggestion = value ? suggestInterviewOutcome(value) : null;
        const key = value ? normalizeValueKey(value) : null;
        if (suggestion && key) roundValueMap[key] = suggestion;
      }
      return { column, roundName, roundType };
    });
    if (finalStatusColumn !== undefined) {
      for (const row of tab.rows.filter(({ rowNumber }) => rowNumber > tab.headerRow)) {
        const value = row.cells[finalStatusColumn]?.trim();
        const suggestion = value ? suggestPipelineStatus(value) : null;
        const key = value ? normalizeValueKey(value) : null;
        if (suggestion && key) finalValueMap[key] = suggestion;
      }
    }
    return {
      sheet: tab.name,
      headerRow: tab.headerRow,
      columns: {
        ...(tab.columns.fullName !== undefined ? { fullName: tab.columns.fullName } : {}),
        ...(tab.columns.email !== undefined ? { email: tab.columns.email } : {}),
        ...(tab.columns.mobile !== undefined ? { mobile: tab.columns.mobile } : {}),
      },
      rounds,
      ...(finalStatusColumn !== undefined ? { finalStatusColumn } : {}),
      guessed: false,
    };
  });
  return { tabs, roundValueMap, finalValueMap, addJobSkills: selection?.addJobSkills ?? true };
}

export type InferredInternalMapping = ReturnType<typeof mappingForInternal>;
export type InferredCompanyMapping = ReturnType<typeof mappingForCompany>;

/** `usedSheets`: tabs other batches of this job import from, left for those batches. */
export function inferGoogleMapping(
  workbook: Workbook,
  target: "INTERNAL_SCREENING",
  selection?: GoogleInternalSelection,
  usedSheets?: ReadonlySet<string>,
): InferredInternalMapping;
export function inferGoogleMapping(
  workbook: Workbook,
  target: "COMPANY_PIPELINE",
  selection?: GoogleCompanySelection,
): InferredCompanyMapping;
export function inferGoogleMapping(
  workbook: Workbook,
  target: "INTERNAL_SCREENING" | "COMPANY_PIPELINE",
  selection?: GoogleInternalSelection | GoogleCompanySelection,
  usedSheets?: ReadonlySet<string>,
): InferredInternalMapping | InferredCompanyMapping;
export function inferGoogleMapping(
  workbook: Workbook,
  target: "INTERNAL_SCREENING" | "COMPANY_PIPELINE",
  selection?: GoogleInternalSelection | GoogleCompanySelection,
  usedSheets: ReadonlySet<string> = new Set(),
) {
  const sheets = analyzeSheets(workbook);
  return target === "INTERNAL_SCREENING"
    ? mappingForInternal(sheets, selection as GoogleInternalSelection | undefined, usedSheets)
    : mappingForCompany(sheets, selection as GoogleCompanySelection | undefined);
}
