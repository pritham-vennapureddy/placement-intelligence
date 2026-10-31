import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { dashboardRepository } from "./dashboard.repository.js";
import type { SummaryQuery } from "./dashboard.validators.js";

const scopeLabel = { organization: "organization", team: "team", self: "individual" } as const;

/** Job-request conditions from the dashboard filter bar (request date, eligible product, skill). */
export function jobRequestFilterFrom(query: SummaryQuery): Prisma.JobRequestWhereInput {
  return {
    ...(query.from || query.to
      ? {
        requestDate: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      }
      : {}),
    ...(query.productId ? { eligibleProducts: { some: { productId: query.productId } } } : {}),
    ...(query.skill ? { skills: { some: { skill: { normalizedName: query.skill } } } } : {}),
  };
}

export const dashboardService = {
  async getSummary(user: AuthenticatedUser, query: SummaryQuery) {
    const scope = await resolveDataScope(user);
    const filter = { ...jobRequestScopeFilter(scope), ...jobRequestFilterFrom(query) };
    const isUnfiltered = Object.keys(filter).length === 0;
    const ownerIds = scope.kind === "organization" ? undefined : scope.ownerIds;

    const [totalCompanies, activeJobRequests, openPositions, psmCount, companies, funnel] = await Promise.all([
      dashboardRepository.countCompanies(isUnfiltered ? null : filter),
      dashboardRepository.countOpenJobRequests(filter),
      dashboardRepository.sumOpenPositions(filter),
      dashboardRepository.countActivePsms(ownerIds),
      scope.kind === "organization" ? Promise.resolve([]) : dashboardRepository.listCompaniesWithJobRequests(filter),
      dashboardRepository.funnel(filter),
    ]);

    return {
      totalCompanies,
      activeJobRequests,
      openPositions,
      psmCount: scope.kind === "self" ? 1 : psmCount,
      scope: scopeLabel[scope.kind],
      teamName: scope.teamName,
      companies,
      funnel,
    };
  },
};
