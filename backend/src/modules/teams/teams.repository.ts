import { prisma, type Db } from "../../db.js";
import type { UserRoleCode } from "./teams.validators.js";

const userSelect = {
  id: true,
  fullName: true,
  email: true,
  teamId: true,
  isActive: true,
  createdAt: true,
  roles: { select: { role: { select: { code: true } } } },
} as const;

async function roleId(db: Db, code: UserRoleCode) {
  const role = await db.role.upsert({
    where: { code },
    create: { code, name: code[0] + code.slice(1).toLowerCase() },
    update: {},
  });
  return role.id;
}

export const teamsRepository = {
  listUsers() {
    return prisma.user.findMany({ where: { isActive: true }, select: userSelect, orderBy: { fullName: "asc" } });
  },

  findUser(id: string) {
    return prisma.user.findUnique({ where: { id }, select: userSelect });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  },

  countActiveAdmins(db: Db = prisma) {
    return db.user.count({ where: { isActive: true, roles: { some: { role: { code: "ADMIN" } } } } });
  },

  async findOrCreateWorkspaceTeam(db: Db, createdById: string) {
    const existing = await db.team.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (existing) return existing.id;
    const team = await db.team.upsert({
      where: { name: "Placement Team" },
      create: { name: "Placement Team", createdById },
      update: {},
      select: { id: true },
    });
    return team.id;
  },

  async createUserWithRole(db: Db, input: { email: string; fullName: string; passwordHash: string; teamId: string; role: UserRoleCode }) {
    return db.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        teamId: input.teamId,
        roles: { create: { roleId: await roleId(db, input.role) } },
      },
      select: userSelect,
    });
  },

  /** Brings back a deleted (deactivated) account under the same email with fresh details. */
  async reactivateUser(db: Db, id: string, input: { fullName: string; passwordHash: string; teamId: string; role: UserRoleCode }) {
    await db.userRole.deleteMany({ where: { userId: id } });
    return db.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        teamId: input.teamId,
        isActive: true,
        roles: { create: { roleId: await roleId(db, input.role) } },
      },
      select: userSelect,
    });
  },

  async updateUser(db: Db, id: string, data: { email?: string; fullName?: string; role?: UserRoleCode }) {
    if (data.role) {
      await db.userRole.deleteMany({ where: { userId: id } });
      await db.userRole.create({ data: { userId: id, roleId: await roleId(db, data.role) } });
    }
    return db.user.update({
      where: { id },
      data: { ...(data.email ? { email: data.email } : {}), ...(data.fullName ? { fullName: data.fullName } : {}) },
      select: userSelect,
    });
  },

  setPassword(db: Db, id: string, passwordHash: string) {
    return db.user.update({ where: { id }, data: { passwordHash }, select: { id: true } });
  },

  deactivate(db: Db, id: string) {
    return db.user.update({ where: { id }, data: { isActive: false }, select: { id: true } });
  },

  /** Signs the user out everywhere: their refresh tokens stop working. */
  revokeSessions(db: Db, userId: string) {
    return db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },
};
