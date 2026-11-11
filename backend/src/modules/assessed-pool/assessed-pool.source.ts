import { inTransaction, prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AssessedPoolSource } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { buildWorkbook, excelSheetNames } from "../imports/google-snapshot.js";
import { extractSpreadsheetId, fetchSpreadsheetGrid, type SpreadsheetGrid } from "../sheets/google-sheets.service.js";
import { assessedPoolService } from "./assessed-pool.service.js";
import { autoAssessedPoolMapping } from "./assessed-pool-data.js";
import {
  assessedPoolMappingSchema,
  type SourceConnectBody,
  type SourcePreviewBody,
} from "./assessed-pool.validators.js";

const MAX_BYTES = 20 * 1024 * 1024;
const ASSESSED_POOL_SHEETS = ["Offline Pool Main", "Competency Pool Main"] as const;
type SourceMappings = Record<string, ReturnType<typeof assessedPoolMappingSchema.parse>>;

/** Same name rules as the file upload, so the import history reads the same for both sources. */
function fileNameFor(spreadsheetTitle: string, sheetTitle: string): string {
  const name = `${spreadsheetTitle} - ${sheetTitle}`.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  return `${name || "Google Sheet"}.xlsx`;
}

/** Reads every tab of the spreadsheet (read-only) into the same .xlsx snapshot the Google imports use. */
async function readSpreadsheet(spreadsheetId: string) {
  const grid = await fetchSpreadsheetGrid(spreadsheetId);
  if (grid.sheets.length === 0) {
    throw new ApiError(400, "WORKBOOK_EMPTY", "The spreadsheet does not contain a readable worksheet.");
  }
  const bytes = await buildWorkbook(grid);
  if (bytes.length > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "The spreadsheet must be 20 MB or smaller.");
  return { grid, bytes, sheetNames: excelSheetNames(grid.sheets) };
}

/** The worksheet name inside the built workbook for a Google tab title. */
function workbookSheetFor(grid: SpreadsheetGrid, sheetNames: string[], sheetTitle: string): string {
  const index = grid.sheets.findIndex(({ title }) => title === sheetTitle);
  const name = index < 0 ? undefined : sheetNames[index];
  if (!name) throw new ApiError(400, "SHEET_TAB_NOT_FOUND", "The selected tab was not found in this spreadsheet. Choose it again.");
  return name;
}

function selectedSourceSheets(source: AssessedPoolSource): string[] {
  const parsed = Array.isArray(source.sheetTitles)
    ? source.sheetTitles.filter((title): title is string => typeof title === "string")
    : [];
  return parsed.length > 0 ? parsed : [source.sheetTitle];
}

function sourceMappings(value: unknown): SourceMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed: SourceMappings = {};
  for (const [sheetTitle, mapping] of Object.entries(value)) {
    const result = assessedPoolMappingSchema.safeParse(mapping);
    if (result.success) parsed[sheetTitle] = result.data;
  }
  return parsed;
}

async function mappingForSheet(bytes: Buffer, fileName: string, sheet: string) {
  const preview = await assessedPoolService.preview(bytes, { fileName, sheet });
  const mapping = autoAssessedPoolMapping(preview.headers.map(({ header }) => header));
  if (!mapping) {
    throw new ApiError(400, "ASSESSED_POOL_MOBILE_COLUMN_NOT_FOUND", `Could not find a mobile-number column in “${sheet}”.`);
  }
  return assessedPoolMappingSchema.parse(mapping);
}

function aggregateImports(results: Awaited<ReturnType<typeof assessedPoolService.importFile>>[]) {
  const totals = results.reduce((summary, result) => ({
    rowCount: summary.rowCount + result.rowCount,
    importedCount: summary.importedCount + result.importedCount,
    updatedCount: summary.updatedCount + result.updatedCount,
    skippedCount: summary.skippedCount + result.skippedCount,
    skippedMissingMobile: summary.skippedMissingMobile + result.skippedMissingMobile,
    skippedInvalidMobile: summary.skippedInvalidMobile + result.skippedInvalidMobile,
    skippedDuplicateMobile: summary.skippedDuplicateMobile + result.skippedDuplicateMobile,
    mergedDuplicateMobile: summary.mergedDuplicateMobile + result.mergedDuplicateMobile,
  }), {
    rowCount: 0,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    skippedMissingMobile: 0,
    skippedInvalidMobile: 0,
    skippedDuplicateMobile: 0,
    mergedDuplicateMobile: 0,
  });
  const first = results[0];
  if (!first) throw new ApiError(400, "ASSESSED_POOL_SHEETS_EMPTY", "Select at least one assessed-pool tab to sync.");
  return { ...first, ...totals };
}

async function findSource() {
  return prisma.assessedPoolSource.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

function sourceView(source: AssessedPoolSource) {
  const mappings = sourceMappings(source.mapping);
  const mappedFields = Object.keys(mappings).length > 0
    ? [...new Set(Object.values(mappings).flatMap((mapping) => Object.keys(mapping)))]
    : Object.keys(source.mapping as Record<string, unknown>);
  return {
    id: source.id,
    spreadsheetUrl: source.spreadsheetUrl,
    spreadsheetTitle: source.spreadsheetTitle,
    sheetTitles: selectedSourceSheets(source),
    lastSyncedAt: source.lastSyncedAt,
    mappedFields,
  };
}

export const assessedPoolSourceService = {
  async getSource() {
    const source = await findSource();
    return source ? sourceView(source) : null;
  },

  /** Lists the spreadsheet's tabs and reads the chosen one's headers, without saving anything. */
  async preview(body: SourcePreviewBody) {
    const { grid, bytes, sheetNames } = await readSpreadsheet(extractSpreadsheetId(body.url));
    const selectedName = body.sheetTitle ? workbookSheetFor(grid, sheetNames, body.sheetTitle) : sheetNames[0];
    const preview = await assessedPoolService.preview(bytes, { fileName: fileNameFor(grid.title, ""), sheet: selectedName });
    const selectedIndex = sheetNames.indexOf(preview.selectedSheet ?? "");

    return {
      ...preview,
      spreadsheetTitle: grid.title,
      sheets: grid.sheets.map((sheet, index) => {
        const info = preview.sheets.find(({ name }) => name === sheetNames[index]);
        return { name: sheet.title, rowCount: info?.rowCount ?? 0, columnCount: info?.columnCount ?? 0 };
      }),
      selectedSheet: selectedIndex >= 0 ? grid.sheets[selectedIndex]?.title ?? null : null,
    };
  },

  /** Saves the sheet link and detected mappings, then imports the two configured assessed-pool tabs. */
  async connect(body: SourceConnectBody, user: AuthenticatedUser, audit: AuditContext) {
    const spreadsheetId = extractSpreadsheetId(body.url);
    const { grid, bytes, sheetNames } = await readSpreadsheet(spreadsheetId);
    const availableTitles = new Set(grid.sheets.map(({ title }) => title));
    const missingTabs = ASSESSED_POOL_SHEETS.filter((title) => !availableTitles.has(title));
    if (missingTabs.length > 0) {
      throw new ApiError(400, "ASSESSED_POOL_TABS_MISSING", `The spreadsheet must contain these tabs: ${missingTabs.join(", ")}.`);
    }

    const mappings: SourceMappings = {};
    for (const title of ASSESSED_POOL_SHEETS) {
      const sheet = workbookSheetFor(grid, sheetNames, title);
      mappings[title] = await mappingForSheet(bytes, fileNameFor(grid.title, title), sheet);
    }
    const imports = [];
    for (const title of ASSESSED_POOL_SHEETS) {
      const sheet = workbookSheetFor(grid, sheetNames, title);
      imports.push(await assessedPoolService.importFile(
        bytes,
        { fileName: fileNameFor(grid.title, title), sheet, mapping: mappings[title]! },
        user,
        audit,
      ));
    }

    const source = await inTransaction(async (transaction) => {
      // One assessed-pool source per workspace: a new link replaces the previous one.
      await transaction.assessedPoolSource.deleteMany({});
      const created = await transaction.assessedPoolSource.create({
        data: {
          spreadsheetId,
          spreadsheetUrl: body.url,
          spreadsheetTitle: grid.title,
          sheetTitle: ASSESSED_POOL_SHEETS[0],
          sheetTitles: [...ASSESSED_POOL_SHEETS],
          mapping: mappings as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
          connectedById: user.id,
        },
      });
      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOL_SOURCE_CONNECTED",
        entityType: "AssessedPoolSource",
        entityId: created.id,
        metadata: { spreadsheetId, sheetTitles: ASSESSED_POOL_SHEETS },
      });
      return created;
    });
    return { source: sourceView(source), import: aggregateImports(imports) };
  },

  /** Re-reads every configured tab with its saved mapping and merges all rows into the pool. */
  async sync(user: AuthenticatedUser, audit: AuditContext) {
    const source = await findSource();
    if (!source) throw new ApiError(404, "ASSESSED_POOL_SOURCE_NOT_FOUND", "Connect a Google Sheet for the assessed pool first.");
    const { grid, bytes, sheetNames } = await readSpreadsheet(source.spreadsheetId);
    const titles = selectedSourceSheets(source);
    const mappings: SourceMappings = {};
    for (const title of titles) {
      const sheet = workbookSheetFor(grid, sheetNames, title);
      mappings[title] = await mappingForSheet(bytes, fileNameFor(grid.title, title), sheet);
    }
    const imports = [];
    for (const title of titles) {
      const sheet = workbookSheetFor(grid, sheetNames, title);
      imports.push(await assessedPoolService.importFile(
        bytes,
        { fileName: fileNameFor(grid.title, title), sheet, mapping: mappings[title]! },
        user,
        audit,
      ));
    }
    const updated = await prisma.assessedPoolSource.update({
      where: { id: source.id },
      data: { spreadsheetTitle: grid.title, mapping: mappings as Prisma.InputJsonValue, lastSyncedAt: new Date() },
    });
    return { source: sourceView(updated), import: aggregateImports(imports) };
  },

  /** Forgets the sheet link. Pool records already synced are kept; use the delete actions to remove them. */
  async disconnect(audit: AuditContext) {
    const source = await findSource();
    if (!source) return;
    await inTransaction(async (transaction) => {
      await transaction.assessedPoolSource.delete({ where: { id: source.id } });
      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOL_SOURCE_DISCONNECTED",
        entityType: "AssessedPoolSource",
        entityId: source.id,
        metadata: { spreadsheetId: source.spreadsheetId, sheetTitle: source.sheetTitle },
      });
    });
  },
};
