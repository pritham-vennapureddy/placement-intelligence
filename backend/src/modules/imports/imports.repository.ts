import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../db.js";
import { Prisma, type ImportTarget } from "../../generated/prisma/client.js";
import type { PlanIssue, StagedRow } from "./internal-plan.js";

const CHUNK = 500;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export const batchSummarySelect = {
  id: true,
  batchCode: true,
  target: true,
  sourceType: true,
  status: true,
  jobRequestId: true,
  recruitmentBatchId: true,
  sourceFileName: true,
  sourceSpreadsheetId: true,
  sourceUrl: true,
  snapshotSize: true,
  sheets: true,
  mapping: true,
  summary: true,
  createdAt: true,
  committedAt: true,
  importedBy: { select: { id: true, fullName: true } },
  jobRequest: { select: { id: true, jobId: true, roleTitle: true, company: { select: { id: true, name: true } } } },
  recruitmentBatch: { select: { id: true, name: true, sequence: true } },
} satisfies Prisma.ImportBatchSelect;

export const importsRepository = {
  createBatch(data: {
    target: ImportTarget;
    sourceType: "EXCEL" | "CSV" | "GOOGLE_SHEETS";
    sourceSpreadsheetId?: string | null;
    sourceUrl?: string | null;
    jobRequestId: string;
    recruitmentBatchId: string;
    sourceFileName: string;
    sourceChecksum: string;
    snapshotSize: number;
    sourceSnapshot: Prisma.InputJsonValue;
    sheets: Prisma.InputJsonValue;
    importedById: string;
    mapping: Prisma.InputJsonValue | null;
  }) {
    const batchCode = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const { mapping, ...rest } = data;
    return prisma.importBatch.create({
      data: {
        ...rest,
        batchCode,
        ...(mapping ? { mapping } : {}),
      },
      select: batchSummarySelect,
    });
  },

  findBatch(id: string) {
    return prisma.importBatch.findUnique({ where: { id }, select: batchSummarySelect });
  },

  findSnapshot(batchId: string) {
    return prisma.importBatch.findUnique({ where: { id: batchId }, select: { sourceSnapshot: true } });
  },

  /** Most recent committed mapping for this job and target, to pre-fill the wizard. */
  findPreviousMapping(jobRequestId: string, recruitmentBatchId: string, target: ImportTarget) {
    return prisma.importBatch.findFirst({
      where: { jobRequestId, recruitmentBatchId, target, status: "COMMITTED", NOT: { mapping: { equals: Prisma.AnyNull } } },
      select: { mapping: true, sourceFileName: true, committedAt: true },
      orderBy: { committedAt: "desc" },
    });
  },

  /** The latest approved mapping of each other batch of this job, to tell which tabs they use. */
  async otherBatchMappings(jobRequestId: string, recruitmentBatchId: string, target: ImportTarget) {
    const batches = await prisma.importBatch.findMany({
      where: { jobRequestId, target, status: "COMMITTED", recruitmentBatchId: { not: recruitmentBatchId }, NOT: { mapping: { equals: Prisma.AnyNull } } },
      select: { recruitmentBatchId: true, mapping: true },
      orderBy: { committedAt: "desc" },
    });
    const latest = new Map<string, Prisma.JsonValue>();
    for (const batch of batches) if (!latest.has(batch.recruitmentBatchId)) latest.set(batch.recruitmentBatchId, batch.mapping);
    return [...latest.values()];
  },

  /** Recruitment batch id → its latest approved mapping, for every batch of this job. */
  async latestMappingByBatch(jobRequestId: string, target: ImportTarget) {
    const batches = await prisma.importBatch.findMany({
      where: { jobRequestId, target, status: "COMMITTED", NOT: { mapping: { equals: Prisma.AnyNull } } },
      select: { recruitmentBatchId: true, mapping: true },
      orderBy: { committedAt: "desc" },
    });
    const latest = new Map<string, Prisma.JsonValue>();
    for (const batch of batches) if (!latest.has(batch.recruitmentBatchId)) latest.set(batch.recruitmentBatchId, batch.mapping);
    return latest;
  },

  /**
   * The Google Sheet to refresh this batch from: its own latest Google import,
   * else the job's (later batches usually live in the same sheet as new tabs).
   */
  async findLatestGoogleBatch(jobRequestId: string, recruitmentBatchId: string, target: ImportTarget) {
    const where = { jobRequestId, target, sourceType: "GOOGLE_SHEETS" as const, sourceSpreadsheetId: { not: null } };
    const select = { sourceSpreadsheetId: true, sourceUrl: true };
    return await prisma.importBatch.findFirst({ where: { ...where, recruitmentBatchId }, select, orderBy: { createdAt: "desc" } })
      ?? prisma.importBatch.findFirst({ where, select, orderBy: { createdAt: "desc" } });
  },

  findDuplicateUpload(jobRequestId: string, recruitmentBatchId: string, checksum: string) {
    return prisma.importBatch.findFirst({
      where: { jobRequestId, recruitmentBatchId, sourceChecksum: checksum, status: "COMMITTED" },
      select: { batchCode: true, committedAt: true },
    });
  },

  listForJob(jobRequestId: string) {
    return prisma.importBatch.findMany({ where: { jobRequestId }, select: batchSummarySelect, orderBy: { createdAt: "desc" }, take: 100 });
  },

  list(where: Prisma.ImportBatchWhereInput, page: { skip: number; take: number }) {
    return Promise.all([
      prisma.importBatch.findMany({ where, select: batchSummarySelect, orderBy: { createdAt: "desc" }, ...page }),
      prisma.importBatch.count({ where }),
    ]);
  },

  setStatus(db: Db, id: string, status: "UPLOADED" | "VALIDATED" | "COMMITTED" | "CANCELLED", extra: Prisma.ImportBatchUpdateInput = {}) {
    return db.importBatch.update({ where: { id }, data: { status, ...extra } });
  },

  /** Replaces the batch's staged rows and issues with a fresh validation result. */
  async saveValidation(
    batchId: string,
    mapping: Prisma.InputJsonValue,
    summary: Prisma.InputJsonValue,
    rows: StagedRow<unknown>[],
    batchIssues: PlanIssue[],
  ) {
    const sheetKeys = new Map<string, { id: string; role: string; worksheetName: string; headerRow: number }>();
    for (const row of rows) {
      const key = `${row.role}|${row.sheet}`;
      if (!sheetKeys.has(key)) sheetKeys.set(key, { id: randomUUID(), role: row.role, worksheetName: row.sheet, headerRow: row.headerRow });
    }
    const staged = rows.map((row) => ({
      id: randomUUID(),
      batchId,
      sheetMappingId: sheetKeys.get(`${row.role}|${row.sheet}`)!.id,
      sourceRowNumber: row.rowNumber,
      sourceRowRef: row.rowRef,
      rawData: row.raw as Prisma.InputJsonValue,
      normalizedData: row.data as Prisma.InputJsonValue,
      validationStatus: row.issues.some((issue) => issue.severity === "ERROR")
        ? ("INVALID" as const)
        : row.issues.some((issue) => issue.severity === "WARNING") ? ("WARNING" as const) : ("VALID" as const),
      approvalStatus: row.included ? ("INCLUDED" as const) : ("EXCLUDED" as const),
      action: row.action,
    }));
    const issues = [
      ...batchIssues.map((issue) => ({ batchId, stagingRecordId: null, ...issue })),
      ...rows.flatMap((row, index) => row.issues.map((issue) => ({ batchId, stagingRecordId: staged[index]!.id, ...issue }))),
    ];

    await prisma.$transaction(async (transaction) => {
      await transaction.importSheetMapping.deleteMany({ where: { batchId } });
      await transaction.dataQualityIssue.deleteMany({ where: { batchId } });
      await transaction.importSheetMapping.createMany({
        data: [...sheetKeys.values()].map((sheet) => ({ ...sheet, batchId, columnMapping: {} })),
      });
      for (const part of chunks(staged)) await transaction.importStagingRecord.createMany({ data: part });
      for (const part of chunks(issues)) await transaction.dataQualityIssue.createMany({ data: part });
      await transaction.importBatch.update({ where: { id: batchId }, data: { status: "VALIDATED", mapping, summary } });
    }, { timeout: 120_000, maxWait: 10_000 });
  },

  async listRows(batchId: string, where: Prisma.ImportStagingRecordWhereInput, page: { skip: number; take: number }) {
    const filter = { batchId, ...where };
    const [rows, total] = await Promise.all([
      prisma.importStagingRecord.findMany({
        where: filter,
        select: {
          id: true,
          sourceRowNumber: true,
          sourceRowRef: true,
          rawData: true,
          normalizedData: true,
          validationStatus: true,
          approvalStatus: true,
          action: true,
          committedAt: true,
          sheetMapping: { select: { role: true, worksheetName: true } },
          issues: { select: { severity: true, code: true, message: true } },
        },
        orderBy: [{ sheetMapping: { role: "asc" } }, { sourceRowNumber: "asc" }],
        ...page,
      }),
      prisma.importStagingRecord.count({ where: filter }),
    ]);
    return { rows, total };
  },

  batchIssues(batchId: string) {
    return prisma.dataQualityIssue.findMany({
      where: { batchId, stagingRecordId: null },
      select: { severity: true, code: true, message: true },
    });
  },

  findRow(batchId: string, rowId: string) {
    return prisma.importStagingRecord.findFirst({
      where: { id: rowId, batchId },
      select: { id: true, validationStatus: true, approvalStatus: true, sourceRowNumber: true, sheetMapping: { select: { worksheetName: true, role: true } } },
    });
  },

  setRowApproval(rowId: string, included: boolean) {
    return prisma.importStagingRecord.update({ where: { id: rowId }, data: { approvalStatus: included ? "INCLUDED" : "EXCLUDED" } });
  },

  includedRows(batchId: string) {
    return prisma.importStagingRecord.findMany({
      where: { batchId, approvalStatus: "INCLUDED", validationStatus: { not: "INVALID" }, committedAt: null },
      select: { id: true, normalizedData: true, action: true, sheetMapping: { select: { role: true } } },
    });
  },
};
