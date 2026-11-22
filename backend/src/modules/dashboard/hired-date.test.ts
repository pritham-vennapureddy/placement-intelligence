import assert from "node:assert/strict";
import { test } from "node:test";
import { hiredDateOf, processEndOf } from "./dashboard.repository.js";

const d = (value: string) => new Date(value);

test("the hired date prefers the student's end date, then the last round, then the job's end", () => {
  assert.deepEqual(hiredDateOf(d("2026-10-04T00:00:00Z"), d("2026-10-09T10:30:00Z"), d("2026-10-20T00:00:00Z")), { on: d("2026-10-04T00:00:00Z"), source: "STUDENT" });
  assert.deepEqual(hiredDateOf(null, d("2026-10-09T10:30:00Z"), d("2026-10-20T00:00:00Z")), { on: d("2026-10-09T00:00:00Z"), source: "ROUND" });
  assert.deepEqual(hiredDateOf(null, null, d("2026-10-20T00:00:00Z")), { on: d("2026-10-20T00:00:00Z"), source: "JOB" });
  assert.equal(hiredDateOf(null, null, null), null);
});

test("a job's process end is the entered end date, else the done date, else a filled/closed job's last change", () => {
  const base = { companyProcessEndDate: null, processPhase: "COMPANY_ROUNDS", processPhaseAt: d("2026-10-02T08:00:00Z"), status: "OPEN", updatedAt: d("2026-10-30T08:00:00Z") };
  assert.deepEqual(processEndOf({ ...base, companyProcessEndDate: d("2026-10-15T00:00:00Z") }), d("2026-10-15T00:00:00Z"));
  assert.deepEqual(processEndOf({ ...base, processPhase: "PROCESS_DONE_NOT_HIRED" }), d("2026-10-02T00:00:00Z"));
  assert.deepEqual(processEndOf({ ...base, status: "FILLED" }), d("2026-10-30T00:00:00Z"));
  assert.equal(processEndOf(base), null);
});
