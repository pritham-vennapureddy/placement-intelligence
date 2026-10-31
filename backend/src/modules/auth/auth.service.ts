import { randomBytes, randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { SignJWT } from "jose";
import { ApiError } from "../../utils/api-error.js";
import { createRefreshToken, hashRefreshToken } from "../../utils/refresh-token.js";
import type { AuditContext } from "../audit/audit.service.js";
import type { AuthRepository, UserRecord } from "./auth.repository.js";

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  now: () => Date;
}

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists. Generated once, on first use.
let dummyPasswordHash: Promise<string> | undefined;
const getDummyPasswordHash = () => (dummyPasswordHash ??= hash(randomBytes(16).toString("hex"), 12));

const invalidSession = () =>
  new ApiError(401, "INVALID_REFRESH_TOKEN", "Your session has expired. Sign in again.");

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles.map(({ role }) => role.code),
  };
}

export function createAuthService(repository: AuthRepository, config: AuthConfig) {
  const refreshExpiry = () =>
    new Date(config.now().getTime() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const createAccessToken = (user: PublicUser) =>
    new SignJWT({ roles: user.roles })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
      .sign(new TextEncoder().encode(config.accessSecret));

  return {
    async login(email: string, password: string, audit: Omit<AuditContext, "actorId">): Promise<AuthResult> {
      const user = await repository.findUserByEmail(email.toLowerCase());
      const passwordMatches = await compare(password, user?.passwordHash ?? (await getDummyPasswordHash()));

      if (!user || !user.isActive || !passwordMatches) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
      }

      const publicUser = toPublicUser(user);
      const refreshToken = createRefreshToken();
      await repository.createSession(
        {
          userId: user.id,
          tokenHash: hashRefreshToken(refreshToken, config.refreshSecret),
          familyId: randomUUID(),
          expiresAt: refreshExpiry(),
        },
        { ...audit, actorId: user.id },
      );

      return { accessToken: await createAccessToken(publicUser), refreshToken, user: publicUser };
    },

    async refresh(rawToken: string | undefined): Promise<AuthResult> {
      if (!rawToken) {
        throw invalidSession();
      }

      const stored = await repository.findRefreshToken(hashRefreshToken(rawToken, config.refreshSecret));
      if (!stored) {
        throw invalidSession();
      }

      const now = config.now();
      if (stored.revokedAt) {
        // A revoked token being presented again means it was stolen or replayed:
        // end every session descended from the same login.
        await repository.revokeFamily(stored.familyId, now);
        throw invalidSession();
      }
      if (stored.expiresAt <= now || !stored.user.isActive) {
        throw invalidSession();
      }

      const nextToken = createRefreshToken();
      const rotated = await repository.rotate(stored.id, stored.familyId, now, {
        userId: stored.userId,
        tokenHash: hashRefreshToken(nextToken, config.refreshSecret),
        familyId: stored.familyId,
        expiresAt: refreshExpiry(),
      });
      if (!rotated) {
        throw invalidSession();
      }

      const user = toPublicUser(stored.user);
      return { accessToken: await createAccessToken(user), refreshToken: nextToken, user };
    },

    async logout(rawToken: string | undefined): Promise<void> {
      if (rawToken) {
        await repository.revokeSession(hashRefreshToken(rawToken, config.refreshSecret), config.now());
      }
    },

    async getCurrentUser(userId: string): Promise<PublicUser> {
      const user = await repository.findUserById(userId);
      if (!user || !user.isActive) {
        throw new ApiError(401, "UNAUTHENTICATED", "Your account is unavailable.");
      }
      return toPublicUser(user);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
