import { prisma } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { logger } from "../../config/logger.js";
import type { AuditContext } from "../audit/audit.service.js";
import { importsService } from "../imports/imports.service.js";

/** The inactive user scheduled and "Sync all" imports are recorded as (seeded by migration). */
export const SHEET_SYNC_USER_ID = "00000000-0000-4000-8000-00000000a5c1";
const syncUser: AuthenticatedUser = { id: SHEET_SYNC_USER_ID, roles: ["ADMIN"] };

/** A run still marked RUNNING after this long died with the server; a new one may start. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export type SyncOutcome = "APPLIED" | "UNCHANGED" | "NEEDS_REVIEW" | "FAILED";
export interface SyncResult {
  jobRequestId: string;
  jobId: string;
  companyName: string;
  roleTitle: string;
  batchName: string;
  outcome: SyncOutcome;
  batchId?: string;
  batchCode?: string;
  reason?: string;
}

const runSelect = {
  id: true, trigger: true, status: true, startedAt: true, finishedAt: true, total: true, applied: true, unchanged: true,
  needsReview: true, failed: true, results: true, error: true, startedBy: { select: { fullName: true } },
} as const;

/**
 * Every open drive (active recruitment batch) that has a company Google Sheet:
 * linked on the batch or job request, or imported from Google before.
 */
async function drivesToSync() {
  return prisma.recruitmentBatch.findMany({
    where: {
      status: "ACTIVE",
      jobRequest: { archivedAt: null, status: { in: ["OPEN", "ON_HOLD", "FILLED"] } },
      OR: [
        { companySheetUrl: { not: null } },
        { jobRequest: { companySheetUrl: { not: null } } },
        { importBatches: { some: { target: "COMPANY_PIPELINE", sourceType: "GOOGLE_SHEETS", sourceSpreadsheetId: { not: null } } } },
      ],
    },
    select: { id: true, name: true, jobRequest: { select: { id: true, jobId: true, roleTitle: true, company: { select: { name: true } } } } },
    orderBy: [{ jobRequest: { requestDate: "desc" } }, { sequence: "asc" }],
  });
}

async function runSync(runId: string) {
  const audit: AuditContext = { actorId: SHEET_SYNC_USER_ID, requestId: `sheet-sync-${runId}`, ipAddress: null };
  const results: SyncResult[] = [];
  const counts = { applied: 0, unchanged: 0, needsReview: 0, failed: 0 };
  try {
    const drives = await drivesToSync();
    await prisma.sheetSyncRun.update({ where: { id: runId }, data: { total: drives.length } });
    for (const drive of drives) {
      const base = { jobRequestId: drive.jobRequest.id, jobId: drive.jobRequest.jobId, companyName: drive.jobRequest.company.name, roleTitle: drive.jobRequest.roleTitle, batchName: drive.name };
      let result: SyncResult;
      try {
        const outcome = await importsService.autoSyncCompanySheet(syncUser, drive.jobRequest.id, drive.id, audit);
        result = { ...base, ...outcome };
      } catch (error) {
        result = { ...base, outcome: "FAILED", reason: error instanceof Error ? error.message : "Could not read the sheet." };
      }
      results.push(result);
      if (result.outcome === "APPLIED") counts.applied++;
      else if (result.outcome === "UNCHANGED") counts.unchanged++;
      else if (result.outcome === "NEEDS_REVIEW") counts.needsReview++;
      else counts.failed++;
      // Saved after every drive so the page can show progress.
      await prisma.sheetSyncRun.update({ where: { id: runId }, data: { ...counts, results: results as unknown as Prisma.InputJsonValue } });
    }
    await prisma.sheetSyncRun.update({ where: { id: runId }, data: { status: "DONE", finishedAt: new Date() } });
    logger.info({ runId, ...counts }, "company sheet sync finished");
  } catch (error) {
    logger.error({ err: error, runId }, "company sheet sync failed");
    await prisma.sheetSyncRun.update({
      where: { id: runId },
      data: { status: "FAILED", finishedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
    }).catch(() => undefined);
  }
}

export const sheetSyncService = {
  /**
   * Starts a sync of every company sheet in the background and returns at once.
   * Only one run at a time: if one is going, that run is returned instead.
   */
  async start(trigger: "SCHEDULED" | "MANUAL", startedById: string | null) {
    const run = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sheet-sync-start'))`;
      await transaction.sheetSyncRun.updateMany({
        where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
        data: { status: "FAILED", finishedAt: new Date(), error: "Stopped before finishing (the server restarted)." },
      });
      const running = await transaction.sheetSyncRun.findFirst({ where: { status: "RUNNING" }, select: runSelect });
      if (running) return { run: running, alreadyRunning: true };
      const created = await transaction.sheetSyncRun.create({ data: { trigger, startedById }, select: runSelect });
      return { run: created, alreadyRunning: false };
    });
    if (!run.alreadyRunning) void runSync(run.run.id);
    return run;
  },

  /** The latest runs, newest first. */
  async list(limit = 10) {
    return prisma.sheetSyncRun.findMany({ select: runSelect, orderBy: { startedAt: "desc" }, take: limit });
  },
};
