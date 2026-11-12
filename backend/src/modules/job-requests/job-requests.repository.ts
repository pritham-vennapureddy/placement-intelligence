import { prisma, type Db } from "../../db.js";
import type { JobRequestStatus, Prisma } from "../../generated/prisma/client.js";
import { normalizeSkillName } from "../../utils/skills.js";

const listSelect = {
  id: true,
  jobId: true,
  roleTitle: true,
  openings: true,
  requiredCandidateCount: true,
  ctcLpa: true,
  requestDate: true,
  deadline: true,
  status: true,
  processPhase: true,
  processRound: { select: { name: true } },
  updatedAt: true,
  company: { select: { id: true, name: true } },
  psmOwner: { select: { id: true, fullName: true } },
  skills: { select: { skill: { select: { name: true } } } },
  eligibleProducts: { select: { product: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.JobRequestSelect;

const detailInclude = {
  company: { select: { id: true, name: true, hubspotCompanyId: true } },
  psmOwner: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  skills: { select: { isMandatory: true, skill: { select: { id: true, name: true } } } },
  eligibleProducts: { select: { product: { select: { id: true, code: true, name: true, category: true } } } },
  assignments: {
    select: {
      id: true,
      assignedAt: true,
      endedAt: true,
      notes: true,
      assignedTo: { select: { id: true, fullName: true } },
      assignedBy: { select: { id: true, fullName: true } },
    },
    orderBy: { assignedAt: "desc" as const },
  },
  recruitmentBatches: {
    select: { id: true, name: true, sequence: true, status: true, openings: true, startsAt: true, endsAt: true, internalSheetUrl: true, companySheetUrl: true, internalTabs: true, createdAt: true,
      // Saved data that stops the batch from being deleted.
      _count: { select: { applications: true, interviewRounds: true, resumeAssessments: true, additionalProfiles: true, importBatches: { where: { status: "COMMITTED" } } } },
    },
    orderBy: { sequence: "asc" as const },
  },
} satisfies Prisma.JobRequestInclude;

export type JobRequestDetail = Prisma.JobRequestGetPayload<{ include: typeof detailInclude }>;

/** Upserts skills by their normalised name and returns their IDs. */
async function upsertSkills(db: Db, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const skill = await db.skill.upsert({
      where: { normalizedName: normalizeSkillName(name) },
      create: { name, normalizedName: normalizeSkillName(name) },
      update: {},
      select: { id: true },
    });
    ids.push(skill.id);
  }
  return ids;
}

export const jobRequestsRepository = {
  async list(where: Prisma.JobRequestWhereInput, page: { skip: number; take: number }) {
    const [rows, total] = await Promise.all([
      prisma.jobRequest.findMany({ where, select: listSelect, orderBy: [{ requestDate: "desc" }, { createdAt: "desc" }], ...page }),
      prisma.jobRequest.count({ where }),
    ]);
    return { rows, total };
  },

  findDetail(id: string, db: Db = prisma) {
    return db.jobRequest.findUnique({ where: { id }, include: detailInclude });
  },

  findPlain(id: string) {
    return prisma.jobRequest.findUnique({ where: { id } });
  },

  findByJobId(jobId: string) {
    return prisma.jobRequest.findUnique({ where: { jobId }, select: { id: true, roleTitle: true } });
  },

  findByHubspotDealId(hubspotDealId: string) {
    return prisma.jobRequest.findUnique({ where: { hubspotDealId }, select: { id: true, roleTitle: true } });
  },

  /** A company with this name (ignoring case), preferring an active one, then the oldest. */
  findCompanyByName(db: Db, name: string) {
    return db.company.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, archivedAt: null },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, status: true },
    });
  },

  createCompany(db: Db, name: string, createdById: string) {
    return db.company.create({ data: { name, createdById }, select: { id: true, name: true, status: true } });
  },

  reactivateCompany(db: Db, id: string) {
    return db.company.update({ where: { id }, data: { status: "ACTIVE" }, select: { id: true, name: true, status: true } });
  },

  countActiveProducts(ids: string[]) {
    return prisma.product.count({ where: { id: { in: ids }, isActive: true } });
  },

  /** The user, if they are active and hold the Employee role. */
  findAssignablePsm(userId: string) {
    return prisma.user.findFirst({
      where: { id: userId, isActive: true, roles: { some: { role: { code: "EMPLOYEE" } } } },
      select: { id: true, fullName: true },
    });
  },

  async create(
    db: Db,
    data: Omit<Prisma.JobRequestUncheckedCreateInput, "skills" | "eligibleProducts" | "assignments">,
    skills: string[],
    productIds: string[],
    assignedById: string,
  ) {
    const job = await db.jobRequest.create({ data });
    await db.recruitmentBatch.create({
      data: {
        jobRequestId: job.id,
        name: "Batch 1",
        sequence: 1,
        openings: job.openings,
        startsAt: job.requestDate,
        endsAt: job.deadline,
        internalSheetUrl: job.internalSheetUrl,
        companySheetUrl: job.companySheetUrl,
      },
    });
    const skillIds = await upsertSkills(db, skills);
    await db.jobRequestSkill.createMany({ data: skillIds.map((skillId) => ({ jobRequestId: job.id, skillId })) });
    if (productIds.length > 0) {
      await db.jobRequestProduct.createMany({ data: productIds.map((productId) => ({ jobRequestId: job.id, productId })) });
    }
    if (job.psmOwnerId) {
      await db.pSMAssignment.create({ data: { jobRequestId: job.id, assignedToId: job.psmOwnerId, assignedById } });
    }
    return job;
  },

  async update(
    db: Db,
    id: string,
    data: Prisma.JobRequestUncheckedUpdateInput,
    skills: string[] | undefined,
    productIds: string[] | undefined,
  ) {
    await db.jobRequest.update({ where: { id }, data });
    if (skills) {
      const skillIds = await upsertSkills(db, skills);
      await db.jobRequestSkill.deleteMany({ where: { jobRequestId: id, skillId: { notIn: skillIds } } });
      await db.jobRequestSkill.createMany({
        data: skillIds.map((skillId) => ({ jobRequestId: id, skillId })),
        skipDuplicates: true,
      });
    }
    if (productIds) {
      await db.jobRequestProduct.deleteMany({ where: { jobRequestId: id, productId: { notIn: productIds } } });
      await db.jobRequestProduct.createMany({
        data: productIds.map((productId) => ({ jobRequestId: id, productId })),
        skipDuplicates: true,
      });
    }
  },

  setStatus(db: Db, id: string, status: JobRequestStatus) {
    return db.jobRequest.update({ where: { id }, data: { status } });
  },

  /** Ends the open ownership row and starts a new one. */
  async reassign(db: Db, id: string, toUserId: string, byUserId: string, notes: string | undefined, at: Date) {
    await db.pSMAssignment.updateMany({ where: { jobRequestId: id, endedAt: null }, data: { endedAt: at } });
    await db.pSMAssignment.create({
      data: { jobRequestId: id, assignedToId: toUserId, assignedById: byUserId, assignedAt: at, ...(notes ? { notes } : {}) },
    });
    await db.jobRequest.update({ where: { id }, data: { psmOwnerId: toUserId } });
  },
};

/** Stage statuses, selections per stage and company outcomes for the given job requests. */
export async function jobProgress(jobRequestIds: string[]) {
  const [stages, selections, applications, pipeline] = await Promise.all([
    prisma.internalProcessStage.findMany({ where: { jobRequestId: { in: jobRequestIds } }, select: { id: true, jobRequestId: true, stage: true, status: true } }),
    prisma.internalStageCandidate.groupBy({ by: ["jobRequestId", "stageId"], where: { jobRequestId: { in: jobRequestIds }, outcome: "SELECTED" }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ["jobRequestId"], where: { jobRequestId: { in: jobRequestIds } }, _count: { _all: true } }),
    prisma.companyNomination.groupBy({ by: ["jobRequestId", "pipelineStatus"], where: { jobRequestId: { in: jobRequestIds }, status: "NOMINATED" }, _count: { _all: true } }),
  ]);
  return { stages, selections, applications, pipeline };
}
