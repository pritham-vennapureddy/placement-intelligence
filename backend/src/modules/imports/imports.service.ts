import { createHash } from "node:crypto";
import {
  suggestInterviewOutcome,
  suggestPipelineStatus,
  suggestStageOutcome,
  normalizeValueKey,
  type DecisionStage,
} from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { loadJobForUser } from "../../services/job-access.service.js";
import { ApiError } from "../../utils/api-error.js";
import { normalizeEmail, normalizeMobile } from "../../utils/normalize.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { commitCompanyImport } from "./company-commit.js";
import { overrideKey, planCompanyImport, type JobApplicant } from "./company-plan.js";
import { commitInternalImport } from "./internal-commit.js";
import { collectApplicationKeys, planInternalImport, type ExistingCandidate } from "./internal-plan.js";
import { importsRepository } from "./imports.repository.js";
import {
  companyMappingSchema,
  internalMappingSchema,
  type CompanyMapping,
  type InternalMapping,
  type PreviewQuery,
  type RowsQuery,
  type UpdateRowInput,
  type ValuesQuery,
} from "./imports.validators.js";
import { readWorkbook, type Workbook } from "./workbook.js";

const MAX_BYTES = 20 * 1024 * 1024;

async function loadBatch(user: AuthenticatedUser, batchId: string, write = false) {
  const batch = await importsRepository.findBatch(batchId);
  if (!batch) throw new ApiError(404, "IMPORT_NOT_FOUND", "The import was not found.");
  const { job } = await loadJobForUser(user, batch.jobRequestId, write ? "import:run" : undefined);
  return { batch, job };
}

function assertEditable(batch: { status: string }) {
  if (batch.status === "COMMITTED") throw new ApiError(409, "IMPORT_COMMITTED", "This import has already been approved and saved.");
  if (batch.status === "CANCELLED") throw new ApiError(409, "IMPORT_CANCELLED", "This import was cancelled. Upload the file again to start over.");
}

async function openWorkbook(batch: { id: string; sourceFileName: string }): Promise<Workbook> {
  const bytes = await importsRepository.findFile(batch.id);
  if (!bytes) throw new ApiError(410, "IMPORT_FILE_MISSING", "The uploaded file is no longer available.");
  return readWorkbook(bytes, batch.sourceFileName);
}

/** Memoised sheet reader: each sheet/header-row pair is parsed once per request. */
function readerFor(workbook: Workbook) {
  const cache = new Map<string, ReturnType<Workbook["read"]>>();
  return (sheet: string, headerRow: number) => {
    const key = `${sheet}|${headerRow}`;
    if (!cache.has(key)) cache.set(key, workbook.read(sheet, headerRow));
    return cache.get(key)!;
  };
}

// ── Internal sheet ──

async function validateInternal(batchId: string, job: { id: string; jobId: string }, mapping: InternalMapping, workbook: Workbook) {
  const read = readerFor(workbook);
  const keys = collectApplicationKeys(mapping, read);

  const candidateSelect = {
    id: true, candidateCode: true, fullName: true, email: true, mobile: true, gender: true, currentCity: true, state: true,
    college: true, degree: true, department: true, graduationYear: true, academicScore: true, resumeUrl: true, category: true,
  } as const;
  const [found, applications, outcomes, products, jobs] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        OR: [
          { candidateCode: { in: [...keys.codes, ...keys.codes.map((code) => code.toLowerCase())] } },
          { email: { in: keys.emails } },
          { mobile: { in: keys.mobiles } },
        ],
      },
      select: candidateSelect,
    }),
    prisma.application.findMany({ where: { jobRequestId: job.id }, select: { candidateId: true, source: true, candidate: { select: candidateSelect } } }),
    prisma.internalStageCandidate.findMany({
      where: { jobRequestId: job.id },
      select: { outcome: true, source: true, priority: true, techScore: true, commScore: true, stage: { select: { stage: true } }, application: { select: { candidateId: true } } },
    }),
    prisma.product.findMany({ select: { id: true, code: true, name: true, category: true } }),
    prisma.jobRequest.findMany({
      where: { jobId: { in: keys.jobIds } },
      select: { jobId: true, roleTitle: true, requestDate: true, company: { select: { name: true } } },
    }),
  ]);

  const toExisting = (candidate: (typeof found)[number]): ExistingCandidate => ({
    ...candidate,
    academicScore: candidate.academicScore === null ? null : Number(candidate.academicScore),
  });
  const candidates = new Map<string, ExistingCandidate>();
  for (const candidate of [...found, ...applications.map(({ candidate }) => candidate)]) candidates.set(candidate.id, toExisting(candidate));

  const outcomeMap = new Map<string, Map<DecisionStage, { outcome: never; source: string; priority: string | null; techScore: number | null; commScore: number | null }>>();
  for (const outcome of outcomes) {
    if (outcome.stage.stage === "TOTAL_APPLICATIONS") continue;
    const perCandidate = outcomeMap.get(outcome.application.candidateId) ?? new Map();
    perCandidate.set(outcome.stage.stage as DecisionStage, {
      outcome: outcome.outcome as never,
      source: outcome.source,
      priority: outcome.priority,
      techScore: outcome.techScore === null ? null : Number(outcome.techScore),
      commScore: outcome.commScore === null ? null : Number(outcome.commScore),
    });
    outcomeMap.set(outcome.application.candidateId, perCandidate);
  }

  const plan = planInternalImport(mapping, read, {
    job,
    products,
    candidates: [...candidates.values()],
    applicationCandidateIds: new Set(applications.map(({ candidateId }) => candidateId)),
    outcomes: outcomeMap,
    importedCandidateIds: new Set(applications.filter(({ source }) => source === "IMPORT").map(({ candidateId }) => candidateId)),
    jobLabels: new Map(jobs.map((other) => [other.jobId, `${other.company.name} · ${other.roleTitle} · ${other.requestDate.toISOString().slice(0, 10)}`])),
  });
  await importsRepository.saveValidation(batchId, mapping as Prisma.InputJsonValue, plan.summary as unknown as Prisma.InputJsonValue, plan.rows, plan.batchIssues);
}

// ── Company sheet ──

async function validateCompany(batchId: string, job: { id: string }, mapping: CompanyMapping, workbook: Workbook) {
  const read = readerFor(workbook);
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  for (const tab of mapping.tabs) {
    for (const row of read(tab.sheet, tab.headerRow).rows) {
      const email = tab.columns.email !== undefined ? normalizeEmail(row.cells[tab.columns.email]) : null;
      const mobile = tab.columns.mobile !== undefined ? normalizeMobile(row.cells[tab.columns.mobile]) : null;
      if (email) emails.add(email);
      if (mobile) mobiles.add(mobile);
    }
  }

  const [applications, outsiders, rounds] = await Promise.all([
    prisma.application.findMany({
      where: { jobRequestId: job.id },
      select: {
        id: true,
        candidateId: true,
        candidate: { select: { candidateCode: true, fullName: true, email: true, mobile: true } },
        stageOutcomes: { where: { outcome: "REJECTED" }, select: { id: true }, take: 1 },
        nomination: {
          select: { id: true, pipelineStatus: true, interviews: { select: { outcome: true, round: { select: { name: true } } } } },
        },
      },
    }),
    prisma.candidate.findMany({
      where: { OR: [{ email: { in: [...emails] } }, { mobile: { in: [...mobiles] } }], applications: { none: { jobRequestId: job.id } } },
      select: { fullName: true, email: true, mobile: true },
    }),
    prisma.companyInterviewRound.findMany({ where: { jobRequestId: job.id }, select: { name: true } }),
  ]);

  const applicants: JobApplicant[] = applications.map((application) => ({
    applicationId: application.id,
    candidateId: application.candidateId,
    candidateCode: application.candidate.candidateCode,
    fullName: application.candidate.fullName,
    email: application.candidate.email,
    mobile: application.candidate.mobile,
    internallyRejected: application.stageOutcomes.length > 0,
    nomination: application.nomination
      ? {
        id: application.nomination.id,
        pipelineStatus: application.nomination.pipelineStatus,
        outcomes: new Map(application.nomination.interviews.map((interview) => [interview.round.name, interview.outcome])),
      }
      : null,
  }));

  const plan = planCompanyImport(mapping, read, applicants, outsiders, rounds.map(({ name }) => name));
  await importsRepository.saveValidation(batchId, mapping as Prisma.InputJsonValue, plan.summary as unknown as Prisma.InputJsonValue, plan.rows, []);
}

export const importsService = {
  async upload(user: AuthenticatedUser, jobRequestId: string, target: "INTERNAL_SCREENING" | "COMPANY_PIPELINE", file: Express.Multer.File | undefined, audit: AuditContext) {
    const { job } = await loadJobForUser(user, jobRequestId, "import:run");
    if (!file) throw new ApiError(400, "FILE_REQUIRED", "Choose an Excel (.xlsx) or CSV file.");
    if (file.size > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "The file is larger than 20 MB.");
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new ApiError(400, "UNSUPPORTED_FILE", "Upload an .xlsx or .csv file. Google Sheets: File → Download → Microsoft Excel.");

    const workbook = await readWorkbook(file.buffer, file.originalname);
    if (workbook.sheets.length === 0) throw new ApiError(400, "EMPTY_FILE", "The file has no sheets with data.");
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const previous = await importsRepository.findPreviousMapping(job.id, target);

    const batch = await importsRepository.createBatch({
      target,
      sourceType: /\.csv$/i.test(file.originalname) ? "CSV" : "EXCEL",
      jobRequestId: job.id,
      sourceFileName: file.originalname.slice(0, 250),
      sourceChecksum: checksum,
      fileSize: file.size,
      sheets: workbook.sheets as unknown as Prisma.InputJsonValue,
      importedById: user.id,
      bytes: file.buffer,
      contentType: file.mimetype || "application/octet-stream",
      // Pre-fill from the last approved import of this job, minus row-level choices.
      mapping: previous?.mapping ? ({ ...(previous.mapping as object), overrides: {} } as Prisma.InputJsonValue) : null,
    });
    await recordAudit(prisma, audit, {
      action: "IMPORT_UPLOADED",
      entityType: "JobRequest",
      entityId: job.id,
      metadata: { batchId: batch.id, batchCode: batch.batchCode, target, fileName: batch.sourceFileName },
    });
    const duplicate = await importsRepository.findDuplicateUpload(job.id, checksum);
    return { batch, duplicateOf: duplicate };
  },

  async get(user: AuthenticatedUser, batchId: string) {
    const { batch } = await loadBatch(user, batchId);
    const batchIssues = batch.status === "UPLOADED" ? [] : await importsRepository.batchIssues(batchId);
    return { ...batch, batchIssues };
  },

  async preview(user: AuthenticatedUser, batchId: string, query: PreviewQuery) {
    const { batch } = await loadBatch(user, batchId);
    const workbook = await openWorkbook(batch);
    return { rows: workbook.top(query.sheet, query.limit).map(({ rowNumber, cells }) => ({ rowNumber, cells })) };
  },

  /** Distinct values in the chosen columns, with a suggested meaning for each. */
  async values(user: AuthenticatedUser, batchId: string, query: ValuesQuery) {
    const { batch } = await loadBatch(user, batchId);
    const workbook = await openWorkbook(batch);
    const { rows } = workbook.read(query.sheet, query.headerRow);
    const counts = new Map<string, { value: string; count: number }>();
    for (const row of rows) {
      for (const column of query.columns) {
        const value = row.cells[column]?.trim();
        if (!value) continue;
        const key = normalizeValueKey(value);
        const entry = counts.get(key) ?? { value, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return {
      values: [...counts].slice(0, 100).map(([key, { value, count }]) => ({
        key,
        value,
        count,
        suggested: {
          stage: suggestStageOutcome(value),
          interview: suggestInterviewOutcome(value),
          pipeline: suggestPipelineStatus(value),
        },
      })),
    };
  },

  async validate(user: AuthenticatedUser, batchId: string, body: unknown, audit: AuditContext) {
    const { batch, job } = await loadBatch(user, batchId, true);
    assertEditable(batch);
    const workbook = await openWorkbook(batch);
    if (batch.target === "INTERNAL_SCREENING") {
      await validateInternal(batch.id, job, internalMappingSchema.parse(body), workbook);
    } else {
      // Keep manual matches made during review unless the request replaces them.
      const parsed = companyMappingSchema.parse(body);
      const previous = (batch.mapping as { overrides?: Record<string, string> } | null)?.overrides ?? {};
      await validateCompany(batch.id, job, { ...parsed, overrides: { ...previous, ...parsed.overrides } }, workbook);
    }
    await recordAudit(prisma, audit, { action: "IMPORT_VALIDATED", entityType: "ImportBatch", entityId: batch.id });
    return importsService.get(user, batch.id);
  },

  async rows(user: AuthenticatedUser, batchId: string, query: RowsQuery) {
    await loadBatch(user, batchId);
    const where: Prisma.ImportStagingRecordWhereInput = {
      ...(query.role ? { sheetMapping: { role: query.role } } : {}),
      ...(query.filter === "errors" ? { validationStatus: "INVALID" } : {}),
      ...(query.filter === "warnings" ? { validationStatus: "WARNING" } : {}),
      ...(query.filter === "excluded" ? { approvalStatus: "EXCLUDED" } : {}),
      ...(query.filter === "changes" ? { action: { in: ["CREATE", "UPDATE", "CONFLICT"] } } : {}),
    };
    const { rows, total } = await importsRepository.listRows(batchId, where, toPrismaPage(query));
    return { rows, meta: buildPaginationMeta(query, total) };
  },

  /** Include/exclude a row, or (company sheet) match it to an applicant by hand and re-check. */
  async updateRow(user: AuthenticatedUser, batchId: string, rowId: string, input: UpdateRowInput, audit: AuditContext) {
    const { batch, job } = await loadBatch(user, batchId, true);
    assertEditable(batch);
    const row = await importsRepository.findRow(batchId, rowId);
    if (!row) throw new ApiError(404, "IMPORT_ROW_NOT_FOUND", "The row was not found.");

    if (input.applicationId !== undefined) {
      if (batch.target !== "COMPANY_PIPELINE") throw new ApiError(400, "NOT_SUPPORTED", "Rows can only be matched by hand in company-sheet imports.");
      const mapping = companyMappingSchema.parse(batch.mapping);
      const key = overrideKey(row.sheetMapping.worksheetName, row.sourceRowNumber);
      const overrides = { ...mapping.overrides };
      if (input.applicationId) {
        const application = await prisma.application.findFirst({ where: { id: input.applicationId, jobRequestId: job.id }, select: { id: true } });
        if (!application) throw new ApiError(400, "INVALID_APPLICATION", "Choose an applicant of this job.");
        overrides[key] = input.applicationId;
      } else {
        delete overrides[key];
      }
      await validateCompany(batch.id, job, { ...mapping, overrides }, await openWorkbook(batch));
      await recordAudit(prisma, audit, { action: "IMPORT_ROW_MATCHED", entityType: "ImportBatch", entityId: batch.id, metadata: { row: key, applicationId: input.applicationId } });
      return importsService.get(user, batch.id);
    }

    if (input.included && row.validationStatus === "INVALID") {
      throw new ApiError(400, "ROW_HAS_ERRORS", "Rows with errors cannot be included. Fix the sheet or the mapping and check again.");
    }
    await importsRepository.setRowApproval(row.id, Boolean(input.included));
    return importsService.get(user, batch.id);
  },

  async approve(user: AuthenticatedUser, batchId: string, notes: string | undefined, audit: AuditContext) {
    const { batch, job } = await loadBatch(user, batchId, true);
    assertEditable(batch);
    if (batch.status !== "VALIDATED") throw new ApiError(409, "IMPORT_NOT_VALIDATED", "Check the file before approving it.");
    const rows = await importsRepository.includedRows(batchId);
    if (rows.length === 0) throw new ApiError(400, "NOTHING_TO_IMPORT", "No rows are included.");

    const jobSkills = await prisma.jobRequestSkill.findMany({ where: { jobRequestId: job.id }, select: { skillId: true } });
    const counts = await inTransaction(async (transaction) => {
      const result = batch.target === "INTERNAL_SCREENING"
        ? await commitInternalImport(transaction, {
          batchId: batch.id,
          jobRequestId: job.id,
          userId: user.id,
          mapping: internalMappingSchema.parse(batch.mapping),
          rows,
        })
        : await commitCompanyImport(transaction, {
          jobRequestId: job.id,
          userId: user.id,
          rows,
          jobSkillIds: jobSkills.map(({ skillId }) => skillId),
          addJobSkills: companyMappingSchema.parse(batch.mapping).addJobSkills,
        });
      await transaction.importStagingRecord.updateMany({ where: { id: { in: rows.map(({ id }) => id) } }, data: { committedAt: new Date() } });
      await importsRepository.setStatus(transaction, batch.id, "COMMITTED", { committedAt: new Date() });
      await transaction.importApproval.create({
        data: { batchId: batch.id, decision: "APPROVED", decidedById: user.id, counts: result as unknown as Prisma.InputJsonValue, ...(notes ? { notes } : {}) },
      });
      await recordAudit(transaction, audit, {
        action: batch.target === "INTERNAL_SCREENING" ? "INTERNAL_SHEET_IMPORTED" : "COMPANY_SHEET_IMPORTED",
        entityType: "JobRequest",
        entityId: job.id,
        metadata: { batchId: batch.id, batchCode: batch.batchCode, fileName: batch.sourceFileName, ...result },
      });
      return result;
    }, { timeoutMs: 180_000 });
    return { batch: await importsService.get(user, batch.id), counts };
  },

  async cancel(user: AuthenticatedUser, batchId: string, audit: AuditContext) {
    const { batch } = await loadBatch(user, batchId, true);
    assertEditable(batch);
    await inTransaction(async (transaction) => {
      await importsRepository.setStatus(transaction, batch.id, "CANCELLED");
      await transaction.importApproval.create({ data: { batchId: batch.id, decision: "CANCELLED", decidedById: user.id } });
      await recordAudit(transaction, audit, { action: "IMPORT_CANCELLED", entityType: "ImportBatch", entityId: batch.id });
    });
    return importsService.get(user, batch.id);
  },

  async listForJob(user: AuthenticatedUser, jobRequestId: string) {
    const { job } = await loadJobForUser(user, jobRequestId);
    return importsRepository.listForJob(job.id);
  },

  async list(user: AuthenticatedUser, query: { page: number; pageSize: number }) {
    const scope = await resolveDataScope(user);
    const [batches, total] = await importsRepository.list({ jobRequest: jobRequestScopeFilter(scope) }, toPrismaPage(query));
    return { batches, meta: buildPaginationMeta(query, total) };
  },
};
