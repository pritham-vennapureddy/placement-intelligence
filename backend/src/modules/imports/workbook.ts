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
  /** Rows after `headerRow` (1-based); `headers` are the header row's cells. */
  read(sheetName: string, headerRow: number): { headers: string[]; rows: SheetRow[] };
  /** The first `limit` rows from the top, for choosing the header row. */
  top(sheetName: string, limit: number): SheetRow[];
}

const MAX_COLUMNS = 200;

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

/** Header label shown to the PSM: "C · Email Id", or just the letter when the header is blank. */
export function describeColumn(index: number, header: string | undefined): string {
  return header ? `${columnLetter(index)} · ${header}` : columnLetter(index);
}
