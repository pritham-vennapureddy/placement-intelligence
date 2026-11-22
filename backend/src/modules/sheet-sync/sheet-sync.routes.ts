import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { ApiError } from "../../utils/api-error.js";
import { sendData } from "../../utils/http.js";
import { sheetSyncService } from "./sheet-sync.service.js";

/** Constant-time check of the scheduler's secret. */
export function secretMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Mounted under /api/sheet-sync: sync every company Google Sheet. */
export const sheetSyncRouter = Router();

/**
 * Called by the schedule (GitHub Actions) with the shared secret in
 * `x-sheet-sync-secret`. Starts a run and returns at once.
 */
sheetSyncRouter.post(
  "/scheduled",
  rateLimit({ windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false }),
  async (request: Request, response: Response) => {
    if (!env.SHEET_SYNC_SECRET) throw new ApiError(503, "SYNC_NOT_CONFIGURED", "The scheduled sheet sync is not set up on this server.");
    if (!secretMatches(request.get("x-sheet-sync-secret"), env.SHEET_SYNC_SECRET)) throw new ApiError(401, "INVALID_SYNC_SECRET", "Wrong or missing sync secret.");
    const { run, alreadyRunning } = await sheetSyncService.start("SCHEDULED", null);
    sendData(response, { runId: run.id, alreadyRunning }, 202);
  },
);

sheetSyncRouter.get("/runs", authenticate, requirePermission("job:read"), async (_request: Request, response: Response) => {
  sendData(response, { runs: await sheetSyncService.list() });
});

/** The "Sync all company sheets" button. */
sheetSyncRouter.post("/run", authenticate, requirePermission("import:run"), async (request: Request, response: Response) => {
  const { run, alreadyRunning } = await sheetSyncService.start("MANUAL", request.user!.id);
  sendData(response, { run, alreadyRunning }, 202);
});
