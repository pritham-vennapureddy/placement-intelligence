import assert from "node:assert/strict";
import { test } from "node:test";
import { companyProcessLabel } from "@placement/shared";
import { insightsQuerySchema, studentInsightsQuerySchema } from "../insights/insights.validators.js";
import { shareStatusOf } from "./tracking.service.js";
import { guidanceSessionSchema, processStatusSchema } from "./tracking.validators.js";

const sp = (outcome: string) => [{ outcome, stage: { stage: "FINAL_SHORTLIST" } }];

test("with the company sheet imported, an SP student missing from it is not shared", () => {
  const status = (stageOutcomes: { outcome: string; stage: { stage: string } }[], nomination: { status: string; pipelineStatus: string } | null) =>
    shareStatusOf({ stageOutcomes, nomination, companySheetPending: false });
  assert.equal(status(sp("SELECTED"), null), "NOT_SHARED");
  assert.equal(status(sp("SELECTED"), { status: "WITHDRAWN", pipelineStatus: "IN_PROCESS" }), "NOT_SHARED");
  assert.equal(status(sp("SELECTED"), { status: "NOMINATED", pipelineStatus: "NOT_SUBMITTED" }), "NOT_SHARED");
  assert.equal(status(sp("SELECTED"), { status: "NOMINATED", pipelineStatus: "IN_PROCESS" }), "SHARED");
  // Nominated without SP selection (any non-rejected applicant may be nominated) still counts as shared once sent.
  assert.equal(status([], { status: "NOMINATED", pipelineStatus: "SELECTED" }), "SHARED");
  assert.equal(status(sp("REJECTED"), null), "NOT_SHORTLISTED");
});

test("past Yet to share CVs with the company sheet pending, SP students count as shared", () => {
  const status = (stageOutcomes: { outcome: string; stage: { stage: string } }[], nomination: { status: string; pipelineStatus: string } | null) =>
    shareStatusOf({ stageOutcomes, nomination, companySheetPending: true });
  assert.equal(status(sp("SELECTED"), null), "SHARED");
  assert.equal(status(sp("SELECTED"), { status: "NOMINATED", pipelineStatus: "NOT_SUBMITTED" }), "SHARED");
  // A withdrawn nomination is an explicit decision not to share.
  assert.equal(status(sp("SELECTED"), { status: "WITHDRAWN", pipelineStatus: "NOT_SUBMITTED" }), "NOT_SHARED");
  assert.equal(status(sp("REJECTED"), null), "NOT_SHORTLISTED");
});

test("round phases of the company process need a round", () => {
  const roundId = "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d";
  assert.equal(processStatusSchema.safeParse({ phase: "CVS_SHARED" }).success, true);
  assert.equal(processStatusSchema.safeParse({ phase: "ROUND_IN_PROGRESS" }).success, false);
  assert.equal(processStatusSchema.safeParse({ phase: "ROUND_YET_TO_START", roundId }).success, true);
  assert.equal(processStatusSchema.safeParse({ phase: "SOMETHING_ELSE" }).success, false);
});

test("company process labels name the round", () => {
  assert.equal(companyProcessLabel("ROUND_YET_TO_START", "TR1"), "Yet to start TR1");
  assert.equal(companyProcessLabel("ROUND_IN_PROGRESS", "TR2"), "TR2 in progress");
  assert.equal(companyProcessLabel("CVS_SHARED"), "CV provided");
  assert.equal(companyProcessLabel("PROCESS_DONE_NOT_HIRED"), "Process done – not hired");
  assert.equal(companyProcessLabel("ROUND_IN_PROGRESS", null), "Round in progress");
});

test("guidance cannot be dated in the future", () => {
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(guidanceSessionSchema.safeParse({ givenOn: tomorrow }).success, false);
  assert.equal(guidanceSessionSchema.safeParse({ givenOn: "2026-11-01" }).success, true);
});

test("insight filters take months in order", () => {
  assert.equal(insightsQuerySchema.safeParse({ from: "2026-09", to: "2026-11", category: "ACADEMY" }).success, true);
  assert.equal(insightsQuerySchema.safeParse({ from: "2026-11", to: "2026-09" }).success, false);
  assert.equal(insightsQuerySchema.safeParse({ from: "2026-13" }).success, false);
  assert.deepEqual(studentInsightsQuerySchema.parse({ status: "NOT_SHARED" }).page, 1);
});

test("guidance / RSA: each status's own rules decide what is required", async () => {
  const { checkStatusRules } = await import("./support-status.service.js");
  const done = { label: "Done", needsContributor: true, needsNote: false };
  const other = { label: "Other", needsContributor: false, needsNote: true };
  const person = "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d";
  assert.throws(() => checkStatusRules(done, { contributorIds: [] }), /needs who contributed/);
  assert.doesNotThrow(() => checkStatusRules(done, { contributorIds: [person] }));
  assert.doesNotThrow(() => checkStatusRules(done, { contributorIds: [], otherContributors: "Ravi (trainer)" }));
  assert.throws(() => checkStatusRules(other, { contributorIds: [] }), /needs a note/);
  assert.doesNotThrow(() => checkStatusRules(other, { contributorIds: [], notes: "Company cancelled the round" }));
});

test("guidance / RSA inputs and status-list edits are validated", async () => {
  const { studentSupportSchema, bulkStudentSupportSchema, createStatusOptionSchema, updateStatusOptionSchema } = await import("./tracking.validators.js");
  const id = "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d";
  assert.equal(studentSupportSchema.safeParse({ statusId: id }).success, true);
  assert.equal(studentSupportSchema.safeParse({ statusId: "DONE" }).success, false);
  assert.equal(studentSupportSchema.safeParse({ statusId: id, doneOn: "2999-01-01" }).success, false);
  assert.equal(bulkStudentSupportSchema.safeParse({ kind: "RSA", statusId: id, applicationIds: [] }).success, false);
  assert.equal(bulkStudentSupportSchema.safeParse({ kind: "RSA", statusId: id, applicationIds: [id] }).success, true);
  assert.deepEqual(createStatusOptionSchema.parse({ kind: "RSA", label: " Analysis shared " }), {
    kind: "RSA", label: "Analysis shared", tone: "slate", countsAsDone: false, needsContributor: false, needsNote: false,
  });
  assert.equal(createStatusOptionSchema.safeParse({ kind: "RSA", label: "" }).success, false);
  assert.equal(createStatusOptionSchema.safeParse({ kind: "RSA", label: "X", tone: "neon" }).success, false);
  assert.equal(updateStatusOptionSchema.safeParse({}).success, false);
  assert.equal(updateStatusOptionSchema.safeParse({ restore: true }).success, true);
});
