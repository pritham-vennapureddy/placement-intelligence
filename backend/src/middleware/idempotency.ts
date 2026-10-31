import type { RequestHandler } from "express";
import { IDEMPOTENCY_HEADER } from "@placement/shared";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";
import { hashRequest } from "../utils/request-hash.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Duplicate-request protection. When a mutating request carries an
 * `Idempotency-Key` header, the first successful response is stored and
 * replayed for repeats; a repeat that arrives while the first is still
 * running gets 409. Failed responses are not stored, so the client may retry.
 * Must run after `authenticate`.
 */
export const idempotency: RequestHandler = async (request, response, next) => {
  const key = request.header(IDEMPOTENCY_HEADER);
  if (!key || !MUTATING_METHODS.has(request.method) || !request.user) {
    next();
    return;
  }
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "The idempotency key is invalid.");
  }

  const userId = request.user.id;
  const requestHash = hashRequest(request.method, request.originalUrl, request.body);
  const now = new Date();
  const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different request.");
    }
    if (existing.responseStatus === null) {
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed.");
    }
    response.setHeader("Idempotent-Replayed", "true");
    if (existing.responseBody === null) {
      response.status(existing.responseStatus).end();
    } else {
      response.status(existing.responseStatus).json(existing.responseBody);
    }
    return;
  }

  if (existing) {
    await prisma.idempotencyKey.delete({ where: { id: existing.id } });
  }

  let recordId: string;
  try {
    const record = await prisma.idempotencyKey.create({
      data: {
        userId,
        key,
        method: request.method,
        path: request.originalUrl,
        requestHash,
        expiresAt: new Date(now.getTime() + KEY_TTL_MS),
      },
      select: { id: true },
    });
    recordId = record.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed.");
    }
    throw error;
  }

  let responseBody: unknown = null;
  const originalJson = response.json.bind(response);
  response.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  response.on("finish", () => {
    const succeeded = response.statusCode >= 200 && response.statusCode < 300;
    const settle = succeeded
      ? prisma.idempotencyKey.update({
        where: { id: recordId },
        data: {
          responseStatus: response.statusCode,
          responseBody: responseBody === null ? Prisma.DbNull : (responseBody as Prisma.InputJsonValue),
        },
      })
      : prisma.idempotencyKey.delete({ where: { id: recordId } });
    settle.catch((error: unknown) => logger.error({ err: error }, "Failed to settle idempotency key"));
  });

  next();
};
