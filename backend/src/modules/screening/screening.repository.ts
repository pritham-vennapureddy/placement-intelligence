import { INTERNAL_STAGES } from "@placement/shared";
import { prisma, type Db } from "../../db.js";
import type { InternalStage, Prisma, StageCandidateOutcome, StageStatus } from "../../generated/prisma/client.js";

export const candidateSummarySelect = {
  id: true,
  candidateCode: true,
  fullName: true,
  email: true,
  mobile: true,
  college: true,
  graduationYear: true,
  resumeUrl: true,
  category: true,
  assessedPool: true,
} satisfies Prisma.CandidateSelect;

export const screeningRepository = {
  findProcess(jobRequestId: string) {
    return prisma.internalProcess.findUnique({
      where: { jobRequestId },
      select: {
        id: true,
        shortlistingNotes: true,
        updatedAt: true,
        stages: {
          select: {
            id: true,
            stage: true,
            status: true,
            completedAt: true,
            nextPlannedDate: true,
            remarks: true,
            updatedAt: true,
            owner: { select: { id: true, fullName: true } },
            completionLog: {
              select: { fromStatus: true, toStatus: true, remarks: true, recordedAt: true, recordedBy: { select: { fullName: true } } },
              orderBy: { recordedAt: "desc" },
              take: 10,
            },
          },
        },
      },
    });
  },

  outcomeCounts(jobRequestId: string) {
    return prisma.internalStageCandidate.groupBy({
      by: ["stageId", "outcome"],
      where: { jobRequestId },
      _count: { _all: true },
    });
  },

  countApplications(jobRequestId: string) {
    return prisma.application.count({ where: { jobRequestId, status: { not: "WITHDRAWN" } } });
  },

  updateNotes(db: Db, jobRequestId: string, shortlistingNotes: string | null) {
    return db.internalProcess.update({ where: { jobRequestId }, data: { shortlistingNotes } });
  },

  updateStage(db: Db, stageId: string, data: Prisma.InternalProcessStageUncheckedUpdateInput) {
    return db.internalProcessStage.update({ where: { id: stageId }, data });
  },

  logStatus(db: Db, stageId: string, fromStatus: StageStatus, toStatus: StageStatus, remarks: string | undefined, userId: string) {
    return db.stageCompletionRecord.create({ data: { stageId, fromStatus, toStatus, recordedById: userId, ...(remarks ? { remarks } : {}) } });
  },

  async listApplications(jobRequestId: string, where: Prisma.ApplicationWhereInput, page: { skip: number; take: number }) {
    const filter = { jobRequestId, ...where };
    return Promise.all([
      prisma.application.findMany({
        where: filter,
        select: {
          id: true,
          appliedAt: true,
          source: true,
          product: { select: { code: true, name: true } },
          candidate: { select: candidateSummarySelect },
        },
        orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
        ...page,
      }),
      prisma.application.count({ where: filter }),
    ]);
  },

  async listStageCandidates(stageId: string, where: Prisma.InternalStageCandidateWhereInput, page: { skip: number; take: number }) {
    const filter = { stageId, ...where };
    return Promise.all([
      prisma.internalStageCandidate.findMany({
        where: filter,
        select: {
          id: true,
          outcome: true,
          priority: true,
          techScore: true,
          commScore: true,
          rejectionReason: true,
          remarks: true,
          source: true,
          decidedAt: true,
          decidedBy: { select: { fullName: true } },
          application: {
            select: { id: true, product: { select: { code: true, name: true } }, candidate: { select: candidateSummarySelect } },
          },
        },
        orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        ...page,
      }),
      prisma.internalStageCandidate.count({ where: filter }),
    ]);
  },

  findDecision(stageId: string, applicationId: string) {
    return prisma.internalStageCandidate.findUnique({ where: { stageId_applicationId: { stageId, applicationId } } });
  },

  upsertDecision(
    db: Db,
    keys: { stageId: string; applicationId: string; jobRequestId: string },
    data: { outcome: StageCandidateOutcome } & Omit<Prisma.InternalStageCandidateUncheckedUpdateInput, "outcome">,
  ) {
    return db.internalStageCandidate.upsert({
      where: { stageId_applicationId: { stageId: keys.stageId, applicationId: keys.applicationId } },
      create: { ...keys, ...data } as Prisma.InternalStageCandidateUncheckedCreateInput,
      update: data,
    });
  },

  addToStage(db: Db, rows: { stageId: string; applicationId: string; jobRequestId: string; outcome: StageCandidateOutcome; decidedById: string }[]) {
    return db.internalStageCandidate.createMany({
      data: rows.map((row) => ({ ...row, source: "MANUAL" as const, decidedAt: new Date() })),
      skipDuplicates: true,
    });
  },

  countApplicationsIn(jobRequestId: string, ids: string[]) {
    return prisma.application.count({ where: { jobRequestId, id: { in: ids } } });
  },

  findApplication(jobRequestId: string, applicationId: string) {
    return prisma.application.findFirst({ where: { id: applicationId, jobRequestId }, select: { id: true, nomination: { select: { id: true } } } });
  },
};

/** Creates the job's internal process and its five stages if they do not exist; returns stage IDs. */
export async function ensureInternalProcess(db: Db, jobRequestId: string) {
  const process = await db.internalProcess.upsert({
    where: { jobRequestId },
    create: { jobRequestId },
    update: {},
    select: { id: true },
  });
  await db.internalProcessStage.createMany({
    data: INTERNAL_STAGES.map((stage) => ({ processId: process.id, jobRequestId, stage })),
    skipDuplicates: true,
  });
  const stages = await db.internalProcessStage.findMany({ where: { processId: process.id }, select: { id: true, stage: true, status: true } });
  return { processId: process.id, stages: new Map(stages.map((stage) => [stage.stage, stage])) };
}

