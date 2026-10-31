import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { hashSync } from "bcryptjs";
import { jwtVerify } from "jose";
import { ApiError } from "../../utils/api-error.js";
import type { AuthRepository, NewRefreshToken, UserRecord } from "./auth.repository.js";
import { createAuthService } from "./auth.service.js";

const ACCESS_SECRET = "access-secret-for-tests-0123456789";
const REFRESH_SECRET = "refresh-secret-for-tests-0123456789";

interface TokenRow extends NewRefreshToken {
  id: string;
  revokedAt: Date | null;
}

/** In-memory repository with the same rotation semantics as the Prisma one. */
function createFakeRepository(users: UserRecord[]) {
  const tokens: TokenRow[] = [];
  const audits: { actorId: string | null; requestId: string | null }[] = [];
  let nextId = 0;

  const repository: AuthRepository = {
    async findUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findUserById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
    async findRefreshToken(tokenHash) {
      const token = tokens.find((row) => row.tokenHash === tokenHash);
      const user = token && users.find(({ id }) => id === token.userId);
      return token && user ? { ...token, user } : null;
    },
    async createSession(token, audit) {
      tokens.push({ ...token, id: String(nextId++), revokedAt: null });
      audits.push({ actorId: audit.actorId, requestId: audit.requestId });
    },
    async revokeFamily(familyId, at) {
      for (const row of tokens) {
        if (row.familyId === familyId && !row.revokedAt) row.revokedAt = at;
      }
    },
    async rotate(currentId, familyId, at, next) {
      const current = tokens.find(({ id }) => id === currentId);
      if (!current || current.revokedAt || current.expiresAt <= at) {
        await repository.revokeFamily(familyId, at);
        return false;
      }
      current.revokedAt = at;
      tokens.push({ ...next, id: String(nextId++), revokedAt: null });
      return true;
    },
    async revokeSession(tokenHash, at) {
      const token = tokens.find((row) => row.tokenHash === tokenHash);
      if (!token) return false;
      token.revokedAt ??= at;
      return true;
    },
  };

  return { repository, tokens, audits };
}

const psm: UserRecord = {
  id: "user-1",
  email: "psm@example.com",
  fullName: "Priya PSM",
  passwordHash: hashSync("correct horse battery", 4),
  isActive: true,
  roles: [{ role: { code: "PSM" } }],
};

const audit = { requestId: "req-1", ipAddress: "127.0.0.1" };

describe("auth service", () => {
  let now: Date;
  let fake: ReturnType<typeof createFakeRepository>;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    now = new Date("2026-10-31T10:00:00Z");
    fake = createFakeRepository([psm, { ...psm, id: "user-2", email: "gone@example.com", isActive: false }]);
    service = createAuthService(fake.repository, {
      accessSecret: ACCESS_SECRET,
      refreshSecret: REFRESH_SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      now: () => now,
    });
  });

  test("login issues a signed access token and stores only a hash of the refresh token", async () => {
    const result = await service.login("PSM@example.com", "correct horse battery", audit);

    const { payload } = await jwtVerify(result.accessToken, new TextEncoder().encode(ACCESS_SECRET));
    assert.equal(payload.sub, psm.id);
    assert.deepEqual(payload.roles, ["PSM"]);
    assert.equal(fake.tokens.length, 1);
    assert.notEqual(fake.tokens[0]!.tokenHash, result.refreshToken);
    assert.deepEqual(fake.audits, [{ actorId: psm.id, requestId: "req-1" }]);
  });

  test("login rejects wrong passwords, unknown emails and inactive users with the same error", async () => {
    for (const [email, password] of [
      ["psm@example.com", "wrong"],
      ["nobody@example.com", "correct horse battery"],
      ["gone@example.com", "correct horse battery"],
    ] as const) {
      await assert.rejects(service.login(email, password, audit), (error: unknown) =>
        error instanceof ApiError && error.code === "INVALID_CREDENTIALS");
    }
    assert.equal(fake.tokens.length, 0);
  });

  test("refresh rotates the token: the old one is revoked and the new one works", async () => {
    const first = await service.login(psm.email, "correct horse battery", audit);
    const second = await service.refresh(first.refreshToken);

    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.ok(fake.tokens[0]!.revokedAt);
    const third = await service.refresh(second.refreshToken);
    assert.equal(third.user.id, psm.id);
  });

  test("reusing a rotated token revokes the whole session family", async () => {
    const first = await service.login(psm.email, "correct horse battery", audit);
    const second = await service.refresh(first.refreshToken);

    await assert.rejects(service.refresh(first.refreshToken), (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_REFRESH_TOKEN");
    assert.ok(fake.tokens.every((row) => row.revokedAt));
    await assert.rejects(service.refresh(second.refreshToken));
  });

  test("an expired token is rejected without revoking other sessions", async () => {
    const first = await service.login(psm.email, "correct horse battery", audit);
    const other = await service.login(psm.email, "correct horse battery", audit);
    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

    await assert.rejects(service.refresh(first.refreshToken));
    assert.equal(fake.tokens.find((row) => row.familyId !== fake.tokens[0]!.familyId)?.revokedAt, null);
    assert.ok(other.refreshToken);
  });

  test("refresh without a cookie or with an unknown token is rejected", async () => {
    await assert.rejects(service.refresh(undefined));
    await assert.rejects(service.refresh("not-a-real-token"));
  });

  test("logout revokes the presented token", async () => {
    const session = await service.login(psm.email, "correct horse battery", audit);
    await service.logout(session.refreshToken);
    await assert.rejects(service.refresh(session.refreshToken));
  });
});
