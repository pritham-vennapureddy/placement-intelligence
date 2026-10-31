import { prisma } from "../../db.js";

type JobRequestFilter = { psmOwnerId?: { in: string[] } };

export const dashboardRepository = {
  /** Companies with at least one job request matching the filter (all companies when unfiltered). */
  countCompanies(filter: JobRequestFilter) {
    return prisma.company.count({
      where: filter.psmOwnerId ? { jobRequests: { some: filter } } : {},
    });
  },

  countOpenJobRequests(filter: JobRequestFilter) {
    return prisma.jobRequest.count({ where: { ...filter, status: "OPEN" } });
  },

  async sumOpenPositions(filter: JobRequestFilter): Promise<number> {
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

  listCompaniesWithJobRequests(filter: JobRequestFilter) {
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
};
