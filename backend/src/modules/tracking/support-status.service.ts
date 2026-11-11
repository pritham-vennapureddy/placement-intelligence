import { hasPermission, type StudentSupportKind } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { definedOnly } from "../../utils/object.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { CreateStatusOptionInput, ReorderStatusOptionsInput, UpdateStatusOptionInput } from "./tracking.validators.js";

export const statusOptionSelect = {
  id: true,
  kind: true,
  label: true,
  tone: true,
  countsAsDone: true,
  needsContributor: true,
  needsNote: true,
  sortOrder: true,
  archivedAt: true,
} as const;

function assertCanManage(user: AuthenticatedUser) {
  if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to change the status list.");
}

async function assertLabelFree(kind: StudentSupportKind, label: string, exceptId?: string) {
  const clash = await prisma.supportStatusOption.findFirst({
    where: { kind, archivedAt: null, label: { equals: label, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "STATUS_EXISTS", `There is already a “${label}” status.`);
}

/**
 * A status a student's Guidance/RSA may be set to: it must belong to that task
 * and not be deleted (unless the student already has it, so an edit can keep it).
 */
export async function loadStatusForKind(statusId: string, kind: StudentSupportKind, currentStatusIds: string[] = []) {
  const option = await prisma.supportStatusOption.findUnique({ where: { id: statusId }, select: statusOptionSelect });
  if (!option || option.kind !== kind) throw new ApiError(400, "STATUS_NOT_FOUND", "Choose one of the statuses in the list.");
  if (option.archivedAt && !currentStatusIds.includes(option.id)) {
    throw new ApiError(400, "STATUS_DELETED", `“${option.label}” was deleted from the list. Choose another status.`);
  }
  return option;
}

/** The status's own rules: who did it, and whether it needs an explanation. */
export function checkStatusRules(
  option: { label: string; needsContributor: boolean; needsNote: boolean },
  input: { contributorIds: string[]; otherContributors?: string | null | undefined; notes?: string | null | undefined },
) {
  if (option.needsContributor && input.contributorIds.length === 0 && !input.otherContributors) {
    throw new ApiError(400, "CONTRIBUTOR_REQUIRED", `“${option.label}” needs who contributed. Pick a team member or type a name under Others.`);
  }
  if (option.needsNote && !input.notes) {
    throw new ApiError(400, "NOTE_REQUIRED", `“${option.label}” needs a note explaining it.`);
  }
}

export const supportStatusService = {
  /** Both lists, deleted statuses included (flagged) so old records can still be shown. */
  list() {
    return prisma.supportStatusOption.findMany({
      select: { ...statusOptionSelect, _count: { select: { supports: true } } },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }).then((rows) => rows.map(({ _count, ...row }) => ({ ...row, inUse: _count.supports })));
  },

  async create(user: AuthenticatedUser, input: CreateStatusOptionInput, audit: AuditContext) {
    assertCanManage(user);
    await assertLabelFree(input.kind, input.label);
    const last = await prisma.supportStatusOption.aggregate({ where: { kind: input.kind }, _max: { sortOrder: true } });
    return inTransaction(async (transaction) => {
      const option = await transaction.supportStatusOption.create({
        data: { ...input, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: user.id },
        select: statusOptionSelect,
      });
      await recordAudit(transaction, audit, { action: "SUPPORT_STATUS_CREATED", entityType: "SupportStatusOption", entityId: option.id, metadata: { kind: option.kind, label: option.label } });
      return option;
    });
  },

  async update(user: AuthenticatedUser, optionId: string, input: UpdateStatusOptionInput, audit: AuditContext) {
    assertCanManage(user);
    const current = await prisma.supportStatusOption.findUnique({ where: { id: optionId }, select: statusOptionSelect });
    if (!current) throw new ApiError(404, "STATUS_NOT_FOUND", "The status was not found.");
    const { restore, ...fields } = input;
    if (fields.label && fields.label.toLowerCase() !== current.label.toLowerCase()) await assertLabelFree(current.kind, fields.label, current.id);
    if (restore && current.archivedAt) await assertLabelFree(current.kind, fields.label ?? current.label, current.id);
    return inTransaction(async (transaction) => {
      const option = await transaction.supportStatusOption.update({
        where: { id: optionId },
        data: { ...definedOnly(fields), ...(restore ? { archivedAt: null } : {}) },
        select: statusOptionSelect,
      });
      await recordAudit(transaction, audit, {
        action: restore ? "SUPPORT_STATUS_RESTORED" : "SUPPORT_STATUS_UPDATED",
        entityType: "SupportStatusOption",
        entityId: optionId,
        metadata: { kind: current.kind, from: current.label, ...fields },
      });
      return option;
    });
  },

  /** Removes a status nobody uses; one already on students is hidden from the list but kept on their records. */
  async delete(user: AuthenticatedUser, optionId: string, audit: AuditContext) {
    assertCanManage(user);
    const option = await prisma.supportStatusOption.findUnique({ where: { id: optionId }, select: { ...statusOptionSelect, _count: { select: { supports: true } } } });
    if (!option) throw new ApiError(404, "STATUS_NOT_FOUND", "The status was not found.");
    const remaining = await prisma.supportStatusOption.count({ where: { kind: option.kind, archivedAt: null, id: { not: option.id } } });
    if (!option.archivedAt && remaining === 0) throw new ApiError(409, "LAST_STATUS", "Keep at least one status in the list.");
    const inUse = option._count.supports;
    await inTransaction(async (transaction) => {
      if (inUse) await transaction.supportStatusOption.update({ where: { id: optionId }, data: { archivedAt: option.archivedAt ?? new Date() } });
      else await transaction.supportStatusOption.delete({ where: { id: optionId } });
      await recordAudit(transaction, audit, {
        action: "SUPPORT_STATUS_DELETED",
        entityType: "SupportStatusOption",
        entityId: optionId,
        metadata: { kind: option.kind, label: option.label, keptOnStudents: inUse },
      });
    });
    return { removed: inUse === 0, keptOnStudents: inUse };
  },

  async reorder(user: AuthenticatedUser, input: ReorderStatusOptionsInput, audit: AuditContext) {
    assertCanManage(user);
    const ids = [...new Set(input.ids)];
    const found = await prisma.supportStatusOption.count({ where: { id: { in: ids }, kind: input.kind } });
    if (found !== ids.length) throw new ApiError(400, "STATUS_NOT_FOUND", "The list changed. Reload and try again.");
    await inTransaction(async (transaction) => {
      for (const [index, id] of ids.entries()) await transaction.supportStatusOption.update({ where: { id }, data: { sortOrder: index + 1 } });
      await recordAudit(transaction, audit, { action: "SUPPORT_STATUS_REORDERED", entityType: "SupportStatusOption", entityId: ids[0]!, metadata: { kind: input.kind } });
    });
    return { ok: true };
  },
};
