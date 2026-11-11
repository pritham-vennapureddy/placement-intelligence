import { prisma, type Db } from "../../db.js";
import type { CandidatePoolType, Prisma } from "../../generated/prisma/client.js";
import type { sourceTypes } from "./sheets.validators.js";

const connectionInclude = {
  tabMappings: { orderBy: { workflowStage: "asc" as const } },
  team: { select: { id: true, name: true } },
} as const;

export const sheetsRepository = {
  /** `teamId` undefined = all connections (admin); null = none. */
  listConnections(teamId: string | null | undefined) {
    if (teamId === null) {
      return Promise.resolve([]);
    }
    return prisma.sheetConnection.findMany({
      where: teamId === undefined ? {} : { teamId },
      include: connectionInclude,
      orderBy: { updatedAt: "desc" },
    });
  },

  findConnection(id: string) {
    return prisma.sheetConnection.findUnique({ where: { id }, include: connectionInclude });
  },

  async findUserTeamId(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } });
    return user?.teamId ?? null;
  },

  async findWorkspaceTeamId(): Promise<string | null> {
    const team = await prisma.team.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    return team?.id ?? null;
  },

  createConnection(
    db: Db,
    data: {
      spreadsheetId: string;
      title: string;
      sourceType: (typeof sourceTypes)[number];
      teamId: string | null;
      createdById: string;
    },
  ) {
    return db.sheetConnection.create({ data, include: { tabMappings: true } });
  },

  upsertTabMapping(
    db: Db,
    connectionId: string,
    workflowStage: string,
    values: { sheetId: number; sheetTitle: string; headerRow: number; columnMapping?: Prisma.InputJsonValue },
  ) {
    return db.sheetTabMapping.upsert({
      where: { connectionId_workflowStage: { connectionId, workflowStage } },
      create: { connectionId, workflowStage, ...values },
      update: values,
    });
  },

  findCandidatesByCodes(candidateCodes: string[]) {
    return prisma.candidate.findMany({
      where: { candidateCode: { in: candidateCodes } },
      select: { id: true, candidateCode: true },
    });
  },

  async replacePoolMemberships(
    db: Db,
    sourceConnectionId: string,
    entries: { candidateCode: string; candidateId: string | null; poolType: CandidatePoolType; sourceConnectionId: string }[],
  ) {
    await db.candidatePoolMembership.deleteMany({
      where: { sourceConnectionId },
    });
    if (entries.length > 0) {
      await db.candidatePoolMembership.createMany({ data: entries });
    }
  },
};
