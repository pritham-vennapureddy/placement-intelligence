import { inTransaction, prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { academyFacts, APPLICATION_PRODUCT } from "../insights/academy-insights.service.js";
import { APPLICATION_REASON, NOT_SELECTED } from "../insights/company-reasons.service.js";
import { assertUsableTag } from "../rejection-tags/rejection-tags.service.js";
import { ROUND_LABELS } from "../insights/company-rounds.js";
import { jobFilter, ownerFilter } from "../insights/insights.service.js";
import type { AcademyQuery } from "../insights/insights.validators.js";
import { checkStatusRules, loadStatusForKind } from "../tracking/support-status.service.js";
import type { RsaReportInput, RsaStudentsQuery } from "./pulse.validators.js";

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

const SEGMENT: Record<RsaStudentsQuery["segment"], Prisma.Sql> = {
  ACADEMY_OR_POOL: Prisma.sql`(f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE') OR f.in_pool)`,
  ACADEMY: Prisma.sql`f.category IN ('ACADEMY', 'ACADEMY_INTENSIVE')`,
  POOL: Prisma.sql`f.in_pool`,
  EVERYONE: Prisma.sql`TRUE`,
};

const PROGRESS: Record<RsaStudentsQuery["progress"], Prisma.Sql> = {
  ALL: Prisma.sql`TRUE`,
  NOT_STARTED: Prisma.sql`ss.id IS NULL`,
  IN_PROGRESS: Prisma.sql`ss.id IS NOT NULL AND NOT o."countsAsDone"`,
  DONE: Prisma.sql`o."countsAsDone"`,
};

const ENDED_DRIVE = Prisma.sql`(j."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED') OR j."companyProcessEndDate" IS NOT NULL)`;

const RESULT: Record<RsaStudentsQuery["result"], Prisma.Sql> = {
  ALL: Prisma.sql`TRUE`,
  SELECTED: Prisma.sql`f.selected`,
  NOT_SELECTED: Prisma.sql`(NOT f.selected AND (${NOT_SELECTED(Prisma.sql`f`)} OR ${ENDED_DRIVE}))`,
  UNKNOWN: Prisma.sql`(NOT f.selected AND NOT ${NOT_SELECTED(Prisma.sql`f`)} AND NOT ${ENDED_DRIVE})`,
};

/**
 * The RSA team's worklist: every student who is in a company sheet (shared with
 * the company), whatever the result, so RSA can start before results come in.
 * Anyone who already has an RSA record stays listed.
 */
export const rsaReportsService = {
  async students(user: AuthenticatedUser, query: RsaStudentsQuery) {
    const owners = await ownerFilter(user);
    const academyQuery = { from: query.from, to: query.to, dateBy: query.dateBy, companyId: query.companyId, academyCategory: "ALL_ACADEMY", segment: "ALL" } as AcademyQuery;
    const needsRsa = Prisma.sql`f.shared`;
    const reasonFilter = query.reasonTagId === "untagged" ? Prisma.sql`AND rt.id IS NULL`
      : query.reasonTagId ? Prisma.sql`AND rt.id = ${query.reasonTagId}::uuid` : Prisma.empty;
    const search = query.q
      ? Prisma.sql`AND (c."fullName" ILIKE ${`%${query.q}%`} OR c."candidateCode" ILIKE ${`%${query.q}%`} OR co.name ILIKE ${`%${query.q}%`})`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<{
      application_id: string; candidate_id: string; full_name: string; candidate_code: string | null; category: string; in_pool: boolean; tier: string | null;
      product: string | null;
      job_id: string; job_code: string; role_title: string; company_id: string; company_name: string; phase: string; month: string; process_end: Date | null;
      pipeline: string | null; selected: boolean; not_selected: boolean; drive_ended: boolean; rejected_round: string | null; rejection_reason: string | null;
      reason_tag_id: string | null; reason_label: string | null; reason_from_rsa: boolean;
      support_id: string | null; status_id: string | null; status_label: string | null; status_tone: string | null; counts_as_done: boolean | null;
      report_summary: string | null; report_url: string | null; notes: string | null; done_on: Date | null; other_contributors: string | null;
      contributors: { id: string; fullName: string }[] | null; updated_at: Date | null; updated_by: string | null;
    }[]>`
      ${academyFacts(academyQuery, owners, jobFilter(academyQuery))},
      ${ROUND_LABELS}
      SELECT f.application_id, f.candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code, f.category, f.in_pool, f.tier,
        ${APPLICATION_PRODUCT(Prisma.sql`f.application_id`, Prisma.sql`c.id`)} AS product,
        f.job_id, j."jobId" AS job_code, j."roleTitle" AS role_title, co.id AS company_id, co.name AS company_name, j."processPhase"::text AS phase,
        f.month, j."companyProcessEndDate" AS process_end, f.pipeline,
        f.selected, ${NOT_SELECTED(Prisma.sql`f`)} AS not_selected, ${ENDED_DRIVE} AS drive_ended,
        rr.label AS rejected_round, rr.note AS rejection_reason,
        rt.id AS reason_tag_id, rt.label AS reason_label, (ra."rejectionTagId" IS NOT NULL) AS reason_from_rsa,
        ss.id AS support_id, o.id AS status_id, o.label AS status_label, o.tone AS status_tone, o."countsAsDone" AS counts_as_done,
        ss."reportSummary" AS report_summary, ss."reportUrl" AS report_url, ss.notes, ss."doneOn" AS done_on, ss."otherContributors" AS other_contributors,
        (SELECT json_agg(json_build_object('id', u.id, 'fullName', u."fullName") ORDER BY u."fullName")
           FROM "StudentSupportContributor" sc JOIN "User" u ON u.id = sc."userId" WHERE sc."supportId" = ss.id) AS contributors,
        ss."updatedAt" AS updated_at, ub."fullName" AS updated_by
      FROM f
      JOIN "Candidate" c ON c.id = f.candidate_id
      JOIN "JobRequest" j ON j.id = f.job_id
      JOIN "Company" co ON co.id = j."companyId"
      LEFT JOIN "StudentSupport" ss ON ss."applicationId" = f.application_id AND ss.kind = 'RSA'
      LEFT JOIN "SupportStatusOption" o ON o.id = ss."statusId"
      LEFT JOIN "User" ub ON ub.id = ss."updatedById"
      ${APPLICATION_REASON(Prisma.sql`f`)}
      WHERE ${SEGMENT[query.segment]} AND (${needsRsa} OR ss.id IS NOT NULL) AND ${PROGRESS[query.progress]} AND ${RESULT[query.result]} ${reasonFilter} ${search}
      ORDER BY (ss.id IS NULL) DESC, COALESCE(o."countsAsDone", FALSE), f.month DESC, co.name, c."fullName"
      LIMIT 2000`;

    const items = rows.map((row) => ({
      applicationId: row.application_id,
      candidateId: row.candidate_id,
      fullName: row.full_name,
      candidateCode: row.candidate_code,
      category: row.category,
      inPool: row.in_pool,
      product: row.product,
      tier: row.tier,
      jobRequestId: row.job_id,
      jobCode: row.job_code,
      roleTitle: row.role_title,
      companyId: row.company_id,
      companyName: row.company_name,
      phase: row.phase,
      month: row.month,
      processEndDate: row.process_end ? row.process_end.toISOString().slice(0, 10) : null,
      pipelineStatus: row.pipeline,
      /** The company's result so far. */
      result: row.selected ? "SELECTED" as const : row.not_selected || row.drive_ended ? "NOT_SELECTED" as const : "UNKNOWN" as const,
      rejectedRound: row.rejected_round,
      rejectionReason: row.rejection_reason,
      /** Why not selected: the RSA team's tag, else the tag on the rejected round. */
      reason: row.reason_tag_id ? { id: row.reason_tag_id, label: row.reason_label!, fromRsa: row.reason_from_rsa } : null,
      rsa: row.support_id
        ? {
            statusId: row.status_id!,
            statusLabel: row.status_label!,
            statusTone: row.status_tone ?? "slate",
            done: Boolean(row.counts_as_done),
            reportSummary: row.report_summary,
            reportUrl: row.report_url,
            notes: row.notes,
            doneOn: row.done_on ? row.done_on.toISOString().slice(0, 10) : null,
            otherContributors: row.other_contributors,
            contributors: row.contributors ?? [],
            updatedAt: row.updated_at,
            updatedBy: row.updated_by,
          }
        : null,
    }));
    return {
      items,
      summary: {
        total: items.length,
        notStarted: items.filter((item) => !item.rsa).length,
        inProgress: items.filter((item) => item.rsa && !item.rsa.done).length,
        done: items.filter((item) => item.rsa?.done).length,
        withLink: items.filter((item) => item.rsa?.reportUrl).length,
        byResult: {
          UNKNOWN: items.filter((item) => item.result === "UNKNOWN").length,
          NOT_SELECTED: items.filter((item) => item.result === "NOT_SELECTED").length,
          SELECTED: items.filter((item) => item.result === "SELECTED").length,
        },
        /** Reason tags across the list (selected students left out), most common first. */
        byReason: [...items.filter((item) => item.result !== "SELECTED").reduce((map, item) => {
          const key = item.reason?.id ?? "untagged";
          const entry = map.get(key) ?? { tagId: item.reason?.id ?? null, label: item.reason?.label ?? "No reason tagged", students: 0 };
          entry.students++;
          return map.set(key, entry);
        }, new Map<string, { tagId: string | null; label: string; students: number }>()).values()]
          .sort((a, b) => Number(a.tagId === null) - Number(b.tagId === null) || b.students - a.students),
      },
    };
  },

  /** The RSA team's reason why the company did not select this student on this drive. */
  async setReason(user: AuthenticatedUser, applicationId: string, rejectionTagId: string | null, audit: AuditContext) {
    const application = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, jobRequestId: true, rejectionTagId: true } });
    if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "The candidate application was not found.");
    await loadJobForUser(user, application.jobRequestId, "pipeline:write");
    const tag = rejectionTagId ? await assertUsableTag(rejectionTagId, [application.rejectionTagId]) : null;
    await inTransaction(async (transaction) => {
      await transaction.application.update({ where: { id: application.id }, data: { rejectionTagId } });
      await recordAudit(transaction, audit, {
        action: "RSA_REASON_SET", entityType: "Application", entityId: application.id,
        metadata: { from: application.rejectionTagId, to: rejectionTagId, label: tag?.label ?? null },
      });
    });
    return { applicationId: application.id, reason: tag ? { id: tag.id, label: tag.label } : null };
  },

  /** Saves the RSA team's summary, report link and status for one student's application. */
  async setReport(user: AuthenticatedUser, applicationId: string, input: RsaReportInput, audit: AuditContext) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, jobRequestId: true, support: { where: { kind: "RSA" }, select: { id: true, statusId: true } } },
    });
    if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "The candidate application was not found.");
    await loadJobForUser(user, application.jobRequestId, "pipeline:write");
    const current = application.support[0];
    const option = await loadStatusForKind(input.statusId, "RSA", current ? [current.statusId] : []);
    checkStatusRules(option, { contributorIds: input.contributorIds, otherContributors: input.otherContributors, notes: input.notes ?? input.reportSummary });
    const contributorIds = [...new Set(input.contributorIds)];
    if (contributorIds.length) {
      const found = await prisma.user.count({ where: { id: { in: contributorIds }, isActive: true } });
      if (found !== contributorIds.length) throw new ApiError(400, "CONTRIBUTOR_NOT_FOUND", "One of the chosen contributors no longer has an account.");
    }

    const data = {
      statusId: input.statusId,
      ...(input.reportSummary !== undefined ? { reportSummary: input.reportSummary || null } : {}),
      ...(input.reportUrl !== undefined ? { reportUrl: input.reportUrl || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.otherContributors !== undefined ? { otherContributors: input.otherContributors || null } : {}),
      ...(input.doneOn !== undefined ? { doneOn: input.doneOn ? toDate(input.doneOn) : null } : {}),
      updatedById: user.id,
    };
    await inTransaction(async (transaction) => {
      const support = await transaction.studentSupport.upsert({
        where: { applicationId_kind: { applicationId: application.id, kind: "RSA" } },
        create: { applicationId: application.id, jobRequestId: application.jobRequestId, kind: "RSA", ...data },
        update: data,
        select: { id: true },
      });
      await transaction.studentSupportContributor.deleteMany({ where: { supportId: support.id } });
      if (contributorIds.length) {
        await transaction.studentSupportContributor.createMany({ data: contributorIds.map((userId) => ({ supportId: support.id, userId })) });
      }
      await recordAudit(transaction, audit, {
        action: "RSA_REPORT_SAVED", entityType: "Application", entityId: application.id,
        metadata: { status: option.label, hasSummary: Boolean(input.reportSummary), hasLink: Boolean(input.reportUrl) },
      });
    });
    return { applicationId: application.id };
  },
};
