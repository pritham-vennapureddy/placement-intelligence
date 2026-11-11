import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";

const SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const spreadsheetFields = "spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))";

interface GoogleSheetProperties {
  sheetId: number;
  title: string;
  index: number;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties?: { title?: string };
  sheets?: { properties: GoogleSheetProperties }[];
}

interface ValuesResponse {
  values?: unknown[][];
}

function googleAuth(): GoogleAuth {
  if (!env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    throw new ApiError(
      503,
      "GOOGLE_SHEETS_NOT_CONFIGURED",
      "Google Sheets access is not configured. Add the service-account credential on the backend, then share the workbook with that service account.",
    );
  }

  try {
    const credentials = z.object({
      client_email: z.email(),
      private_key: z.string().min(1),
      type: z.literal("service_account"),
    }).parse(JSON.parse(
      Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"),
    ));
    return new GoogleAuth({
      credentials,
      scopes: [SHEETS_READ_SCOPE],
    });
  } catch {
    throw new ApiError(
      503,
      "GOOGLE_CREDENTIAL_INVALID",
      "The Google service-account credential is invalid. Check the backend configuration.",
    );
  }
}

export function getGoogleServiceAccountEmail(): string | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_BASE64) return null;
  try {
    const credentials: unknown = JSON.parse(
      Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"),
    );
    const parsed = z.object({ client_email: z.email() }).safeParse(credentials);
    return parsed.success ? parsed.data.client_email : null;
  } catch {
    return null;
  }
}

export function extractSpreadsheetId(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError(400, "INVALID_SHEET_URL", "Enter a valid Google Sheets URL.");
  }

  if (url.hostname !== "docs.google.com" || !url.pathname.startsWith("/spreadsheets/d/")) {
    throw new ApiError(400, "INVALID_SHEET_URL", "Enter a URL from docs.google.com/spreadsheets.");
  }

  const spreadsheetId = url.pathname.split("/")[3];
  if (!spreadsheetId || !/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
    throw new ApiError(400, "INVALID_SHEET_URL", "The spreadsheet ID in that URL is invalid.");
  }
  return spreadsheetId;
}

async function googleRequest<T>(url: string): Promise<T> {
  const auth = googleAuth();
  const client = await auth.getClient();
  try {
    const response = await client.request<T>({ url, method: "GET", timeout: 90_000 });
    return response.data;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "response" in error &&
      typeof error.response === "object" && error.response !== null && "status" in error.response
      ? error.response.status
      : undefined;
    if (status === 403 || status === 404) {
      throw new ApiError(
        403,
        "SHEET_ACCESS_DENIED",
        `Google could not open this spreadsheet. Share it (Viewer is enough) with ${getGoogleServiceAccountEmail() ?? "the configured service account"}, then try again.`,
      );
    }
    if (status === 401) {
      throw new ApiError(503, "GOOGLE_CREDENTIAL_INVALID", "Google rejected the configured service-account credential.");
    }
    throw new ApiError(502, "GOOGLE_SHEETS_UNAVAILABLE", "Google Sheets could not be reached. Try again shortly.");
  }
}

export async function inspectSpreadsheet(spreadsheetId: string): Promise<{
  id: string;
  title: string;
  tabs: GoogleSheetProperties[];
}> {
  const metadata = await googleRequest<SpreadsheetMetadata>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(spreadsheetFields)}`,
  );
  return {
    id: metadata.spreadsheetId,
    title: metadata.properties?.title ?? "Untitled spreadsheet",
    tabs: (metadata.sheets ?? []).map(({ properties }) => properties),
  };
}

export async function readHeaderRow(
  spreadsheetId: string,
  sheetTitle: string,
  rowNumber: number,
): Promise<string[]> {
  const escapedTitle = sheetTitle.replaceAll("'", "''");
  const range = `'${escapedTitle}'!A${rowNumber}:AZ${rowNumber}`;
  const result = await googleRequest<ValuesResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  const row = result.values?.[0] ?? [];
  return row.map((value) => typeof value === "string" ? value.trim() : String(value ?? ""));
}

export async function readSampleRows(
  spreadsheetId: string,
  sheetTitle: string,
  limit = 10,
): Promise<{ rowNumber: number; cells: string[] }[]> {
  const escapedTitle = sheetTitle.replaceAll("'", "''");
  const range = `'${escapedTitle}'!A1:AZ${limit}`;
  const result = await googleRequest<ValuesResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  return (result.values ?? []).map((values, index) => ({
    rowNumber: index + 1,
    cells: values.map((value) => typeof value === "string" ? value.trim() : String(value ?? "").trim()),
  })).filter((row) => row.cells.some(Boolean));
}

export async function readColumnValues(
  spreadsheetId: string,
  sheetTitle: string,
  columnIndex: number,
  firstRow: number,
): Promise<string[]> {
  let column = "";
  for (let value = columnIndex + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }
  const escapedTitle = sheetTitle.replaceAll("'", "''");
  const range = `'${escapedTitle}'!${column}${firstRow}:${column}`;
  const result = await googleRequest<ValuesResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  return (result.values ?? []).map((row) => {
    const value = row[0];
    return typeof value === "string" ? value.trim() : String(value ?? "").trim();
  });
}

export interface SpreadsheetGrid {
  title: string;
  sheets: { title: string; rows: { text: string; link?: string }[][] }[];
}

interface GridResponse {
  properties?: { title?: string };
  sheets?: {
    properties: { title: string; sheetType?: string };
    data?: { rowData?: { values?: { formattedValue?: string; hyperlink?: string }[] }[] }[];
  }[];
}

/**
 * Every grid tab's displayed values and cell hyperlinks (e.g. resume links),
 * read in one call with the read-only scope. Charts and other non-grid tabs are skipped.
 */
export async function fetchSpreadsheetGrid(spreadsheetId: string): Promise<SpreadsheetGrid> {
  const fields = "properties.title,sheets(properties(title,sheetType),data(rowData(values(formattedValue,hyperlink))))";
  const grid = await googleRequest<GridResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&fields=${encodeURIComponent(fields)}`,
  );
  return {
    title: grid.properties?.title ?? "Untitled spreadsheet",
    sheets: (grid.sheets ?? [])
      .filter(({ properties }) => !properties.sheetType || properties.sheetType === "GRID")
      .map((sheet) => ({
        title: sheet.properties.title,
        rows: (sheet.data?.[0]?.rowData ?? []).map((row) =>
          (row.values ?? []).map((cell) => ({
            text: cell.formattedValue ?? "",
            ...(cell.hyperlink ? { link: cell.hyperlink } : {}),
          }))),
      })),
  };
}
