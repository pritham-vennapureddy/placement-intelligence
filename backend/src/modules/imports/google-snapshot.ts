// Turns a Google Sheet read into the existing workbook reader format. The
// parsed rows and links are persisted as structured JSON, not as a file blob.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { SpreadsheetGrid } from "../sheets/google-sheets.service.js";
import { restoreWorkbook, type Workbook, type WorkbookSnapshot } from "./workbook.js";

/**
 * Excel limits tab names to 31 characters without []:*?/\. The same Google tab
 * always gets the same name, so saved mappings keep matching on refresh.
 */
export function excelSheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let counter = 2; taken.has(name.toLowerCase()); counter++) {
    const suffix = ` (${counter})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Worksheet names of the workbook built from `sheets`, in the same order. */
export function excelSheetNames(sheets: { title: string }[]): string[] {
  const taken = new Set<string>();
  return sheets.map((sheet) => excelSheetName(sheet.title, taken));
}

/**
 * Text an .xlsx can hold: no control characters (tab and line breaks stay), no
 * U+FFFE/U+FFFF or unpaired surrogates (invalid XML: the file would not read
 * back), and at most Excel's 32,767 characters per cell.
 */
export function xlsxSafeText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .slice(0, 32767);
}

/**
 * The Google Sheet as the import's workbook, read straight from the cell values
 * (no Excel file in between). Tab names, trimming, blank-row skipping and the
 * 200-column cap match what reading an .xlsx gives, so saved mappings still fit.
 */
export function workbookFromGrid(grid: SpreadsheetGrid): Workbook {
  const names = excelSheetNames(grid.sheets);
  const sheets: WorkbookSnapshot["sheets"] = [];
  const rowsBySheet: WorkbookSnapshot["rowsBySheet"] = {};
  for (const [index, sheet] of grid.sheets.entries()) {
    const name = names[index]!;
    const width = Math.min(MAX_GRID_COLUMNS, Math.max(0, ...sheet.rows.map((cells) => {
      let last = cells.length;
      while (last > 0 && !cells[last - 1]?.text && !cells[last - 1]?.link) last--;
      return last;
    })));
    const usedColumns = new Set<number>();
    const rows: WorkbookSnapshot["rowsBySheet"][string] = [];
    sheet.rows.forEach((source, rowIndex) => {
      const cells: string[] = [];
      const links: (string | null)[] = [];
      for (let column = 0; column < width; column++) {
        const text = xlsxSafeText(source[column]?.text ?? "").trim();
        const link = source[column]?.link ? xlsxSafeText(source[column]!.link!) : "";
        const shown = text || link.trim();
        if (shown) usedColumns.add(column);
        cells.push(shown);
        links.push(link || null);
      }
      if (cells.some(Boolean)) rows.push({ rowNumber: rowIndex + 1, cells, links });
    });
    sheets.push({ name, rowCount: rows.length, columnCount: usedColumns.size });
    rowsBySheet[name] = rows;
  }
  return restoreWorkbook({ version: 1, sheets, rowsBySheet } satisfies WorkbookSnapshot);
}

const MAX_GRID_COLUMNS = 200;

export async function buildWorkbook(grid: SpreadsheetGrid): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const names = excelSheetNames(grid.sheets);
  for (const [index, sheet] of grid.sheets.entries()) {
    const worksheet = workbook.addWorksheet(names[index]);
    sheet.rows.forEach((cells, rowIndex) => {
      cells.forEach((cell, columnIndex) => {
        const text = xlsxSafeText(cell.text ?? "");
        const link = cell.link ? xlsxSafeText(cell.link) : "";
        if (!text && !link) return;
        worksheet.getCell(rowIndex + 1, columnIndex + 1).value = link
          ? { text: text || link, hyperlink: link }
          : text;
      });
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Fingerprint of the sheet's content, to tell whether anything changed since the last import. */
export function gridChecksum(grid: SpreadsheetGrid): string {
  return createHash("sha256").update(JSON.stringify(grid.sheets)).digest("hex");
}
