import {
  canTransitionJob,
  hasPermission,
  hubspotRecordUrl,
  jobTransitionNeedsReason,
  JOB_STATUS_LABELS,
  JOB_STATUS_TRANSITIONS,
} from "@placement/shared";
import { env } from "../../config/env.js";
import { inTransaction, prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import {
  isJobOwnerInScope,
  jobRequestScopeFilter,
  resolveDataScope,
  type DataScope,
} from "../../services/data-scope.service.js";
import { ApiError } from "../../utils/api-error.js";
import { definedOnly } from "../../utils/object.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { splitSkills } from "../../utils/skills.js";
import { diffFields, listAuditHistory, recordAudit, type AuditContext } from "../audit/audit.service.js";
import { companyHubspotUrl } from "../companies/companies.service.js";
import { jobRequestsRepository, type JobRequestDetail } from "./job-requests.repository.js";
import type {
  ChangeStatusInput,
  CreateJobRequestInput,
  ListJobRequestsQuery,
  ReassignOwnerInput,
  UpdateJobRequestInput,
} from "./job-requests.validators.js";

const VIEW_STATUSES = {
  active: ["DRAFT", "OPEN", "ON_HOLD"],
  closed: ["FILLED", "CLOSED", "CANCELLED"],
  all: undefined,
} as const;

const notFound = () => new ApiError(404, "JOB_REQUEST_NOT_FOUND", "The job request was not found.");
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

function dealUrl(hubspotDealId: string | null): string | null {
  return hubspotDealId && env.HUBSPOT_PORTAL_ID ? hubspotRecordUrl(env.HUBSPOT_PORTAL_ID, "deal", hubspotDealId) : null;
}

/** Loads a job request the user may see, or throws 404 (never revealing out-of-scope jobs). */
async function loadVisible(user: AuthenticatedUser, jobRequestId: string): Promise<{ job: JobRequestDetail; scope: DataScope }> {
  const [job, scope] = await Promise.all([jobRequestsRepository.findDetail(jobRequestId), resolveDataScope(user)]);
  if (!job || job.archivedAt || !isJobOwnerInScope(scope, job.psmOwnerId)) {
    throw notFound();
  }
  return { job, scope };
}

/** The new owner must be an active PSM inside the assigner's scope. */
async function assertAssignableOwner(scope: DataScope, userId: string) {
  const owner = await jobRequestsRepository.findAssignablePsm(userId);
  if (!owner || !isJobOwnerInScope(scope, owner.id)) {
    throw new ApiError(400, "INVALID_PSM_OWNER", "Choose an active PSM from your team as the owner.");
  }
  return owner;
}

async function assertUniqueKeys(jobId: string | undefined, hubspotDealId: string | null | undefined, exceptId?: string) {
  if (jobId) {
    const existing = await jobRequestsRepository.findByJobId(jobId);
    if (existing && existing.id !== exceptId) {
      throw new ApiError(409, "JOB_ID_EXISTS", `Job ID already used by “${existing.roleTitle}”.`);
    }
  }
  if (hubspotDealId) {
    const existing = await jobRequestsRepository.findByHubspotDealId(hubspotDealId);
    if (existing && existing.id !== exceptId) {
      throw new ApiError(409, "HUBSPOT_DEAL_EXISTS", `This HubSpot deal is already linked to “${existing.roleTitle}”.`);
    }
  }
}

async function assertProductsExist(productIds: string[]) {
  const unique = [...new Set(productIds)];
  if (unique.length > 0 && (await jobRequestsRepository.countActiveProducts(unique)) !== unique.length) {
    throw new ApiError(400, "INVALID_PRODUCT", "One or more selected products are unavailable.");
  }
  return unique;
}

function present(job: JobRequestDetail, user: AuthenticatedUser, scope: DataScope) {
  const canEdit = hasPermission(user.roles, "job:write") && isJobOwnerInScope(scope, job.psmOwnerId);
  return {
    ...job,
    hubspotDealUrl: dealUrl(job.hubspotDealId),
    company: { ...job.company, hubspotUrl: companyHubspotUrl(job.company.hubspotCompanyId) },
    allowedTransitions: canEdit ? JOB_STATUS_TRANSITIONS[job.status] : [],
    canEdit,
    canReassign: canEdit && hasPermission(user.roles, "job:assign"),
  };
}

export const jobRequestsService = {
  async list(user: AuthenticatedUser, query: ListJobRequestsQuery) {
    const scope = await resolveDataScope(user);
    const statuses = query.status ? [query.status] : VIEW_STATUSES[query.view];
    const where: Prisma.JobRequestWhereInput = {
      ...jobRequestScopeFilter(scope),
      archivedAt: null,
      ...(statuses ? { status: { in: [...statuses] } } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.ownerId ? { psmOwnerId: query.ownerId } : {}),
      ...(query.productId ? { eligibleProducts: { some: { productId: query.productId } } } : {}),
      ...(query.skill ? { skills: { some: { skill: { normalizedName: query.skill } } } } : {}),
      ...(query.search
        ? {
          OR: [
            { jobId: { contains: query.search.toLowerCase() } },
            { roleTitle: { contains: query.search, mode: "insensitive" } },
            { company: { name: { contains: query.search, mode: "insensitive" } } },
            { skills: { some: { skill: { normalizedName: { contains: query.search.toLowerCase() } } } } },
          ],
        }
        : {}),
    };
    const { rows, total } = await jobRequestsRepository.list(where, toPrismaPage(query));
    const jobRequests = rows.map(({ skills, eligibleProducts, ...job }) => ({
      ...job,
      techStack: skills.map(({ skill }) => skill.name),
      eligibleProducts: eligibleProducts.map(({ product }) => product),
    }));
    return { jobRequests, meta: buildPaginationMeta(query, total) };
  },

  async get(user: AuthenticatedUser, jobRequestId: string) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    const history = await listAuditHistory(prisma, "JobRequest", [job.id]);
    return { ...present(job, user, scope), history };
  },

  async create(user: AuthenticatedUser, input: CreateJobRequestInput, audit: AuditContext) {
    const scope = await resolveDataScope(user);
    const canAssign = hasPermission(user.roles, "job:assign");

    let ownerId: string;
    if (canAssign) {
      if (!input.psmOwnerId && !user.roles.includes("PSM")) {
        throw new ApiError(400, "PSM_OWNER_REQUIRED", "Choose the PSM who owns this job request.");
      }
      ownerId = input.psmOwnerId ?? user.id;
    } else {
      if (input.psmOwnerId && input.psmOwnerId !== user.id) {
        throw new ApiError(403, "FORBIDDEN", "Only managers can assign a job request to someone else.");
      }
      ownerId = user.id;
    }
    await assertAssignableOwner(scope, ownerId);

    const company = await jobRequestsRepository.findActiveCompany(input.companyId);
    if (!company) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "The selected company was not found.");
    }
    if (company.status === "INACTIVE") {
      throw new ApiError(409, "COMPANY_INACTIVE", "Reactivate the company before adding job requests.");
    }
    await assertUniqueKeys(input.jobId, input.hubspotDeal);
    const productIds = await assertProductsExist(input.eligibleProductIds);
    const skills = splitSkills(input.techStack);

    return inTransaction(async (transaction) => {
      const job = await jobRequestsRepository.create(
        transaction,
        {
          jobId: input.jobId,
          hubspotDealId: input.hubspotDeal ?? null,
          companyId: input.companyId,
          roleTitle: input.roleTitle,
          openings: input.openings,
          requiredCandidateCount: input.requiredCandidateCount,
          description: input.description,
          requestDate: toDate(input.requestDate),
          deadline: input.deadline ? toDate(input.deadline) : null,
          status: input.status,
          timeline: input.timeline ?? null,
          shortlistingMechanism: input.shortlistingMechanism ?? null,
          companyRemarks: input.companyRemarks ?? null,
          companySheetUrl: input.companySheetUrl ?? null,
          internalSheetUrl: input.internalSheetUrl ?? null,
          psmOwnerId: ownerId,
          createdById: user.id,
        },
        skills,
        productIds,
        user.id,
      );
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_CREATED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { jobId: job.jobId, companyId: job.companyId, roleTitle: job.roleTitle, psmOwnerId: ownerId, status: job.status },
      });
      // Company history shows its job requests too.
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_ADDED",
        entityType: "Company",
        entityId: job.companyId,
        metadata: { jobRequestId: job.id, jobId: job.jobId, roleTitle: job.roleTitle },
      });
      return job;
    });
  },

  async update(user: AuthenticatedUser, jobRequestId: string, input: UpdateJobRequestInput, audit: AuditContext) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    if (!present(job, user, scope).canEdit) {
      throw new ApiError(403, "FORBIDDEN", "You cannot edit this job request.");
    }

    const { techStack, eligibleProductIds, hubspotDeal, requestDate, deadline, ...fields } = input;
    const nextRequest = requestDate ?? job.requestDate.toISOString().slice(0, 10);
    const nextDeadline = deadline === undefined ? job.deadline?.toISOString().slice(0, 10) : deadline;
    if (nextDeadline && nextDeadline < nextRequest) {
      throw new ApiError(400, "INVALID_DEADLINE", "The deadline cannot be before the request date.");
    }
    await assertUniqueKeys(fields.jobId, hubspotDeal, job.id);
    const productIds = eligibleProductIds ? await assertProductsExist(eligibleProductIds) : undefined;
    const skills = techStack ? splitSkills(techStack) : undefined;

    const data = definedOnly({
      ...fields,
      hubspotDealId: hubspotDeal,
      requestDate: requestDate ? toDate(requestDate) : undefined,
      deadline: deadline === undefined ? undefined : deadline ? toDate(deadline) : null,
    });
    const changes: Record<string, unknown> = diffFields(job, data);
    const previousSkills = job.skills.map(({ skill }) => skill.name).sort();
    if (skills && JSON.stringify([...skills].sort()) !== JSON.stringify(previousSkills)) {
      changes.techStack = { from: previousSkills, to: skills };
    }
    const previousProducts = job.eligibleProducts.map(({ product }) => product.id).sort();
    if (productIds && JSON.stringify([...productIds].sort()) !== JSON.stringify(previousProducts)) {
      changes.eligibleProductIds = { from: previousProducts, to: productIds };
    }
    if (Object.keys(changes).length === 0) {
      return present(job, user, scope);
    }

    const updated = await inTransaction(async (transaction) => {
      await jobRequestsRepository.update(transaction, job.id, data, skills, productIds);
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_UPDATED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { changes },
      });
      return jobRequestsRepository.findDetail(job.id, transaction);
    });
    return present(updated!, user, scope);
  },

  async changeStatus(user: AuthenticatedUser, jobRequestId: string, input: ChangeStatusInput, audit: AuditContext) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    if (!present(job, user, scope).canEdit) {
      throw new ApiError(403, "FORBIDDEN", "You cannot change this job request.");
    }
    if (!canTransitionJob(job.status, input.status)) {
      throw new ApiError(
        409,
        "INVALID_STATUS_CHANGE",
        `A job request that is ${JOB_STATUS_LABELS[job.status].toLowerCase()} cannot be moved to ${JOB_STATUS_LABELS[input.status].toLowerCase()}.`,
      );
    }
    if (jobTransitionNeedsReason(job.status, input.status) && !input.reason) {
      throw new ApiError(400, "REASON_REQUIRED", "Give a reason for this change.");
    }

    await inTransaction(async (transaction) => {
      await jobRequestsRepository.setStatus(transaction, job.id, input.status);
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_STATUS_CHANGED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { from: job.status, to: input.status, reason: input.reason ?? null },
      });
    });
    return jobRequestsService.get(user, job.id);
  },

  async reassign(user: AuthenticatedUser, jobRequestId: string, input: ReassignOwnerInput, audit: AuditContext) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    if (!present(job, user, scope).canReassign) {
      throw new ApiError(403, "FORBIDDEN", "Only managers can reassign job requests.");
    }
    if (job.psmOwnerId === input.psmOwnerId) {
      throw new ApiError(400, "SAME_OWNER", "This PSM already owns the job request.");
    }
    const owner = await assertAssignableOwner(scope, input.psmOwnerId);

    await inTransaction(async (transaction) => {
      await jobRequestsRepository.reassign(transaction, job.id, owner.id, user.id, input.notes, new Date());
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_REASSIGNED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { fromUserId: job.psmOwnerId, toUserId: owner.id, notes: input.notes ?? null },
      });
    });
    return jobRequestsService.get(user, job.id);
  },
};
