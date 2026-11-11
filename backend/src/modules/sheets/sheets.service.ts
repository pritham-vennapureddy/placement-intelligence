import { inTransaction } from "../../db.js";
import type { CandidatePoolType } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import {
  extractSpreadsheetId,
  getGoogleServiceAccountEmail,
  inspectSpreadsheet,
  readColumnValues,
  readHeaderRow,
  readSampleRows,
} from "./google-sheets.service.js";
import { sheetsRepository } from "./sheets.repository.js";
import {
  columnKeys,
  poolWorkflowStages,
  workflowStages,
  type CreateConnectionInput,
  type CreateMappingInput,
} from "./sheets.validators.js";
import { z } from "zod";
import { detectHeaderRow } from "../imports/workbook.js";

const poolTypeByStage: Record<(typeof poolWorkflowStages)[number], CandidatePoolType> = {
  BUCKET_POOL: "BUCKET",
  TR_POOL: "TR",
  COMPETENCY_POOL: "COMPETENCY",
};

const columnToken = (column: number) => `__column_${column}__`;
const columnFromToken = (value: string) => {
  const match = /^__column_(\d+)__$/.exec(value);
  return match ? Number(match[1]) : undefined;
};

/** Connections belong to the shared workspace, so every user can see them. */
async function getVisibleConnection(connectionId: string, _user: AuthenticatedUser) {
  const connection = await sheetsRepository.findConnection(connectionId);
  if (!connection) {
    throw new ApiError(404, "SHEET_CONNECTION_NOT_FOUND", "The spreadsheet connection was not found.");
  }
  return connection;
}

async function findTab(spreadsheetId: string, sheetId: number) {
  const spreadsheet = await inspectSpreadsheet(spreadsheetId);
  return spreadsheet.tabs.find((tab) => tab.sheetId === sheetId);
}

export const sheetsService = {
  async getSetup(_user: AuthenticatedUser) {
    return {
      connections: await sheetsRepository.listConnections(undefined),
      workflowStages,
      columnKeys,
      googleServiceAccountEmail: getGoogleServiceAccountEmail(),
    };
  },

  async createConnection(input: CreateConnectionInput, user: AuthenticatedUser, audit: AuditContext) {
    const teamId = await sheetsRepository.findWorkspaceTeamId();
    if (!teamId) {
      throw new ApiError(409, "WORKSPACE_NOT_READY", "Create the shared workspace before connecting a spreadsheet.");
    }

    const spreadsheetId = extractSpreadsheetId(input.url);
    const metadata = await inspectSpreadsheet(spreadsheetId);
    const connection = await inTransaction(async (transaction) => {
      const created = await sheetsRepository.createConnection(transaction, {
        spreadsheetId,
        title: metadata.title,
        sourceType: input.sourceType,
        teamId,
        createdById: user.id,
      });
      await recordAudit(transaction, audit, {
        action: "SHEET_CONNECTED",
        entityType: "SheetConnection",
        entityId: created.id,
        metadata: { spreadsheetId, sourceType: input.sourceType, teamId },
      });
      return created;
    });
    return { connection, tabs: metadata.tabs };
  },

  async listTabs(connectionId: string, user: AuthenticatedUser) {
    const connection = await getVisibleConnection(connectionId, user);
    return (await inspectSpreadsheet(connection.spreadsheetId)).tabs;
  },

  async getHeaders(connectionId: string, sheetId: number, user: AuthenticatedUser) {
    const connection = await getVisibleConnection(connectionId, user);
    const tab = await findTab(connection.spreadsheetId, sheetId);
    if (!tab) {
      throw new ApiError(404, "SHEET_TAB_NOT_FOUND", "The selected tab was not found in this spreadsheet.");
    }
    const rows = await readSampleRows(connection.spreadsheetId, tab.title);
    const headerRow = detectHeaderRow(rows.map(({ rowNumber, cells }) => ({ rowNumber, cells, links: [] })));
    const headers = headerRow > 0 ? rows.find(({ rowNumber }) => rowNumber === headerRow)?.cells ?? [] : [];
    const dataRows = rows.filter(({ rowNumber }) => rowNumber > headerRow);
    const width = Math.max(headers.length, ...rows.map(({ cells }) => cells.length));
    return {
      headerRow,
      headers: Array.from({ length: width }, (_, column) => ({
        column,
        header: headers[column] ?? "",
        sample: dataRows.find(({ cells }) => cells[column])?.cells[column] ?? rows.find(({ cells }) => cells[column])?.cells[column] ?? "",
        value: columnToken(column),
      })),
    };
  },

  async saveMapping(connectionId: string, input: CreateMappingInput, user: AuthenticatedUser, audit: AuditContext) {
    const connection = await getVisibleConnection(connectionId, user);
    const tab = await findTab(connection.spreadsheetId, input.sheetId);
    if (!tab || tab.title !== input.sheetTitle) {
      throw new ApiError(400, "INVALID_SHEET_TAB", "The selected tab does not match the connected spreadsheet.");
    }

    const headers = input.headerRow > 0 ? await readHeaderRow(connection.spreadsheetId, tab.title, input.headerRow) : [];
    if (Object.values(input.columnMapping ?? {}).some((value) => {
      const column = columnFromToken(value);
      return column === undefined ? !headers.includes(value) : column >= (tab.gridProperties?.columnCount ?? 52);
    })) {
      throw new ApiError(400, "INVALID_COLUMN_MAPPING", "Choose valid columns from the selected tab.");
    }

    return inTransaction(async (transaction) => {
      const mapping = await sheetsRepository.upsertTabMapping(transaction, connection.id, input.workflowStage, {
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        headerRow: input.headerRow,
        ...(input.columnMapping ? { columnMapping: input.columnMapping } : {}),
      });
      await recordAudit(transaction, audit, {
        action: "SHEET_MAPPING_SAVED",
        entityType: "SheetTabMapping",
        entityId: mapping.id,
        metadata: { connectionId: connection.id, workflowStage: input.workflowStage, sheetTitle: tab.title },
      });
      return mapping;
    });
  },

  /** Removes the link, its tab mappings and the pool memberships it created. Candidate profiles are not touched. */
  async deleteConnection(connectionId: string, user: AuthenticatedUser, audit: AuditContext) {
    const connection = await getVisibleConnection(connectionId, user);
    await inTransaction(async (transaction) => {
      await transaction.sheetConnection.delete({ where: { id: connection.id } });
      await recordAudit(transaction, audit, {
        action: "SHEET_DISCONNECTED",
        entityType: "SheetConnection",
        entityId: connection.id,
        metadata: { spreadsheetId: connection.spreadsheetId, sourceType: connection.sourceType, title: connection.title },
      });
    });
  },

  async syncAssessedPools(connectionId: string, user: AuthenticatedUser, audit: AuditContext) {
    const connection = await getVisibleConnection(connectionId, user);
    if (connection.sourceType !== "ASSESSED_POOL") {
      throw new ApiError(400, "NOT_ASSESSED_POOL_SOURCE", "Connect this workbook as an assessed-pool source before syncing it.");
    }
    const mappings = new Map(connection.tabMappings.map((mapping) => [mapping.workflowStage, mapping]));
    const missingStages = poolWorkflowStages.filter((stage) => !mappings.has(stage));
    if (missingStages.length > 0) {
      throw new ApiError(400, "POOL_TABS_NOT_MAPPED", `Choose a tab for each pool first: ${missingStages.map((stage) => stage.replaceAll("_", " ").toLowerCase()).join(", ")}.`);
    }

    const spreadsheet = await inspectSpreadsheet(connection.spreadsheetId);
    const mappedEntries: { candidateCode: string; poolType: CandidatePoolType }[] = [];
    const counts: Record<CandidatePoolType, number> = { BUCKET: 0, TR: 0, COMPETENCY: 0 };
    for (const stage of poolWorkflowStages) {
      const mapping = mappings.get(stage)!;
      const tab = spreadsheet.tabs.find(({ sheetId, title }) => sheetId === mapping.sheetId && title === mapping.sheetTitle);
      if (!tab) {
        throw new ApiError(400, "POOL_TAB_NOT_FOUND", `The mapped ${stage.replaceAll("_", " ").toLowerCase()} tab no longer exists. Choose it again.`);
      }

      const columnMapping = z.record(z.string(), z.string()).safeParse(mapping.columnMapping);
      const candidateIdHeader = columnMapping.success ? columnMapping.data.candidate_id : undefined;
      if (!candidateIdHeader) {
        throw new ApiError(400, "POOL_ID_COLUMN_NOT_MAPPED", `Choose the UID/User ID column for the ${stage.replaceAll("_", " ").toLowerCase()} tab.`);
      }
      const columnTokenIndex = columnFromToken(candidateIdHeader);
      const headers = columnTokenIndex === undefined ? await readHeaderRow(connection.spreadsheetId, tab.title, mapping.headerRow) : [];
      const columnIndex = columnTokenIndex ?? headers.indexOf(candidateIdHeader);
      if (columnIndex < 0) {
        throw new ApiError(400, "POOL_ID_COLUMN_NOT_FOUND", `The UID/User ID column was not found on the ${tab.title} tab. Update its mapping.`);
      }
      const firstDataRow = mapping.headerRow === 0 ? 1 : mapping.headerRow + 1;
      const candidateCodes = [...new Set((await readColumnValues(connection.spreadsheetId, tab.title, columnIndex, firstDataRow)).filter(Boolean))];
      if (candidateCodes.length === 0) {
        throw new ApiError(400, "POOL_TAB_EMPTY", `No candidate IDs were found on the ${tab.title} tab. No pool data was changed.`);
      }
      const poolType = poolTypeByStage[stage];
      counts[poolType] = candidateCodes.length;
      mappedEntries.push(...candidateCodes.map((candidateCode) => ({ candidateCode, poolType })));
    }

    const candidates = await sheetsRepository.findCandidatesByCodes([...new Set(mappedEntries.map(({ candidateCode }) => candidateCode))]);
    const candidateIdByCode = new Map(candidates.map(({ id, candidateCode }) => [candidateCode, id]));
    await inTransaction(async (transaction) => {
      await sheetsRepository.replacePoolMemberships(
        transaction,
        connection.id,
        mappedEntries.map(({ candidateCode, poolType }) => ({
          candidateCode,
          candidateId: candidateIdByCode.get(candidateCode) ?? null,
          poolType,
          sourceConnectionId: connection.id,
        })),
      );
      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOLS_SYNCED",
        entityType: "SheetConnection",
        entityId: connection.id,
        metadata: { counts, matchedCandidates: candidates.length },
      });
    });
    return { counts, matchedCandidates: candidates.length };
  },
};
