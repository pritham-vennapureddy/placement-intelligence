import { createHash } from "node:crypto";
import {
  DECISION_STAGES,
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
import { normalizeMobile } from "../../utils/normalize.js";
import { buildPaginationMeta, toPrismaPage } from "../../utils/pagination.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { commitCompanyImport } from "./company-commit.js";
import { overrideKey, planCompanyImport, type JobApplicant } from "./company-plan.js";
import { commitInternalImport } from "./internal-commit.js";
import { collectApplicationKeys, planInternalImport, type ExistingCandidate } from "./internal-plan.js";
import { importsRepository } from "./imports.repository.js";
import {
  companyMappingSchema,
  googleCompanySelectionSchema,
  googleInternalSelectionSchema,
  internalMappingSchema,
  type CompanyMapping,
  type GoogleCompanySelection,
  type GoogleInternalSelection,
  type InternalMapping,
  type PreviewQuery,
  type RowsQuery,
  type UpdateRowInput,
  type ValuesQuery,
} from "./imports.validators.js";
import { detectHeaderRow, readWorkbook, restoreWorkbook, serializeWorkbook, type Workbook } from "./workbook.js";
import { buildWorkbook, gridChecksum } from "./google-snapshot.js";
import { inferGoogleMapping } from "./google-sheet-analysis.js";
import { mappingMatchesTabs, parseBatchTabs, selectionFromTabs, tabsFromMapping } from "./batch-tabs.js";
import { isRecruitmentTab, sheetsInMapping, suggestRecruitmentTab } from "./tab-names.js";
import { extractSpreadsheetId, fetchSpreadsheetGrid, getGoogleServiceAccountEmail } from "../sheets/google-sheets.service.js";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 80 * 1024 * 1024;

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
  const stored = await importsRepository.findSnapshot(batch.id);
  if (!stored?.sourceSnapshot) throw new ApiError(410, "IMPORT_SNAPSHOT_MISSING", "The source snapshot for this import is unavailable.");
  return restoreWorkbook(stored.sourceSnapshot);
}

async function resolveRecruitmentBatchId(jobRequestId: string, requestedBatchId?: string): Promise<string> {
  if (requestedBatchId) {
    const selected = await prisma.recruitmentBatch.findFirst({ where: { id: requestedBatchId, jobRequestId }, select: { id: true, status: true } });
    if (!selected) throw new ApiError(404, "RECRUITMENT_BATCH_NOT_FOUND", "The recruitment batch was not found for this job request.");
    if (selected.status === "CLOSED") throw new ApiError(409, "RECRUITMENT_BATCH_CLOSED", "This recruitment batch is closed and cannot receive imports.");
    return selected.id;
  }
  const defaultBatch = await prisma.recruitmentBatch.findFirst({ where: { jobRequestId, status: "ACTIVE" }, orderBy: { sequence: "asc" }, select: { id: true } });
  if (!defaultBatch) throw new ApiError(409, "RECRUITMENT_BATCH_MISSING", "Create an active recruitment batch before importing a sheet.");
  return defaultBatch.id;
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

function detectInternalHeaderRows(mapping: InternalMapping, workbook: Workbook): InternalMapping {
  const stages = { ...mapping.stages };
  for (const stageKey of DECISION_STAGES) {
    const stage = stages[stageKey];
    if (stage.mode === "SHEET") {
      stages[stageKey] = { ...stage, headerRow: detectHeaderRow(workbook.top(stage.sheet, 10)) };
    }
  }
  return {
    ...mapping,
    applications: {
      ...mapping.applications,
      headerRow: detectHeaderRow(workbook.top(mapping.applications.sheet, 10)),
    },
    profileLookups: mapping.profileLookups.map((lookup) => ({
      ...lookup,
      headerRow: detectHeaderRow(workbook.top(lookup.sheet, 10)),
    })),
    ...(mapping.productsLookup
      ? { productsLookup: { ...mapping.productsLookup, headerRow: detectHeaderRow(workbook.top(mapping.productsLookup.sheet, 10)) } }
      : {}),
    stages,
  };
}

function detectCompanyHeaderRows(mapping: CompanyMapping, workbook: Workbook): CompanyMapping {
  return {
    ...mapping,
    tabs: mapping.tabs.map((tab) => ({ ...tab, headerRow: detectHeaderRow(workbook.top(tab.sheet, 10)) })),
  };
}

function selectedSheetNames(selection: GoogleInternalSelection | GoogleCompanySelection): string[] {
  if ("applications" in selection) {
    return [
      selection.applications.sheet,
      ...(selection.productLookupSheet ? [selection.productLookupSheet] : []),
      ...DECISION_STAGES.flatMap((stage) => {
        const config = selection.stages[stage];
        return config.mode === "SHEET" ? [config.sheet] : [];
      }),
    ];
  }
  return selection.tabs.map(({ sheet }) => sheet);
}

function assertSelectedGoogleSheetsExist(selection: GoogleInternalSelection | GoogleCompanySelection, workbook: Workbook): void {
  const available = new Set(workbook.sheets.map(({ name }) => name));
  const missing = selectedSheetNames(selection).find((sheet) => !available.has(sheet));
  if (missing) {
    throw new ApiError(400, "GOOGLE_SHEET_NOT_FOUND", `The selected tab “${missing}” is no longer in this spreadsheet. Choose a tab that still exists.`);
  }
}

function assertGoogleInternalMapping(mapping: ReturnType<typeof inferGoogleMapping>, selection: GoogleInternalSelection): asserts mapping is ReturnType<typeof inferGoogleMapping> {
  if (!("applications" in mapping)) {
    throw new ApiError(422, "GOOGLE_SHEET_ANALYSIS_FAILED", "Could not analyze the selected internal workbook tabs.");
  }
  const application = mapping.applications.columns;
  if (application.mobile === undefined) {
    throw new ApiError(422, "GOOGLE_SHEET_ANALYSIS_FAILED", `Could not identify a mobile-number column in the selected applications tab “${selection.applications.sheet}”. Candidate UUID and email columns are ignored for identity matching.`);
  }
  if (selection.productLookupSheet && !mapping.productsLookup) {
    throw new ApiError(422, "GOOGLE_SHEET_ANALYSIS_FAILED", `Could not identify a mobile-number column and a Product column in the selected product tab “${selection.productLookupSheet}”.`);
  }
  for (const stageKey of DECISION_STAGES) {
    const selected = selection.stages[stageKey];
    if (selected.mode !== "SHEET") continue;
    const stage = mapping.stages[stageKey];
    if (!stage || typeof stage !== "object" || !("mode" in stage) || stage.mode !== "SHEET") {
      const needsReason = stageKey === "FINAL_SHORTLIST";
      throw new ApiError(
        422,
        "GOOGLE_SHEET_ANALYSIS_FAILED",
        needsReason
          ? `Could not identify a mobile-number column in the selected SP tab “${selected.sheet}”.`
          : `Could not identify a candidate ID, email, or mobile in the selected ${stageKey} tab “${selected.sheet}”.`,
      );
    }
  }
}

// ── Internal sheet ──

async function validateInternal(batchId: string, job: { id: string; jobId: string }, recruitmentBatchId: string, mapping: InternalMapping, workbook: Workbook) {
  const read = readerFor(workbook);
  const keys = collectApplicationKeys(mapping, read);

  const candidateSelect = {
    id: true, candidateCode: true, fullName: true, email: true, mobile: true, gender: true, currentCity: true, state: true,
    college: true, degree: true, department: true, graduationYear: true, academicScore: true, resumeUrl: true, category: true,
  } as const;
  const [found, applications, outcomes, products, jobs] = await Promise.all([
    prisma.candidate.findMany({
      where: { mobile: { in: keys.mobiles } },
      select: candidateSelect,
    }),
    prisma.application.findMany({ where: { jobRequestId: job.id, recruitmentBatchId }, select: { candidateId: true, source: true, candidate: { select: candidateSelect } } }),
    prisma.internalStageCandidate.findMany({
      where: { jobRequestId: job.id, application: { recruitmentBatchId } },
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

async function validateCompany(batchId: string, job: { id: string }, recruitmentBatchId: string, mapping: CompanyMapping, workbook: Workbook) {
  const read = readerFor(workbook);
  const mobiles = new Set<string>();
  for (const tab of mapping.tabs) {
    for (const row of read(tab.sheet, tab.headerRow).rows) {
      const mobile = tab.columns.mobile !== undefined ? normalizeMobile(row.cells[tab.columns.mobile]) : null;
      if (mobile) mobiles.add(mobile);
    }
  }

  const [applications, outsiders, rounds] = await Promise.all([
    prisma.application.findMany({
      where: { jobRequestId: job.id, recruitmentBatchId },
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
      where: { mobile: { in: [...mobiles] }, applications: { none: { jobRequestId: job.id, recruitmentBatchId } } },
      select: { fullName: true, email: true, mobile: true },
    }),
    prisma.companyInterviewRound.findMany({ where: { jobRequestId: job.id, recruitmentBatchId }, select: { name: true } }),
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

type ImportTarget = "INTERNAL_SCREENING" | "COMPANY_PIPELINE";

/**
 * The batch's last approved mapping, adjusted to this workbook. TA is the
 * total-applications tab by definition: when the earlier import read
 * applicants from a non-TA tab (e.g. "Applied Users", which omits External
 * applicants) and the workbook has a TA tab this batch can use, that TA tab
 * becomes the applications tab and the student-detail lookups are re-detected
 * so the old tab still enriches profiles. A batch already on a TA-style tab
 * (e.g. "TA-1") keeps it. `usedSheets` are other batches' tabs.
 */
export function reusableMapping(previous: Prisma.JsonValue, workbook: Workbook, target: ImportTarget, usedSheets: ReadonlySet<string> = new Set()): Record<string, unknown> {
  let mapping = previous as Record<string, unknown>;
  if (target !== "INTERNAL_SCREENING") return mapping;
  const inferred = () => inferGoogleMapping(workbook, "INTERNAL_SCREENING", undefined, usedSheets);
  const taSheet = suggestRecruitmentTab(workbook.sheets, "TA", usedSheets)?.name;
  const savedSheet = (mapping.applications as { sheet?: string } | undefined)?.sheet;
  if (taSheet && !(savedSheet && isRecruitmentTab(savedSheet, "TA"))) {
    mapping = { ...mapping, applications: inferred().applications, profileLookups: inferred().profileLookups };
  }
  // A product tab the PSM never confirmed was auto-detected: detect it again.
  if (!mapping.productTabConfirmed) {
    const { productsLookup, ...rest } = mapping;
    void productsLookup;
    const detected = inferred();
    mapping = { ...rest, ...("productsLookup" in detected && detected.productsLookup ? { productsLookup: detected.productsLookup } : {}) };
  }
  return mapping;
}

/** Batch-level switches the PSM set on an earlier import, kept when the tabs change. */
function copySettings(previous: Prisma.JsonValue): Record<string, unknown> {
  const value = (previous ?? {}) as Record<string, unknown>;
  return Object.fromEntries(["acceptOtherJobIds", "overwriteManualDecisions"].filter((key) => typeof value[key] === "boolean").map((key) => [key, value[key]]));
}

/** Creates a batch from source bytes, stores only the parsed snapshot, and reuses the job's last approved mapping. */
async function createBatch(
  user: AuthenticatedUser,
  jobRequestId: string,
  recruitmentBatchId: string,
  target: ImportTarget,
  audit: AuditContext,
  source: {
    bytes: Buffer;
    fileName: string;
    sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS";
    checksum: string;
    spreadsheetId?: string;
    url?: string | null;
  },
) {
  const workbook = await readWorkbook(source.bytes, source.fileName);
  if (workbook.sheets.length === 0) throw new ApiError(400, "EMPTY_FILE", "The file has no sheets with data.");
  const sourceSnapshot = serializeWorkbook(workbook);
  const snapshotSize = Buffer.byteLength(JSON.stringify(sourceSnapshot));
  if (snapshotSize > MAX_SNAPSHOT_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "The spreadsheet is too large to store as an import snapshot.");
  const previous = await importsRepository.findPreviousMapping(jobRequestId, recruitmentBatchId, target);
  // Tabs other batches of this job import from (e.g. "TA" for batch 1), so this batch is offered its own ("TA-1").
  const usedSheets = new Set((await importsRepository.otherBatchMappings(jobRequestId, recruitmentBatchId, target)).flatMap(sheetsInMapping));
  // The tabs the PSM chose for this recruitment batch win over detection; the last
  // approved mapping is kept only while it still reads exactly those tabs.
  const batchTabs = target === "INTERNAL_SCREENING" && source.sourceType === "GOOGLE_SHEETS"
    ? parseBatchTabs((await prisma.recruitmentBatch.findUnique({ where: { id: recruitmentBatchId }, select: { internalTabs: true } }))?.internalTabs)
    : null;
  const fromTabs = selectionFromTabs(batchTabs, workbook.sheets.map(({ name }) => name));
  const keepPrevious = Boolean(previous?.mapping) && (!fromTabs || mappingMatchesTabs(previous!.mapping, batchTabs!));
  const batch = await importsRepository.createBatch({
    target,
    sourceType: source.sourceType,
    jobRequestId,
    recruitmentBatchId,
    sourceFileName: source.fileName.slice(0, 250),
    sourceChecksum: source.checksum,
    snapshotSize,
    sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
    sheets: workbook.sheets as unknown as Prisma.InputJsonValue,
    importedById: user.id,
    sourceSpreadsheetId: source.spreadsheetId ?? null,
    sourceUrl: source.url ?? null,
    // Row-level choices (manual matches) are not carried over.
    mapping: keepPrevious && previous?.mapping
      ? ({ ...reusableMapping(previous.mapping, workbook, target, usedSheets), overrides: {} } as Prisma.InputJsonValue)
      : fromTabs
        ? ({
          ...inferGoogleMapping(workbook, "INTERNAL_SCREENING", fromTabs.selection, usedSheets),
          ...(previous?.mapping ? copySettings(previous.mapping) : {}),
        } as Prisma.InputJsonValue)
      : source.sourceType === "GOOGLE_SHEETS"
        ? inferGoogleMapping(workbook, target, undefined, usedSheets) as Prisma.InputJsonValue
        : null,
  });
  await recordAudit(prisma, audit, {
    action: "IMPORT_UPLOADED",
    entityType: "JobRequest",
    entityId: jobRequestId,
    metadata: { batchId: batch.id, batchCode: batch.batchCode, target, fileName: batch.sourceFileName, source: source.sourceType },
  });
  const duplicate = await importsRepository.findDuplicateUpload(jobRequestId, recruitmentBatchId, source.checksum);
  return { batch, duplicateOf: duplicate };
}

/** The sheet a batch reads for this target: its own link, else the job request's. */
async function linkedSheetUrl(jobRequestId: string, recruitmentBatchId: string, target: ImportTarget): Promise<string | null> {
  const batch = await prisma.recruitmentBatch.findFirst({
    where: { id: recruitmentBatchId, jobRequestId },
    select: { internalSheetUrl: true, companySheetUrl: true, jobRequest: { select: { internalSheetUrl: true, companySheetUrl: true } } },
  });
  if (!batch) return null;
  return target === "COMPANY_PIPELINE"
    ? batch.companySheetUrl ?? batch.jobRequest.companySheetUrl
    : batch.internalSheetUrl ?? batch.jobRequest.internalSheetUrl;
}

async function createGoogleBatch(user: AuthenticatedUser, jobRequestId: string, recruitmentBatchId: string, target: ImportTarget, spreadsheetId: string, url: string | null, audit: AuditContext) {
  const grid = await fetchSpreadsheetGrid(spreadsheetId);
  if (grid.sheets.every((sheet) => sheet.rows.length === 0)) throw new ApiError(400, "EMPTY_FILE", "The spreadsheet has no data.");
  const bytes = await buildWorkbook(grid);
  if (bytes.length > MAX_BYTES * 2) throw new ApiError(413, "FILE_TOO_LARGE", "The spreadsheet is too large to import in one go.");
  return createBatch(user, jobRequestId, recruitmentBatchId, target, audit, {
    bytes,
    fileName: `${grid.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 200) || "Google Sheet"}.xlsx`,
    sourceType: "GOOGLE_SHEETS",
    checksum: gridChecksum(grid),
    spreadsheetId,
    url: url ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  });
}

export const importsService = {
  /** Reads a Google Sheet (read-only) into a snapshot and starts an import from it. */
  async importFromGoogle(user: AuthenticatedUser, jobRequestId: string, target: ImportTarget, url: string, audit: AuditContext, requestedBatchId?: string) {
    const { job } = await loadJobForUser(user, jobRequestId, "import:run");
    const recruitmentBatchId = await resolveRecruitmentBatchId(job.id, requestedBatchId);
    const spreadsheetId = extractSpreadsheetId(url);
    return createGoogleBatch(user, job.id, recruitmentBatchId, target, spreadsheetId, url, audit);
  },

  /**
   * Re-reads the sheet this job was last imported from, applies the previous
   * mapping and checks the file, so the PSM lands on the review step.
   */
  async refreshFromGoogle(user: AuthenticatedUser, jobRequestId: string, target: ImportTarget, audit: AuditContext, requestedBatchId?: string) {
    const { job } = await loadJobForUser(user, jobRequestId, "import:run");
    const recruitmentBatchId = await resolveRecruitmentBatchId(job.id, requestedBatchId);
    // The sheet linked now (the batch's own, else the job request's) wins over the one
    // last imported, so editing the job's sheet link takes effect on the next refresh.
    const linked = await linkedSheetUrl(job.id, recruitmentBatchId, target);
    const latest = linked ? null : await importsRepository.findLatestGoogleBatch(job.id, recruitmentBatchId, target);
    if (!linked && !latest?.sourceSpreadsheetId) {
      throw new ApiError(404, "NO_GOOGLE_SOURCE", "Add the sheet link on the job request, or import this job from a Google Sheets link first.");
    }
    const result = linked
      ? await createGoogleBatch(user, job.id, recruitmentBatchId, target, extractSpreadsheetId(linked), linked, audit)
      : await createGoogleBatch(user, job.id, recruitmentBatchId, target, latest!.sourceSpreadsheetId!, latest!.sourceUrl, audit);
    let checked = false;
    if (result.batch.mapping) {
      try {
        await importsService.validate(user, result.batch.id, result.batch.mapping, audit);
        checked = true;
      } catch {
        // The sheet's layout changed (e.g. a tab was renamed): the PSM re-maps it.
      }
    }
    return { batch: await importsService.get(user, result.batch.id), duplicateOf: result.duplicateOf, checked };
  },

  googleInfo() {
    return { serviceAccountEmail: getGoogleServiceAccountEmail() };
  },

  async get(user: AuthenticatedUser, batchId: string) {
    const { batch } = await loadBatch(user, batchId);
    const batchIssues = batch.status === "UPLOADED" ? [] : await importsRepository.batchIssues(batchId);
    return { ...batch, batchIssues };
  },

  async preview(user: AuthenticatedUser, batchId: string, query: PreviewQuery) {
    const { batch } = await loadBatch(user, batchId);
    const workbook = await openWorkbook(batch);
    const rows = workbook.top(query.sheet, query.limit);
    return {
      headerRow: detectHeaderRow(workbook.top(query.sheet, 10)),
      rows: rows.map(({ rowNumber, cells }) => ({ rowNumber, cells })),
    };
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
      let parsed: InternalMapping;
      if (batch.sourceType === "GOOGLE_SHEETS") {
        const selection = googleInternalSelectionSchema.parse(body);
        assertSelectedGoogleSheetsExist(selection, workbook);
        const inferred = inferGoogleMapping(workbook, "INTERNAL_SCREENING", selection);
        assertGoogleInternalMapping(inferred, selection);
        parsed = {
          ...internalMappingSchema.parse(inferred),
          acceptOtherJobIds: selection.acceptOtherJobIds,
          overwriteManualDecisions: selection.overwriteManualDecisions,
          productTabConfirmed: selection.productTabConfirmed ?? false,
        };
      } else {
        parsed = internalMappingSchema.parse(body);
      }
      const mapping = detectInternalHeaderRows(parsed, workbook);
      await validateInternal(batch.id, job, batch.recruitmentBatchId, mapping, workbook);
    } else {
      // Keep manual matches made during review unless the request replaces them.
      let parsed: CompanyMapping;
      if (batch.sourceType === "GOOGLE_SHEETS") {
        const selection = googleCompanySelectionSchema.parse(body);
        assertSelectedGoogleSheetsExist(selection, workbook);
        const inferred = inferGoogleMapping(workbook, "COMPANY_PIPELINE", selection);
        const tabs = inferred.tabs;
        const invalidTab = tabs.find((tab) => tab.columns.mobile === undefined);
        if (invalidTab) {
          throw new ApiError(422, "GOOGLE_SHEET_ANALYSIS_FAILED", `Could not identify a mobile-number column in the selected company tab “${invalidTab.sheet}”.`);
        }
        parsed = companyMappingSchema.parse(inferred);
      } else {
        parsed = companyMappingSchema.parse(body);
      }
      parsed = detectCompanyHeaderRows(parsed, workbook);
      const previous = (batch.mapping as { overrides?: Record<string, string> } | null)?.overrides ?? {};
      await validateCompany(batch.id, job, batch.recruitmentBatchId, { ...parsed, overrides: { ...previous, ...parsed.overrides } }, workbook);
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
      await validateCompany(batch.id, job, batch.recruitmentBatchId, { ...mapping, overrides }, await openWorkbook(batch));
      await recordAudit(prisma, audit, { action: "IMPORT_ROW_MATCHED", entityType: "ImportBatch", entityId: batch.id, metadata: { row: key, applicationId: input.applicationId } });
      return importsService.get(user, batch.id);
    }

    if (input.included && row.validationStatus === "INVALID") {
      throw new ApiError(400, "ROW_HAS_ERRORS", "Rows with errors cannot be included. Fix the sheet or the mapping and check again.");
    }
    await importsRepository.setRowApproval(row.id, Boolean(input.included));
    return importsService.get(user, batch.id);
  },

  async approve(user: AuthenticatedUser, batchId: string, notes: string | undefined, audit: AuditContext, recordApproval = true) {
    const { batch, job } = await loadBatch(user, batchId, true);
    assertEditable(batch);
    if (batch.status !== "VALIDATED") throw new ApiError(409, "IMPORT_NOT_VALIDATED", "Check the file before approving it.");
    const rows = await importsRepository.includedRows(batchId);
    if (rows.length === 0) throw new ApiError(400, "NOTHING_TO_IMPORT", "No rows are included.");

    // loadJobForUser already selected these IDs; avoid another database trip on approval.
    const jobSkills = batch.target === "COMPANY_PIPELINE" ? job.skills.map(({ skillId }) => skillId) : [];
    const counts = await inTransaction(async (transaction) => {
      const result = batch.target === "INTERNAL_SCREENING"
        ? await commitInternalImport(transaction, {
          batchId: batch.id,
          jobRequestId: job.id,
          recruitmentBatchId: batch.recruitmentBatchId,
          userId: user.id,
          mapping: internalMappingSchema.parse(batch.mapping),
          rows,
        })
        : await commitCompanyImport(transaction, {
          jobRequestId: job.id,
          recruitmentBatchId: batch.recruitmentBatchId,
          userId: user.id,
          rows,
          jobSkillIds: jobSkills,
          addJobSkills: companyMappingSchema.parse(batch.mapping).addJobSkills,
        });
      await transaction.importStagingRecord.updateMany({ where: { id: { in: rows.map(({ id }) => id) } }, data: { committedAt: new Date() } });
      await importsRepository.setStatus(transaction, batch.id, "COMMITTED", { committedAt: new Date() });
      // The batch shows the tabs it really imports: the ones the PSM confirmed here.
      const confirmedTabs = batch.target === "INTERNAL_SCREENING" && batch.sourceType === "GOOGLE_SHEETS" ? tabsFromMapping(batch.mapping) : null;
      if (confirmedTabs) {
        await transaction.recruitmentBatch.update({ where: { id: batch.recruitmentBatchId }, data: { internalTabs: confirmedTabs } });
      }
      if (recordApproval) {
        await transaction.importApproval.create({
          data: { batchId: batch.id, decision: "APPROVED", decidedById: user.id, counts: result as unknown as Prisma.InputJsonValue, ...(notes ? { notes } : {}) },
        });
      }
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

  async save(user: AuthenticatedUser, batchId: string, mapping: unknown, audit: AuditContext) {
    const { batch } = await loadBatch(user, batchId, true);
    if (batch.sourceType !== "GOOGLE_SHEETS" || batch.target !== "INTERNAL_SCREENING") {
      throw new ApiError(400, "DIRECT_SAVE_NOT_SUPPORTED", "Direct save is only available for internal Google Sheets shortlists.");
    }

    await importsService.validate(user, batchId, mapping, audit);
    return importsService.approve(user, batchId, undefined, audit, false);
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

  async delete(user: AuthenticatedUser, batchId: string, audit: AuditContext) {
    const { batch } = await loadBatch(user, batchId, true);
    if (batch.status === "COMMITTED") {
      throw new ApiError(
        409,
        "IMPORT_ROLLBACK_UNAVAILABLE",
        "This import has saved data and cannot be deleted safely. Delete the job request to remove its imported application and pipeline data.",
      );
    }

    await inTransaction(async (transaction) => {
      const current = await transaction.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } });
      if (!current) throw new ApiError(404, "IMPORT_NOT_FOUND", "The import was not found.");
      if (current.status === "COMMITTED") {
        throw new ApiError(
          409,
          "IMPORT_ROLLBACK_UNAVAILABLE",
          "This import has saved data and cannot be deleted safely. Delete the job request to remove its imported application and pipeline data.",
        );
      }
      await transaction.importApproval.deleteMany({ where: { batchId: batch.id } });
      await transaction.importBatch.delete({ where: { id: batch.id } });
      await recordAudit(transaction, audit, {
        action: "IMPORT_DELETED",
        entityType: "ImportBatch",
        entityId: batch.id,
        metadata: { batchCode: batch.batchCode, fileName: batch.sourceFileName, status: batch.status },
      });
    }, { timeoutMs: 30_000 });
    return { id: batch.id, batchCode: batch.batchCode };
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
