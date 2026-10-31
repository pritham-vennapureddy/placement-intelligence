import { prisma, type Db } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";

type JobFilter = Prisma.JobRequestWhereInput;

const OPEN_STATUSES = ["DRAFT", "OPEN", "ON_HOLD"] as const;

export const companiesRepository = {
  async list(where: Prisma.CompanyWhereInput, jobFilter: JobFilter, page: { skip: number; take: number }) {
    const [rows, total] = await Promise.all([
      prisma.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          hubspotCompanyId: true,
          industry: true,
          location: true,
          status: true,
          updatedAt: true,
          jobRequests: {
            where: { ...jobFilter, status: { in: [...OPEN_STATUSES] }, archivedAt: null },
            select: { openings: true, psmOwner: { select: { id: true, fullName: true } } },
          },
        },
        orderBy: { name: "asc" },
        ...page,
      }),
      prisma.company.count({ where }),
    ]);
    return { rows, total };
  },

  findById(id: string, jobFilter: JobFilter) {
    return prisma.company.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        jobRequests: {
          where: { ...jobFilter, archivedAt: null },
          select: {
            id: true,
            jobId: true,
            roleTitle: true,
            openings: true,
            status: true,
            requestDate: true,
            deadline: true,
            psmOwner: { select: { id: true, fullName: true } },
          },
          orderBy: { requestDate: "desc" },
        },
      },
    });
  },

  findPlain(id: string) {
    return prisma.company.findUnique({ where: { id } });
  },

  findByHubspotId(hubspotCompanyId: string) {
    return prisma.company.findUnique({ where: { hubspotCompanyId }, select: { id: true, name: true } });
  },

  /** Whether the user owns, or created, any job request at this company. */
  async userWorksWithCompany(companyId: string, userId: string): Promise<boolean> {
    const job = await prisma.jobRequest.findFirst({
      where: { companyId, OR: [{ psmOwnerId: userId }, { createdById: userId }] },
      select: { id: true },
    });
    return job !== null;
  },

  create(db: Db, data: Prisma.CompanyUncheckedCreateInput) {
    return db.company.create({ data });
  },

  update(db: Db, id: string, data: Prisma.CompanyUncheckedUpdateInput) {
    return db.company.update({ where: { id }, data });
  },
};
