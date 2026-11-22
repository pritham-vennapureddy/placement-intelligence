import { hasPermission } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";

export const rejectionTagSelect = { id: true, label: true, builtIn: true, sortOrder: true, archivedAt: true } as const;

function assertCanManage(user: AuthenticatedUser) {
  if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to change the rejection reasons.");
}

/** Collapses spaces so "Weak  DSA " and "Weak DSA" are the same reason. */
export function cleanTagLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

async function assertLabelFree(label: string, exceptId?: string) {
  const clash = await prisma.rejectionReasonTag.findFirst({
    where: { archivedAt: null, label: { equals: label, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "REASON_EXISTS", `There is already a “${label}” reason.`);
}

/**
 * A reason a round result may be tagged with: it must exist and not be removed,
 * unless the result already has it (so an edit can keep an old reason).
 */
export async function assertUsableTag(tagId: string, currentTagIds: (string | null)[] = []) {
  const tag = await prisma.rejectionReasonTag.findUnique({ where: { id: tagId }, select: rejectionTagSelect });
  if (!tag) throw new ApiError(400, "REASON_NOT_FOUND", "Choose one of the rejection reasons in the list.");
  if (tag.archivedAt && !currentTagIds.includes(tag.id)) {
    throw new ApiError(400, "REASON_REMOVED", `“${tag.label}” was removed from the list. Choose another reason.`);
  }
  return tag;
}

export const rejectionTagsService = {
  /** Every reason, removed ones flagged, with how many round results use each. */
  async list() {
    const rows = await prisma.rejectionReasonTag.findMany({
      select: { ...rejectionTagSelect, _count: { select: { interviews: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(({ _count, ...row }) => ({ ...row, inUse: _count.interviews }));
  },

  async create(user: AuthenticatedUser, label: string, audit: AuditContext) {
    assertCanManage(user);
    const clean = cleanTagLabel(label);
    await assertLabelFree(clean);
    return inTransaction(async (transaction) => {
      const tag = await transaction.rejectionReasonTag.create({ data: { label: clean, createdById: user.id }, select: rejectionTagSelect });
      await recordAudit(transaction, audit, { action: "REJECTION_REASON_CREATED", entityType: "RejectionReasonTag", entityId: tag.id, metadata: { label: tag.label } });
      return tag;
    });
  },

  async rename(user: AuthenticatedUser, id: string, label: string, audit: AuditContext) {
    assertCanManage(user);
    const clean = cleanTagLabel(label);
    const tag = await prisma.rejectionReasonTag.findUnique({ where: { id }, select: rejectionTagSelect });
    if (!tag) throw new ApiError(404, "REASON_NOT_FOUND", "The rejection reason was not found.");
    await assertLabelFree(clean, id);
    return inTransaction(async (transaction) => {
      const updated = await transaction.rejectionReasonTag.update({ where: { id }, data: { label: clean }, select: rejectionTagSelect });
      await recordAudit(transaction, audit, { action: "REJECTION_REASON_RENAMED", entityType: "RejectionReasonTag", entityId: id, metadata: { from: tag.label, to: clean } });
      return updated;
    });
  },

  /** Removes a reason from the dropdown. Results already tagged with it keep it. */
  async remove(user: AuthenticatedUser, id: string, audit: AuditContext) {
    assertCanManage(user);
    const tag = await prisma.rejectionReasonTag.findUnique({ where: { id }, select: rejectionTagSelect });
    if (!tag) throw new ApiError(404, "REASON_NOT_FOUND", "The rejection reason was not found.");
    if (tag.archivedAt) return { ok: true };
    await inTransaction(async (transaction) => {
      await transaction.rejectionReasonTag.update({ where: { id }, data: { archivedAt: new Date() } });
      await recordAudit(transaction, audit, { action: "REJECTION_REASON_REMOVED", entityType: "RejectionReasonTag", entityId: id, metadata: { label: tag.label } });
    });
    return { ok: true };
  },
};
