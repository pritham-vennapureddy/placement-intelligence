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
};
