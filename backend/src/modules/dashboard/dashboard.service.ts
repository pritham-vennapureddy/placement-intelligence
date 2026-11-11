import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { prisma } from "../../db.js";
import { ApiError } from "../../utils/api-error.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { dashboardRepository } from "./dashboard.repository.js";
import type { CandidateAnalyticsQuery, PlacementKpisQuery, SummaryQuery } from "./dashboard.validators.js";
import { buildPlacementKpis } from "./placement-kpis.js";

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
  async getCompanyAnalytics(user: AuthenticatedUser, companyId: string) {
    const scope = await resolveDataScope(user);
    const result = await dashboardRepository.companyAnalytics(companyId, {
      ...jobRequestScopeFilter(scope),
      companyId,
    });
    if (!result.company) throw new ApiError(404, "COMPANY_NOT_FOUND", "The company was not found.");

    const totals = result.jobs.reduce((summary, job) => ({
      applications: summary.applications + job.applications,
      resumeShortlisted: summary.resumeShortlisted + (job.stages.RESUME_SHORTLIST?.selected ?? 0),
      screeningShortlisted: summary.screeningShortlisted + (job.stages.SCREENING_SHORTLIST?.selected ?? 0),
      assignmentShortlisted: summary.assignmentShortlisted + (job.stages.ASSIGNMENT_SHORTLIST?.selected ?? 0),
      finalShortlisted: summary.finalShortlisted + (job.stages.FINAL_SHORTLIST?.selected ?? 0),
      inAssessedPool: summary.inAssessedPool + job.breakdown.applications.inPool,
      screeningNoShow: summary.screeningNoShow + job.batches.reduce((total, batch) => total + batch.stages.SCREENING_SHORTLIST.noShow, 0),
    }), {
      applications: 0,
      resumeShortlisted: 0,
      screeningShortlisted: 0,
      assignmentShortlisted: 0,
      finalShortlisted: 0,
      inAssessedPool: 0,
      screeningNoShow: 0,
    });
    const productCounts = new Map<string, {
      name: string;
      category: string;
      applicants: number;
      resumeShortlisted: number;
      screeningShortlisted: number;
      assignmentShortlisted: number;
      finalShortlisted: number;
      inPool: number;
      poolFinalShortlisted: number;
    }>();
    for (const job of result.jobs) {
      for (const product of job.products) {
        const current = productCounts.get(product.id) ?? {
          name: product.name,
          category: product.category,
          applicants: 0,
          resumeShortlisted: 0,
          screeningShortlisted: 0,
          assignmentShortlisted: 0,
          finalShortlisted: 0,
          inPool: 0,
          poolFinalShortlisted: 0,
        };
        current.applicants += product.applicants;
        current.resumeShortlisted += product.resumeShortlisted;
        current.screeningShortlisted += product.screeningShortlisted;
        current.assignmentShortlisted += product.assignmentShortlisted;
        current.finalShortlisted += product.finalShortlisted;
        current.inPool += product.inPool;
        current.poolFinalShortlisted += product.poolFinalShortlisted;
        productCounts.set(product.id, current);
      }
    }
    return {
      company: result.company,
      totals,
      products: [...productCounts].map(([id, product]) => ({ id, ...product })),
      jobs: result.jobs,
    };
  },

  async getJobCandidates(user: AuthenticatedUser, companyId: string, jobRequestId: string, query: CandidateAnalyticsQuery) {
    const scope = await resolveDataScope(user);
    const job = await prisma.jobRequest.findFirst({
      where: { id: jobRequestId, companyId, ...jobRequestScopeFilter(scope) },
      select: { id: true },
    });
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "The job request was not found in this workspace.");
    if (query.recruitmentBatchId) {
      const batch = await prisma.recruitmentBatch.findFirst({
        where: { id: query.recruitmentBatchId, jobRequestId: job.id },
        select: { id: true },
      });
      if (!batch) throw new ApiError(404, "RECRUITMENT_BATCH_NOT_FOUND", "The recruitment batch was not found for this job.");
    }
    return dashboardRepository.jobCandidates(job.id, query.page, query.pageSize, query.recruitmentBatchId, {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.q ? { q: query.q } : {}),
    });
  },

  async getPlacementKpis(user: AuthenticatedUser, query: PlacementKpisQuery) {
    const scope = await resolveDataScope(user);
    const jobs = await dashboardRepository.placementKpiJobs({ ...jobRequestScopeFilter(scope), ...jobRequestFilterFrom(query) });
    return { from: query.from ?? null, to: query.to ?? null, ...buildPlacementKpis(jobs) };
  },

  async getSummary(user: AuthenticatedUser, query: SummaryQuery) {
    const scope = await resolveDataScope(user);
    const filter = { ...jobRequestScopeFilter(scope), ...jobRequestFilterFrom(query) };
    const isUnfiltered = Object.keys(filter).length === 0;
    const ownerIds = scope.kind === "organization" ? undefined : scope.ownerIds;

    const [totalCompanies, openRequestStats, employeeCount, companies, funnel] = await Promise.all([
      dashboardRepository.countCompanies(isUnfiltered ? null : filter),
      dashboardRepository.openRequestStats(filter),
      dashboardRepository.countActiveEmployees(ownerIds),
      dashboardRepository.listCompaniesWithJobRequests(filter),
      dashboardRepository.funnel(filter),
    ]);

    return {
      totalCompanies,
      activeJobRequests: openRequestStats.activeJobRequests,
      openPositions: openRequestStats.openPositions,
      employeeCount: scope.kind === "self" ? (user.roles.includes("EMPLOYEE") ? 1 : 0) : employeeCount,
      scope: scopeLabel[scope.kind],
      teamName: scope.teamName,
      companies,
      funnel,
    };
  },
};
