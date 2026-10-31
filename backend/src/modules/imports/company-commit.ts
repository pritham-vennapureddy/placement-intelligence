// Writes an approved company-sheet import: rounds, nominations, round outcomes,
// pipeline status changes (with history) and the job's tech stack on profiles.
import type { PipelineStatus } from "@placement/shared";
import type { Db } from "../../db.js";
import type { CompanyRowData } from "./company-plan.js";

export interface CompanyCommitCounts {
  roundsCreated: number;
  nominationsCreated: number;
  outcomesWritten: number;
  statusChanges: number;
  skillsAdded: number;
}

export async function commitCompanyImport(
  db: Db,
  input: {
    jobRequestId: string;
    userId: string;
    rows: { normalizedData: unknown }[];
    jobSkillIds: string[];
    addJobSkills: boolean;
  },
): Promise<CompanyCommitCounts> {
  const rows = input.rows.map((row) => row.normalizedData as CompanyRowData).filter((row) => row.kind === "company" && row.applicationId);
  const now = new Date();

  // 1. Rounds, in the order they first appear; existing ones are kept as they are.
  const existing = await db.companyInterviewRound.findMany({ where: { jobRequestId: input.jobRequestId }, select: { id: true, name: true, sequence: true } });
  const roundIds = new Map(existing.map((round) => [round.name, round.id]));
  let sequence = Math.max(0, ...existing.map((round) => round.sequence));
  let roundsCreated = 0;
  for (const round of rows.flatMap((row) => row.rounds)) {
    if (roundIds.has(round.roundName)) continue;
    const created = await db.companyInterviewRound.create({
      data: { jobRequestId: input.jobRequestId, name: round.roundName, roundType: round.roundType, sequence: ++sequence },
      select: { id: true },
    });
    roundIds.set(round.roundName, created.id);
    roundsCreated++;
  }

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
      })),
      skipDuplicates: true,
    });
  }
  const nominations = await db.companyNomination.findMany({
    where: { jobRequestId: input.jobRequestId, applicationId: { in: rows.map((row) => row.applicationId!) } },
    select: { id: true, applicationId: true, pipelineStatus: true, submittedAt: true },
  });
  const nominationByApplication = new Map(nominations.map((nomination) => [nomination.applicationId, nomination]));

  // 3. Round outcomes.
  const outcomes = rows.flatMap((row) => {
    const nomination = nominationByApplication.get(row.applicationId!);
    return nomination
      ? row.rounds.map((round) => ({ nominationId: nomination.id, roundId: roundIds.get(round.roundName)!, outcome: round.outcome }))
      : [];
  });
  let outcomesWritten = 0;
  if (outcomes.length > 0) {
    outcomesWritten = await db.$executeRaw`
      INSERT INTO "CompanyInterview" ("id", "nominationId", "roundId", "jobRequestId", "outcome", "source", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), t.nomination_id, t.round_id, ${input.jobRequestId}::uuid, t.outcome::"InterviewOutcome", 'IMPORT'::"ChangeSource", NOW(), NOW()
      FROM UNNEST(
        ${outcomes.map((row) => row.nominationId)}::uuid[],
        ${outcomes.map((row) => row.roundId)}::uuid[],
        ${outcomes.map((row) => row.outcome)}::text[]
      ) AS t(nomination_id, round_id, outcome)
      ON CONFLICT ("nominationId", "roundId") DO UPDATE SET
        "outcome" = EXCLUDED."outcome", "source" = 'IMPORT', "updatedAt" = NOW()`;
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

  return { roundsCreated, nominationsCreated: toNominate.length, outcomesWritten, statusChanges: changes.length, skillsAdded };
}
