import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ownerFilter } from "./insights.service.js";
import { academyFacts, APPLICATION_PRODUCT } from "./academy-insights.service.js";
import { ROUND_LABELS } from "./company-rounds.js";
import type { AcademyQuery } from "./insights.validators.js";

/** Label for students not selected whom nobody has tagged with a reason yet. */
export const UNTAGGED = "No reason tagged";

/**
 * Joins, for each row of a facts CTE (alias `x`, needs the `rounds` CTE), why the
 * company did not select that student on that drive: the reason the RSA team
 * tagged on the student, else the reason on the round they were rejected in.
 * Adds `rr` (last rejected round), `rt` (the reason tag), `ra` (the application),
 * `rj` (its job request) and `rs` (the RSA record).
 */
export const APPLICATION_REASON = (x: Prisma.Sql) => Prisma.sql`
  JOIN "Application" ra ON ra.id = ${x}.application_id
  JOIN "JobRequest" rj ON rj.id = ra."jobRequestId"
  LEFT JOIN LATERAL (
    SELECT rounds.label, rounds.sort, cr.name AS round_name, ci."rejectionTagId" AS tag_id,
      NULLIF(TRIM(ci."rejectionReason"), '') AS note, ci."rejectionDocUrl" AS doc_url
    FROM "CompanyInterview" ci
    JOIN "CompanyInterviewRound" cr ON cr.id = ci."roundId"
    JOIN rounds ON rounds.id = ci."roundId"
    WHERE ci."nominationId" = ${x}.nomination_id AND ci.outcome = 'REJECTED'
    ORDER BY rounds.sort DESC
    LIMIT 1
  ) rr ON TRUE
  LEFT JOIN "RejectionReasonTag" rt ON rt.id = COALESCE(ra."rejectionTagId", rr.tag_id)
  LEFT JOIN "StudentSupport" rs ON rs."applicationId" = ${x}.application_id AND rs.kind = 'RSA'`;

/**
 * A student counts as not selected on a drive once rejected / dropped, once given
 * a reason, or when they were shared and the drive ended without selecting them.
 */
export const NOT_SELECTED = (x: Prisma.Sql) => Prisma.sql`(NOT ${x}.selected AND (
  ra."rejectionTagId" IS NOT NULL OR rr.label IS NOT NULL OR ${x}.pipeline IN ('REJECTED', 'DROPPED')
  OR (${x}.shared AND (rj."processPhase" IN ('PROCESS_DONE_HIRED', 'PROCESS_DONE_NOT_HIRED') OR rj."companyProcessEndDate" IS NOT NULL))))`;

/**
 * Students the companies did not select, in the Academy filters (period,
 * students, segment), grouped by reason: the "why are students rejected" analytics.
 */
export const companyReasonsService = {
  async overview(user: AuthenticatedUser, query: AcademyQuery & { tagId?: string | undefined }) {
    const owners = await ownerFilter(user);
    const facts = academyFacts(query, owners);
    const rejections = Prisma.sql`
      ${facts}, ${ROUND_LABELS},
      rej AS (
        SELECT af.application_id, af.candidate_id, af.job_id, af.in_pool,
          COALESCE(rr.label, 'Round not recorded') AS round, COALESCE(rr.sort, 9999) AS sort, COALESCE(rr.round_name, 'Round not recorded') AS round_name,
          rt.id AS tag_id, COALESCE(rt.label, ${UNTAGGED}) AS tag, rt."archivedAt" IS NOT NULL AS tag_removed,
          COALESCE(rr.note, NULLIF(TRIM(rs."reportSummary"), '')) AS note, COALESCE(rr.doc_url, rs."reportUrl") AS doc_url
        FROM af
        ${APPLICATION_REASON(Prisma.sql`af`)}
        WHERE ${NOT_SELECTED(Prisma.sql`af`)}
      )`;
    const tagFilter = query.tagId === "untagged" ? Prisma.sql`tag_id IS NULL` : query.tagId ? Prisma.sql`tag_id = ${query.tagId}::uuid` : Prisma.sql`TRUE`;

    const [byTag, byRound, byCompany, students] = await Promise.all([
      prisma.$queryRaw<{ tag_id: string | null; tag: string; removed: boolean; rejections: number; students: number; academy: number; pool: number; with_note: number; with_doc: number }[]>`
        ${rejections}
        SELECT tag_id, tag, bool_or(tag_removed) AS removed, COUNT(*)::int AS rejections, COUNT(DISTINCT candidate_id)::int AS students,
          COUNT(*) FILTER (WHERE NOT in_pool)::int AS academy, COUNT(*) FILTER (WHERE in_pool)::int AS pool,
          COUNT(note)::int AS with_note, COUNT(doc_url)::int AS with_doc
        FROM rej GROUP BY tag_id, tag ORDER BY (tag_id IS NULL), COUNT(*) DESC, tag`,
      prisma.$queryRaw<{ round: string; sort: number; tag_id: string | null; tag: string; count: number }[]>`
        ${rejections}
        SELECT round, MIN(sort)::int AS sort, tag_id, tag, COUNT(*)::int AS count FROM rej GROUP BY round, tag_id, tag ORDER BY 2, 5 DESC`,
      prisma.$queryRaw<{ job_id: string; company_name: string; role_title: string; tag_id: string | null; tag: string; count: number }[]>`
        ${rejections}
        SELECT rej.job_id, co.name AS company_name, j."roleTitle" AS role_title, tag_id, tag, COUNT(*)::int AS count
        FROM rej JOIN "JobRequest" j ON j.id = rej.job_id JOIN "Company" co ON co.id = j."companyId"
        GROUP BY rej.job_id, co.name, j."roleTitle", tag_id, tag ORDER BY co.name, 6 DESC`,
      prisma.$queryRaw<{ application_id: string; candidate_id: string; full_name: string; candidate_code: string; product: string | null; in_pool: boolean;
        company_name: string; role_title: string; job_code: string | null; round_name: string; tag: string; note: string | null; doc_url: string | null }[]>`
        ${rejections}
        SELECT rej.application_id, rej.candidate_id, c."fullName" AS full_name, c."candidateCode" AS candidate_code,
          ${APPLICATION_PRODUCT(Prisma.sql`rej.application_id`, Prisma.sql`c.id`)} AS product,
          rej.in_pool, co.name AS company_name, j."roleTitle" AS role_title, j."jobId" AS job_code, rej.round_name, rej.tag, rej.note, rej.doc_url
        FROM rej
        JOIN "Application" a ON a.id = rej.application_id
        JOIN "Candidate" c ON c.id = rej.candidate_id
        LEFT JOIN "Product" p ON p.id = a."productId"
        JOIN "JobRequest" j ON j.id = rej.job_id
        JOIN "Company" co ON co.id = j."companyId"
        WHERE ${tagFilter}
        ORDER BY co.name, rej.sort, c."fullName"
        LIMIT 1000`,
    ]);

    const total = byTag.reduce((sum, row) => sum + row.rejections, 0);
    const untagged = byTag.find((row) => row.tag_id === null)?.rejections ?? 0;
    return {
      totals: { rejections: total, tagged: total - untagged, untagged },
      byTag: byTag.map((row) => ({ tagId: row.tag_id, label: row.tag, removed: row.removed, rejections: row.rejections, students: row.students, academy: row.academy, pool: row.pool, withNote: row.with_note, withDoc: row.with_doc })),
      byRound: byRound.map((row) => ({ round: row.round, sort: row.sort, tagId: row.tag_id, label: row.tag, count: row.count })),
      byCompany: byCompany.map((row) => ({ jobRequestId: row.job_id, companyName: row.company_name, roleTitle: row.role_title, tagId: row.tag_id, label: row.tag, count: row.count })),
      students: students.map((row) => ({
        applicationId: row.application_id, candidateId: row.candidate_id, fullName: row.full_name, candidateCode: row.candidate_code, product: row.product,
        inPool: row.in_pool, companyName: row.company_name, roleTitle: row.role_title, jobCode: row.job_code, roundName: row.round_name,
        reason: row.tag, note: row.note, docUrl: row.doc_url,
      })),
    };
  },
};
