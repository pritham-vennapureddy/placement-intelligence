import { INTERNAL_STAGES } from "@placement/shared";
import { prisma, type Db } from "../../db.js";
import type { CandidatePoolType, InternalStage, Prisma, StageCandidateOutcome, StageStatus } from "../../generated/prisma/client.js";

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
  poolMemberships: { select: { poolType: true } },
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
            skipReason: true,
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
      where: { jobRequestId, application: { status: { not: "WITHDRAWN" } } },
      _count: { _all: true },
    });
  },

  countApplications(jobRequestId: string) {
    return prisma.application.count({ where: { jobRequestId, status: { not: "WITHDRAWN" } } });
  },

  async productCounts(jobRequestId: string) {
    const groups = await prisma.application.groupBy({
      by: ["productId"],
      where: { jobRequestId, status: { not: "WITHDRAWN" }, productId: { not: null } },
      _count: { _all: true },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: groups.flatMap(({ productId }) => productId ? [productId] : []) } },
      select: { id: true, name: true, category: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    return groups.flatMap(({ productId, _count }) => {
      const product = productId ? productById.get(productId) : undefined;
      return product ? [{ productId, name: product.name, category: product.category, applicants: _count._all }] : [];
    });
  },

  /**
   * Stage-by-stage consolidation of a job's applicants: TA counts everyone,
   * each later stage counts the candidates selected there. Split by product,
   * and for applicants found in the assessed pool (matched by mobile), by
   * bucket, TR result and competency pool.
   */
  async stageAnalytics(jobRequestId: string) {
    const stages = ["TOTAL_APPLICATIONS", "RESUME_SHORTLIST", "SCREENING_SHORTLIST", "ASSIGNMENT_SHORTLIST", "FINAL_SHORTLIST"] as const;
    type StageKey = (typeof stages)[number];
    const zero = () => Object.fromEntries(stages.map((stage) => [stage, 0])) as Record<StageKey, number>;
    const [applications, poolSize] = await Promise.all([
      prisma.application.findMany({
        where: { jobRequestId, status: { not: "WITHDRAWN" } },
        select: {
          product: { select: { id: true, name: true, category: true } },
          candidate: { select: { mobile: true } },
          stageOutcomes: { where: { outcome: "SELECTED" }, select: { stage: { select: { stage: true } } } },
        },
      }),
      prisma.assessedPoolRecord.count(),
    ]);
    const mobiles = [...new Set(applications.flatMap(({ candidate }) => candidate.mobile ? [candidate.mobile] : []))];
    const poolRecords = mobiles.length
      ? await prisma.assessedPoolRecord.findMany({
        where: { mobile: { in: mobiles } },
        select: { mobile: true, bucketTier: true, tr1Status: true, tr2Status: true, isCompetencyPoolMember: true, competencyLevel: true },
      })
      : [];
    const poolByMobile = new Map(poolRecords.map((record) => [record.mobile, record]));
    const cleared = (value: string | null) => /^clear(ed)?$/i.test(value?.trim() ?? "");

    const products = new Map<string, { productId: string | null; name: string; category: string | null; stages: Record<StageKey, number> }>();
    const emptyPoolStage = () => ({ inPool: 0, buckets: { A: 0, B: 0, C: 0, D: 0, other: 0 }, trCleared: 0, competencyPool: 0 });
    const pool = Object.fromEntries(stages.map((stage) => [stage, emptyPoolStage()])) as Record<StageKey, ReturnType<typeof emptyPoolStage>>;
    for (const application of applications) {
      const reached = new Set<StageKey>(["TOTAL_APPLICATIONS", ...application.stageOutcomes.map(({ stage }) => stage.stage as StageKey)]);
      const key = application.product?.id ?? "unknown";
      const entry = products.get(key) ?? {
        productId: application.product?.id ?? null,
        name: application.product?.name ?? "Product unknown",
        category: application.product?.category ?? null,
        stages: zero(),
      };
      products.set(key, entry);
      const record = application.candidate.mobile ? poolByMobile.get(application.candidate.mobile) : undefined;
      for (const stage of stages) {
        if (!reached.has(stage)) continue;
        entry.stages[stage]++;
        if (!record) continue;
        const counts = pool[stage];
        counts.inPool++;
        const tier = record.bucketTier?.trim().toUpperCase();
        if (tier === "A" || tier === "B" || tier === "C" || tier === "D") counts.buckets[tier]++;
        else counts.buckets.other++;
        if (cleared(record.tr1Status) || cleared(record.tr2Status)) counts.trCleared++;
        if (record.isCompetencyPoolMember) counts.competencyPool++;
      }
    }
    const categoryOrder = ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"];
    return {
      byProduct: [...products.values()].sort((a, b) =>
        (a.category === null ? 9 : categoryOrder.indexOf(a.category)) - (b.category === null ? 9 : categoryOrder.indexOf(b.category))
        || b.stages.TOTAL_APPLICATIONS - a.stages.TOTAL_APPLICATIONS),
      assessedPool: { poolSize, stages: pool },
    };
  },

  countPoolApplications(jobRequestId: string, poolType: CandidatePoolType) {
    return prisma.application.count({
      where: {
        jobRequestId,
        status: { not: "WITHDRAWN" },
        candidate: { poolMemberships: { some: { poolType } } },
      },
    });
  },

  poolOutcomeCounts(jobRequestId: string, poolType: CandidatePoolType) {
    return prisma.internalStageCandidate.groupBy({
      by: ["stageId", "outcome"],
      where: {
        jobRequestId,
        application: {
          status: { not: "WITHDRAWN" },
          candidate: { poolMemberships: { some: { poolType } } },
        },
      },
      _count: { _all: true },
    });
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
          selectionBasis: true,
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
  const stages = await db.internalProcessStage.findMany({ where: { processId: process.id }, select: { id: true, stage: true, status: true, remarks: true, skipReason: true } });
  return { processId: process.id, stages: new Map(stages.map((stage) => [stage.stage, stage])) };
}
