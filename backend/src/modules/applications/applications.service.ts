import type { DecisionStage } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { jobRequestScopeFilter } from "../../services/data-scope.service.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { protectContact } from "../../services/pii.js";
import { ApiError } from "../../utils/api-error.js";
import { normalizeEmail, normalizeMobile } from "../../utils/normalize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { generatedCandidateCode } from "../imports/internal-plan.js";
import { candidateSummarySelect } from "../screening/screening.repository.js";
import type { AddApplicationInput, CarryOverCandidatesQuery, CarryOverInput } from "./applications.validators.js";

export const applicationsService = {
  /** Adds one candidate to the job by hand: an existing candidate, or a new one. */
  async add(user: AuthenticatedUser, jobRequestId: string, input: AddApplicationInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "candidate:write");

    return inTransaction(async (transaction) => {
      let candidateId = input.candidateId;
      let productId: string | null = null;
      if (candidateId) {
        if (!(await transaction.candidate.findUnique({ where: { id: candidateId }, select: { id: true } }))) {
          throw new ApiError(404, "CANDIDATE_NOT_FOUND", "The candidate was not found.");
        }
      } else {
        const details = input.candidate!;
        const email = normalizeEmail(details.email);
        const mobile = normalizeMobile(details.mobile);
        if (details.email && !email) throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
        const code = details.candidateCode || generatedCandidateCode(email, mobile, details.fullName);
        const existing = await transaction.candidate.findUnique({ where: { candidateCode: code }, select: { id: true } });
        if (existing) throw new ApiError(409, "CANDIDATE_EXISTS", "A candidate with this Candidate ID already exists; choose them instead.");
        if (details.productId) {
          const product = await transaction.product.findUnique({ where: { id: details.productId }, select: { id: true, category: true } });
          if (!product) throw new ApiError(400, "INVALID_PRODUCT", "The product was not found.");
          productId = product.id;
        }
        const created = await transaction.candidate.create({
          data: {
            candidateCode: code,
            fullName: details.fullName,
            email,
            mobile,
            ...(productId ? { products: { create: { productId } } } : {}),
          },
          select: { id: true },
        });
        candidateId = created.id;
      }

      const duplicate = await transaction.application.findUnique({ where: { candidateId_jobRequestId: { candidateId, jobRequestId: job.id } }, select: { id: true } });
      if (duplicate) throw new ApiError(409, "ALREADY_APPLIED", "This candidate is already an applicant of this job.");
      const application = await transaction.application.create({
        data: { candidateId, jobRequestId: job.id, productId, source: "MANUAL" },
        select: { id: true },
      });
      await recordAudit(transaction, audit, { action: "APPLICATION_ADDED", entityType: "JobRequest", entityId: job.id, metadata: { applicationId: application.id, candidateId } });
      return application;
    });
  },

  /** Earlier job requests the PSM can re-use candidates from; same company first. */
  async carryOverSources(user: AuthenticatedUser, jobRequestId: string) {
    const { job, scope } = await loadJobForUser(user, jobRequestId);
    const jobs = await prisma.jobRequest.findMany({
      where: { ...jobRequestScopeFilter(scope), id: { not: job.id }, archivedAt: null, applications: { some: {} } },
      select: {
        id: true,
        jobId: true,
        roleTitle: true,
        requestDate: true,
        status: true,
        company: { select: { id: true, name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { requestDate: "desc" },
      take: 100,
    });
    return jobs
      .map(({ _count, ...other }) => ({ ...other, applications: _count.applications, sameCompany: other.company.id === job.companyId }))
      .sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany));
  },

  /** Candidates of an earlier job, with their outcomes there, to tick for re-use. */
  async carryOverCandidates(user: AuthenticatedUser, jobRequestId: string, query: CarryOverCandidatesQuery) {
    const { job } = await loadJobForUser(user, jobRequestId);
    await loadJobForUser(user, query.fromJobRequestId);
    const applications = await prisma.application.findMany({
      where: {
        jobRequestId: query.fromJobRequestId,
        ...(query.stage && query.outcome ? { stageOutcomes: { some: { outcome: query.outcome, stage: { stage: query.stage } } } } : {}),
      },
      select: {
        id: true,
        candidate: { select: { ...candidateSummarySelect, applications: { where: { jobRequestId: job.id }, select: { id: true } } } },
        stageOutcomes: { select: { outcome: true, stage: { select: { stage: true } } } },
        nomination: { select: { pipelineStatus: true } },
      },
      orderBy: { appliedAt: "asc" },
      take: 1000,
    });
    return applications.map(({ candidate: { applications: onThisJob, ...candidate }, stageOutcomes, ...application }) => ({
      ...application,
      candidate: protectContact(user, candidate),
      outcomes: Object.fromEntries(stageOutcomes.map(({ outcome, stage }) => [stage.stage, outcome])) as Partial<Record<DecisionStage, string>>,
      alreadyOnThisJob: onThisJob.length > 0,
    }));
  },

  /** Re-uses candidates from an earlier drive: each gets a new application linked to the old one. */
  async carryOver(user: AuthenticatedUser, jobRequestId: string, input: CarryOverInput, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "candidate:write");
    if (input.fromJobRequestId === job.id) throw new ApiError(400, "SAME_JOB", "Choose an earlier job request.");
    await loadJobForUser(user, input.fromJobRequestId);
    const sources = await prisma.application.findMany({
      where: { id: { in: input.applicationIds }, jobRequestId: input.fromJobRequestId },
      select: { id: true, candidateId: true, productId: true },
    });
    if (sources.length !== new Set(input.applicationIds).size) {
      throw new ApiError(400, "INVALID_APPLICATION", "Some selected candidates are not applicants of the earlier job.");
    }
    return inTransaction(async (transaction) => {
      const result = await transaction.application.createMany({
        data: sources.map((source) => ({
          candidateId: source.candidateId,
          jobRequestId: job.id,
          productId: source.productId,
          source: "CARRIED_OVER" as const,
          sourceApplicationId: source.id,
        })),
        skipDuplicates: true,
      });
      await recordAudit(transaction, audit, {
        action: "CANDIDATES_CARRIED_OVER",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { fromJobRequestId: input.fromJobRequestId, selected: sources.length, added: result.count },
      });
      return { added: result.count, alreadyOnThisJob: sources.length - result.count };
    });
  },
};
