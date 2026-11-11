import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { columnLetter } from "@placement/shared";
import { ApiError } from "../../utils/api-error.js";

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface SheetRow {
  rowNumber: number;
  /** Displayed text of each cell. */
  cells: string[];
  /** Hyperlink target of each cell, when it has one. */
  links: (string | undefined)[];
}

export interface Workbook {
  sheets: SheetInfo[];
  /** Rows after `headerRow` (1-based); a value of 0 means the sheet has no header row. */
  read(sheetName: string, headerRow: number): { headers: string[]; rows: SheetRow[] };
  /** The first `limit` rows from the top. */
  top(sheetName: string, limit: number): SheetRow[];
}

export interface WorkbookSnapshot {
  version: 1;
  sheets: SheetInfo[];
  rowsBySheet: Record<string, { rowNumber: number; cells: string[]; links: (string | null)[] }[]>;
}

const MAX_COLUMNS = 200;
const HEADER_LABEL = /\b(?:name|email|e-?mail|mobile\s*(?:no\.?|number)?|phone|contact|user\s*id|candidate\s*id|uid|uuid|product|bucket|tier|status|outcome|result|round|score|cgpa|percentage|reason|selection\s*basis|remarks|date|resume|college|university|institute|gender|city|state|department|degree|job\s*id)\b/i;

/** Returns the likely 1-based header row, or 0 when the sheet appears headerless. */
export function detectHeaderRow(rows: SheetRow[]): number {
  let bestRow = 0;
  let bestScore = 1;
  for (const row of rows.slice(0, 10)) {
    const populated = row.cells.filter(Boolean);
    if (populated.length < 2) continue;
    const score = populated.filter((cell) => HEADER_LABEL.test(cell.replace(/[_-]+/g, " "))).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = row.rowNumber;
    }
  }
  return bestRow;
}

function cellText(value: ExcelJS.CellValue): { text: string; link?: string } {
  if (value === null || value === undefined) return { text: "" };
  if (value instanceof Date) return { text: value.toISOString() };
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return result === undefined || (typeof result === "object" && result !== null && "error" in result) ? { text: "" } : cellText(result);
    }
    if ("richText" in value) return { text: value.richText.map((part) => part.text).join("") };
    if ("hyperlink" in value) {
      const text = typeof value.text === "string" ? value.text : cellText(value.text as ExcelJS.CellValue).text;
      return { text: text || value.hyperlink, link: value.hyperlink };
    }
    if ("error" in value) return { text: "" };
    return { text: JSON.stringify(value) };
  }
  return { text: String(value) };
}

async function readXlsx(buffer: Buffer): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ApiError(400, "UNREADABLE_FILE", "This file could not be read as an Excel workbook (.xlsx).");
  }
  const byName = new Map(workbook.worksheets.map((sheet) => [sheet.name, sheet]));
  const rowsOf = (name: string) => {
    const sheet = byName.get(name);
    if (!sheet) throw new ApiError(400, "SHEET_NOT_FOUND", `The workbook has no sheet named “${name}”.`);
    const rows: SheetRow[] = [];
    const width = Math.min(sheet.columnCount, MAX_COLUMNS);
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      const links: (string | undefined)[] = [];
      for (let column = 1; column <= width; column++) {
        const { text, link } = cellText(row.getCell(column).value);
        cells.push(text.trim());
        links.push(link);
      }
      if (cells.some(Boolean)) rows.push({ rowNumber, cells, links });
    });
    return rows;
  };

  return {
    sheets: workbook.worksheets
      .filter((sheet) => sheet.state !== "veryHidden")
      .map((sheet) => ({ name: sheet.name, rowCount: sheet.actualRowCount, columnCount: Math.min(sheet.actualColumnCount, MAX_COLUMNS) })),
    read(name, headerRow) {
      const rows = rowsOf(name);
      if (headerRow === 0) return { headers: [], rows };
      const header = rows.find((row) => row.rowNumber === headerRow);
      return { headers: header?.cells ?? [], rows: rows.filter((row) => row.rowNumber > headerRow) };
    },
    top(name, limit) {
      return rowsOf(name).slice(0, limit);
    },
  };
}

function readCsv(buffer: Buffer): Workbook {
  let records: string[][];
  try {
    records = parseCsv(buffer, { bom: true, relax_column_count: true, skip_empty_lines: false }) as string[][];
  } catch {
    throw new ApiError(400, "UNREADABLE_FILE", "This file could not be read as CSV.");
  }
  const rows: SheetRow[] = records
    .map((cells, index) => ({ rowNumber: index + 1, cells: cells.slice(0, MAX_COLUMNS).map((cell) => cell.trim()), links: [] }))
    .filter((row) => row.cells.some(Boolean));
  const name = "CSV";
  const check = (sheet: string) => {
    if (sheet !== name) throw new ApiError(400, "SHEET_NOT_FOUND", `The file has no sheet named “${sheet}”.`);
  };
  return {
    sheets: [{ name, rowCount: rows.length, columnCount: Math.max(0, ...rows.map((row) => row.cells.length)) }],
    read(sheet, headerRow) {
      check(sheet);
      if (headerRow === 0) return { headers: [], rows };
      const header = rows.find((row) => row.rowNumber === headerRow);
      return { headers: header?.cells ?? [], rows: rows.filter((row) => row.rowNumber > headerRow) };
    },
    top(sheet, limit) {
      check(sheet);
      return rows.slice(0, limit);
    },
  };
}

export async function readWorkbook(buffer: Buffer, fileName: string): Promise<Workbook> {
  return /\.csv$/i.test(fileName) ? readCsv(buffer) : readXlsx(buffer);
}

/** Keeps the parsed source rows and links needed by review, without retaining an .xlsx blob. */
export function serializeWorkbook(workbook: Workbook): WorkbookSnapshot {
  return {
    version: 1,
    sheets: workbook.sheets,
    rowsBySheet: Object.fromEntries(workbook.sheets.map(({ name }) => [name, workbook.read(name, 0).rows.map((row) => ({
      ...row,
      links: row.links.map((link) => link ?? null),
    }))])),
  };
}

/** Rebuilds the read-only workbook interface from its database-backed JSON snapshot. */
export function restoreWorkbook(value: unknown): Workbook {
  if (!value || typeof value !== "object") {
    throw new ApiError(410, "IMPORT_SNAPSHOT_MISSING", "The source snapshot for this import is unavailable.");
  }
  const snapshot = value as Partial<WorkbookSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.sheets) || !snapshot.rowsBySheet || typeof snapshot.rowsBySheet !== "object") {
    throw new ApiError(410, "IMPORT_SNAPSHOT_INVALID", "The source snapshot for this import is invalid. Reconnect the Google Sheet to start a new import.");
  }

  const rowsBySheet = new Map<string, SheetRow[]>();
  for (const sheet of snapshot.sheets) {
    if (!sheet || typeof sheet.name !== "string" || !sheet.name || !Number.isInteger(sheet.rowCount) || sheet.rowCount < 0 || !Number.isInteger(sheet.columnCount) || sheet.columnCount < 0) {
      throw new ApiError(410, "IMPORT_SNAPSHOT_INVALID", "The source snapshot for this import is invalid. Reconnect the Google Sheet to start a new import.");
    }
    const rows = snapshot.rowsBySheet[sheet.name];
    if (!rows || !Array.isArray(rows) || !rows.every((row) =>
      Number.isInteger(row.rowNumber) && row.rowNumber > 0 && Array.isArray(row.cells) && row.cells.every((cell) => typeof cell === "string") &&
      Array.isArray(row.links) && row.links.every((link) => link === null || link === undefined || typeof link === "string"))) {
      throw new ApiError(410, "IMPORT_SNAPSHOT_INVALID", "The source snapshot for this import is invalid. Reconnect the Google Sheet to start a new import.");
    }
    rowsBySheet.set(sheet.name, rows.map((row) => ({ ...row, links: row.links.map((link) => link ?? undefined) })));
  }

  const sheets = snapshot.sheets;
  const rowsOf = (name: string) => {
    const rows = rowsBySheet.get(name);
    if (!rows) throw new ApiError(400, "SHEET_NOT_FOUND", `The workbook has no sheet named “${name}”.`);
    return rows;
  };
  return {
    sheets,
    read(name, headerRow) {
      const rows = rowsOf(name);
      if (headerRow === 0) return { headers: [], rows };
      const header = rows.find((row) => row.rowNumber === headerRow);
      return { headers: header?.cells ?? [], rows: rows.filter((row) => row.rowNumber > headerRow) };
    },
    top(name, limit) {
      return rowsOf(name).slice(0, limit);
    },
  };
}

/** Header label shown to the PSM: "C · Email Id", or just the letter when the header is blank. */
export function describeColumn(index: number, header: string | undefined): string {
  return header ? `${columnLetter(index)} · ${header}` : columnLetter(index);
}
