import { inTransaction, prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { protectContact } from "../../services/pii.js";
import { ApiError } from "../../utils/api-error.js";
import { normalizeEmail, normalizeMobile } from "../../utils/normalize.js";
import { definedOnly } from "../../utils/object.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { diffFields, listAuditHistory, recordAudit, type AuditContext } from "../audit/audit.service.js";
import type { ListCandidatesQuery, UpdateCandidateInput } from "./candidates.validators.js";

/** Candidates visible to the user: those who applied to a job request in their scope. */
async function visibleWhere(user: AuthenticatedUser): Promise<Prisma.CandidateWhereInput> {
  const scope = await resolveDataScope(user);
  return scope.kind === "organization" ? {} : { applications: { some: { jobRequest: jobRequestScopeFilter(scope) } } };
}

async function loadVisible(user: AuthenticatedUser, candidateId: string) {
  const candidate = await prisma.candidate.findFirst({ where: { id: candidateId, archivedAt: null, ...(await visibleWhere(user)) } });
  if (!candidate) throw new ApiError(404, "CANDIDATE_NOT_FOUND", "The candidate was not found.");
  return candidate;
}

export const candidatesService = {
  async list(user: AuthenticatedUser, query: ListCandidatesQuery) {
    const where: Prisma.CandidateWhereInput = {
      archivedAt: null,
      AND: [
        await visibleWhere(user),
        query.search
          ? {
            OR: [
              { fullName: { contains: query.search, mode: "insensitive" } },
              { candidateCode: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search.toLowerCase() } },
              ...(query.search.replace(/\D/g, "").length >= 4 ? [{ mobile: { contains: query.search.replace(/\D/g, "") } }] : []),
              { college: { contains: query.search, mode: "insensitive" } },
            ],
          }
          : {},
        query.productId ? { products: { some: { productId: query.productId } } } : {},
        query.category ? { category: query.category } : {},
        query.assessedPool ? { assessedPool: query.assessedPool } : {},
        query.jobRequestId ? { applications: { some: { jobRequestId: query.jobRequestId } } } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.candidate.findMany({
        where,
        select: {
          id: true,
          candidateCode: true,
          fullName: true,
          email: true,
          mobile: true,
          college: true,
          graduationYear: true,
          category: true,
          assessedPool: true,
          updatedAt: true,
          products: { select: { product: { select: { code: true, name: true } } } },
          _count: { select: { applications: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        ...toPrismaPage(query),
      }),
      prisma.candidate.count({ where }),
    ]);
    return {
      candidates: rows.map(({ _count, products, ...candidate }) => ({
        ...protectContact(user, candidate),
        products: products.map(({ product }) => product),
        applications: _count.applications,
      })),
      meta: buildPaginationMeta(query, total),
    };
  },

  /** Profile plus every application in scope, each with its own internal and company history. */
  async get(user: AuthenticatedUser, candidateId: string) {
    const candidate = await loadVisible(user, candidateId);
    const scope = await resolveDataScope(user);
    const [details, history] = await Promise.all([
      prisma.candidate.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          products: { select: { firstSeenAt: true, product: { select: { code: true, name: true, category: true } } } },
          skills: { select: { skill: { select: { name: true } } } },
          applications: {
            where: { jobRequest: jobRequestScopeFilter(scope) },
            orderBy: { appliedAt: "desc" },
            select: {
              id: true,
              appliedAt: true,
              source: true,
              status: true,
              product: { select: { code: true, name: true } },
              sourceApplication: { select: { jobRequest: { select: { id: true, roleTitle: true, company: { select: { name: true } } } } } },
              jobRequest: { select: { id: true, jobId: true, roleTitle: true, status: true, company: { select: { id: true, name: true } } } },
              stageOutcomes: {
                select: { outcome: true, priority: true, rejectionReason: true, remarks: true, source: true, decidedAt: true, stage: { select: { stage: true } } },
              },
              nomination: {
                select: {
                  pipelineStatus: true,
                  status: true,
                  submittedAt: true,
                  offerReleasedAt: true,
                  offerAcceptedAt: true,
                  joinedAt: true,
                  interviews: { select: { outcome: true, round: { select: { name: true, sequence: true } } } },
                  stageHistory: { select: { fromStatus: true, toStatus: true, changedAt: true, notes: true }, orderBy: { changedAt: "desc" } },
                },
              },
            },
          },
        },
      }),
      listAuditHistory(prisma, "Candidate", [candidate.id]),
    ]);
    return {
      ...protectContact(user, candidate),
      academicScore: candidate.academicScore === null ? null : Number(candidate.academicScore),
      products: details.products,
      skills: details.skills.map(({ skill }) => skill.name),
      applications: details.applications,
      history,
    };
  },

  async update(user: AuthenticatedUser, candidateId: string, input: UpdateCandidateInput, audit: AuditContext) {
    const candidate = await loadVisible(user, candidateId);
    const { reason, ...fields } = input;
    const email = fields.email === undefined ? undefined : fields.email ? normalizeEmail(fields.email) : null;
    if (fields.email && !email) throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
    const data = definedOnly({ ...fields, email, mobile: fields.mobile === undefined ? undefined : normalizeMobile(fields.mobile) });
    const changes = diffFields(candidate, data);
    if (Object.keys(changes).length === 0) return candidatesService.get(user, candidate.id);
    await inTransaction(async (transaction) => {
      await transaction.candidate.update({ where: { id: candidate.id }, data });
      await recordAudit(transaction, audit, {
        action: changes.category || changes.assessedPool ? "CANDIDATE_CLASSIFICATION_CHANGED" : "CANDIDATE_UPDATED",
        entityType: "Candidate",
        entityId: candidate.id,
        metadata: { changes, reason: reason ?? null },
      });
    });
    return candidatesService.get(user, candidate.id);
  },
};
