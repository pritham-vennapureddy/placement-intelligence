import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { dashboardRepository } from "./dashboard.repository.js";

const scopeLabel = { organization: "organization", team: "team", self: "individual" } as const;

export const dashboardService = {
  async getSummary(user: AuthenticatedUser) {
    const scope = await resolveDataScope(user);
    const filter = jobRequestScopeFilter(scope);
    const ownerIds = scope.kind === "organization" ? undefined : scope.ownerIds;

    const [totalCompanies, activeJobRequests, openPositions, psmCount, companies] = await Promise.all([
      dashboardRepository.countCompanies(filter),
      dashboardRepository.countOpenJobRequests(filter),
      dashboardRepository.sumOpenPositions(filter),
      dashboardRepository.countActivePsms(ownerIds),
      scope.kind === "organization" ? Promise.resolve([]) : dashboardRepository.listCompaniesWithJobRequests(filter),
    ]);

    return {
      totalCompanies,
      activeJobRequests,
      openPositions,
      psmCount: scope.kind === "self" ? 1 : psmCount,
      scope: scopeLabel[scope.kind],
      teamName: scope.teamName,
      companies,
    };
  },
};
