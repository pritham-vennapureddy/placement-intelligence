import { DECISION_STAGES, STAGE_LABELS, type DecisionStage, type InternalStage } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { CandidatePoolType, Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { protectContact } from "../../services/pii.js";
import { ApiError } from "../../utils/api-error.js";
import { definedOnly } from "../../utils/object.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { ensureInternalProcess, screeningRepository } from "./screening.repository.js";
import type { AddToStageInput, DecisionInput, StageCandidatesQuery, UpdateStageInput } from "./screening.validators.js";

const COMPLETE = new Set(["COMPLETED", "PARTIALLY_COMPLETED"]);
const POOL_TYPES: CandidatePoolType[] = ["BUCKET", "TR", "COMPETENCY"];

const candidateSearch = (search: string | undefined): Prisma.CandidateWhereInput | undefined =>
  search
    ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search.toLowerCase() } },
        { mobile: { contains: search.replace(/\D/g, "") || search } },
        { candidateCode: { contains: search, mode: "insensitive" } },
      ],
    }
    : undefined;

async function processFor(jobRequestId: string) {
  await inTransaction((transaction) => ensureInternalProcess(transaction, jobRequestId));
  return (await screeningRepository.findProcess(jobRequestId))!;
}

export const screeningService = {
  async get(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const [process, counts, totalApplications, productCounts, stageAnalytics] = await Promise.all([
      processFor(job.id),
      screeningRepository.outcomeCounts(job.id),
      screeningRepository.countApplications(job.id),
      screeningRepository.productCounts(job.id),
      screeningRepository.stageAnalytics(job.id),
    ]);
    const countsByStage = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const entry = countsByStage.get(row.stageId) ?? {};
      entry[row.outcome] = row._count._all;
      countsByStage.set(row.stageId, entry);
    }
    const order = Object.keys(STAGE_LABELS);
    const poolProgress = await Promise.all(POOL_TYPES.map(async (poolType) => {
      const [applicants, outcomes] = await Promise.all([
        screeningRepository.countPoolApplications(job.id, poolType),
        screeningRepository.poolOutcomeCounts(job.id, poolType),
      ]);
      const countsByStageId = new Map<string, Record<string, number>>();
      for (const row of outcomes) {
        const entry = countsByStageId.get(row.stageId) ?? {};
        entry[row.outcome] = row._count._all;
        countsByStageId.set(row.stageId, entry);
      }
      const countsByStage = Object.fromEntries(DECISION_STAGES.map((stageName: DecisionStage) => {
        const stage = process.stages.find((item) => item.stage === stageName);
        const stageCounts = stage ? countsByStageId.get(stage.id) ?? {} : {};
        return [stageName, { selected: stageCounts.SELECTED ?? 0, rejected: stageCounts.REJECTED ?? 0 }];
      }));
      return { poolType, applicants, stages: countsByStage };
    }));
    return {
      id: process.id,
      shortlistingNotes: process.shortlistingNotes,
      totalApplications,
      canEdit: false,
      productCounts,
      poolProgress,
      stageAnalytics,
      stages: [...process.stages]
        .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
        .map((stage) => ({ ...stage, counts: stage.stage === "TOTAL_APPLICATIONS" ? { SELECTED: totalApplications } : countsByStage.get(stage.id) ?? {} })),
    };
  },

  async updateNotes(user: AuthenticatedUser, jobRequestId: string, shortlistingNotes: string | null, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "screening:write");
    await processFor(job.id);
    await inTransaction(async (transaction) => {
      await screeningRepository.updateNotes(transaction, job.id, shortlistingNotes);
      await recordAudit(transaction, audit, { action: "SHORTLISTING_NOTES_UPDATED", entityType: "JobRequest", entityId: job.id });
    });
    return screeningService.get(user, job.id);
  },

  /** Stage status changes only through this explicit call, and each is logged. */
  async updateStage(user: AuthenticatedUser, jobRequestId: string, stageName: InternalStage, input: UpdateStageInput, audit: AuditContext) {
    const { job, scope } = await loadJobForUser(user, jobRequestId, "screening:write");
    const process = await processFor(job.id);
    const stage = process.stages.find((entry) => entry.stage === stageName)!;
    if (input.ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: input.ownerId, isActive: true }, select: { id: true } });
      if (!owner || (scope.kind !== "organization" && !scope.ownerIds.includes(owner.id) && owner.id !== user.id)) {
        throw new ApiError(400, "INVALID_STAGE_OWNER", "Choose an active member of your team as the stage owner.");
      }
    }

    const statusChanged = input.status !== undefined && input.status !== stage.status;
    const nextStatus = input.status ?? stage.status;
    if (stageName === "SCREENING_SHORTLIST" && statusChanged && nextStatus === "NOT_CONDUCTED") {
      if (!input.skipReason) throw new ApiError(400, "SKIP_REASON_REQUIRED", "Choose why screening was not conducted.");
      if (!input.statusRemarks?.trim()) throw new ApiError(400, "SKIP_NOTE_REQUIRED", "Add a note explaining why screening was not conducted.");
    }
    // The reason belongs to a skipped stage only; clear it when the stage is conducted after all.
    const skipReason = nextStatus === "NOT_CONDUCTED" ? input.skipReason : statusChanged ? null : undefined;
    await inTransaction(async (transaction) => {
      await screeningRepository.updateStage(transaction, stage.id, definedOnly({
        status: input.status,
        ownerId: input.ownerId,
        remarks: input.remarks ?? (statusChanged && nextStatus === "NOT_CONDUCTED" ? input.statusRemarks : undefined),
        skipReason,
        nextPlannedDate: input.nextPlannedDate === undefined ? undefined : input.nextPlannedDate ? new Date(`${input.nextPlannedDate}T00:00:00Z`) : null,
        completedAt: statusChanged ? (COMPLETE.has(input.status!) ? new Date() : null) : undefined,
      }));
      if (statusChanged) {
        await screeningRepository.logStatus(transaction, stage.id, stage.status, input.status!, input.statusRemarks, user.id);
      }
      await recordAudit(transaction, audit, {
        action: statusChanged ? "STAGE_STATUS_CHANGED" : "STAGE_UPDATED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { stage: STAGE_LABELS[stageName].code, ...(statusChanged ? { from: stage.status, to: input.status } : {}), ...definedOnly({ remarks: input.statusRemarks, skipReason: input.skipReason }) },
      });
    });
    return screeningService.get(user, job.id);
  },

  /** TA lists applications; other stages list the candidates recorded at that stage. */
  async listCandidates(user: AuthenticatedUser, jobRequestId: string, stageName: InternalStage, query: StageCandidatesQuery) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const process = await processFor(job.id);
    const search = candidateSearch(query.search);
    if (stageName === "TOTAL_APPLICATIONS") {
      const [rows, total] = await screeningRepository.listApplications(job.id, search ? { candidate: search } : {}, toPrismaPage(query));
      return {
        rows: rows.map((row) => ({ application: { id: row.id, product: row.product, appliedAt: row.appliedAt, source: row.source, candidate: protectContact(user, row.candidate) } })),
        meta: buildPaginationMeta(query, total),
      };
    }
    const stage = process.stages.find((entry) => entry.stage === stageName)!;
    const [rows, total] = await screeningRepository.listStageCandidates(
      stage.id,
      {
        ...(query.outcome ? { outcome: query.outcome } : {}),
        application: { status: { not: "WITHDRAWN" }, ...(search ? { candidate: search } : {}) },
      },
      toPrismaPage(query),
    );
    return {
      rows: rows.map(({ application, techScore, commScore, ...decision }) => ({
        ...decision,
        techScore: techScore === null ? null : Number(techScore),
        commScore: commScore === null ? null : Number(commScore),
        application: { ...application, candidate: protectContact(user, application.candidate) },
      })),
      meta: buildPaginationMeta(query, total),
    };
  },

  /** Saves one candidate's decision at a stage (PSMs save progress incrementally). */
  async decide(user: AuthenticatedUser, jobRequestId: string, stageName: InternalStage, applicationId: string, input: DecisionInput, audit: AuditContext) {
    if (stageName === "TOTAL_APPLICATIONS") throw new ApiError(400, "NOT_A_DECISION_STAGE", "Total applications has no decisions; use the later stages.");
    const { job } = await loadJobForUser(user, jobRequestId, "screening:write");
    const application = await screeningRepository.findApplication(job.id, applicationId);
    if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "The applicant was not found on this job.");
    if (input.outcome === "REJECTED" && application.nomination) {
      throw new ApiError(409, "ALREADY_NOMINATED", "This candidate is already nominated to the company. Withdraw the nomination first.");
    }
    const process = await processFor(job.id);
    const stage = process.stages.find((entry) => entry.stage === stageName)!;
    const previous = await screeningRepository.findDecision(stage.id, applicationId);

    await inTransaction(async (transaction) => {
      await screeningRepository.upsertDecision(
        transaction,
        { stageId: stage.id, applicationId, jobRequestId: job.id },
        definedOnly({
          outcome: input.outcome,
          priority: input.priority,
          techScore: input.techScore,
          commScore: input.commScore,
          rejectionReason: input.rejectionReason,
          remarks: input.remarks,
          source: "MANUAL" as const,
          decidedById: user.id,
          decidedAt: new Date(),
        }) as { outcome: typeof input.outcome },
      );
      await recordAudit(transaction, audit, {
        action: "STAGE_DECISION_RECORDED",
        entityType: "Application",
        entityId: applicationId,
        metadata: { stage: STAGE_LABELS[stageName].code, from: previous?.outcome ?? null, to: input.outcome, reason: input.rejectionReason ?? null },
      });
    });
    return { ok: true };
  },

  /** Manual candidate selection: put applicants on a stage. */
  async addToStage(user: AuthenticatedUser, jobRequestId: string, stageName: InternalStage, input: AddToStageInput, audit: AuditContext) {
    if (stageName === "TOTAL_APPLICATIONS") throw new ApiError(400, "NOT_A_DECISION_STAGE", "Add applicants to the job first; Total applications lists them all.");
    const { job } = await loadJobForUser(user, jobRequestId, "screening:write");
    const ids = [...new Set(input.applicationIds)];
    if ((await screeningRepository.countApplicationsIn(job.id, ids)) !== ids.length) {
      throw new ApiError(400, "INVALID_APPLICATION", "Some selected candidates are not applicants of this job.");
    }
    const process = await processFor(job.id);
    const stage = process.stages.find((entry) => entry.stage === stageName)!;
    const result = await inTransaction(async (transaction) => {
      const created = await screeningRepository.addToStage(
        transaction,
        ids.map((applicationId) => ({ stageId: stage.id, applicationId, jobRequestId: job.id, outcome: input.outcome, decidedById: user.id })),
      );
      await recordAudit(transaction, audit, {
        action: "CANDIDATES_ADDED_TO_STAGE",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { stage: STAGE_LABELS[stageName].code, count: created.count, outcome: input.outcome },
      });
      return created;
    });
    return { added: result.count, alreadyThere: ids.length - result.count };
  },
};
