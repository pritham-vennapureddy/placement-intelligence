import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveJobProcessDates } from "./job-process-dates.js";
import { bulkProcessDatesSchema } from "./pipeline.validators.js";

const d = (value: string) => new Date(`${value}T00:00:00Z`);
const student = (pipelineStatus: string, start: string | null, end: string | null) => ({
  pipelineStatus, processStartDate: start ? d(start) : null, processEndDate: end ? d(end) : null,
});

test("the company process starts at the earliest student start and ends at the latest end once everyone shared has one", () => {
  assert.deepEqual(
    deriveJobProcessDates([student("REJECTED", "2026-10-03", "2026-10-08"), student("SELECTED", "2026-10-01", "2026-10-20"), student("NOT_SUBMITTED", null, null)]),
    { start: d("2026-10-01"), end: d("2026-10-20") },
  );
});

test("while a shared student has no end date the company process has no end", () => {
  assert.deepEqual(
    deriveJobProcessDates([student("REJECTED", "2026-10-03", "2026-10-08"), student("IN_PROCESS", "2026-10-03", null)]),
    { start: d("2026-10-03"), end: null },
  );
});

test("no students or no dates means no company process dates", () => {
  assert.deepEqual(deriveJobProcessDates([]), { start: null, end: null });
  assert.deepEqual(deriveJobProcessDates([student("NOT_SUBMITTED", null, null)]), { start: null, end: null });
});

test("bulk process dates need a date and a valid order", () => {
  const id = "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d";
  assert.equal(bulkProcessDatesSchema.safeParse({ nominationIds: [id] }).success, false);
  assert.equal(bulkProcessDatesSchema.safeParse({ nominationIds: [id], startDate: "2026-10-01" }).success, true);
  assert.equal(bulkProcessDatesSchema.safeParse({ nominationIds: [id], endDate: null }).success, true);
  assert.equal(bulkProcessDatesSchema.safeParse({ nominationIds: [id], startDate: "2026-10-09", endDate: "2026-10-01" }).success, false);
});
