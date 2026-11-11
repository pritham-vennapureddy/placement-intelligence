import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { hasPermission } from "@placement/shared";
import { inTransaction, prisma } from "../../db.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { maskEmail, maskMobile } from "../../services/pii.js";
import { cleanText, isPlausibleMobile, normalizeKey, normalizeMobile } from "../../utils/normalize.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { detectHeaderRow, readWorkbook, type SheetRow, type Workbook } from "../imports/workbook.js";
import {
  COMPETENCY_TITLES,
  competencyHeaderInfo,
  competencyLevelForRow,
  groupRowsByMobile,
  isCompetencyPoolSheet,
  processTypeForSheet,
  rawRowData,
  sourceNameForRow,
} from "./assessed-pool-data.js";
import type { AssessedPoolLookupQuery, AssessedPoolMapping, ImportQuery, PreviewQuery } from "./assessed-pool.validators.js";

const MAX_BYTES = 20 * 1024 * 1024;
const POSITIVE_COMPETENCY_VALUES = new Set(["yes", "true", "1", "cleared", "clear", "eligible", "in competency pool"]);

function safeFileName(fileName: string): string {
  const name = path.win32.basename(fileName).trim().slice(0, 200);
  if (!name || !/\.(xlsx|csv)$/i.test(name)) {
    throw new ApiError(400, "INVALID_FILE_TYPE", "Upload an .xlsx or .csv file.");
  }
  return name;
}

function workbookFrom(bytes: Buffer, fileName: string): Promise<Workbook> {
  if (bytes.length === 0) throw new ApiError(400, "EMPTY_FILE", "Choose a non-empty spreadsheet file.");
  if (bytes.length > MAX_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "The spreadsheet must be 20 MB or smaller.");
  return readWorkbook(bytes, fileName);
}

function fileRows(workbook: Workbook, sheet: string) {
  const selectedSheet = workbook.sheets.find((item) => item.name === sheet);
  if (!selectedSheet) throw new ApiError(400, "SHEET_NOT_FOUND", "Choose a worksheet from the uploaded file.");
  const groupedHeader = isCompetencyPoolSheet(sheet) ? competencyHeaderInfo(workbook.top(sheet, 10)) : null;
  const headerRow = groupedHeader?.headerRow ?? detectHeaderRow(workbook.top(sheet, 10));
  const data = workbook.read(sheet, headerRow);
  return {
    ...data,
    headers: groupedHeader?.headers ?? data.headers,
    headerRow,
    columnCount: selectedSheet.columnCount,
  };
}

function cleanStatus(value: string | undefined): string | null {
  return cleanText(value, 120);
}

function mappedValue(row: SheetRow, index: number | undefined): string | undefined {
  return index === undefined ? undefined : row.cells[index];
}

function bucketLabel(value: string): string {
  const normalized = normalizeKey(value);
  const match = normalized.match(/(?:^| )([abc])$/);
  return match?.[1]?.toUpperCase() ?? cleanText(value, 80) ?? "";
}

function clearStatus(value: string | null): boolean {
  return value !== null && ["clear", "cleared"].includes(normalizeKey(value));
}

function competencyIncluded(value: string | null): boolean {
  return value !== null && POSITIVE_COMPETENCY_VALUES.has(normalizeKey(value));
}

function objectValue(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function sourceRows(sourceData: Prisma.JsonValue): Prisma.JsonValue[] {
  const root = objectValue(sourceData);
  if (!root) return [];
  return Object.values(root).flatMap((sheetValue) => {
    const sheet = objectValue(sheetValue);
    if (!sheet) return [];
    return Array.isArray(sheet.rows) ? sheet.rows : [sheetValue];
  });
}

function sourceFieldValue(sourceData: Prisma.JsonValue, headerPattern: RegExp): string | null {
  const values = sourceRows(sourceData).flatMap((value) => {
    const row = objectValue(value);
    if (!row || !Array.isArray(row.columns)) return [];
    const column = row.columns.find((item) => {
      const entry = objectValue(item);
      return typeof entry?.header === "string" && headerPattern.test(entry.header);
    });
    const entry = column ? objectValue(column) : null;
    return typeof entry?.value === "string" && entry.value.trim() ? [entry.value.trim()] : [];
  });
  return values.at(-1) ?? null;
}

function competencyAssessments(sourceData: Prisma.JsonValue) {
  const assessments = new Map<string, {
    code: string;
    title: string;
    score: number | null;
    verdictBand: string | null;
    clearanceStatus: string | null;
    level: string | null;
  }>();
  for (const value of sourceRows(sourceData)) {
    const row = objectValue(value);
    if (!row || !Array.isArray(row.competencies)) continue;
    for (const rawAssessment of row.competencies) {
      const assessment = objectValue(rawAssessment);
      if (typeof assessment?.code !== "string") continue;
      const previous = assessments.get(assessment.code);
      assessments.set(assessment.code, {
        code: assessment.code,
        title: typeof assessment.title === "string" ? assessment.title : previous?.title ?? assessment.code,
        score: typeof assessment.score === "number" ? assessment.score : previous?.score ?? null,
        verdictBand: typeof assessment.verdictBand === "string" ? assessment.verdictBand : previous?.verdictBand ?? null,
        clearanceStatus: typeof assessment.clearanceStatus === "string" ? assessment.clearanceStatus : previous?.clearanceStatus ?? null,
        level: typeof assessment.level === "string" ? assessment.level : previous?.level ?? null,
      });
    }
  }
  return [...assessments.values()];
}

function countValues(values: (string | null)[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function protectSourceData(value: Prisma.JsonValue, canReadPii: boolean): Prisma.JsonValue {
  if (canReadPii) return value;
  if (Array.isArray(value)) return value.map((item) => protectSourceData(item, false));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).flatMap(([key, inner]) => {
    if (inner === undefined) return [];
    if (key === "columns" && Array.isArray(inner)) {
      return [[key, inner.map((column) => {
        if (column === null || typeof column !== "object" || Array.isArray(column)) return protectSourceData(column, false);
        const header = typeof column.header === "string" ? column.header : "";
        if (typeof column.value !== "string") return protectSourceData(column, false);
        if (/e-?mail/i.test(header)) return { ...column, value: maskEmail(column.value.includes("@") ? column.value : null) ?? "" };
        if (/mobile|phone|contact(?: number)?|whatsapp|telephone/i.test(header)) {
          return { ...column, value: maskMobile(normalizeMobile(column.value)) ?? "" };
        }
        return protectSourceData(column, false);
      })]];
    }
    return [[key, protectSourceData(inner, false)]];
  });
  return Object.fromEntries(entries);
}

function writeRow(
  mobile: string,
  row: SheetRow,
  mapping: AssessedPoolMapping,
  sheet: string,
  headers: string[],
) {
  return {
    mobile,
    sourceUserId: mapping.sourceUserId === undefined ? null : cleanText(mappedValue(row, mapping.sourceUserId), 120),
    sourceName: sourceNameForRow(headers, row.cells),
    processType: processTypeForSheet(sheet),
    isCompetencyPoolMember: isCompetencyPoolSheet(sheet),
    competencyLevel: competencyLevelForRow(headers, row.cells, sheet, mapping.competencyLevel),
    category: "ACADEMY",
    bucketTier: mapping.bucketTier === undefined ? null : cleanText(mappedValue(row, mapping.bucketTier), 80)
      ? bucketLabel(mappedValue(row, mapping.bucketTier)!)
      : null,
    tr1Status: mapping.tr1Status === undefined ? null : cleanStatus(mappedValue(row, mapping.tr1Status)),
    tr2Status: mapping.tr2Status === undefined ? null : cleanStatus(mappedValue(row, mapping.tr2Status)),
    competencyStatus: mapping.competencyStatus === undefined ? null : cleanStatus(mappedValue(row, mapping.competencyStatus)),
    spReason: mapping.spReason === undefined ? null : cleanText(mappedValue(row, mapping.spReason), 500),
    sourceData: rawRowData(sheet, headers, row),
  };
}

export const assessedPoolService = {
  async preview(bytes: Buffer, query: PreviewQuery) {
    const fileName = safeFileName(query.fileName);
    const workbook = await workbookFrom(bytes, fileName);
    const sheet = query.sheet ?? workbook.sheets[0]?.name;
    if (!sheet) throw new ApiError(400, "WORKBOOK_EMPTY", "The workbook does not contain a readable worksheet.");
    const { headers, columnCount, rows, headerRow } = fileRows(workbook, sheet);
    const sampleRow = rows.find((row) => row.cells.some(Boolean));
    return {
      fileName,
      sheets: workbook.sheets,
      selectedSheet: sheet ?? null,
      headerRow,
      headers: Array.from({ length: columnCount }, (_, column) => ({
        column,
        header: headers[column] ?? "",
        sample: sampleRow?.cells[column] ?? "",
      })),
    };
  },

  async importFile(
    bytes: Buffer,
    query: ImportQuery,
    user: AuthenticatedUser,
    audit: AuditContext,
  ) {
    const fileName = safeFileName(query.fileName);
    const workbook = await workbookFrom(bytes, fileName);
    const sheet = query.sheet ?? workbook.sheets[0]?.name;
    if (!sheet) throw new ApiError(400, "WORKBOOK_EMPTY", "The workbook does not contain a readable worksheet.");
    const { headers, rows, columnCount } = fileRows(workbook, sheet);
    const mapping = query.mapping as AssessedPoolMapping;
    const mappedColumns = Object.entries(mapping).filter((entry): entry is [string, number] => typeof entry[1] === "number");
    for (const [field, index] of mappedColumns) {
      if (index >= columnCount) {
        throw new ApiError(400, "INVALID_COLUMN_MAPPING", `Choose a valid source column for ${field}.`);
      }
    }

    const hash = createHash("sha256").update(bytes).digest("hex");
    const parsed: { mobile: string; row: SheetRow }[] = [];
    let skippedMissingMobile = 0;
    let skippedInvalidMobile = 0;
    for (const row of rows) {
      const mobile = normalizeMobile(mappedValue(row, mapping.mobile));
      if (!mobile) {
        skippedMissingMobile += 1;
      } else if (!isPlausibleMobile(mobile)) {
        skippedInvalidMobile += 1;
      } else {
        parsed.push({ mobile, row });
      }
    }

    const { rowsByMobile, mergedDuplicateMobile } = groupRowsByMobile(parsed);
    const uniqueMobiles = [...rowsByMobile.keys()];
    const existingRecords = uniqueMobiles.length
      ? await prisma.assessedPoolRecord.findMany({
        where: { mobile: { in: uniqueMobiles } },
        select: { mobile: true },
      })
      : [];
    const existingMobiles = new Set(existingRecords.map(({ mobile }) => mobile));
    const skippedDuplicateMobile = 0;
    const skippedCount = skippedMissingMobile + skippedInvalidMobile;
    const writeRows = [...rowsByMobile].map(([mobile, duplicateRows]) => {
      const rowValues = duplicateRows.map((row) => writeRow(mobile, row, mapping, sheet, headers));
      const merged = rowValues.reduce((current, next) => ({
        ...current,
        sourceUserId: next.sourceUserId ?? current.sourceUserId,
        sourceName: next.sourceName ?? current.sourceName,
        competencyLevel: next.competencyLevel ?? current.competencyLevel,
        bucketTier: next.bucketTier ?? current.bucketTier,
        tr1Status: next.tr1Status ?? current.tr1Status,
        tr2Status: next.tr2Status ?? current.tr2Status,
        competencyStatus: next.competencyStatus ?? current.competencyStatus,
        spReason: next.spReason ?? current.spReason,
      }));
      const sourceRows = rowValues.flatMap((row) => {
        const source = row.sourceData[sheet];
        return source && typeof source === "object" && !Array.isArray(source) ? [source] : [];
      });
      return {
        ...merged,
        sourceData: { [sheet]: { rows: sourceRows } },
      };
    });
    const rawRows = rows.map((row) => ({
      rowNumber: row.rowNumber,
      mobile: normalizeMobile(mappedValue(row, mapping.mobile)),
      processType: processTypeForSheet(sheet),
      data: rawRowData(sheet, headers, row),
    }));

    const imported = await inTransaction(async (transaction) => {
      const createdImport = await transaction.assessedPoolImport.create({
        data: {
          sourceFileName: fileName,
          sourceSheet: sheet,
          rowCount: rows.length,
          importedCount: uniqueMobiles.filter((mobile) => !existingMobiles.has(mobile)).length,
          updatedCount: uniqueMobiles.filter((mobile) => existingMobiles.has(mobile)).length,
          skippedCount,
          mapping: mapping as Prisma.InputJsonValue,
          rawRows: rawRows as Prisma.InputJsonValue,
          importedById: user.id,
        },
      });
      const updateFields = [
        mapping.sourceUserId !== undefined
          ? Prisma.sql`"sourceUserId" = EXCLUDED."sourceUserId"`
          : Prisma.sql`"sourceUserId" = COALESCE(EXCLUDED."sourceUserId", "AssessedPoolRecord"."sourceUserId")`,
        Prisma.sql`"sourceName" = COALESCE(EXCLUDED."sourceName", "AssessedPoolRecord"."sourceName")`,
        Prisma.sql`"category" = 'ACADEMY'::"CandidateCategory"`,
        Prisma.sql`"isCompetencyPoolMember" = "AssessedPoolRecord"."isCompetencyPoolMember" OR EXCLUDED."isCompetencyPoolMember"`,
        Prisma.sql`"competencyLevel" = COALESCE(EXCLUDED."competencyLevel", "AssessedPoolRecord"."competencyLevel")`,
        mapping.bucketTier !== undefined
          ? Prisma.sql`"bucketTier" = EXCLUDED."bucketTier"`
          : Prisma.sql`"bucketTier" = COALESCE(EXCLUDED."bucketTier", "AssessedPoolRecord"."bucketTier")`,
        mapping.tr1Status !== undefined
          ? Prisma.sql`"tr1Status" = EXCLUDED."tr1Status"`
          : Prisma.sql`"tr1Status" = COALESCE(EXCLUDED."tr1Status", "AssessedPoolRecord"."tr1Status")`,
        mapping.tr2Status !== undefined
          ? Prisma.sql`"tr2Status" = EXCLUDED."tr2Status"`
          : Prisma.sql`"tr2Status" = COALESCE(EXCLUDED."tr2Status", "AssessedPoolRecord"."tr2Status")`,
        mapping.competencyStatus !== undefined
          ? Prisma.sql`"competencyStatus" = EXCLUDED."competencyStatus"`
          : Prisma.sql`"competencyStatus" = COALESCE(EXCLUDED."competencyStatus", "AssessedPoolRecord"."competencyStatus")`,
        mapping.spReason !== undefined
          ? Prisma.sql`"spReason" = EXCLUDED."spReason"`
          : Prisma.sql`"spReason" = COALESCE(EXCLUDED."spReason", "AssessedPoolRecord"."spReason")`,
        Prisma.sql`"processType" = CASE
          WHEN EXCLUDED."processType" = 'NEW' THEN 'NEW'::"AssessedProcessType"
          WHEN EXCLUDED."processType" = 'OLD' AND "AssessedPoolRecord"."processType" <> 'NEW' THEN 'OLD'::"AssessedProcessType"
          WHEN "AssessedPoolRecord"."processType" = 'UNKNOWN' THEN EXCLUDED."processType"
          ELSE "AssessedPoolRecord"."processType"
        END`,
        Prisma.sql`"sourceData" = COALESCE("AssessedPoolRecord"."sourceData", '{}'::jsonb) || EXCLUDED."sourceData"`,
        Prisma.sql`"sourceImportId" = EXCLUDED."sourceImportId"`,
        Prisma.sql`"updatedAt" = NOW()`,
      ];
      for (let offset = 0; offset < writeRows.length; offset += 500) {
        const values = writeRows.slice(offset, offset + 500).map((row) => Prisma.sql`(
          ${randomUUID()}::uuid,
          ${row.mobile},
          ${row.sourceUserId},
          ${row.sourceName},
          ${row.processType}::"AssessedProcessType",
          ${row.isCompetencyPoolMember},
          ${row.competencyLevel},
          ${row.category}::"CandidateCategory",
          ${row.bucketTier},
          ${row.tr1Status},
          ${row.tr2Status},
          ${row.competencyStatus},
          ${row.spReason},
          ${JSON.stringify(row.sourceData)}::jsonb,
          ${createdImport.id}::uuid,
          NOW()
        )`);
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "AssessedPoolRecord" (
            "id", "mobile", "sourceUserId", "sourceName", "processType", "isCompetencyPoolMember", "competencyLevel", "category",
            "bucketTier", "tr1Status", "tr2Status", "competencyStatus", "spReason", "sourceData",
            "sourceImportId", "updatedAt"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("mobile") DO UPDATE SET ${Prisma.join(updateFields)}
        `);
      }

      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOL_IMPORTED",
        entityType: "AssessedPoolImport",
        entityId: createdImport.id,
        metadata: {
          sourceFileName: fileName,
          sourceSheet: sheet,
          checksum: hash,
          rowCount: rows.length,
          importedCount: createdImport.importedCount,
          updatedCount: createdImport.updatedCount,
          skippedCount,
          skippedMissingMobile,
          skippedInvalidMobile,
          skippedDuplicateMobile,
          mergedDuplicateMobile,
        },
      });
      return createdImport;
    }, { timeoutMs: 60_000 });

    return {
      importId: imported.id,
      sourceFileName: fileName,
      rowCount: rows.length,
      importedCount: imported.importedCount,
      updatedCount: imported.updatedCount,
      skippedCount,
      skippedMissingMobile,
      skippedInvalidMobile,
      skippedDuplicateMobile,
      mergedDuplicateMobile,
    };
  },

  async lookup(user: AuthenticatedUser, query: AssessedPoolLookupQuery) {
    const search = query.search.trim();
    const digits = search.replace(/\D/g, "");
    const canReadPii = hasPermission(user.roles, "candidate:pii:read");
    const records = await prisma.assessedPoolRecord.findMany({
      where: {
        OR: [
          { sourceName: { contains: search, mode: "insensitive" } },
          { sourceUserId: { contains: search, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ mobile: { contains: digits } }] : []),
        ],
      },
      take: 100,
      orderBy: [{ sourceName: "asc" }, { mobile: "asc" }],
      select: {
        id: true,
        mobile: true,
        sourceUserId: true,
        sourceName: true,
        processType: true,
        isCompetencyPoolMember: true,
        competencyLevel: true,
        bucketTier: true,
        tr1Status: true,
        tr2Status: true,
        competencyStatus: true,
        spReason: true,
        sourceData: true,
      },
    });

    return {
      results: records.map((record) => ({
      status: "ASSESSED" as const,
      id: record.id,
      userId: record.sourceUserId,
      name: record.sourceName,
      mobile: canReadPii ? record.mobile : maskMobile(record.mobile),
      processType: record.processType,
      category: "ACADEMY" as const,
      bucketTier: record.bucketTier,
      tr1Status: record.tr1Status,
      tr2Status: record.tr2Status,
      isCompetencyPoolMember: record.isCompetencyPoolMember || competencyIncluded(record.competencyStatus),
      competencyLevel: record.competencyLevel,
      competencyStatus: record.competencyStatus,
      spReason: record.spReason,
      sourceData: protectSourceData(record.sourceData, canReadPii),
      })),
      limit: 100,
    };
  },

  async analytics() {
    const [records, latestImport, total] = await Promise.all([
      prisma.assessedPoolRecord.findMany({
        select: {
          processType: true,
          isCompetencyPoolMember: true,
          competencyLevel: true,
          bucketTier: true,
          tr1Status: true,
          tr2Status: true,
          competencyStatus: true,
          spReason: true,
          sourceData: true,
        },
      }),
      prisma.assessedPoolImport.findFirst({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          sourceFileName: true,
          sourceSheet: true,
          rowCount: true,
          importedCount: true,
          updatedCount: true,
          skippedCount: true,
          mapping: true,
          createdAt: true,
          importedBy: { select: { fullName: true } },
        },
      }),
      prisma.assessedPoolRecord.count(),
    ]);

    const buckets: Record<"A" | "B" | "C", number> = { A: 0, B: 0, C: 0 };
    let otherBucketTiers = 0;
    let tr1Cleared = 0;
    let tr2Cleared = 0;
    let competencyIncludedCount = 0;
    const processTypes: Record<"OLD" | "NEW" | "UNKNOWN", number> = { OLD: 0, NEW: 0, UNKNOWN: 0 };
    const competencyTotals = new Map(Object.entries(COMPETENCY_TITLES).map(([code, title]) => [
      code,
      { code, title, assessedCount: 0, scoredCount: 0, scoreTotal: 0, verdictValues: [] as (string | null)[], clearanceValues: [] as (string | null)[], levelValues: [] as (string | null)[] },
    ]));

    for (const record of records) {
      processTypes[record.processType] += 1;
      const tier = record.bucketTier ? normalizeKey(record.bucketTier).toUpperCase() : "";
      if (tier === "A" || tier === "B" || tier === "C") buckets[tier] += 1;
      else if (record.bucketTier) otherBucketTiers += 1;
      if (clearStatus(record.tr1Status)) tr1Cleared += 1;
      if (clearStatus(record.tr2Status)) tr2Cleared += 1;
      if (record.isCompetencyPoolMember || competencyIncluded(record.competencyStatus)) competencyIncludedCount += 1;
      for (const assessment of competencyAssessments(record.sourceData)) {
        const totals = competencyTotals.get(assessment.code);
        if (!totals) continue;
        if (assessment.score !== null || assessment.verdictBand || assessment.clearanceStatus || assessment.level) {
          totals.assessedCount += 1;
        }
        if (assessment.score !== null) {
          totals.scoredCount += 1;
          totals.scoreTotal += assessment.score;
        }
        totals.verdictValues.push(assessment.verdictBand);
        totals.clearanceValues.push(assessment.clearanceStatus);
        totals.levelValues.push(assessment.level);
      }
    }

    const tr1StatusCounts = countValues(records.map(({ tr1Status }) => tr1Status));
    const tr2StatusCounts = countValues(records.map(({ tr2Status }) => tr2Status));
    const reasonCounts = countValues(records.map(({ spReason }) => spReason)).slice(0, 20);
    const roleRankCheckCounts = countValues(records.map(({ sourceData }) => sourceFieldValue(sourceData, /role\s*rank\s*checks/i)));
    const finalPoolCheckCounts = countValues(records.map(({ sourceData }) => sourceFieldValue(sourceData, /final\s*pool\s*checks/i)));
    const competencyStatusCounts = countValues(records.map(({ competencyStatus }) => competencyStatus));
    const competencyPoolMemberCount = records.filter(({ isCompetencyPoolMember }) => isCompetencyPoolMember).length;
    if (competencyPoolMemberCount > 0) competencyStatusCounts.unshift({ value: "In Competency Pool", count: competencyPoolMemberCount });
    const competencyLevelCounts = countValues(records.map(({ competencyLevel }) => competencyLevel));
    const mappedFields = latestImport?.mapping && typeof latestImport.mapping === "object" && !Array.isArray(latestImport.mapping)
      ? Object.keys(latestImport.mapping)
      : [];

    return {
      total,
      processTypes,
      academyCandidates: total,
      buckets: { ...buckets, other: otherBucketTiers },
      tr: {
        tr1Cleared,
        tr2Cleared,
        bothCleared: records.filter(({ tr1Status, tr2Status }) => clearStatus(tr1Status) && clearStatus(tr2Status)).length,
        tr1StatusCounts,
        tr2StatusCounts,
      },
      competency: {
        included: competencyIncludedCount,
        statusCounts: competencyStatusCounts,
        levelCounts: competencyLevelCounts,
      },
      competencies: [...competencyTotals.values()].map(({ scoreTotal, verdictValues, clearanceValues, levelValues, ...totals }) => ({
        ...totals,
        averageScore: totals.scoredCount > 0 ? Math.round((scoreTotal / totals.scoredCount) * 10) / 10 : null,
        verdictCounts: countValues(verdictValues),
        clearanceCounts: countValues(clearanceValues),
        levelCounts: countValues(levelValues),
      })),
      spReasons: reasonCounts,
      spChecks: {
        roleRankCounts: roleRankCheckCounts,
        finalPoolCounts: finalPoolCheckCounts,
      },
      availableFields: {
        bucketTier: records.some(({ bucketTier }) => Boolean(bucketTier)),
        tr1Status: records.some(({ tr1Status }) => Boolean(tr1Status)),
        tr2Status: records.some(({ tr2Status }) => Boolean(tr2Status)),
        competencyStatus: records.some(({ competencyStatus }) => Boolean(competencyStatus)),
        competencyLevel: records.some(({ competencyLevel }) => Boolean(competencyLevel)),
        spReason: records.some(({ spReason }) => Boolean(spReason)),
        roleRankCheck: roleRankCheckCounts.length > 0,
        finalPoolCheck: finalPoolCheckCounts.length > 0,
      },
      latestImport: latestImport ? {
        id: latestImport.id,
        sourceFileName: latestImport.sourceFileName,
        sourceSheet: latestImport.sourceSheet,
        rowCount: latestImport.rowCount,
        importedCount: latestImport.importedCount,
        updatedCount: latestImport.updatedCount,
        skippedCount: latestImport.skippedCount,
        mappedFields,
        createdAt: latestImport.createdAt,
        importedBy: latestImport.importedBy.fullName,
      } : null,
    };
  },

  /** Removes one upload and the pool records it last wrote. Records a later upload changed are not affected. */
  async deleteImport(importId: string, audit: AuditContext) {
    const existing = await prisma.assessedPoolImport.findUnique({
      where: { id: importId },
      select: { id: true, sourceFileName: true, sourceSheet: true },
    });
    if (!existing) throw new ApiError(404, "ASSESSED_POOL_IMPORT_NOT_FOUND", "The assessed-pool upload was not found.");

    return inTransaction(async (transaction) => {
      const removed = await transaction.assessedPoolRecord.deleteMany({ where: { sourceImportId: importId } });
      await transaction.assessedPoolImport.delete({ where: { id: importId } });
      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOL_IMPORT_DELETED",
        entityType: "AssessedPoolImport",
        entityId: importId,
        metadata: { sourceFileName: existing.sourceFileName, sourceSheet: existing.sourceSheet, removedRecords: removed.count },
      });
      return { removedRecords: removed.count };
    });
  },

  /** Removes assessed-pool records and import history while keeping the standalone sheet connection. */
  async clearAll(audit: AuditContext) {
    return inTransaction(async (transaction) => {
      const removedRecords = await transaction.assessedPoolRecord.deleteMany({});
      const removedImports = await transaction.assessedPoolImport.deleteMany({});
      await recordAudit(transaction, audit, {
        action: "ASSESSED_POOL_CLEARED",
        entityType: "AssessedPoolRecord",
        entityId: "all",
        metadata: { removedRecords: removedRecords.count, removedImports: removedImports.count },
      });
      return { removedRecords: removedRecords.count, removedImports: removedImports.count };
    });
  },
};
