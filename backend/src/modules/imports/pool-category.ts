import type { Db } from "../../db.js";

/**
 * Every assessed-pool student is an Academy student. Students whose mobile is in
 * the pool but who have no category (e.g. created from a company sheet when they
 * were not in TA, the eligible tab or the dashboard) or are marked External are
 * set to Academy. Intensive is left as it is. Returns how many changed.
 */
export async function markPoolStudentsAcademy(db: Db): Promise<number> {
  return db.$executeRaw`
    UPDATE "Candidate" c
    SET "category" = 'ACADEMY'::"CandidateCategory", "updatedAt" = NOW()
    WHERE (c."category" IS NULL OR c."category" = 'EXTERNAL'::"CandidateCategory")
      AND c.mobile IS NOT NULL
      AND EXISTS (SELECT 1 FROM "AssessedPoolRecord" r WHERE r.mobile = c.mobile)`;
}
