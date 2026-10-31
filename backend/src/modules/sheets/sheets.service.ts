import { inTransaction } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import {
  extractSpreadsheetId,
  getGoogleServiceAccountEmail,
  inspectSpreadsheet,
  readHeaderRow,
} from "./google-sheets.service.js";
import { sheetsRepository } from "./sheets.repository.js";
import {
  columnKeys,
  workflowStages,
  type CreateConnectionInput,
  type CreateMappingInput,
} from "./sheets.validators.js";

const isAdmin = (user: AuthenticatedUser) => user.roles.includes("ADMIN");

/** Administrators see every connection; others only their own team's. */
async function getVisibleConnection(connectionId: string, user: AuthenticatedUser) {
  const connection = await sheetsRepository.findConnection(connectionId);
  if (!connection) {
    throw new ApiError(404, "SHEET_CONNECTION_NOT_FOUND", "The spreadsheet connection was not found.");
  }
  if (!isAdmin(user)) {
    const teamId = await sheetsRepository.findUserTeamId(user.id);
    if (!teamId || connection.teamId !== teamId) {
      throw new ApiError(404, "SHEET_CONNECTION_NOT_FOUND", "The spreadsheet connection was not found.");
    }
  }
  return connection;
}

async function findTab(spreadsheetId: string, sheetId: number) {
  const spreadsheet = await inspectSpreadsheet(spreadsheetId);
  return spreadsheet.tabs.find((tab) => tab.sheetId === sheetId);
}

export const sheetsService = {
  async getSetup(user: AuthenticatedUser) {
    const teamId = isAdmin(user) ? undefined : await sheetsRepository.findUserTeamId(user.id);
    return {
      connections: await sheetsRepository.listConnections(teamId),
      workflowStages,
      columnKeys,
      googleServiceAccountEmail: getGoogleServiceAccountEmail(),
    };
  },

  async createConnection(input: CreateConnectionInput, user: AuthenticatedUser, audit: AuditContext) {
    let teamId = input.teamId ?? null;
    if (!isAdmin(user)) {
      const ledTeamId = await sheetsRepository.findTeamIdLedBy(user.id);
      if (!ledTeamId) {
        throw new ApiError(403, "TEAM_REQUIRED", "A team lead must be assigned to a team before adding spreadsheets.");
      }
      if (teamId && teamId !== ledTeamId) {
        throw new ApiError(403, "FORBIDDEN", "You can only add spreadsheets to your own team.");
      }
      teamId = ledTeamId;
    }

    if (teamId && !(await sheetsRepository.teamExists(teamId))) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
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

  async getHeaders(connectionId: string, sheetId: number, row: number, user: AuthenticatedUser) {
    const connection = await getVisibleConnection(connectionId, user);
    const tab = await findTab(connection.spreadsheetId, sheetId);
    if (!tab) {
      throw new ApiError(404, "SHEET_TAB_NOT_FOUND", "The selected tab was not found in this spreadsheet.");
    }
    const headers = await readHeaderRow(connection.spreadsheetId, tab.title, row);
    return headers.map((header, index) => ({ column: index, header }));
  },

  async saveMapping(connectionId: string, input: CreateMappingInput, user: AuthenticatedUser, audit: AuditContext) {
    const connection = await getVisibleConnection(connectionId, user);
    const tab = await findTab(connection.spreadsheetId, input.sheetId);
    if (!tab || tab.title !== input.sheetTitle) {
      throw new ApiError(400, "INVALID_SHEET_TAB", "The selected tab does not match the connected spreadsheet.");
    }

    const headers = await readHeaderRow(connection.spreadsheetId, tab.title, input.headerRow);
    if (Object.values(input.columnMapping ?? {}).some((header) => !headers.includes(header))) {
      throw new ApiError(400, "INVALID_COLUMN_MAPPING", "Choose columns from the selected tab's header row.");
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
};
