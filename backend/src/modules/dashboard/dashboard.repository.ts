import { prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const dashboardRepository = {
  /** Companies with at least one matching job request; every company when `filter` is null. */
  countCompanies(filter: Prisma.JobRequestWhereInput | null) {
    return prisma.company.count({ where: filter ? { jobRequests: { some: filter } } : {} });
  },

  countOpenJobRequests(filter: Prisma.JobRequestWhereInput) {
    return prisma.jobRequest.count({ where: { ...filter, status: "OPEN" } });
  },

  async sumOpenPositions(filter: Prisma.JobRequestWhereInput): Promise<number> {
    const result = await prisma.jobRequest.aggregate({
      where: { ...filter, status: "OPEN" },
      _sum: { openings: true },
    });
    return result._sum.openings ?? 0;
  },

  countActivePsms(ownerIds?: string[]) {
    return prisma.user.count({
      where: {
        isActive: true,
        roles: { some: { role: { code: "PSM" } } },
        ...(ownerIds ? { id: { in: ownerIds } } : {}),
      },
    });
  },

  listCompaniesWithJobRequests(filter: Prisma.JobRequestWhereInput) {
    return prisma.company.findMany({
      where: { jobRequests: { some: filter } },
      select: {
        id: true,
        name: true,
        jobRequests: {
          where: filter,
          select: { id: true, jobId: true, roleTitle: true, openings: true, status: true },
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });
  },

  /** Placement funnel for the job requests matching the filter, counted from candidate records. */
  async funnel(filter: Prisma.JobRequestWhereInput) {
    const inJobs = { jobRequest: filter };
    const selectedAt = (stage: "RESUME_SHORTLIST" | "SCREENING_SHORTLIST" | "ASSIGNMENT_SHORTLIST" | "FINAL_SHORTLIST") =>
      prisma.internalStageCandidate.count({ where: { outcome: "SELECTED", stage: { stage }, application: inJobs } });
    const [candidates, applications, rs, sc, as, sp, pipeline] = await Promise.all([
      prisma.candidate.count({ where: { applications: { some: inJobs } } }),
      prisma.application.count({ where: inJobs }),
      selectedAt("RESUME_SHORTLIST"),
      selectedAt("SCREENING_SHORTLIST"),
      selectedAt("ASSIGNMENT_SHORTLIST"),
      selectedAt("FINAL_SHORTLIST"),
      prisma.companyNomination.groupBy({ by: ["pipelineStatus"], where: { status: "NOMINATED", application: inJobs }, _count: { _all: true } }),
    ]);
    const count = (...statuses: string[]) => pipeline.filter((row) => statuses.includes(row.pipelineStatus)).reduce((sum, row) => sum + row._count._all, 0);
    return {
      candidates,
      applications,
      resumeShortlisted: rs,
      screeningShortlisted: sc,
      assignmentShortlisted: as,
      finalShortlisted: sp,
      nominated: count("NOT_SUBMITTED", "IN_PROCESS", "ON_HOLD", "REJECTED", "SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED", "DROPPED"),
      inCompanyProcess: count("IN_PROCESS", "ON_HOLD"),
      selected: count("SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
      offersReleased: count("OFFER_RELEASED", "OFFER_ACCEPTED", "OFFER_DECLINED", "JOINED"),
      offersAccepted: count("OFFER_ACCEPTED", "JOINED"),
      joined: count("JOINED"),
    };
  },
};
