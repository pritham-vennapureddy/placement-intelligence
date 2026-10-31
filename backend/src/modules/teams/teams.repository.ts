import { prisma, type Db } from "../../db.js";

const teamInclude = {
  teamLead: { select: { id: true, fullName: true, email: true, isActive: true } },
  members: {
    where: { isActive: true },
    select: {
      id: true,
      fullName: true,
      email: true,
      roles: { select: { role: { select: { code: true } } } },
    },
    orderBy: { fullName: "asc" as const },
  },
  _count: { select: { members: true, sheetConnections: true } },
} as const;

export const teamsRepository = {
  listTeams() {
    return prisma.team.findMany({ include: teamInclude, orderBy: { name: "asc" } });
  },

  findTeamLedBy(userId: string) {
    return prisma.team.findFirst({ where: { teamLeadId: userId }, include: teamInclude });
  },

  findTeamWithMembers(teamId: string, db: Db = prisma) {
    return db.team.findUniqueOrThrow({ where: { id: teamId }, include: teamInclude });
  },

  findTeam(teamId: string) {
    return prisma.team.findUnique({ where: { id: teamId } });
  },

  listAssignableUsers() {
    return prisma.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { code: { in: ["MANAGER", "PSM"] } } } },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        teamId: true,
        roles: { select: { role: { select: { code: true } } } },
      },
      orderBy: { fullName: "asc" },
    });
  },

  createTeam(db: Db, name: string, createdById: string) {
    return db.team.create({ data: { name, createdById }, select: { id: true } });
  },

  emailExists(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } }).then(Boolean);
  },

  async createUserWithRole(
    db: Db,
    input: { email: string; fullName: string; passwordHash: string; teamId?: string; role: "MANAGER" | "PSM" },
  ) {
    const role = await db.role.upsert({
      where: { code: input.role },
      create: {
        code: input.role,
        name: input.role === "MANAGER" ? "Team Lead" : "Placement Success Manager",
      },
      update: {},
    });
    return db.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        roles: { create: { roleId: role.id } },
      },
      select: { id: true, fullName: true, email: true, isActive: true, teamId: true },
    });
  },

  setTeamLead(db: Db, teamId: string, teamLeadId: string | null) {
    return db.team.update({ where: { id: teamId }, data: { teamLeadId } });
  },

  findActiveUsersWithRoles(ids: string[]) {
    return prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, roles: { select: { role: { select: { code: true } } } } },
    });
  },

  /** Rewrites a team's lead and PSM membership. Call inside a transaction. */
  async replaceMembers(
    db: Db,
    team: { id: string; teamLeadId: string | null },
    teamLeadId: string | null,
    psmIds: string[],
  ): Promise<void> {
    if (teamLeadId) {
      await db.team.updateMany({
        where: { teamLeadId, id: { not: team.id } },
        data: { teamLeadId: null },
      });
    }

    if (team.teamLeadId && team.teamLeadId !== teamLeadId) {
      await db.user.updateMany({
        where: { id: team.teamLeadId, teamId: team.id },
        data: { teamId: null },
      });
    }
    if (teamLeadId) {
      await db.user.update({ where: { id: teamLeadId }, data: { teamId: team.id } });
    }

    const currentPsms = await db.user.findMany({
      where: { teamId: team.id, roles: { some: { role: { code: "PSM" } } } },
      select: { id: true },
    });
    const removedIds = currentPsms.map(({ id }) => id).filter((id) => !psmIds.includes(id));
    if (removedIds.length > 0) {
      await db.user.updateMany({
        where: { id: { in: removedIds }, teamId: team.id },
        data: { teamId: null },
      });
    }
    if (psmIds.length > 0) {
      await db.user.updateMany({
        where: { id: { in: psmIds }, isActive: true },
        data: { teamId: team.id },
      });
    }
    await db.team.update({ where: { id: team.id }, data: { teamLeadId } });
  },
};
