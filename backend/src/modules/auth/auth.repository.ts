import { prisma } from "../../db.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";

const userWithRoles = {
  roles: { select: { role: { select: { code: true } } } },
} as const;

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  isActive: boolean;
  roles: { role: { code: string } }[];
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: UserRecord;
}

export interface NewRefreshToken {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  /** Stores a new session token and the login audit event atomically. */
  createSession(token: NewRefreshToken, audit: AuditContext): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  /**
   * Revokes `currentId` and stores `next` in one transaction. Returns false —
   * and revokes the whole family — if `currentId` was already used or expired.
   */
  rotate(currentId: string, familyId: string, at: Date, next: NewRefreshToken): Promise<boolean>;
  /** Revokes one token and records the logout. Returns false if the token is unknown. */
  revokeSession(tokenHash: string, at: Date): Promise<boolean>;
}

export const authRepository: AuthRepository = {
  findUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, include: userWithRoles });
  },

  findUserById(id) {
    return prisma.user.findUnique({ where: { id }, include: userWithRoles });
  },

  findRefreshToken(tokenHash) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: userWithRoles } },
    });
  },

  async createSession(token, audit) {
    await prisma.$transaction(async (transaction) => {
      await transaction.refreshToken.create({ data: token });
      await recordAudit(transaction, audit, { action: "AUTH_LOGIN", entityType: "User", entityId: token.userId });
    });
  },

  async revokeFamily(familyId, at) {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  },

  rotate(currentId, familyId, at, next) {
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.refreshToken.updateMany({
        where: { id: currentId, revokedAt: null, expiresAt: { gt: at } },
        data: { revokedAt: at },
      });

      if (result.count !== 1) {
        await transaction.refreshToken.updateMany({
          where: { familyId, revokedAt: null },
          data: { revokedAt: at },
        });
        return false;
      }

      await transaction.refreshToken.create({ data: next });
      return true;
    });
  },

  async revokeSession(tokenHash, at) {
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    if (!token) {
      return false;
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: at },
      });
      await recordAudit(
        transaction,
        { actorId: token.userId, requestId: null, ipAddress: null },
        { action: "AUTH_LOGOUT", entityType: "User", entityId: token.userId },
      );
    });
    return true;
  },
};
