import { canMovePipeline, hasPermission, PIPELINE_STATUS_LABELS, type PipelineStatus } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { protectContact } from "../../services/pii.js";
import { ApiError } from "../../utils/api-error.js";
import { definedOnly } from "../../utils/object.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { candidateSummarySelect } from "../screening/screening.repository.js";
import { assertUsableTag } from "../rejection-tags/rejection-tags.service.js";
import { syncJobProcessDates } from "./job-process-dates.js";
import type { BulkInterviewInput, BulkProcessDatesInput, CreateRoundInput, DirectShareInput, InterviewInput, NominateInput, PipelineStatusInput, ProcessDatesInput, UpdateRoundInput } from "./pipeline.validators.js";

/** Date fields each status records. */
const STATUS_DATES: Partial<Record<PipelineStatus, "submittedAt" | "offerReleasedAt" | "offerAcceptedAt" | "joinedAt">> = {
  IN_PROCESS: "submittedAt",
  OFFER_RELEASED: "offerReleasedAt",
  OFFER_ACCEPTED: "offerAcceptedAt",
  JOINED: "joinedAt",
};

async function loadNomination(jobRequestId: string, nominationId: string) {
  const nomination = await prisma.companyNomination.findFirst({
    where: { id: nominationId, jobRequestId },
    select: { id: true, status: true, pipelineStatus: true, applicationId: true },
  });
  if (!nomination) throw new ApiError(404, "NOMINATION_NOT_FOUND", "The nomination was not found.");
  return nomination;
}

export const pipelineService = {
  async get(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const [rounds, nominations, eligible] = await Promise.all([
      prisma.companyInterviewRound.findMany({
        where: { jobRequestId: job.id },
        select: { id: true, name: true, roundType: true, sequence: true, _count: { select: { interviews: true } } },
        orderBy: { sequence: "asc" },
      }),
      prisma.companyNomination.findMany({
        where: { jobRequestId: job.id },
        select: {
          id: true,
          status: true,
          pipelineStatus: true,
          source: true,
          submittedAt: true,
          offerReleasedAt: true,
          offerAcceptedAt: true,
          joinedAt: true,
          processStartDate: true,
          processEndDate: true,
          directShareReason: true,
          directShareNote: true,
          remarks: true,
          createdAt: true,
          nominatedBy: { select: { fullName: true } },
          application: {
            select: {
              id: true,
              product: { select: { code: true, name: true, category: true } },
              candidate: { select: candidateSummarySelect },
              stageOutcomes: { where: { stage: { stage: "FINAL_SHORTLIST" } }, select: { outcome: true, priority: true } },
            },
          },
          interviews: { select: { roundId: true, outcome: true, scheduledAt: true, interviewerName: true, feedback: true, rejectionReason: true, rejectionDocUrl: true, rejectionTag: { select: { id: true, label: true, archivedAt: true } } } },
          stageHistory: {
            select: { fromStatus: true, toStatus: true, notes: true, source: true, changedAt: true, changedBy: { select: { fullName: true } } },
            orderBy: { changedAt: "desc" },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.application.count({
        where: { jobRequestId: job.id, nomination: null, status: "ACTIVE", stageOutcomes: { none: { outcome: "REJECTED" } } },
      }),
    ]);
    return {
      canEdit: hasPermission(user.roles, "pipeline:write"),
      rounds: rounds.map(({ _count, ...round }) => ({ ...round, interviews: _count.interviews })),
      nominations: nominations.map(({ application, ...nomination }) => ({
        ...nomination,
        application: { ...application, candidate: protectContact(user, application.candidate) },
      })),
      eligibleToNominate: eligible,
    };
  },

  /** Applicants who can be nominated: not rejected at any internal stage and not nominated yet. */
  async eligible(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const applications = await prisma.application.findMany({
      where: { jobRequestId: job.id, nomination: null, status: "ACTIVE", stageOutcomes: { none: { outcome: "REJECTED" } } },
      select: {
        id: true,
        product: { select: { code: true, name: true } },
        candidate: { select: candidateSummarySelect },
        stageOutcomes: { select: { outcome: true, priority: true, stage: { select: { stage: true } } } },
      },
      orderBy: { appliedAt: "asc" },
      take: 2000,
    });
    return applications.map(({ stageOutcomes, candidate, ...application }) => ({
      ...application,
      candidate: protectContact(user, candidate),
      outcomes: Object.fromEntries(stageOutcomes.map(({ outcome, stage }) => [stage.stage, outcome])),
      finalPriority: stageOutcomes.find(({ stage }) => stage.stage === "FINAL_SHORTLIST")?.priority ?? null,
    }));
  },

  async createRound(user: AuthenticatedUser, jobRequestId: string, input: CreateRoundInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    // Rounds added by hand go to the job's first active recruitment batch, as imports do by default.
    const batch = await prisma.recruitmentBatch.findFirst({ where: { jobRequestId: job.id, status: "ACTIVE" }, orderBy: { sequence: "asc" }, select: { id: true } });
    if (!batch) throw new ApiError(409, "RECRUITMENT_BATCH_MISSING", "Create an active recruitment batch before adding rounds.");
    return inTransaction(async (transaction) => {
      const last = await transaction.companyInterviewRound.aggregate({ where: { jobRequestId: job.id, recruitmentBatchId: batch.id }, _max: { sequence: true } });
      const round = await transaction.companyInterviewRound.create({
        data: { jobRequestId: job.id, recruitmentBatchId: batch.id, name: input.name, roundType: input.roundType, sequence: (last._max.sequence ?? 0) + 1 },
      });
      await recordAudit(transaction, audit, { action: "ROUND_ADDED", entityType: "JobRequest", entityId: job.id, metadata: { name: input.name } });
      return round;
    });
  },

  async updateRound(user: AuthenticatedUser, jobRequestId: string, roundId: string, input: UpdateRoundInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const round = await prisma.companyInterviewRound.findFirst({ where: { id: roundId, jobRequestId: job.id } });
    if (!round) throw new ApiError(404, "ROUND_NOT_FOUND", "The round was not found.");
    return inTransaction(async (transaction) => {
      const updated = await transaction.companyInterviewRound.update({ where: { id: round.id }, data: definedOnly(input) });
      await recordAudit(transaction, audit, { action: "ROUND_UPDATED", entityType: "JobRequest", entityId: job.id, metadata: { from: round.name, ...input } });
      return updated;
    });
  },

  async deleteRound(user: AuthenticatedUser, jobRequestId: string, roundId: string, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const round = await prisma.companyInterviewRound.findFirst({ where: { id: roundId, jobRequestId: job.id }, select: { id: true, name: true, _count: { select: { interviews: true } } } });
    if (!round) throw new ApiError(404, "ROUND_NOT_FOUND", "The round was not found.");
    if (round._count.interviews > 0) throw new ApiError(409, "ROUND_IN_USE", "This round already has candidate outcomes and cannot be removed.");
    await inTransaction(async (transaction) => {
      await transaction.companyInterviewRound.delete({ where: { id: round.id } });
      await recordAudit(transaction, audit, { action: "ROUND_REMOVED", entityType: "JobRequest", entityId: job.id, metadata: { name: round.name } });
    });
  },

  async reorderRounds(user: AuthenticatedUser, jobRequestId: string, roundIds: string[], audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const rounds = await prisma.companyInterviewRound.findMany({ where: { jobRequestId: job.id }, select: { id: true } });
    if (rounds.length !== roundIds.length || !rounds.every(({ id }) => roundIds.includes(id))) {
      throw new ApiError(400, "INVALID_ROUND_ORDER", "List every round of this job exactly once.");
    }
    await inTransaction(async (transaction) => {
      for (const [index, id] of roundIds.entries()) {
        await transaction.companyInterviewRound.update({ where: { id }, data: { sequence: index + 1 } });
      }
      await recordAudit(transaction, audit, { action: "ROUNDS_REORDERED", entityType: "JobRequest", entityId: job.id });
    });
  },

  /** The PSM nominates directly; internally rejected candidates are refused. */
  async nominate(user: AuthenticatedUser, jobRequestId: string, input: NominateInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const ids = [...new Set(input.applicationIds)];
    const applications = await prisma.application.findMany({
      where: { id: { in: ids }, jobRequestId: job.id },
      select: {
        id: true,
        nomination: { select: { id: true } },
        candidate: { select: { fullName: true } },
        stageOutcomes: { where: { outcome: "REJECTED" }, select: { stage: { select: { stage: true } } } },
      },
    });
    if (applications.length !== ids.length) throw new ApiError(400, "INVALID_APPLICATION", "Some selected candidates are not applicants of this job.");
    const rejected = applications.filter(({ stageOutcomes }) => stageOutcomes.length > 0);
    if (rejected.length > 0) {
      throw new ApiError(409, "INTERNALLY_REJECTED", `Rejected in internal screening, so cannot be nominated: ${rejected.map(({ candidate }) => candidate.fullName).join(", ")}.`);
    }
    const fresh = applications.filter(({ nomination }) => !nomination);
    return inTransaction(async (transaction) => {
      const result = await transaction.companyNomination.createMany({
        data: fresh.map(({ id }) => ({ applicationId: id, jobRequestId: job.id, nominatedById: user.id, ...(input.remarks ? { remarks: input.remarks } : {}) })),
        skipDuplicates: true,
      });
      await recordAudit(transaction, audit, { action: "CANDIDATES_NOMINATED", entityType: "JobRequest", entityId: job.id, metadata: { count: result.count } });
      return { nominated: result.count, alreadyNominated: ids.length - fresh.length };
    });
  },

  async changeStatus(user: AuthenticatedUser, jobRequestId: string, nominationId: string, input: PipelineStatusInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const nomination = await loadNomination(job.id, nominationId);
    if (nomination.status === "WITHDRAWN") throw new ApiError(409, "NOMINATION_WITHDRAWN", "This nomination was withdrawn.");
    if (!canMovePipeline(nomination.pipelineStatus, input.status)) {
      throw new ApiError(
        409,
        "INVALID_PIPELINE_CHANGE",
        `“${PIPELINE_STATUS_LABELS[nomination.pipelineStatus]}” cannot move to “${PIPELINE_STATUS_LABELS[input.status]}”.`,
      );
    }
    const at = input.date ? new Date(`${input.date}T00:00:00Z`) : new Date();
    const dateField = STATUS_DATES[input.status];
    await inTransaction(async (transaction) => {
      await transaction.companyNomination.update({
        where: { id: nomination.id },
        data: {
          pipelineStatus: input.status,
          ...(dateField ? { [dateField]: at } : {}),
          // Selected: the date is the interview-done (hired) date, which decides the placement's month.
          ...(input.status === "SELECTED" && input.date ? { processEndDate: at } : {}),
        },
      });
      await transaction.companyStageHistory.create({
        data: {
          nominationId: nomination.id,
          fromStatus: nomination.pipelineStatus,
          toStatus: input.status,
          changedById: user.id,
          changedAt: at,
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
      await recordAudit(transaction, audit, {
        action: "PIPELINE_STATUS_CHANGED",
        entityType: "Application",
        entityId: nomination.applicationId,
        metadata: { from: nomination.pipelineStatus, to: input.status, date: input.date ?? null, notes: input.notes ?? null },
      });
      await syncJobProcessDates(transaction, job.id);
    });
    return { ok: true };
  },

  /** Hand-entered start / end dates of this student's company process. */
  async setProcessDates(user: AuthenticatedUser, jobRequestId: string, nominationId: string, input: ProcessDatesInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const nomination = await loadNomination(job.id, nominationId);
    const toDay = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
    await inTransaction(async (transaction) => {
      await transaction.companyNomination.update({
        where: { id: nomination.id },
        data: { processStartDate: toDay(input.startDate), processEndDate: toDay(input.endDate) },
      });
      await recordAudit(transaction, audit, {
        action: "STUDENT_PROCESS_DATES_CHANGED",
        entityType: "Application",
        entityId: nomination.applicationId,
        metadata: { startDate: input.startDate, endDate: input.endDate },
      });
      await syncJobProcessDates(transaction, job.id);
    });
    return { ok: true };
  },

  /**
   * The same start and/or end date for many students at once; a date left out
   * keeps each student's own. The job's company process dates follow.
   */
  async setProcessDatesBulk(user: AuthenticatedUser, jobRequestId: string, input: BulkProcessDatesInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const ids = [...new Set(input.nominationIds)];
    const nominations = await prisma.companyNomination.findMany({
      where: { jobRequestId: job.id, id: { in: ids } },
      select: { id: true, processStartDate: true, processEndDate: true, application: { select: { candidate: { select: { fullName: true } } } } },
    });
    if (nominations.length !== ids.length) throw new ApiError(404, "NOMINATION_NOT_FOUND", "Some of these students are not on this job.");
    const toDay = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
    const start = input.startDate === undefined ? undefined : toDay(input.startDate);
    const end = input.endDate === undefined ? undefined : toDay(input.endDate);
    const clash = nominations.filter((nomination) => {
      const nextStart = start === undefined ? nomination.processStartDate : start;
      const nextEnd = end === undefined ? nomination.processEndDate : end;
      return nextStart && nextEnd && nextEnd < nextStart;
    });
    if (clash.length > 0) {
      const names = clash.slice(0, 3).map((nomination) => nomination.application.candidate.fullName).join(", ");
      throw new ApiError(400, "INVALID_PROCESS_DATES", `The end date would be before the start date for ${names}${clash.length > 3 ? ` and ${clash.length - 3} more` : ""}.`);
    }
    await inTransaction(async (transaction) => {
      await transaction.companyNomination.updateMany({
        where: { id: { in: ids } },
        data: { ...(start !== undefined ? { processStartDate: start } : {}), ...(end !== undefined ? { processEndDate: end } : {}) },
      });
      await recordAudit(transaction, audit, {
        action: "STUDENT_PROCESS_DATES_CHANGED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { students: ids.length, startDate: input.startDate ?? "unchanged", endDate: input.endDate ?? "unchanged" },
      });
      await syncJobProcessDates(transaction, job.id);
    });
    return { updated: ids.length };
  },

  /** Tags why profiles went to the company without the internal shortlist (one or many at once). */
  async setDirectShare(user: AuthenticatedUser, jobRequestId: string, input: DirectShareInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const ids = [...new Set(input.nominationIds)];
    const note = input.reason ? input.note?.trim() || null : null;
    return inTransaction(async (transaction) => {
      const result = await transaction.companyNomination.updateMany({
        where: { jobRequestId: job.id, id: { in: ids } },
        data: { directShareReason: input.reason, directShareNote: note },
      });
      if (result.count !== ids.length) throw new ApiError(404, "NOMINATION_NOT_FOUND", "Some of these nominations are not on this job.");
      await recordAudit(transaction, audit, {
        action: "DIRECT_SHARE_TAGGED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { nominations: ids.length, reason: input.reason, note },
      });
      return { updated: result.count };
    });
  },

  async withdraw(user: AuthenticatedUser, jobRequestId: string, nominationId: string, notes: string, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const nomination = await loadNomination(job.id, nominationId);
    if (nomination.status === "WITHDRAWN") return { ok: true };
    if (["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "JOINED"].includes(nomination.pipelineStatus)) {
      throw new ApiError(409, "CANNOT_WITHDRAW", "The candidate is already selected; record them as dropped instead.");
    }
    await inTransaction(async (transaction) => {
      await transaction.companyNomination.update({ where: { id: nomination.id }, data: { status: "WITHDRAWN", remarks: notes } });
      await recordAudit(transaction, audit, { action: "NOMINATION_WITHDRAWN", entityType: "Application", entityId: nomination.applicationId, metadata: { notes } });
      await syncJobProcessDates(transaction, job.id);
    });
    return { ok: true };
  },

  /** Records a candidate's outcome in one company round. */
  async recordInterview(user: AuthenticatedUser, jobRequestId: string, nominationId: string, roundId: string, input: InterviewInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const nomination = await loadNomination(job.id, nominationId);
    return saveRoundResults(user, job.id, roundId, [nomination], input, audit);
  },

  /** The same round result for several students at once. */
  async recordInterviewsBulk(user: AuthenticatedUser, jobRequestId: string, roundId: string, input: BulkInterviewInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const ids = [...new Set(input.nominationIds)];
    const nominations = await prisma.companyNomination.findMany({
      where: { jobRequestId: job.id, id: { in: ids } },
      select: { id: true, applicationId: true, pipelineStatus: true },
    });
    if (nominations.length !== ids.length) throw new ApiError(404, "NOMINATION_NOT_FOUND", "Some of these students are not nominated on this job.");
    const { nominationIds: _ids, ...result } = input;
    return saveRoundResults(user, job.id, roundId, nominations, result, audit);
  },
};

type RoundResultInput = Omit<InterviewInput, "interviewerName" | "feedback"> & Partial<Pick<InterviewInput, "interviewerName" | "feedback">>;

async function saveRoundResults(
  user: AuthenticatedUser,
  jobRequestId: string,
  roundId: string,
  nominations: { id: string; applicationId: string; pipelineStatus: PipelineStatus }[],
  input: RoundResultInput,
  audit: AuditContext,
) {
  const round = await prisma.companyInterviewRound.findFirst({ where: { id: roundId, jobRequestId }, select: { id: true, name: true } });
  if (!round) throw new ApiError(404, "ROUND_NOT_FOUND", "The round was not found.");
  const rejected = input.outcome === "REJECTED";
  if (rejected && input.rejectionTagId) {
    const current = await prisma.companyInterview.findMany({
      where: { roundId: round.id, nominationId: { in: nominations.map((row) => row.id) } },
      select: { rejectionTagId: true },
    });
    await assertUsableTag(input.rejectionTagId, current.map((row) => row.rejectionTagId));
  }
  const data = definedOnly({
    outcome: input.outcome,
    scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt ? new Date(input.scheduledAt) : null,
    interviewerName: input.interviewerName,
    feedback: input.feedback,
    // A reason only belongs to a rejection; any other result clears it.
    rejectionTagId: rejected ? input.rejectionTagId : null,
    rejectionReason: rejected ? input.rejectionReason : null,
    rejectionDocUrl: rejected ? input.rejectionDocUrl : null,
    source: "MANUAL" as const,
  });
  await inTransaction(async (transaction) => {
    for (const nomination of nominations) {
      await transaction.companyInterview.upsert({
        where: { nominationId_roundId: { nominationId: nomination.id, roundId: round.id } },
        create: { nominationId: nomination.id, roundId: round.id, jobRequestId, ...data, outcome: input.outcome },
        update: data,
      });
      // Having outcomes means the company has the profile.
      if (nomination.pipelineStatus === "NOT_SUBMITTED") {
        await transaction.companyNomination.update({ where: { id: nomination.id }, data: { pipelineStatus: "IN_PROCESS", submittedAt: new Date() } });
        await transaction.companyStageHistory.create({
          data: { nominationId: nomination.id, fromStatus: "NOT_SUBMITTED", toStatus: "IN_PROCESS", changedById: user.id, notes: `First round outcome recorded (${round.name}).` },
        });
      }
      await recordAudit(transaction, audit, {
        action: "INTERVIEW_RECORDED",
        entityType: "Application",
        entityId: nomination.applicationId,
        metadata: { round: round.name, outcome: input.outcome, ...(rejected && input.rejectionTagId ? { rejectionTagId: input.rejectionTagId } : {}) },
      });
    }
    await syncJobProcessDates(transaction, jobRequestId);
  });
  return { ok: true, updated: nominations.length };
}
