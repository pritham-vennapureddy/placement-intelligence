import type { Request } from "express";
import type { Db } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";

const SENSITIVE_KEY = /password|token|secret|email|mobile|phone/i;
const REDACTED = "[REDACTED]";

export interface AuditContext {
  actorId: string | null;
  requestId: string | null;
  ipAddress: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/** Recursively replaces values whose key looks like credentials or candidate PII. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(inner)]),
    );
  }
  return value;
}

export function auditContextFrom(request: Request): AuditContext {
  return {
    actorId: request.user?.id ?? null,
    requestId: typeof request.id === "string" ? request.id : null,
    ipAddress: request.ip ?? null,
  };
}

/** Writes an audit event. Pass a transaction client to keep it atomic with the change. */
export async function recordAudit(db: Db, context: AuditContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: context.actorId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(entry.metadata ? { metadata: redactSensitive(entry.metadata) as Prisma.InputJsonValue } : {}),
    },
  });
}
