import { request } from "./api";

export type SyncOutcome = "APPLIED" | "UNCHANGED" | "NEEDS_REVIEW" | "FAILED";

export interface SheetSyncRun {
  id: string;
  trigger: "SCHEDULED" | "MANUAL";
  status: "RUNNING" | "DONE" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  total: number;
  applied: number;
  unchanged: number;
  needsReview: number;
  failed: number;
  error: string | null;
  startedBy: { fullName: string } | null;
  results: {
    jobRequestId: string; jobId: string; companyName: string; roleTitle: string; batchName: string;
    outcome: SyncOutcome; batchId?: string; batchCode?: string; reason?: string;
  }[];
}

/** Sync every company Google Sheet (also runs on a schedule). */
export const sheetSyncApi = {
  async runs(): Promise<SheetSyncRun[]> {
    return (await request<{ data: { runs: SheetSyncRun[] } }>("/sheet-sync/runs")).data.runs;
  },
  async start(): Promise<{ run: SheetSyncRun; alreadyRunning: boolean }> {
    return (await request<{ data: { run: SheetSyncRun; alreadyRunning: boolean } }>("/sheet-sync/run", { method: "POST" })).data;
  },
};
