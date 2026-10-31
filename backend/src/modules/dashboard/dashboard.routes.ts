import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { prisma } from "../../db.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", authenticate, async (request, response) => {
  const isAdmin = request.user!.roles.includes("ADMIN");
  const isManager = request.user!.roles.includes("MANAGER");
  let ownerIds: string[] | undefined;
  let teamName: string | null = null;

  if (!isAdmin) {
    if (isManager) {
      const team = await prisma.team.findFirst({
        where: { teamLeadId: request.user!.id },
        include: {
          members: {
            where: { isActive: true, roles: { some: { role: { code: "PSM" } } } },
            select: { id: true },
          },
        },
      });
      ownerIds = team?.members.map(({ id }) => id) ?? [];
      teamName = team?.name ?? null;
    } else {
      ownerIds = [request.user!.id];
      const member = await prisma.user.findUnique({
        where: { id: request.user!.id },
        select: { team: { select: { name: true } } },
      });
      teamName = member?.team?.name ?? null;
    }
  }

  const requestFilter = ownerIds ? { psmOwnerId: { in: ownerIds } } : {};
  const companyFilter = ownerIds
    ? {
      OR: [
        { jobRequests: { some: { psmOwnerId: { in: ownerIds } } } },
        { assignments: { some: { assignedToId: { in: ownerIds }, endedAt: null } } },
      ],
    }
    : {};

  const [totalCompanies, activeJobRequests, openPositions, psmCount, ownedCompanies] = await Promise.all([
    prisma.company.count({ where: companyFilter }),
    prisma.jobRequest.count({ where: { ...requestFilter, status: "OPEN" } }),
    prisma.jobRequest.aggregate({
      where: { ...requestFilter, status: "OPEN" },
      _sum: { openings: true },
    }),
    isAdmin
      ? prisma.user.count({
        where: { isActive: true, roles: { some: { role: { code: "PSM" } } } },
      })
      : isManager
        ? prisma.user.count({
          where: {
            isActive: true,
            team: { teamLeadId: request.user!.id },
            roles: { some: { role: { code: "PSM" } } },
          },
        })
        : Promise.resolve(1),
    ownerIds
      ? prisma.company.findMany({
        where: companyFilter,
        select: {
          id: true,
          name: true,
          jobRequests: {
            where: requestFilter,
            select: { id: true, jobId: true, roleTitle: true, openings: true, status: true },
            orderBy: { updatedAt: "desc" },
          },
        },
        orderBy: { name: "asc" },
      })
      : Promise.resolve([]),
  ]);

  response.json({
    data: {
      totalCompanies,
      activeJobRequests,
      openPositions: openPositions._sum.openings ?? 0,
      psmCount,
      scope: isAdmin ? "organization" : isManager ? "team" : "individual",
      teamName,
      companies: ownedCompanies,
    },
  });
});
