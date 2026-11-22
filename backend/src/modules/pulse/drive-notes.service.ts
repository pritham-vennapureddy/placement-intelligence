import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { CrmRemarkInput, RsaReviewInput } from "./pulse.validators.js";

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

const remarkSelect = {
  id: true,
  interactionOn: true,
  channel: true,
  remark: true,
  nextStep: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
} as const;

const presentRemark = <T extends { interactionOn: Date }>(row: T) => ({ ...row, interactionOn: row.interactionOn.toISOString().slice(0, 10) });

/** CRM remarks and the RSA review of one job drive. */
export const driveNotesService = {
  async get(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const [remarks, review, rsa] = await Promise.all([
      prisma.jobCrmRemark.findMany({ where: { jobRequestId: job.id }, select: remarkSelect, orderBy: [{ interactionOn: "desc" }, { createdAt: "desc" }] }),
      prisma.jobRsaReview.findUnique({
        where: { jobRequestId: job.id },
        select: { wentRight: true, wentWrong: true, actionItems: true, updatedAt: true, updatedBy: { select: { id: true, fullName: true } } },
      }),
      prisma.studentSupport.findMany({
        where: { jobRequestId: job.id, kind: "RSA" },
        select: { reportSummary: true, reportUrl: true, status: { select: { countsAsDone: true } } },
      }),
    ]);
    return {
      crmRemarks: remarks.map(presentRemark),
      rsaReview: review,
      /** Per-student RSA reports already on file for this drive. */
      studentReports: {
        total: rsa.length,
        done: rsa.filter((row) => row.status.countsAsDone).length,
        withSummary: rsa.filter((row) => row.reportSummary).length,
        withLink: rsa.filter((row) => row.reportUrl).length,
      },
    };
  },

  async addRemark(user: AuthenticatedUser, jobRequestId: string, input: CrmRemarkInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    return inTransaction(async (transaction) => {
      const remark = await transaction.jobCrmRemark.create({
        data: { jobRequestId: job.id, interactionOn: toDate(input.interactionOn), channel: input.channel, remark: input.remark, nextStep: input.nextStep || null, createdById: user.id },
        select: remarkSelect,
      });
      await recordAudit(transaction, audit, { action: "CRM_REMARK_ADDED", entityType: "JobRequest", entityId: job.id, metadata: { interactionOn: input.interactionOn, channel: input.channel } });
      return presentRemark(remark);
    });
  },

  async updateRemark(user: AuthenticatedUser, jobRequestId: string, remarkId: string, input: CrmRemarkInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const existing = await prisma.jobCrmRemark.findFirst({ where: { id: remarkId, jobRequestId: job.id }, select: { id: true } });
    if (!existing) throw new ApiError(404, "CRM_REMARK_NOT_FOUND", "The CRM remark was not found.");
    return inTransaction(async (transaction) => {
      const remark = await transaction.jobCrmRemark.update({
        where: { id: existing.id },
        data: { interactionOn: toDate(input.interactionOn), channel: input.channel, remark: input.remark, nextStep: input.nextStep || null },
        select: remarkSelect,
      });
      await recordAudit(transaction, audit, { action: "CRM_REMARK_UPDATED", entityType: "JobRequest", entityId: job.id, metadata: { remarkId } });
      return presentRemark(remark);
    });
  },

  async deleteRemark(user: AuthenticatedUser, jobRequestId: string, remarkId: string, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const existing = await prisma.jobCrmRemark.findFirst({ where: { id: remarkId, jobRequestId: job.id }, select: { id: true, createdById: true, interactionOn: true } });
    if (!existing) throw new ApiError(404, "CRM_REMARK_NOT_FOUND", "The CRM remark was not found.");
    if (existing.createdById !== user.id && !user.roles.includes("ADMIN")) {
      throw new ApiError(403, "FORBIDDEN", "Only the person who wrote this remark (or an admin) can delete it.");
    }
    await inTransaction(async (transaction) => {
      await transaction.jobCrmRemark.delete({ where: { id: existing.id } });
      await recordAudit(transaction, audit, { action: "CRM_REMARK_DELETED", entityType: "JobRequest", entityId: job.id, metadata: { interactionOn: existing.interactionOn.toISOString().slice(0, 10) } });
    });
  },

  async setRsaReview(user: AuthenticatedUser, jobRequestId: string, input: RsaReviewInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const data = {
      ...(input.wentRight !== undefined ? { wentRight: input.wentRight || null } : {}),
      ...(input.wentWrong !== undefined ? { wentWrong: input.wentWrong || null } : {}),
      ...(input.actionItems !== undefined ? { actionItems: input.actionItems || null } : {}),
      updatedById: user.id,
    };
    return inTransaction(async (transaction) => {
      const review = await transaction.jobRsaReview.upsert({
        where: { jobRequestId: job.id },
        create: { jobRequestId: job.id, ...data },
        update: data,
        select: { wentRight: true, wentWrong: true, actionItems: true, updatedAt: true, updatedBy: { select: { id: true, fullName: true } } },
      });
      await recordAudit(transaction, audit, { action: "RSA_REVIEW_SAVED", entityType: "JobRequest", entityId: job.id, metadata: { fields: Object.keys(input) } });
      return review;
    });
  },
};
