import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { compare } from "bcryptjs";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { ApiError } from "../utils/api-error.js";
import { createRefreshToken, hashRefreshToken } from "../utils/refresh-token.js";

const userWithRoles = {
  roles: {
    include: { role: true },
  },
} as const;

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
};

function toPublicUser(user: {
  id: string;
  email: string;
  fullName: string;
  roles: { role: { code: string } }[];
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles.map(({ role }) => role.code),
  };
}

async function createAccessToken(user: PublicUser): Promise<string> {
  return new SignJWT({ roles: user.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
}

function getRefreshExpiration(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: userWithRoles,
  });
  const passwordMatches = user ? await compare(password, user.passwordHash) : false;

  if (!user || !user.isActive || !passwordMatches) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }

  const publicUser = toPublicUser(user);
  const refreshToken = createRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken, env.JWT_REFRESH_SECRET);

  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        familyId: randomUUID(),
        expiresAt: getRefreshExpiration(),
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "AUTH_LOGIN",
        entityType: "User",
        entityId: user.id,
      },
    }),
  ]);

  return {
    accessToken: await createAccessToken(publicUser),
    refreshToken,
    user: publicUser,
  };
}

export async function refresh(rawToken: string | undefined): Promise<AuthResult> {
  if (!rawToken) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Sign in again.");
  }

  const tokenHash = hashRefreshToken(rawToken, env.JWT_REFRESH_SECRET);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: userWithRoles } },
  });

  if (!stored) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Sign in again.");
  }

  const now = new Date();
  if (stored.revokedAt || stored.expiresAt <= now || !stored.user.isActive) {
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Sign in again.");
  }

  const nextToken = createRefreshToken();
  const nextTokenHash = hashRefreshToken(nextToken, env.JWT_REFRESH_SECRET);
  const rotated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.refreshToken.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    if (result.count !== 1) {
      await transaction.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      return false;
    }

    await transaction.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: nextTokenHash,
        familyId: stored.familyId,
        expiresAt: getRefreshExpiration(),
      },
    });
    return true;
  });

  if (!rotated) {
    throw new ApiError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Sign in again.");
  }

  const user = toPublicUser(stored.user);
  return {
    accessToken: await createAccessToken(user),
    refreshToken: nextToken,
    user,
  };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) {
    return;
  }

  const tokenHash = hashRefreshToken(rawToken, env.JWT_REFRESH_SECRET);
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });

  if (!token) {
    return;
  }

  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorId: token.userId,
        action: "AUTH_LOGOUT",
        entityType: "User",
        entityId: token.userId,
      },
    }),
  ]);
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: userWithRoles,
  });

  if (!user || !user.isActive) {
    throw new ApiError(401, "UNAUTHENTICATED", "Your account is unavailable.");
  }

  return toPublicUser(user);
}

export async function getAccessToken(userId: string): Promise<string> {
  return createAccessToken(await getCurrentUser(userId));
}
