// Turns a Google Sheet read into the existing workbook reader format. The
// parsed rows and links are persisted as structured JSON, not as a file blob.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { SpreadsheetGrid } from "../sheets/google-sheets.service.js";

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

export async function buildWorkbook(grid: SpreadsheetGrid): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  const names = excelSheetNames(grid.sheets);
  for (const [index, sheet] of grid.sheets.entries()) {
    const worksheet = workbook.addWorksheet(names[index]);
    sheet.rows.forEach((cells, rowIndex) => {
      cells.forEach((cell, columnIndex) => {
        if (!cell.text && !cell.link) return;
        worksheet.getCell(rowIndex + 1, columnIndex + 1).value = cell.link
          ? { text: cell.text || cell.link, hyperlink: cell.link }
          : cell.text;
      });
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Fingerprint of the sheet's content, to tell whether anything changed since the last import. */
export function gridChecksum(grid: SpreadsheetGrid): string {
  return createHash("sha256").update(JSON.stringify(grid.sheets)).digest("hex");
}
