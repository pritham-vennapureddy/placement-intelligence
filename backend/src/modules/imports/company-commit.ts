// Writes an approved company-sheet import: rounds, nominations, round outcomes,
// pipeline status changes (with history) and the job's tech stack on profiles.
import { syncJobProcessDates } from "../pipeline/job-process-dates.js";
import { markPoolStudentsAcademy } from "./pool-category.js";
import type { PipelineStatus } from "@placement/shared";
import type { Db } from "../../db.js";
import { studentsAddedMeanwhile } from "./student-reuse.js";
import type { CompanyRowData } from "./company-plan.js";

export interface CompanyCommitCounts {
  studentsCreated: number;
  addedToJob: number;
  roundsCreated: number;
  nominationsCreated: number;
  outcomesWritten: number;
  statusChanges: number;
  skillsAdded: number;
}

export async function commitCompanyImport(
  db: Db,
  input: {
    batchId?: string;
    jobRequestId: string;
    recruitmentBatchId: string;
    userId: string;
    rows: { normalizedData: unknown }[];
    jobSkillIds: string[];
    addJobSkills: boolean;
  },
): Promise<CompanyCommitCounts> {
  const staged = input.rows.map((row) => row.normalizedData as CompanyRowData).filter((row) => row.kind === "company");
  const now = new Date();

  // 0. Students shared to the company without being in the internal sheet: create the
  //    ones the dashboard does not have, then add them all to this drive.
  const outsiders = staged.filter((row) => !row.applicationId && row.addToJob);
  const planned = outsiders.flatMap((row) => (row.addToJob!.newCandidate ? [row.addToJob!.newCandidate] : []));
  // Added to the dashboard since this import was checked (e.g. by another PSM's import): reuse by mobile.
  const reused = await studentsAddedMeanwhile(db, planned);
  const newCandidates = planned.filter(({ candidateCode }) => !reused.has(candidateCode.toLowerCase()));
  let studentsCreated = 0;
  if (newCandidates.length > 0) {
    studentsCreated = (await db.candidate.createMany({ data: newCandidates, skipDuplicates: true })).count;
  }
  const createdIds = newCandidates.length > 0
    ? new Map((await db.candidate.findMany({ where: { candidateCode: { in: newCandidates.map(({ candidateCode }) => candidateCode) } }, select: { id: true, candidateCode: true } }))
      .map((candidate) => [candidate.candidateCode, candidate.id]))
    : new Map<string, string>();
  const additions = outsiders.flatMap((row) => {
    const code = row.addToJob!.newCandidate?.candidateCode;
    const candidateId = row.addToJob!.candidateId ?? (code ? reused.get(code.toLowerCase()) ?? createdIds.get(code) : undefined);
    return candidateId ? [{ row, candidateId }] : [];
  });
  let addedToJob = 0;
  if (additions.length > 0) {
    addedToJob = (await db.application.createMany({
      data: additions.map(({ row, candidateId }) => ({
        candidateId,
        jobRequestId: input.jobRequestId,
        recruitmentBatchId: input.recruitmentBatchId,
        productId: row.addToJob!.productId,
        appliedAt: now,
        source: "IMPORT" as const,
        ...(input.batchId ? { importBatchId: input.batchId } : {}),
      })),
      skipDuplicates: true,
    })).count;
    const productLinks = additions.flatMap(({ row, candidateId }) => (row.addToJob!.productId ? [{ candidateId, productId: row.addToJob!.productId }] : []));
    if (productLinks.length > 0) await db.candidateProduct.createMany({ data: productLinks, skipDuplicates: true });
    const applications = await db.application.findMany({
      where: { jobRequestId: input.jobRequestId, recruitmentBatchId: input.recruitmentBatchId, candidateId: { in: additions.map(({ candidateId }) => candidateId) } },
      select: { id: true, candidateId: true },
    });
    const applicationByCandidate = new Map(applications.map((application) => [application.candidateId, application.id]));
    for (const { row, candidateId } of additions) {
      row.candidateId = candidateId;
      row.applicationId = applicationByCandidate.get(candidateId) ?? null;
    }
  }
  /** Application → why it was not in the internal process, saved as the direct-share note. */
  const addedApplications = new Map(additions.flatMap(({ row }) => {
    if (!row.applicationId) return [];
    const { from, fromSheet } = row.addToJob!;
    const note = from === "NOT_IN_APPLICANTS"
      ? "Not in applicants: not in TA, the eligible list or the dashboard; added from the company sheet."
      : from === "ELIGIBLE"
        ? `Not in TA; on the internal sheet's ${fromSheet ?? "eligible"} tab. Added from the company sheet.`
        : "Not in the internal sheet; added from the company sheet.";
    return [[row.applicationId, note] as const];
  }));
  const rows = staged.filter((row) => row.applicationId);

  // 1. Rounds, in the order they first appear; existing ones are kept as they are.
  const existing = await db.companyInterviewRound.findMany({ where: { jobRequestId: input.jobRequestId, recruitmentBatchId: input.recruitmentBatchId }, select: { id: true, name: true, sequence: true } });
  const roundIds = new Map(existing.map((round) => [round.name, round.id]));
  let sequence = Math.max(0, ...existing.map((round) => round.sequence));
  const missingRounds = new Map<string, { jobRequestId: string; recruitmentBatchId: string; name: string; roundType: CompanyRowData["rounds"][number]["roundType"]; sequence: number }>();
  for (const round of rows.flatMap((row) => row.rounds)) {
    if (roundIds.has(round.roundName) || missingRounds.has(round.roundName)) continue;
    missingRounds.set(round.roundName, { jobRequestId: input.jobRequestId, recruitmentBatchId: input.recruitmentBatchId, name: round.roundName, roundType: round.roundType, sequence: ++sequence });
  }
  if (missingRounds.size > 0) {
    await db.companyInterviewRound.createMany({ data: [...missingRounds.values()], skipDuplicates: true });
  }
  const allRounds = missingRounds.size > 0
    ? await db.companyInterviewRound.findMany({ where: { jobRequestId: input.jobRequestId, recruitmentBatchId: input.recruitmentBatchId }, select: { id: true, name: true } })
    : existing;
  const allRoundIds = new Map(allRounds.map((round) => [round.name, round.id]));
  const roundsCreated = missingRounds.size;

  // 2. Nominations for profiles the company has but the PSM had not nominated yet.
  const toNominate = rows.filter((row) => row.createNomination).map((row) => row.applicationId!);
  if (toNominate.length > 0) {
    await db.companyNomination.createMany({
      data: toNominate.map((applicationId) => ({
        applicationId,
        jobRequestId: input.jobRequestId,
        nominatedById: input.userId,
        source: "IMPORT" as const,
        submittedAt: now,
        remarks: "Nominated while importing the company sheet.",
        // Never in the internal process: the PSM tags why on the pipeline tab.
        ...(addedApplications.has(applicationId) ? { directShareNote: addedApplications.get(applicationId)! } : {}),
      })),
      skipDuplicates: true,
    });
  }
  const nominations = await db.companyNomination.findMany({
    where: { jobRequestId: input.jobRequestId, applicationId: { in: rows.map((row) => row.applicationId!) } },
    select: { id: true, applicationId: true, pipelineStatus: true, submittedAt: true },
  });
  const nominationByApplication = new Map(nominations.map((nomination) => [nomination.applicationId, nomination]));

  // 3. Round outcomes. The optional reason column goes with the round the student was
  //    rejected in (as the rejection reason), else with their last round (as feedback).
  const outcomes = rows.flatMap((row) => {
    const nomination = nominationByApplication.get(row.applicationId!);
    if (!nomination) return [];
    const reasonRound = row.reason
      ? [...row.rounds].reverse().find((round) => round.outcome === "REJECTED") ?? row.rounds[row.rounds.length - 1]
      : undefined;
    return row.rounds.flatMap((round) => {
      const roundId = allRoundIds.get(round.roundName);
      if (!roundId) return [];
      const reason = round === reasonRound ? row.reason ?? null : null;
      return [{
        nominationId: nomination.id,
        roundId,
        outcome: round.outcome,
        rejectionReason: reason && round.outcome === "REJECTED" ? reason : null,
        feedback: reason && round.outcome !== "REJECTED" ? reason : null,
      }];
    });
  });
  let outcomesWritten = 0;
  if (outcomes.length > 0) {
    outcomesWritten = await db.$executeRaw`
      INSERT INTO "CompanyInterview" ("id", "nominationId", "roundId", "jobRequestId", "outcome", "rejectionReason", "feedback", "source", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), t.nomination_id, t.round_id, ${input.jobRequestId}::uuid, t.outcome::"InterviewOutcome", t.rejection_reason, t.feedback, 'IMPORT'::"ChangeSource", NOW(), NOW()
      FROM UNNEST(
        ${outcomes.map((row) => row.nominationId)}::uuid[],
        ${outcomes.map((row) => row.roundId)}::uuid[],
        ${outcomes.map((row) => row.outcome)}::text[],
        ${outcomes.map((row) => row.rejectionReason)}::text[],
        ${outcomes.map((row) => row.feedback)}::text[]
      ) AS t(nomination_id, round_id, outcome, rejection_reason, feedback)
      ON CONFLICT ("nominationId", "roundId") DO UPDATE SET
        "outcome" = EXCLUDED."outcome",
        -- A blank reason cell keeps whatever was recorded before.
        "rejectionReason" = COALESCE(EXCLUDED."rejectionReason", "CompanyInterview"."rejectionReason"),
        "feedback" = COALESCE(EXCLUDED."feedback", "CompanyInterview"."feedback"),
        "source" = 'IMPORT', "updatedAt" = NOW()`;
  }

  // 4. Pipeline status, with a history row for every change.
  const changes = rows.flatMap((row) => {
    const nomination = nominationByApplication.get(row.applicationId!);
    return nomination && row.toStatus && row.toStatus !== nomination.pipelineStatus
      ? [{ nomination, to: row.toStatus }]
      : [];
  });
  const byTarget = new Map<PipelineStatus, string[]>();
  for (const change of changes) byTarget.set(change.to, [...(byTarget.get(change.to) ?? []), change.nomination.id]);
  for (const [status, ids] of byTarget) {
    await db.companyNomination.updateMany({ where: { id: { in: ids } }, data: { pipelineStatus: status } });
  }
  await db.companyNomination.updateMany({
    where: { id: { in: nominations.filter((nomination) => !nomination.submittedAt).map((nomination) => nomination.id) } },
    data: { submittedAt: now },
  });
  if (changes.length > 0) {
    await db.companyStageHistory.createMany({
      data: changes.map(({ nomination, to }) => ({
        nominationId: nomination.id,
        fromStatus: nomination.pipelineStatus,
        toStatus: to,
        source: "IMPORT" as const,
        changedById: input.userId,
        notes: "From the company sheet.",
      })),
    });
  }

  // 5. The job's tech stack on matched profiles.
  let skillsAdded = 0;
  if (input.addJobSkills && input.jobSkillIds.length > 0) {
    const candidateIds = [...new Set(rows.map((row) => row.candidateId!).filter(Boolean))];
    const result = await db.candidateSkill.createMany({
      data: candidateIds.flatMap((candidateId) => input.jobSkillIds.map((skillId) => ({ candidateId, skillId }))),
      skipDuplicates: true,
    });
    skillsAdded = result.count;
  }

  // Students found by mobile in the assessed pool are Academy, whatever the sheets said.
  if (additions.length > 0) await markPoolStudentsAcademy(db);
  // Students newly shared without an end date keep the company process open.
  await syncJobProcessDates(db, input.jobRequestId);
  return { studentsCreated, addedToJob, roundsCreated, nominationsCreated: toNominate.length, outcomesWritten, statusChanges: changes.length, skillsAdded };
}
