import {
  canTransitionJob,
  companyProcessLabel,
  hasPermission,
  hubspotRecordUrl,
  jobTransitionNeedsReason,
  JOB_STATUS_LABELS,
  JOB_STATUS_TRANSITIONS,
} from "@placement/shared";
import { env } from "../../config/env.js";
import { inTransaction, prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
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
import { BATCH_TAB_CODES, parseBatchTabs, tabNames, tabsFromMapping, type BatchTabs } from "../imports/batch-tabs.js";
import { importsRepository } from "../imports/imports.repository.js";
import { suggestRecruitmentTab } from "../imports/tab-names.js";
import { extractSpreadsheetId, inspectSpreadsheet } from "../sheets/google-sheets.service.js";
import { deleteJobRequestData } from "./delete-job-request-data.js";
import { resolveJobRequestOwner } from "./owner-policy.js";
import { jobProgress, jobRequestsRepository, type JobRequestDetail } from "./job-requests.repository.js";
import type {
  ChangeStatusInput,
  CreateRecruitmentBatchInput,
  CreateJobRequestInput,
  ListJobRequestsQuery,
  ReassignOwnerInput,
  UpdateJobRequestInput,
  UpdateRecruitmentBatchInput,
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

/** True when both links open the same Google spreadsheet (tab and query parts ignored). */
function sameSheet(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  try {
    return extractSpreadsheetId(a) === extractSpreadsheetId(b);
  } catch {
    return a.trim() === b.trim();
  }
}

/** A batch keeps its own sheet link only when it differs from the job request's; otherwise it follows the job. */
function ownSheet(url: string | null | undefined, jobUrl: string | null): string | null {
  if (!url) return null;
  return jobUrl && sameSheet(url, jobUrl) ? null : url;
}

function assertBatchNameFree(job: JobRequestDetail, name: string, exceptId?: string) {
  const key = name.trim().toLowerCase();
  if (job.recruitmentBatches.some((batch) => batch.id !== exceptId && batch.name.trim().toLowerCase() === key)) {
    throw new ApiError(409, "RECRUITMENT_BATCH_NAME_TAKEN", `This job request already has a batch called “${name.trim()}”.`);
  }
}

/**
 * Tab name → batch name, for the other batches of this job that read the same
 * workbook. A batch's chosen tabs count; a batch without chosen tabs counts the
 * tabs of its last approved import.
 */
async function tabsUsedByOtherBatches(job: JobRequestDetail, exceptId: string | null, ownUrl: string | null): Promise<Record<string, string>> {
  const effective = ownUrl ?? job.internalSheetUrl;
  const mappings = await importsRepository.latestMappingByBatch(job.id, "INTERNAL_SCREENING");
  const usedBy: Record<string, string> = {};
  for (const other of job.recruitmentBatches) {
    if (other.id === exceptId) continue;
    if (!sameSheet(other.internalSheetUrl ?? job.internalSheetUrl, effective)) continue;
    const tabs = parseBatchTabs(other.internalTabs) ?? tabsFromMapping(mappings.get(other.id));
    for (const name of tabNames(tabs)) usedBy[name] ??= other.name;
  }
  return usedBy;
}

/** One tab belongs to one batch: reusing it would import the same rows into two batches. */
async function assertTabsFree(job: JobRequestDetail, exceptId: string | null, ownUrl: string | null, tabs: BatchTabs | null) {
  if (!tabs) return;
  const usedBy = await tabsUsedByOtherBatches(job, exceptId, ownUrl);
  const byKey = new Map(Object.entries(usedBy).map(([name, batch]) => [name.toLowerCase(), batch]));
  const clash = tabNames(tabs).find((name) => byKey.has(name.toLowerCase()));
  if (clash) {
    const owner = byKey.get(clash.toLowerCase());
    throw new ApiError(409, "TAB_IN_USE", `The tab “${clash}” already belongs to ${owner}. Pick another tab, or change ${owner} first.`);
  }
}

/** The new owner must be an active employee inside the assigner's scope. */
async function assertAssignableOwner(scope: DataScope, userId: string) {
  const owner = await jobRequestsRepository.findAssignablePsm(userId);
  if (!owner || !isJobOwnerInScope(scope, owner.id)) {
    throw new ApiError(400, "INVALID_EMPLOYEE_OWNER", "Choose an active employee from the shared workspace as the owner.");
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
    canDelete: hasPermission(user.roles, "job:assign"),
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
    const jobRequests = rows.map(({ skills, eligibleProducts, processRound, ...job }) => ({
      ...job,
      processLabel: companyProcessLabel(job.processPhase, processRound?.name),
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

  async createRecruitmentBatch(user: AuthenticatedUser, jobRequestId: string, input: CreateRecruitmentBatchInput, audit: AuditContext) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    if (!hasPermission(user.roles, "job:write") || !isJobOwnerInScope(scope, job.psmOwnerId)) {
      throw new ApiError(403, "FORBIDDEN", "You cannot add a recruitment batch to this job request.");
    }
    assertBatchNameFree(job, input.name);
    const internalSheetUrl = ownSheet(input.internalSheetUrl, job.internalSheetUrl);
    const internalTabs = parseBatchTabs(input.internalTabs);
    await assertTabsFree(job, null, internalSheetUrl, internalTabs);
    const last = await prisma.recruitmentBatch.aggregate({ where: { jobRequestId: job.id }, _max: { sequence: true } });
    const sequence = (last._max.sequence ?? 0) + 1;
    const batch = await prisma.recruitmentBatch.create({
      data: {
        jobRequestId: job.id,
        name: input.name,
        sequence,
        openings: input.openings ?? null,
        startsAt: input.startsAt ? toDate(input.startsAt) : null,
        endsAt: input.endsAt ? toDate(input.endsAt) : null,
        internalSheetUrl,
        companySheetUrl: ownSheet(input.companySheetUrl, job.companySheetUrl),
        internalTabs: internalTabs ?? Prisma.DbNull,
      },
    });
    await recordAudit(prisma, audit, {
      action: "RECRUITMENT_BATCH_CREATED", entityType: "JobRequest", entityId: job.id,
      metadata: { recruitmentBatchId: batch.id, name: batch.name, sequence, ...(internalTabs ? { tabs: internalTabs } : {}) },
    });
    return batch;
  },

  /** Renames a batch, changes its openings, dates or status, or which tabs (or workbook) it reads. */
  async updateRecruitmentBatch(user: AuthenticatedUser, jobRequestId: string, batchId: string, input: UpdateRecruitmentBatchInput, audit: AuditContext) {
    const { job, scope } = await loadVisible(user, jobRequestId);
    if (!hasPermission(user.roles, "job:write") || !isJobOwnerInScope(scope, job.psmOwnerId)) {
      throw new ApiError(403, "FORBIDDEN", "You cannot change recruitment batches of this job request.");
    }
    const current = job.recruitmentBatches.find((batch) => batch.id === batchId);
    if (!current) throw new ApiError(404, "RECRUITMENT_BATCH_NOT_FOUND", "The recruitment batch was not found on this job request.");
    if (input.name !== undefined) assertBatchNameFree(job, input.name, batchId);

    const internalSheetUrl = input.internalSheetUrl === undefined ? current.internalSheetUrl : ownSheet(input.internalSheetUrl, job.internalSheetUrl);
    const internalTabs = input.internalTabs === undefined ? parseBatchTabs(current.internalTabs) : parseBatchTabs(input.internalTabs);
    if (input.internalTabs !== undefined || input.internalSheetUrl !== undefined) {
      await assertTabsFree(job, batchId, internalSheetUrl, internalTabs);
    }
    const startsAt = input.startsAt === undefined ? current.startsAt : input.startsAt ? toDate(input.startsAt) : null;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt ? toDate(input.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new ApiError(400, "VALIDATION_ERROR", "The end date cannot be before the batch start date.");
    }

    const data = definedOnly({
      name: input.name,
      openings: input.openings,
      status: input.status,
      startsAt: input.startsAt === undefined ? undefined : startsAt,
      endsAt: input.endsAt === undefined ? undefined : endsAt,
      internalSheetUrl: input.internalSheetUrl === undefined ? undefined : internalSheetUrl,
      companySheetUrl: input.companySheetUrl === undefined ? undefined : ownSheet(input.companySheetUrl, job.companySheetUrl),
    });
    const changes: Record<string, unknown> = diffFields(current, data);
    if (input.internalTabs !== undefined && JSON.stringify(parseBatchTabs(current.internalTabs)) !== JSON.stringify(internalTabs)) {
      changes.internalTabs = { from: parseBatchTabs(current.internalTabs), to: internalTabs };
    }
    const batch = await prisma.recruitmentBatch.update({
      where: { id: batchId },
      data: { ...data, ...(input.internalTabs !== undefined ? { internalTabs: internalTabs ?? Prisma.DbNull } : {}) },
    });
    if (Object.keys(changes).length > 0) {
      await recordAudit(prisma, audit, {
        action: "RECRUITMENT_BATCH_UPDATED", entityType: "JobRequest", entityId: job.id,
        metadata: { recruitmentBatchId: batch.id, name: batch.name, changes },
      });
    }
    return batch;
  },

  /**
   * The tabs of the internal sheet a batch reads (its own workbook, else the
   * job's), with a suggested TA / RS / SC / AS / SP choice and which tabs other
   * batches already use.
   */
  async internalSheetTabs(user: AuthenticatedUser, jobRequestId: string, batchId?: string, otherUrl?: string) {
    const { job } = await loadVisible(user, jobRequestId);
    const batch = batchId ? job.recruitmentBatches.find(({ id }) => id === batchId) : undefined;
    if (batchId && !batch) throw new ApiError(404, "RECRUITMENT_BATCH_NOT_FOUND", "The recruitment batch was not found on this job request.");
    // `otherUrl`: a different workbook the PSM is typing for this batch, not saved yet.
    const ownUrl = otherUrl ? ownSheet(otherUrl, job.internalSheetUrl) : batch?.internalSheetUrl ?? null;
    const url = ownUrl ?? job.internalSheetUrl;
    if (!url) {
      throw new ApiError(400, "NO_INTERNAL_SHEET", "Add the internal sheet link on the job request first (Edit job request → Internal sheet).");
    }
    const spreadsheet = await inspectSpreadsheet(extractSpreadsheetId(url));
    const tabs = [...spreadsheet.tabs].sort((a, b) => a.index - b.index).map(({ title }) => title);
    const usedBy = await tabsUsedByOtherBatches(job, batchId ?? null, ownUrl);
    const used = new Set(Object.keys(usedBy));
    const suggested: BatchTabs = {};
    for (const code of BATCH_TAB_CODES) {
      const tab = suggestRecruitmentTab(tabs.map((name) => ({ name })), code, used);
      if (tab) suggested[code] = tab.name;
    }
    return { url, title: spreadsheet.title, tabs, suggested, current: parseBatchTabs(batch?.internalTabs), usedBy };
  },

  async create(user: AuthenticatedUser, input: CreateJobRequestInput, audit: AuditContext) {
    const scope = await resolveDataScope(user);
    const { ownerId, adminSelfAssignment } = resolveJobRequestOwner(user, input.psmOwnerId);
    if (!adminSelfAssignment) await assertAssignableOwner(scope, ownerId);

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
          ctcLpa: input.ctcLpa ?? null,
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

  async delete(user: AuthenticatedUser, jobRequestId: string, audit: AuditContext) {
    if (!hasPermission(user.roles, "job:assign")) {
      throw new ApiError(403, "FORBIDDEN", "Only managers can permanently delete a job request.");
    }
    const { job } = await loadVisible(user, jobRequestId);
    await inTransaction(async (transaction) => {
      await deleteJobRequestData(transaction, job.id);
      await recordAudit(transaction, audit, {
        action: "JOB_REQUEST_DELETED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { jobId: job.jobId, roleTitle: job.roleTitle, companyId: job.companyId },
      });
    }, { timeoutMs: 120_000 });
    return { id: job.id };
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
      throw new ApiError(400, "SAME_OWNER", "This employee already owns the job request.");
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

  /** Active job requests in scope with internal-stage and company-pipeline progress. */
  async progress(user: AuthenticatedUser) {
    const scope = await resolveDataScope(user);
    const { rows } = await jobRequestsRepository.list(
      { ...jobRequestScopeFilter(scope), archivedAt: null, status: { in: ["DRAFT", "OPEN", "ON_HOLD"] } },
      { skip: 0, take: 200 },
    );
    const ids = rows.map(({ id }) => id);
    const data = await jobProgress(ids);
    const stageName = new Map(data.stages.map(({ id, stage }) => [id, stage]));
    return rows.map((job) => ({
      id: job.id,
      jobId: job.jobId,
      roleTitle: job.roleTitle,
      status: job.status,
      deadline: job.deadline,
      company: job.company,
      psmOwner: job.psmOwner,
      applications: data.applications.find((row) => row.jobRequestId === job.id)?._count._all ?? 0,
      stages: Object.fromEntries(data.stages.filter((row) => row.jobRequestId === job.id).map((row) => [row.stage, row.status])),
      selected: Object.fromEntries(
        data.selections.filter((row) => row.jobRequestId === job.id).map((row) => [stageName.get(row.stageId), row._count._all]),
      ),
      pipeline: Object.fromEntries(data.pipeline.filter((row) => row.jobRequestId === job.id).map((row) => [row.pipelineStatus, row._count._all])),
    }));
  },
};
