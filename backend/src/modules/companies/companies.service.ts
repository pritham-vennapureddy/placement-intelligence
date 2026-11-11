import { companyProcessLabel, hasPermission, hubspotRecordUrl } from "@placement/shared";
import { env } from "../../config/env.js";
import { inTransaction, prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { definedOnly } from "../../utils/object.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { diffFields, listAuditHistory, recordAudit, type AuditContext } from "../audit/audit.service.js";
import { deleteJobRequestData } from "../job-requests/delete-job-request-data.js";
import { companiesRepository, OPEN_STATUSES } from "./companies.repository.js";
import type { CompanyOptionsQuery, CreateCompanyInput, ListCompaniesQuery, UpdateCompanyInput } from "./companies.validators.js";

export function companyHubspotUrl(hubspotCompanyId: string | null): string | null {
  return hubspotCompanyId && env.HUBSPOT_PORTAL_ID
    ? hubspotRecordUrl(env.HUBSPOT_PORTAL_ID, "company", hubspotCompanyId)
    : null;
}

async function assertHubspotIdFree(hubspotCompanyId: string | null | undefined, exceptId?: string) {
  if (!hubspotCompanyId) return;
  const existing = await companiesRepository.findByHubspotId(hubspotCompanyId);
  if (existing && existing.id !== exceptId) {
    throw new ApiError(409, "COMPANY_EXISTS", `This HubSpot company is already added as “${existing.name}”.`);
  }
}

/**
 * Administrators and managers may edit any company. A PSM may edit companies
 * they created or where they own or created a job request.
 */
async function assertCanEdit(user: AuthenticatedUser, company: { id: string; createdById: string }) {
  if (hasPermission(user.roles, "job:assign") || company.createdById === user.id) return;
  if (!(await companiesRepository.userWorksWithCompany(company.id, user.id))) {
    throw new ApiError(403, "FORBIDDEN", "You can edit companies you work with.");
  }
}

export const companiesService = {
  /** Lightweight company search for selectors; avoids counts and job/owner joins. */
  options(_user: AuthenticatedUser, query: CompanyOptionsQuery) {
    return companiesRepository.options({
      archivedAt: null,
      status: query.status,
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { hubspotCompanyId: query.search },
        { industry: { contains: query.search, mode: "insensitive" } },
        { location: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    });
  },

  /** Company information and job summaries are visible to every signed-in role. */
  async list(user: AuthenticatedUser, query: ListCompaniesQuery) {
    const { rows, total } = await companiesRepository.list(
      {
        archivedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { hubspotCompanyId: query.search },
              { industry: { contains: query.search, mode: "insensitive" } },
              { location: { contains: query.search, mode: "insensitive" } },
            ],
          }
          : {}),
      },
      {},
      toPrismaPage(query),
    );

    const companies = rows.map(({ jobRequests, ...company }) => {
      const openJobs = jobRequests.filter((job) => OPEN_STATUSES.includes(job.status));
      return {
        ...company,
        hubspotUrl: companyHubspotUrl(company.hubspotCompanyId),
        openJobRequests: openJobs.length,
        openPositions: openJobs.reduce((sum, job) => sum + job.openings, 0),
        psmOwners: [...new Map(openJobs.flatMap(({ psmOwner }) => (psmOwner ? [[psmOwner.id, psmOwner]] : []))).values()],
        // Where the company's hiring stands for each job, most recently updated first.
        processes: jobRequests.map((job) => ({
          jobRequestId: job.id,
          roleTitle: job.roleTitle,
          phase: job.processPhase,
          label: companyProcessLabel(job.processPhase, job.processRound?.name),
        })),
      };
    });
    return { companies, meta: buildPaginationMeta(query, total) };
  },

  async get(user: AuthenticatedUser, companyId: string) {
    const company = await companiesRepository.findById(companyId, {});
    if (!company || company.archivedAt) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "The company was not found.");
    }
    const history = await listAuditHistory(prisma, "Company", [company.id]);
    return {
      ...company,
      jobRequests: company.jobRequests.map((job) => ({ ...job, processLabel: companyProcessLabel(job.processPhase, job.processRound?.name) })),
      hubspotUrl: companyHubspotUrl(company.hubspotCompanyId),
      canEdit: await companiesService.canEdit(user, company),
      canDelete: hasPermission(user.roles, "job:assign"),
      history,
    };
  },

  async canEdit(user: AuthenticatedUser, company: { id: string; createdById: string }) {
    if (!hasPermission(user.roles, "company:write")) return false;
    try {
      await assertCanEdit(user, company);
      return true;
    } catch {
      return false;
    }
  },

  async create(user: AuthenticatedUser, input: CreateCompanyInput, audit: AuditContext) {
    await assertHubspotIdFree(input.hubspotCompany);
    return inTransaction(async (transaction) => {
      const company = await companiesRepository.create(transaction, {
        name: input.name,
        hubspotCompanyId: input.hubspotCompany ?? null,
        website: input.website ?? null,
        industry: input.industry ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        createdById: user.id,
      });
      await recordAudit(transaction, audit, {
        action: "COMPANY_CREATED",
        entityType: "Company",
        entityId: company.id,
        metadata: { name: company.name, hubspotCompanyId: company.hubspotCompanyId },
      });
      return company;
    });
  },

  async update(user: AuthenticatedUser, companyId: string, input: UpdateCompanyInput, audit: AuditContext) {
    const company = await companiesRepository.findPlain(companyId);
    if (!company || company.archivedAt) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "The company was not found.");
    }
    await assertCanEdit(user, company);
    await assertHubspotIdFree(input.hubspotCompany, company.id);

    const { hubspotCompany, ...rest } = input;
    const data = definedOnly({ ...rest, hubspotCompanyId: hubspotCompany });
    const changes = diffFields(company, data);
    if (Object.keys(changes).length === 0) {
      return company;
    }

    return inTransaction(async (transaction) => {
      const updated = await companiesRepository.update(transaction, company.id, data);
      await recordAudit(transaction, audit, {
        action: "COMPANY_UPDATED",
        entityType: "Company",
        entityId: company.id,
        metadata: { changes },
      });
      return updated;
    });
  },

  async delete(user: AuthenticatedUser, companyId: string, audit: AuditContext) {
    if (!hasPermission(user.roles, "job:assign")) {
      throw new ApiError(403, "FORBIDDEN", "Only managers can permanently delete a company.");
    }
    const company = await companiesRepository.findPlain(companyId);
    if (!company || company.archivedAt) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "The company was not found.");
    }

    return inTransaction(async (transaction) => {
      const jobs = await transaction.jobRequest.findMany({
        where: { companyId: company.id },
        select: { id: true, jobId: true, roleTitle: true },
      });
      for (const job of jobs) {
        await deleteJobRequestData(transaction, job.id);
        await recordAudit(transaction, audit, {
          action: "JOB_REQUEST_DELETED",
          entityType: "JobRequest",
          entityId: job.id,
          metadata: { jobId: job.jobId, roleTitle: job.roleTitle, companyId: company.id },
        });
      }
      await transaction.company.delete({ where: { id: company.id } });
      await recordAudit(transaction, audit, {
        action: "COMPANY_DELETED",
        entityType: "Company",
        entityId: company.id,
        metadata: { name: company.name, deletedJobCount: jobs.length },
      });
      return { id: company.id };
    }, { timeoutMs: 120_000 });
  },
};
