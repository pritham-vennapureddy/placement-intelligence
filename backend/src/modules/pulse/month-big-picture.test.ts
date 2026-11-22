import assert from "node:assert/strict";
import { test } from "node:test";
import { companyAndOpeningCounts, jobProcessState, type MonthJob } from "./month-big-picture.js";

const job = (companyId: string, phase: string, openings: number, extra: Partial<MonthJob> = {}): MonthJob => ({
  jobRequestId: `${companyId}-${phase}-${openings}`, companyId, phase, openings, processStartDate: null, processEndDate: null, onList: true, running: true, ...extra,
});

test("a drive is yet to start until CVs reach the company, and ended once the process is done or has an end date", () => {
  assert.equal(jobProcessState(job("a", "YET_TO_SHARE_CVS", 1)), "YET_TO_START");
  assert.equal(jobProcessState(job("a", "YET_TO_SHARE_CVS", 1, { processStartDate: "2026-11-03" })), "STARTED");
  assert.equal(jobProcessState(job("a", "CVS_SHARED", 1)), "STARTED");
  assert.equal(jobProcessState(job("a", "ROUND_IN_PROGRESS", 1, { processEndDate: "2026-11-20" })), "ENDED");
  assert.equal(jobProcessState(job("a", "PROCESS_DONE_NOT_HIRED", 1)), "ENDED");
});

test("companies count once: running if any drive runs; openings split by drive", () => {
  const counts = companyAndOpeningCounts([
    job("tgh", "CVS_SHARED", 5),
    job("tgh", "PROCESS_DONE_HIRED", 2),
    job("pine", "YET_TO_SHARE_CVS", 10, { onList: true, running: false }),
    job("miracle", "PROCESS_DONE_NOT_HIRED", 3, { onList: false }),
  ]);
  assert.deepEqual(counts.companies, { total: 3, STARTED: 1, YET_TO_START: 1, ENDED: 1 });
  assert.deepEqual(counts.openings, { total: 20, STARTED: 5, YET_TO_START: 10, ENDED: 5 });
  assert.equal(counts.drives.total, 4);
  assert.equal(counts.onList, 2);
  assert.equal(counts.notOnList, 1);
});
