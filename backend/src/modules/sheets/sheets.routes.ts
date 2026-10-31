import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { authenticate } from "../../middleware/authenticate.js";
import { authorize } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate-body.js";
import { ApiError } from "../../utils/api-error.js";
import {
  extractSpreadsheetId,
  getGoogleServiceAccountEmail,
  inspectSpreadsheet,
  readHeaderRow,
} from "./google-sheets.service.js";

export const sheetsRouter = Router();

const sourceTypes = ["COMPANY_PROCESS", "STUDENT_APPLICATIONS", "CANDIDATE_PROFILES", "ASSESSED_POOL"] as const;
const workflowStages = [
  "APPLICATIONS",
  "ACADEMY",
  "INTENSIVE",
  "EXTERNAL",
  "ASSESSED_POOL",
  "RESUME_SHORTLISTING",
  "SCREENING",
  "ASSIGNMENT",
  "TECHNICAL_ROUND_1",
  "TECHNICAL_ROUND_2",
  "HR_ROUND",
  "FINAL_STATUS",
  "REJECTION_REASON",
  "RSA_ASSESSMENT",
  "ROUND_TRANSCRIPTS",
] as const;
const columnKeys = [
  "candidate_id",
  "full_name",
  "email",
  "cohort",
  "product",
  "company",
  "role",
  "status",
  "application_date",
  "interview_round",
  "rejection_reason",
  "resume_link",
  "assessment_score",
] as const;

const createConnectionSchema = z.object({
  url: z.url(),
  sourceType: z.enum(sourceTypes),
  teamId: z.uuid().nullable().optional(),
});

const createMappingSchema = z.object({
  workflowStage: z.enum(workflowStages),
  sheetId: z.number().int().nonnegative(),
  sheetTitle: z.string().min(1).max(100),
  headerRow: z.number().int().min(1).max(500),
  columnMapping: z.record(z.enum(columnKeys), z.string().max(256)).optional(),
});

sheetsRouter.use(authenticate);

async function getVisibleConnection(connectionId: string, userId: string, isAdmin: boolean) {
  const connection = await prisma.sheetConnection.findUnique({
    where: { id: connectionId },
    include: { tabMappings: { orderBy: { workflowStage: "asc" } } },
  });
  if (!connection || (!isAdmin && connection.teamId !== (await getUserTeamId(userId)))) {
    throw new ApiError(404, "SHEET_CONNECTION_NOT_FOUND", "The spreadsheet connection was not found.");
  }
  return connection;
}

async function getUserTeamId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } });
  return user?.teamId ?? null;
}

sheetsRouter.get("/", async (request, response) => {
  const isAdmin = request.user!.roles.includes("ADMIN");
  const teamId = isAdmin ? undefined : await getUserTeamId(request.user!.id);
  const connections = await prisma.sheetConnection.findMany({
    where: isAdmin ? {} : { teamId: teamId ?? "" },
    include: {
      tabMappings: { orderBy: { workflowStage: "asc" } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  response.json({
    data: {
      connections,
      workflowStages,
      columnKeys,
      googleServiceAccountEmail: getGoogleServiceAccountEmail(),
    },
  });
});

sheetsRouter.post(
  "/",
  authorize("ADMIN", "MANAGER"),
  validateBody(createConnectionSchema),
  async (request, response) => {
    const input = request.body as z.infer<typeof createConnectionSchema>;
    const isAdmin = request.user!.roles.includes("ADMIN");
    let teamId = input.teamId ?? null;
    if (!isAdmin) {
      const team = await prisma.team.findFirst({
        where: { teamLeadId: request.user!.id },
        select: { id: true },
      });
      if (!team) {
        throw new ApiError(403, "TEAM_REQUIRED", "A team lead must be assigned to a team before adding spreadsheets.");
      }
      if (teamId && teamId !== team.id) {
        throw new ApiError(403, "FORBIDDEN", "You can only add spreadsheets to your own team.");
      }
      teamId = team.id;
    }

    if (teamId && !(await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }))) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
    }

    const spreadsheetId = extractSpreadsheetId(input.url);
    const metadata = await inspectSpreadsheet(spreadsheetId);
    const connection = await prisma.sheetConnection.create({
      data: {
        spreadsheetId,
        title: metadata.title,
        sourceType: input.sourceType,
        teamId,
        createdById: request.user!.id,
      },
      include: { tabMappings: true },
    });
    response.status(201).json({ data: { connection, tabs: metadata.tabs } });
  },
);

sheetsRouter.get("/:connectionId/tabs", async (request, response) => {
  const connection = await getVisibleConnection(
    z.string().uuid().parse(request.params.connectionId),
    request.user!.id,
    request.user!.roles.includes("ADMIN"),
  );
  const spreadsheet = await inspectSpreadsheet(connection.spreadsheetId);
  response.json({ data: { tabs: spreadsheet.tabs } });
});

sheetsRouter.get("/:connectionId/tabs/:sheetId/headers", async (request, response) => {
  const connection = await getVisibleConnection(
    z.string().uuid().parse(request.params.connectionId),
    request.user!.id,
    request.user!.roles.includes("ADMIN"),
  );
  const sheetId = z.coerce.number().int().nonnegative().safeParse(request.params.sheetId);
  const row = z.coerce.number().int().min(1).max(500).safeParse(request.query.row ?? 1);
  if (!sheetId.success || !row.success) {
    throw new ApiError(400, "INVALID_SHEET_RANGE", "Select a valid tab and header row.");
  }

  const spreadsheet = await inspectSpreadsheet(connection.spreadsheetId);
  const tab = spreadsheet.tabs.find(({ sheetId: id }) => id === sheetId.data);
  if (!tab) {
    throw new ApiError(404, "SHEET_TAB_NOT_FOUND", "The selected tab was not found in this spreadsheet.");
  }
  const headers = await readHeaderRow(connection.spreadsheetId, tab.title, row.data);
  response.json({ data: { headers: headers.map((header, index) => ({ column: index, header })) } });
});

sheetsRouter.post(
  "/:connectionId/mappings",
  authorize("ADMIN", "MANAGER"),
  validateBody(createMappingSchema),
  async (request, response) => {
    const connection = await getVisibleConnection(
      z.string().uuid().parse(request.params.connectionId),
      request.user!.id,
      request.user!.roles.includes("ADMIN"),
    );
    const input = request.body as z.infer<typeof createMappingSchema>;
    const spreadsheet = await inspectSpreadsheet(connection.spreadsheetId);
    const tab = spreadsheet.tabs.find(({ sheetId }) => sheetId === input.sheetId);
    if (!tab || tab.title !== input.sheetTitle) {
      throw new ApiError(400, "INVALID_SHEET_TAB", "The selected tab does not match the connected spreadsheet.");
    }

    const headers = await readHeaderRow(connection.spreadsheetId, tab.title, input.headerRow);
    const mappedHeaders = Object.values(input.columnMapping ?? {});
    if (mappedHeaders.some((header) => !headers.includes(header))) {
      throw new ApiError(400, "INVALID_COLUMN_MAPPING", "Choose columns from the selected tab's header row.");
    }

    const mapping = await prisma.sheetTabMapping.upsert({
      where: {
        connectionId_workflowStage: {
          connectionId: connection.id,
          workflowStage: input.workflowStage,
        },
      },
      create: {
        connectionId: connection.id,
        workflowStage: input.workflowStage,
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        headerRow: input.headerRow,
        ...(input.columnMapping ? { columnMapping: input.columnMapping } : {}),
      },
      update: {
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        headerRow: input.headerRow,
        ...(input.columnMapping ? { columnMapping: input.columnMapping } : {}),
      },
    });
    response.status(201).json({ data: { mapping } });
  },
);
