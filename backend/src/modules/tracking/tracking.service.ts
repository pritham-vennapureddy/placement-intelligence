import {
  companyProcessLabel,
  hasPermission,
  isRoundPhase,
  type CompanyShareStatus,
  type StudentSupportKind,
} from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { isJobOwnerInScope, resolveDataScope } from "../../services/data-scope.service.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { checkStatusRules, loadStatusForKind, statusOptionSelect } from "./support-status.service.js";
import type {
  BulkStudentSupportInput,
  GuidanceSessionInput,
  GuidanceViewQuery,
  MyWorkQuery,
  ProcessStatusInput,
  StudentSupportInput,
} from "./tracking.validators.js";

const SELECTED_STATUSES = ["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"] as const;
const OFFER_STATUSES = ["OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"] as const;
const INTERNAL_REJECTION_STAGES = ["RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST"] as const;

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const isAdmin = (user: AuthenticatedUser) => user.roles.includes("ADMIN");

/** Shortlisted at SP, but the company does not have the profile (no active nomination, or never sent). */
export const notSharedWhere: Prisma.ApplicationWhereInput = {
  status: { not: "WITHDRAWN" },
  stageOutcomes: { some: { outcome: "SELECTED", stage: { stage: "FINAL_SHORTLIST" } } },
  OR: [{ nomination: { is: null } }, { nomination: { status: "WITHDRAWN" } }, { nomination: { pipelineStatus: "NOT_SUBMITTED" } }],
};

/** SP-selected, or nominated, and whether the company actually has the profile. */
export function shareStatusOf(application: {
  stageOutcomes: { outcome: string; stage: { stage: string } }[];
  nomination: { status: string; pipelineStatus: string } | null;
}): CompanyShareStatus {
  const nomination = application.nomination;
  if (nomination && nomination.status === "NOMINATED" && nomination.pipelineStatus !== "NOT_SUBMITTED") return "SHARED";
  const atSp = application.stageOutcomes.some(({ outcome, stage }) => stage.stage === "FINAL_SHORTLIST" && outcome === "SELECTED");
  return atSp || nomination?.status === "NOMINATED" ? "NOT_SHARED" : "NOT_SHORTLISTED";
}

/** Per-job candidate counts used by My work. */
async function jobCounts(jobIds: string[]) {
  if (jobIds.length === 0) return new Map<string, ReturnType<typeof emptyCounts>>();
  const inJobs = { jobRequestId: { in: jobIds } };
  const [applications, rejected, sp, notShared, nominations, supportDone] = await Promise.all([
    prisma.application.groupBy({ by: ["jobRequestId"], where: { ...inJobs, status: { not: "WITHDRAWN" } }, _count: { _all: true } }),
    prisma.application.groupBy({
      by: ["jobRequestId"],
      where: { ...inJobs, status: { not: "WITHDRAWN" }, stageOutcomes: { some: { outcome: "REJECTED", stage: { stage: { in: [...INTERNAL_REJECTION_STAGES] } } } } },
      _count: { _all: true },
    }),
    prisma.application.groupBy({
      by: ["jobRequestId"],
      where: { ...inJobs, status: { not: "WITHDRAWN" }, stageOutcomes: { some: { outcome: "SELECTED", stage: { stage: "FINAL_SHORTLIST" } } } },
      _count: { _all: true },
    }),
    prisma.application.groupBy({ by: ["jobRequestId"], where: { ...inJobs, ...notSharedWhere }, _count: { _all: true } }),
    prisma.companyNomination.groupBy({ by: ["jobRequestId", "pipelineStatus"], where: { ...inJobs, status: "NOMINATED" }, _count: { _all: true } }),
    prisma.studentSupport.groupBy({ by: ["jobRequestId", "kind"], where: { ...inJobs, status: { countsAsDone: true } }, _count: { _all: true } }),
  ]);
  const counts = new Map(jobIds.map((id) => [id, emptyCounts()]));
  for (const row of applications) counts.get(row.jobRequestId)!.applications = row._count._all;
  for (const row of rejected) counts.get(row.jobRequestId)!.internalRejected = row._count._all;
  for (const row of sp) counts.get(row.jobRequestId)!.finalShortlisted = row._count._all;
  for (const row of notShared) counts.get(row.jobRequestId)!.notShared = row._count._all;
  for (const row of supportDone) {
    if (row.kind === "GUIDANCE") counts.get(row.jobRequestId)!.studentsGuided = row._count._all;
    else counts.get(row.jobRequestId)!.studentsRsaDone = row._count._all;
  }
  for (const row of nominations) {
    const entry = counts.get(row.jobRequestId)!;
    const n = row._count._all;
    if (row.pipelineStatus !== "NOT_SUBMITTED") entry.shared += n;
    if (row.pipelineStatus === "IN_PROCESS" || row.pipelineStatus === "ON_HOLD") entry.inProcess += n;
    if (row.pipelineStatus === "REJECTED") entry.rejectedByCompany += n;
    if ((SELECTED_STATUSES as readonly string[]).includes(row.pipelineStatus)) entry.selected += n;
    if ((OFFER_STATUSES as readonly string[]).includes(row.pipelineStatus)) entry.offers += n;
    if (row.pipelineStatus === "JOINED") entry.joined += n;
  }
  return counts;
}

function emptyCounts() {
  return { applications: 0, internalRejected: 0, finalShortlisted: 0, shared: 0, notShared: 0, inProcess: 0, rejectedByCompany: 0, selected: 0, offers: 0, joined: 0, studentsGuided: 0, studentsRsaDone: 0 };
}

/** Any PSM may record guidance on any live job, so this skips the ownership scope on purpose. */
async function loadJobForGuidance(user: AuthenticatedUser, jobRequestId: string) {
  if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to record guidance.");
  const job = await prisma.jobRequest.findFirst({ where: { id: jobRequestId, archivedAt: null }, select: { id: true } });
  if (!job) throw new ApiError(404, "JOB_REQUEST_NOT_FOUND", "The job request was not found.");
  return job;
}

const supportSelect = {
  kind: true,
  status: { select: { id: true, label: true, tone: true, archivedAt: true } },
  doneOn: true,
  otherContributors: true,
  notes: true,
  updatedAt: true,
  updatedBy: { select: { id: true, fullName: true } },
  contributors: { select: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.StudentSupportSelect;

type SupportRow = Prisma.StudentSupportGetPayload<{ select: typeof supportSelect }>;

function presentSupport(row: SupportRow | undefined) {
  if (!row) return null;
  const { kind: _kind, contributors, ...rest } = row;
  return { ...rest, contributors: contributors.map(({ user }) => user) };
}

async function assertActiveContributors(ids: string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const found = await prisma.user.count({ where: { id: { in: unique }, isActive: true } });
  if (found !== unique.length) throw new ApiError(400, "CONTRIBUTOR_NOT_FOUND", "One of the chosen contributors no longer has an account.");
}

async function saveSupport(
  transaction: Prisma.TransactionClient,
  userId: string,
  application: { id: string; jobRequestId: string },
  kind: StudentSupportKind,
  input: StudentSupportInput,
) {
  const data = {
    statusId: input.statusId,
    doneOn: input.doneOn ? toDate(input.doneOn) : null,
    otherContributors: input.otherContributors || null,
    notes: input.notes || null,
    updatedById: userId,
  };
  const support = await transaction.studentSupport.upsert({
    where: { applicationId_kind: { applicationId: application.id, kind } },
    create: { applicationId: application.id, jobRequestId: application.jobRequestId, kind, ...data },
    update: data,
    select: { id: true },
  });
  await transaction.studentSupportContributor.deleteMany({ where: { supportId: support.id } });
  const contributorIds = [...new Set(input.contributorIds)];
  if (contributorIds.length) {
    await transaction.studentSupportContributor.createMany({ data: contributorIds.map((contributorId) => ({ supportId: support.id, userId: contributorId })) });
  }
}

export const trackingService = {
  async setProcessStatus(user: AuthenticatedUser, jobRequestId: string, input: ProcessStatusInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "pipeline:write");
    const current = await prisma.jobRequest.findUniqueOrThrow({ where: { id: job.id }, select: { processPhase: true, processRoundId: true } });
    let round: { id: string; name: string } | null = null;
    if (isRoundPhase(input.phase)) {
      round = await prisma.companyInterviewRound.findFirst({ where: { id: input.roundId!, jobRequestId: job.id }, select: { id: true, name: true } });
      if (!round) throw new ApiError(400, "ROUND_NOT_FOUND", "Choose one of this job's company rounds.");
    }
    if (current.processPhase === input.phase && current.processRoundId === (round?.id ?? null) && !input.notes) return { ok: true };
    await inTransaction(async (transaction) => {
      await transaction.jobRequest.update({
        where: { id: job.id },
        data: { processPhase: input.phase, processRoundId: round?.id ?? null, processPhaseAt: new Date() },
      });
      await transaction.companyProcessHistory.create({
        data: {
          jobRequestId: job.id,
          fromPhase: current.processPhase,
          toPhase: input.phase,
          roundId: round?.id ?? null,
          roundName: round?.name ?? null,
          changedById: user.id,
          ...(input.notes ? { notes: input.notes } : {}),
        },
      });
      await recordAudit(transaction, audit, {
        action: "COMPANY_PROCESS_STATUS_CHANGED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { from: current.processPhase, to: input.phase, round: round?.name ?? null, notes: input.notes ?? null },
      });
    });
    return { ok: true };
  },

  /** Company process status, its history and the job's drive-level guidance, for the job's pipeline tab. */
  async jobTracking(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    const [detail, history, sessions, notShared, studentsGuided] = await Promise.all([
      prisma.jobRequest.findUniqueOrThrow({
        where: { id: job.id },
        select: { processPhase: true, processPhaseAt: true, processRound: { select: { id: true, name: true } } },
      }),
      prisma.companyProcessHistory.findMany({
        where: { jobRequestId: job.id },
        select: { id: true, fromPhase: true, toPhase: true, roundName: true, notes: true, changedAt: true, changedBy: { select: { fullName: true } } },
        orderBy: { changedAt: "desc" },
        take: 20,
      }),
      prisma.guidanceSession.findMany({
        where: { jobRequestId: job.id },
        select: { id: true, givenOn: true, notes: true, givenBy: { select: { id: true, fullName: true } } },
        orderBy: { givenOn: "desc" },
      }),
      prisma.application.findMany({
        where: { jobRequestId: job.id, ...notSharedWhere },
        select: {
          id: true,
          product: { select: { name: true } },
          candidate: { select: { id: true, fullName: true, candidateCode: true } },
          nomination: { select: { status: true, pipelineStatus: true } },
          stageOutcomes: { where: { stage: { stage: "FINAL_SHORTLIST" } }, select: { priority: true, selectionBasis: true } },
        },
        orderBy: { candidate: { fullName: "asc" } },
        take: 1000,
      }),
      prisma.studentSupport.count({ where: { jobRequestId: job.id, kind: "GUIDANCE", status: { countsAsDone: true } } }),
    ]);
    return {
      canEdit: hasPermission(user.roles, "pipeline:write"),
      process: {
        phase: detail.processPhase,
        round: detail.processRound,
        label: companyProcessLabel(detail.processPhase, detail.processRound?.name),
        updatedAt: detail.processPhaseAt,
        history: history.map((entry) => ({
          ...entry,
          label: companyProcessLabel(entry.toPhase, entry.roundName),
        })),
      },
      guidance: { sessions, studentsGuided },
      notShared: notShared.map(({ stageOutcomes, nomination, ...application }) => ({
        ...application,
        reason: nomination?.status === "NOMINATED" ? "Nominated but not in the company sheet" : nomination ? "Nomination withdrawn" : "Not in the company sheet",
        priority: stageOutcomes[0]?.priority ?? null,
        selectionBasis: stageOutcomes[0]?.selectionBasis ?? null,
      })),
    };
  },

  /** Jobs anyone can pick when recording guidance they gave. */
  async searchGuidanceJobs(user: AuthenticatedUser, q: string | undefined) {
    if (!hasPermission(user.roles, "pipeline:write")) throw new ApiError(403, "FORBIDDEN", "You do not have permission to record guidance.");
    const jobs = await prisma.jobRequest.findMany({
      where: {
        archivedAt: null,
        ...(q
          ? { OR: [{ roleTitle: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }, { jobId: { startsWith: q.toLowerCase() } }] }
          : { status: { in: ["OPEN", "ON_HOLD", "DRAFT"] } }),
      },
      select: { id: true, jobId: true, roleTitle: true, status: true, company: { select: { name: true } }, psmOwner: { select: { id: true, fullName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 25,
    });
    return jobs;
  },

  /** The guidance view of one job: open to any PSM, shows no contact details. */
  async guidanceForJob(user: AuthenticatedUser, jobRequestId: string, query: GuidanceViewQuery = { students: "shortlisted" }) {
    const { id } = await loadJobForGuidance(user, jobRequestId);
    const [job, sessions, applications, people] = await Promise.all([
      prisma.jobRequest.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          jobId: true,
          roleTitle: true,
          status: true,
          processPhase: true,
          processRound: { select: { name: true } },
          company: { select: { id: true, name: true } },
          psmOwner: { select: { id: true, fullName: true } },
        },
      }),
      prisma.guidanceSession.findMany({
        where: { jobRequestId: id },
        select: { id: true, givenOn: true, notes: true, createdAt: true, givenBy: { select: { id: true, fullName: true } }, recordedBy: { select: { id: true, fullName: true } } },
        orderBy: { givenOn: "desc" },
      }),
      prisma.application.findMany({
        where: {
          jobRequestId: id,
          status: { not: "WITHDRAWN" },
          ...(query.students === "all" ? {} : {
            OR: [
              { stageOutcomes: { some: { outcome: "SELECTED", stage: { stage: "FINAL_SHORTLIST" } } } },
              { nomination: { status: "NOMINATED" } },
              // Keep anyone who already has a Guidance/RSA record, even if no longer shortlisted.
              { support: { some: {} } },
            ],
          }),
        },
        select: {
          id: true,
          product: { select: { name: true } },
          candidate: { select: { id: true, fullName: true, candidateCode: true } },
          nomination: { select: { status: true, pipelineStatus: true } },
          stageOutcomes: { where: { stage: { stage: "FINAL_SHORTLIST" } }, select: { outcome: true, stage: { select: { stage: true } } } },
          support: { select: supportSelect },
        },
        orderBy: { candidate: { fullName: "asc" } },
        take: 2000,
      }),
      prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    ]);
    const statusOptions = await prisma.supportStatusOption.findMany({ select: statusOptionSelect, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const canManage = (ownerId: string) => isAdmin(user) || ownerId === user.id;
    return {
      job: { ...job, processLabel: companyProcessLabel(job.processPhase, job.processRound?.name) },
      sessions: sessions.map((session) => ({ ...session, canDelete: canManage(session.givenBy.id) || session.recordedBy.id === user.id })),
      people,
      statusOptions,
      canEdit: hasPermission(user.roles, "pipeline:write"),
      students: applications.map(({ stageOutcomes, nomination, support, ...application }) => ({
        ...application,
        shareStatus: shareStatusOf({ stageOutcomes, nomination }),
        pipelineStatus: nomination?.status === "NOMINATED" ? nomination.pipelineStatus : null,
        guidance: presentSupport(support.find(({ kind }) => kind === "GUIDANCE")),
        rsa: presentSupport(support.find(({ kind }) => kind === "RSA")),
      })),
    };
  },

  async addSession(user: AuthenticatedUser, jobRequestId: string, input: GuidanceSessionInput, audit: AuditContext) {
    const job = await loadJobForGuidance(user, jobRequestId);
    return inTransaction(async (transaction) => {
      const session = await transaction.guidanceSession.create({
        data: { jobRequestId: job.id, givenById: user.id, recordedById: user.id, givenOn: toDate(input.givenOn), ...(input.notes ? { notes: input.notes } : {}) },
        select: { id: true },
      });
      await recordAudit(transaction, audit, { action: "GUIDANCE_SESSION_RECORDED", entityType: "JobRequest", entityId: job.id, metadata: { givenOn: input.givenOn } });
      return session;
    });
  },

  async deleteSession(user: AuthenticatedUser, sessionId: string, audit: AuditContext) {
    const session = await prisma.guidanceSession.findUnique({ where: { id: sessionId }, select: { id: true, jobRequestId: true, givenById: true, recordedById: true, givenOn: true } });
    if (!session) throw new ApiError(404, "GUIDANCE_NOT_FOUND", "The guidance record was not found.");
    if (!isAdmin(user) && session.givenById !== user.id && session.recordedById !== user.id) {
      throw new ApiError(403, "FORBIDDEN", "Only the PSM who gave this guidance can remove it.");
    }
    await inTransaction(async (transaction) => {
      await transaction.guidanceSession.delete({ where: { id: session.id } });
      await recordAudit(transaction, audit, { action: "GUIDANCE_SESSION_REMOVED", entityType: "JobRequest", entityId: session.jobRequestId, metadata: { givenOn: session.givenOn.toISOString().slice(0, 10) } });
    });
  },

  /** Sets Guidance or RSA for one student. Anyone with pipeline:write may set or correct it. */
  async setStudentSupport(user: AuthenticatedUser, applicationId: string, kind: StudentSupportKind, input: StudentSupportInput, audit: AuditContext) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, jobRequestId: true } });
    if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "The candidate application was not found.");
    await loadJobForGuidance(user, application.jobRequestId);
    const existing = await prisma.studentSupport.findUnique({ where: { applicationId_kind: { applicationId, kind } }, select: { statusId: true } });
    const status = await loadStatusForKind(input.statusId, kind, existing ? [existing.statusId] : []);
    checkStatusRules(status, input);
    await assertActiveContributors(input.contributorIds);
    await inTransaction(async (transaction) => {
      await saveSupport(transaction, user.id, application, kind, input);
      await recordAudit(transaction, audit, {
        action: "STUDENT_SUPPORT_UPDATED",
        entityType: "Application",
        entityId: application.id,
        metadata: { kind, status: status.label, contributors: input.contributorIds.length, otherContributors: input.otherContributors ?? null, doneOn: input.doneOn ?? null },
      });
    });
    return { ok: true };
  },

  /** The same Guidance/RSA update for several students of one job, e.g. everyone in a drive session. */
  async bulkStudentSupport(user: AuthenticatedUser, jobRequestId: string, input: BulkStudentSupportInput, audit: AuditContext) {
    const job = await loadJobForGuidance(user, jobRequestId);
    const { applicationIds, kind, ...fields } = input;
    const ids = [...new Set(applicationIds)];
    const applications = await prisma.application.findMany({ where: { id: { in: ids }, jobRequestId: job.id }, select: { id: true, jobRequestId: true } });
    if (applications.length !== ids.length) throw new ApiError(400, "APPLICATION_NOT_IN_JOB", "Some selected students do not belong to this job.");
    const status = await loadStatusForKind(fields.statusId, kind);
    checkStatusRules(status, fields);
    await assertActiveContributors(fields.contributorIds);
    await inTransaction(async (transaction) => {
      for (const application of applications) await saveSupport(transaction, user.id, application, kind, fields);
      await recordAudit(transaction, audit, {
        action: "STUDENT_SUPPORT_BULK_UPDATED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { kind, status: status.label, students: applications.length, contributors: fields.contributorIds.length, doneOn: fields.doneOn ?? null },
      });
    });
    return { updated: applications.length };
  },

  /** Back to "not recorded". */
  async clearStudentSupport(user: AuthenticatedUser, applicationId: string, kind: StudentSupportKind, audit: AuditContext) {
    const support = await prisma.studentSupport.findUnique({ where: { applicationId_kind: { applicationId, kind } }, select: { id: true, jobRequestId: true, status: { select: { label: true } } } });
    if (!support) return;
    await loadJobForGuidance(user, support.jobRequestId);
    await inTransaction(async (transaction) => {
      await transaction.studentSupport.delete({ where: { id: support.id } });
      await recordAudit(transaction, audit, { action: "STUDENT_SUPPORT_CLEARED", entityType: "Application", entityId: applicationId, metadata: { kind, was: support.status.label } });
    });
  },

  /** One PSM's jobs with company status, selects and guidance, plus guidance they gave on others' jobs. */
  async myWork(user: AuthenticatedUser, query: MyWorkQuery) {
    const scope = await resolveDataScope(user);
    const ownerId = query.ownerId ?? user.id;
    if (ownerId !== user.id && (scope.kind === "self" || !isJobOwnerInScope(scope, ownerId))) {
      throw new ApiError(403, "FORBIDDEN", "You can only view your own work.");
    }
    const [owner, jobs, givenElsewhere, owners] = await Promise.all([
      prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, fullName: true } }),
      prisma.jobRequest.findMany({
        where: { psmOwnerId: ownerId, archivedAt: null },
        select: {
          id: true,
          jobId: true,
          roleTitle: true,
          status: true,
          openings: true,
          requestDate: true,
          deadline: true,
          processPhase: true,
          processPhaseAt: true,
          processRound: { select: { id: true, name: true } },
          company: { select: { id: true, name: true } },
          interviewRounds: { select: { id: true, name: true }, orderBy: { sequence: "asc" } },
          guidanceSessions: { select: { givenOn: true, givenBy: { select: { id: true, fullName: true } } }, orderBy: { givenOn: "desc" } },
          internalProcess: { select: { stages: { where: { stage: "SCREENING_SHORTLIST" }, select: { status: true, skipReason: true, remarks: true } } } },
        },
        orderBy: [{ requestDate: "desc" }],
      }),
      prisma.guidanceSession.findMany({
        where: { givenById: ownerId, jobRequest: { OR: [{ psmOwnerId: null }, { psmOwnerId: { not: ownerId } }] } },
        select: {
          id: true,
          givenOn: true,
          notes: true,
          jobRequest: { select: { id: true, roleTitle: true, company: { select: { name: true } }, psmOwner: { select: { fullName: true } } } },
        },
        orderBy: { givenOn: "desc" },
        take: 100,
      }),
      scope.kind === "self"
        ? Promise.resolve([])
        : prisma.user.findMany({
          where: {
            isActive: true,
            ...(scope.kind === "team" ? { id: { in: [...scope.ownerIds, user.id] } } : {}),
            roles: { some: { role: { code: { in: ["EMPLOYEE", "MANAGER", "ADMIN"] } } } },
          },
          select: { id: true, fullName: true },
          orderBy: { fullName: "asc" },
        }),
    ]);
    if (!owner) throw new ApiError(404, "USER_NOT_FOUND", "The PSM was not found.");
    const counts = await jobCounts(jobs.map(({ id }) => id));
    const rows = jobs.map(({ guidanceSessions, internalProcess, interviewRounds, ...job }) => {
      const sc = internalProcess?.stages[0];
      return {
        ...job,
        rounds: interviewRounds,
        processLabel: companyProcessLabel(job.processPhase, job.processRound?.name),
        counts: counts.get(job.id)!,
        screeningSkipped: sc?.status === "NOT_CONDUCTED" ? { reason: sc.skipReason, note: sc.remarks } : null,
        guidance: {
          sessions: guidanceSessions.length,
          last: guidanceSessions[0] ?? null,
          givers: [...new Map(guidanceSessions.map(({ givenBy }) => [givenBy.id, givenBy.fullName])).values()],
        },
      };
    });
    const totals = rows.reduce((sum, row) => {
      for (const [key, value] of Object.entries(row.counts) as [keyof ReturnType<typeof emptyCounts>, number][]) sum[key] += value;
      return sum;
    }, emptyCounts());
    return {
      owner,
      canEdit: hasPermission(user.roles, "pipeline:write"),
      owners,
      totals: {
        ...totals,
        jobs: rows.length,
        activeJobs: rows.filter(({ status }) => ["DRAFT", "OPEN", "ON_HOLD"].includes(status)).length,
        guidancePending: rows.filter(({ counts: c, guidance }) => c.shared > 0 && guidance.sessions === 0 && c.studentsGuided === 0).length,
      },
      jobs: rows,
      guidanceGivenElsewhere: givenElsewhere,
    };
  },
};
