// Writes an approved internal-sheet import. Bulk statements keep the number of
// database round trips small: each one is costly against a distant database.
import { DECISION_STAGES, type DecisionStage } from "@placement/shared";
import { ensureInternalProcess } from "../screening/screening.repository.js";
import type { Db } from "../../db.js";
import type { ApplicationRowData, StageRowData } from "./internal-plan.js";
import type { InternalMapping } from "./imports.validators.js";

export interface CommitCounts {
  candidatesCreated: number;
  candidatesUpdated: number;
  applicationsCreated: number;
  decisionsWritten: number;
  stagesMarkedNotConducted: number;
}

export async function commitInternalImport(
  db: Db,
  input: {
    batchId: string;
    jobRequestId: string;
    userId: string;
    mapping: InternalMapping;
    rows: { normalizedData: unknown }[];
  },
): Promise<CommitCounts> {
  const appRows = input.rows.map((row) => row.normalizedData).filter((data): data is ApplicationRowData => (data as { kind?: string }).kind === "application");
  const stageRows = input.rows.map((row) => row.normalizedData).filter((data): data is StageRowData => (data as { kind?: string }).kind === "stage");
  const now = new Date();

  // 1. New candidates.
  const toCreate = appRows.filter((row) => !row.candidateId);
  if (toCreate.length > 0) {
    await db.candidate.createMany({
      data: toCreate.map((row) => ({
        candidateCode: row.candidateCode,
        ...row.candidate,
        academicScore: row.candidate.academicScore,
        category: (row.productCategory as never) ?? null,
      })),
      skipDuplicates: true,
    });
  }
  const codes = [...new Set([...appRows.map((row) => row.candidateCode), ...stageRows.flatMap((row) => (row.candidateCode ? [row.candidateCode] : []))])];
  const candidates = await db.candidate.findMany({ where: { candidateCode: { in: codes } }, select: { id: true, candidateCode: true } });
  const idByCode = new Map(candidates.map((candidate) => [candidate.candidateCode.toLowerCase(), candidate.id]));

  // 2. Fill blank fields on existing candidates (never overwrite stored values).
  const fills = appRows.filter((row) => row.candidateId && Object.keys(row.fill).length > 0);
  if (fills.length > 0) {
    const column = <K extends keyof ApplicationRowData["fill"]>(key: K) => fills.map((row) => (row.fill[key] ?? null) as unknown);
    await db.$executeRaw`
      UPDATE "Candidate" AS c SET
        "email" = COALESCE(c."email", v.email),
        "mobile" = COALESCE(c."mobile", v.mobile),
        "gender" = COALESCE(c."gender", v.gender),
        "currentCity" = COALESCE(c."currentCity", v.city),
        "state" = COALESCE(c."state", v.state),
        "college" = COALESCE(c."college", v.college),
        "degree" = COALESCE(c."degree", v.degree),
        "department" = COALESCE(c."department", v.department),
        "graduationYear" = COALESCE(c."graduationYear", v.year),
        "academicScore" = COALESCE(c."academicScore", v.score),
        "resumeUrl" = COALESCE(c."resumeUrl", v.resume),
        "category" = COALESCE(c."category", v.category::"CandidateCategory"),
        "updatedAt" = NOW()
      FROM (
        SELECT * FROM UNNEST(
          ${fills.map((row) => row.candidateId)}::uuid[],
          ${column("email")}::text[], ${column("mobile")}::text[], ${column("gender")}::text[],
          ${column("currentCity")}::text[], ${column("state")}::text[], ${column("college")}::text[],
          ${column("degree")}::text[], ${column("department")}::text[], ${column("graduationYear")}::int[],
          ${column("academicScore")}::numeric[], ${column("resumeUrl")}::text[], ${column("category")}::text[]
        ) AS t(id, email, mobile, gender, city, state, college, degree, department, year, score, resume, category)
      ) AS v
      WHERE c."id" = v.id`;
  }

  // 3. Products held by each candidate.
  const productLinks = appRows.flatMap((row) => {
    const candidateId = idByCode.get(row.candidateCode.toLowerCase());
    return candidateId && row.productId ? [{ candidateId, productId: row.productId }] : [];
  });
  if (productLinks.length > 0) await db.candidateProduct.createMany({ data: productLinks, skipDuplicates: true });

  // 4. Applications to this job.
  const newApplications = appRows.flatMap((row) => {
    const candidateId = idByCode.get(row.candidateCode.toLowerCase());
    return candidateId && row.createApplication
      ? [{
        candidateId,
        jobRequestId: input.jobRequestId,
        productId: row.productId,
        appliedAt: row.appliedAt ? new Date(row.appliedAt) : now,
        source: "IMPORT" as const,
        importBatchId: input.batchId,
      }]
      : [];
  });
  const created = newApplications.length > 0 ? await db.application.createMany({ data: newApplications, skipDuplicates: true }) : { count: 0 };

  // 5. Stage decisions.
  const { stages } = await ensureInternalProcess(db, input.jobRequestId);
  let decisionsWritten = 0;
  if (stageRows.length > 0) {
    const applications = await db.application.findMany({
      where: { jobRequestId: input.jobRequestId, candidateId: { in: [...idByCode.values()] } },
      select: { id: true, candidateId: true },
    });
    const applicationByCandidate = new Map(applications.map((application) => [application.candidateId, application.id]));
    const decisions = stageRows.flatMap((row) => {
      const candidateId = row.candidateCode ? idByCode.get(row.candidateCode.toLowerCase()) : undefined;
      const applicationId = candidateId ? applicationByCandidate.get(candidateId) : undefined;
      const stage = stages.get(row.stage);
      return applicationId && stage && row.outcome ? [{ ...row, applicationId, stageId: stage.id }] : [];
    });
    if (decisions.length > 0) {
      decisionsWritten = await db.$executeRaw`
        INSERT INTO "InternalStageCandidate" (
          "id", "stageId", "applicationId", "jobRequestId", "outcome", "priority", "techScore", "commScore",
          "rejectionReason", "remarks", "source", "importBatchId", "decidedById", "decidedAt", "createdAt", "updatedAt"
        )
        SELECT gen_random_uuid(), t.stage_id, t.application_id, ${input.jobRequestId}::uuid,
               t.outcome::"StageCandidateOutcome", t.priority::"ScreeningPriority", t.tech, t.comm,
               t.reason, t.remarks, 'IMPORT'::"ChangeSource", ${input.batchId}::uuid, ${input.userId}::uuid, NOW(), NOW(), NOW()
        FROM UNNEST(
          ${decisions.map((row) => row.stageId)}::uuid[],
          ${decisions.map((row) => row.applicationId)}::uuid[],
          ${decisions.map((row) => row.outcome)}::text[],
          ${decisions.map((row) => row.priority)}::text[],
          ${decisions.map((row) => row.techScore)}::numeric[],
          ${decisions.map((row) => row.commScore)}::numeric[],
          ${decisions.map((row) => row.rejectionReason)}::text[],
          ${decisions.map((row) => row.remarks)}::text[]
        ) AS t(stage_id, application_id, outcome, priority, tech, comm, reason, remarks)
        ON CONFLICT ("stageId", "applicationId") DO UPDATE SET
          "outcome" = EXCLUDED."outcome",
          "priority" = COALESCE(EXCLUDED."priority", "InternalStageCandidate"."priority"),
          "techScore" = COALESCE(EXCLUDED."techScore", "InternalStageCandidate"."techScore"),
          "commScore" = COALESCE(EXCLUDED."commScore", "InternalStageCandidate"."commScore"),
          "rejectionReason" = COALESCE(EXCLUDED."rejectionReason", "InternalStageCandidate"."rejectionReason"),
          "remarks" = COALESCE(EXCLUDED."remarks", "InternalStageCandidate"."remarks"),
          "source" = 'IMPORT', "importBatchId" = EXCLUDED."importBatchId",
          "decidedById" = EXCLUDED."decidedById", "decidedAt" = NOW(), "updatedAt" = NOW()`;
    }
  }

  // 6. Stages the PSM said were not conducted (an explicit choice in the wizard).
  let stagesMarkedNotConducted = 0;
  for (const stage of DECISION_STAGES as DecisionStage[]) {
    const current = stages.get(stage);
    if (input.mapping.stages[stage].mode === "NOT_CONDUCTED" && current && current.status !== "NOT_CONDUCTED") {
      await db.internalProcessStage.update({ where: { id: current.id }, data: { status: "NOT_CONDUCTED", completedAt: null } });
      await db.stageCompletionRecord.create({
        data: { stageId: current.id, fromStatus: current.status, toStatus: "NOT_CONDUCTED", remarks: "Set while importing the internal sheet.", recordedById: input.userId },
      });
      stagesMarkedNotConducted++;
    }
  }

  return {
    candidatesCreated: toCreate.length,
    candidatesUpdated: fills.length,
    applicationsCreated: created.count,
    decisionsWritten,
    stagesMarkedNotConducted,
  };
}

