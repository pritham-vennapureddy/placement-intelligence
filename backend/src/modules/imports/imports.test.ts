import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canMovePipeline,
  suggestInterviewOutcome,
  suggestPipelineStatus,
  suggestStageOutcome,
} from "@placement/shared";
import { normalizeEmail, normalizeMobile, parseDate } from "../../utils/normalize.js";
import { deriveStatus, planCompanyImport, type JobApplicant } from "./company-plan.js";
import { internalMappingSchema, companyMappingSchema } from "./imports.validators.js";
import { planInternalImport, type PlanContext } from "./internal-plan.js";
import type { SheetRow } from "./workbook.js";

/** In-memory workbook: sheet name → rows of cells (row 1 is the header). */
function reader(sheets: Record<string, string[][]>) {
  return (sheet: string, headerRow: number) => {
    const all = (sheets[sheet] ?? []).map((cells, index): SheetRow => ({ rowNumber: index + 1, cells, links: [] }));
    return { headers: all[headerRow - 1]?.cells ?? [], rows: all.filter((row) => row.rowNumber > headerRow) };
  };
}

const JOB = { id: "job-1", jobId: "0f28a1ef-27d2-4d9e-b6e7-c48cbca2d6b2" };
const PRODUCTS = [
  { id: "p-int", code: "CCBP_INTENSIVE", name: "CCBP Intensive", category: "ACADEMY_INTENSIVE" },
  { id: "p-ext", code: "External", name: "External", category: "EXTERNAL" },
];

function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    job: JOB,
    products: PRODUCTS,
    candidates: [],
    applicationCandidateIds: new Set(),
    outcomes: new Map(),
    importedCandidateIds: new Set(),
    jobLabels: new Map(),
    ...overrides,
  };
}

const APPLIED = [
  ["User Id", "Job Id", "Product", "Name", "Phone Number", "Email"],
  ["u-1", JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "+91 98765 43210", "Asha@Example.com"],
  ["u-2", JOB.jobId, "External", "Ravi Kumar", "9123456780", "ravi@example.com"],
  ["u-3", JOB.jobId, "Unknown Plan", "Meena S", "9000000001", "meena@example"],
];
// SC tab: mobile, resume decision (c / reject / hold), tech and comm scores, priority.
const SC = [
  ["mobile", "decision", "tech", "comm", "priority"],
  ["9876543210", "c", "3.5", "4", "P1"],
  ["9123456780", "reject", "", "", "P2"],
  ["9999999999", "c", "", "", ""],
];

function mapping(stages: Record<string, unknown> = {}) {
  return internalMappingSchema.parse({
    applications: { sheet: "Applied", headerRow: 1, columns: { candidateId: 0, jobId: 1, product: 2, fullName: 3, mobile: 4, email: 5 } },
    stages: {
      RESUME_SHORTLIST: { mode: "MANUAL" },
      SCREENING_SHORTLIST: {
        mode: "SHEET", sheet: "SC", headerRow: 1, matchBy: "mobile", matchColumn: 0, decisionColumn: 1,
        valueMap: { c: "SELECTED", reject: "REJECTED" }, techScoreColumn: 2, commScoreColumn: 3, priorityColumn: 4,
      },
      ASSIGNMENT_SHORTLIST: { mode: "NOT_CONDUCTED" },
      FINAL_SHORTLIST: { mode: "UNCHANGED" },
      ...stages,
    },
  });
}

describe("normalisers", () => {
  test("mobiles become 10 digits; emails lower-case; bad email is null", () => {
    assert.equal(normalizeMobile("+91 98765-43210"), "9876543210");
    assert.equal(normalizeMobile("09876543210"), "9876543210");
    assert.equal(normalizeEmail(" Asha@Example.COM "), "asha@example.com");
    assert.equal(normalizeEmail("no projects"), null);
  });

  test("dates from Excel serials, dd-mm-yyyy and JS date strings", () => {
    assert.equal(parseDate("46320")?.toISOString().slice(0, 10), "2026-10-25");
    assert.equal(parseDate("27-10-2026")?.toISOString().slice(0, 10), "2026-10-27");
    assert.equal(parseDate("Sun Oct 25 2026 13:59:59 GMT+0530 (India Standard Time)")?.toISOString(), "2026-10-25T08:29:59.000Z");
  });

  test("sheet values get suggested meanings", () => {
    assert.equal(suggestStageOutcome("c"), "SELECTED");
    assert.equal(suggestStageOutcome("Reject"), "REJECTED");
    assert.equal(suggestStageOutcome("hold "), "ON_HOLD");
    assert.equal(suggestStageOutcome("cheating"), null);
    assert.equal(suggestInterviewOutcome("Cleared"), "CLEARED");
    assert.equal(suggestPipelineStatus("Offer Released"), "OFFER_RELEASED");
  });
});

describe("internal sheet planning", () => {
  test("new applicants are staged, products resolved, bad values flagged", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), context());
    const apps = plan.rows.filter((row) => row.role === "APPLICATIONS");
    assert.equal(apps.length, 3);
    const asha = apps[0]!.data as { candidateCode: string; candidate: { email: string; mobile: string }; productId: string };
    assert.deepEqual([asha.candidateCode, asha.candidate.email, asha.candidate.mobile, asha.productId], ["u-1", "asha@example.com", "9876543210", "p-int"]);
    const meena = apps[2]!;
    assert.ok(meena.included, "warnings do not exclude a row");
    assert.deepEqual(meena.issues.map((issue) => issue.code).sort(), ["INVALID_EMAIL", "UNKNOWN_PRODUCT"]);
    assert.equal(plan.summary.applications.newCandidates, 3);
  });

  test("stage rows are matched to applicants by mobile; decisions, scores and priority read", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), context());
    const sc = plan.rows.filter((row) => row.role === "SCREENING_SHORTLIST");
    const [first, second, third] = sc.map((row) => row.data as { candidateCode: string | null; outcome: string; techScore: number | null; priority: string | null });
    assert.deepEqual([first!.candidateCode, first!.outcome, first!.techScore, first!.priority], ["u-1", "SELECTED", 3.5, "P1"]);
    assert.equal(second!.outcome, "REJECTED");
    assert.equal(third!.candidateCode, null);
    assert.equal(sc[2]!.issues[0]!.code, "NOT_AN_APPLICANT");
    assert.equal(sc[2]!.included, false);
    assert.deepEqual(plan.summary.stages.SCREENING_SHORTLIST, { mode: "SHEET", rows: 3, selected: 1, rejected: 1, onHold: 0, pending: 0, other: 0, errors: 1, conflicts: 0 });
  });

  test("a decision value with no assigned meaning is an error", () => {
    const plan = planInternalImport(
      mapping({ SCREENING_SHORTLIST: { mode: "SHEET", sheet: "SC", headerRow: 1, matchBy: "mobile", matchColumn: 0, decisionColumn: 1, valueMap: { c: "SELECTED" } } }),
      reader({ Applied: APPLIED, SC }),
      context(),
    );
    const rejectRow = plan.rows.find((row) => row.role === "SCREENING_SHORTLIST" && row.rowNumber === 3)!;
    assert.equal(rejectRow.issues[0]!.code, "UNMAPPED_VALUE");
  });

  test("a shortlist tab without a decision column means everyone listed is selected", () => {
    const plan = planInternalImport(
      mapping({ FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP", headerRow: 1, matchBy: "mobile", matchColumn: 0 } }),
      reader({ Applied: APPLIED, SC, SP: [["mobile"], ["9876543210"]] }),
      context(),
    );
    const sp = plan.rows.find((row) => row.role === "FINAL_SHORTLIST")!;
    assert.equal((sp.data as { outcome: string }).outcome, "SELECTED");
  });

  test("rows from another job's sheet are blocked unless the PSM chooses to re-use them", () => {
    const other = [APPLIED[0]!, ["u-9", "11111111-2222-4333-8444-555555555555", "External", "Old Drive", "9000000009", "old@example.com"]];
    const labels = new Map([["11111111-2222-4333-8444-555555555555", "Asama.ai · MERN · 2026-09-01"]]);
    const blocked = planInternalImport(mapping(), reader({ Applied: other, SC: [SC[0]!] }), context({ jobLabels: labels }));
    assert.equal(blocked.rows[0]!.included, false);
    assert.match(blocked.batchIssues[0]!.message, /Asama\.ai · MERN/);
    const reused = planInternalImport({ ...mapping(), acceptOtherJobIds: true }, reader({ Applied: other, SC: [SC[0]!] }), context({ jobLabels: labels }));
    assert.equal(reused.rows[0]!.included, true);
  });

  test("duplicates in the file are rejected; existing candidates are matched and only blanks filled", () => {
    const duplicate = [...APPLIED, ["u-1", JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "9876543210", "asha@example.com"]];
    const existing = { id: "c-1", candidateCode: "u-1", fullName: "Asha Rao", email: "asha.old@example.com", mobile: null, category: null };
    const plan = planInternalImport(mapping(), reader({ Applied: duplicate, SC: [SC[0]!] }), context({ candidates: [existing] }));
    const apps = plan.rows.filter((row) => row.role === "APPLICATIONS");
    const first = apps[0]!.data as { candidateId: string; fill: Record<string, unknown> };
    assert.equal(first.candidateId, "c-1");
    assert.deepEqual(Object.keys(first.fill).sort(), ["category", "mobile"]);
    assert.ok(apps[0]!.issues.some((issue) => issue.code === "FIELD_DIFFERS"), "a different stored email is kept and reported");
    assert.equal(apps[3]!.issues[0]!.code, "DUPLICATE_IN_FILE");
  });

  test("a PSM's hand-entered decision is protected unless overwriting is chosen", () => {
    const existing = { id: "c-1", candidateCode: "u-1", fullName: "Asha Rao", email: "asha@example.com", mobile: "9876543210", category: null };
    const outcomes = new Map([["c-1", new Map([["SCREENING_SHORTLIST", { outcome: "ON_HOLD", source: "MANUAL", priority: null, techScore: null, commScore: null }]])]]) as PlanContext["outcomes"];
    const ctx = context({ candidates: [existing], applicationCandidateIds: new Set(["c-1"]), outcomes });
    const kept = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), ctx);
    const conflict = kept.rows.find((row) => row.role === "SCREENING_SHORTLIST" && row.rowNumber === 2)!;
    assert.equal(conflict.action, "CONFLICT");
    assert.equal(conflict.included, false);
    const overwritten = planInternalImport({ ...mapping(), overwriteManualDecisions: true }, reader({ Applied: APPLIED, SC }), ctx);
    assert.equal(overwritten.rows.find((row) => row.role === "SCREENING_SHORTLIST" && row.rowNumber === 2)!.included, true);
  });

  test("selected after being rejected at an earlier stage is a warning, not a block", () => {
    const plan = planInternalImport(
      mapping({
        RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS", headerRow: 1, matchBy: "mobile", matchColumn: 0, decisionColumn: 1, valueMap: { reject: "REJECTED" } },
      }),
      reader({ Applied: APPLIED, SC, RS: [["mobile", "d"], ["9876543210", "reject"]] }),
      context(),
    );
    const selected = plan.rows.find((row) => row.role === "SCREENING_SHORTLIST" && row.rowNumber === 2)!;
    assert.ok(selected.included);
    assert.equal(selected.issues.at(-1)!.code, "STAGE_ORDER");
  });
});

describe("company sheet planning", () => {
  const applicant = (id: string, email: string, mobile: string, extra: Partial<JobApplicant> = {}): JobApplicant => ({
    applicationId: id, candidateId: `c-${id}`, candidateCode: `u-${id}`, fullName: `Person ${id}`, email, mobile, internallyRejected: false, nomination: null, ...extra,
  });
  const sheet = [
    ["Full Name", "Mobile Number", "Email Id", "Screening Round", "TR Round 1", "Final Status"],
    ["A", "9000000001", "a@example.com", "Cleared", "Rejected", ""],
    ["B", "9000000002", "nobody@example.com", "Cleared", "", ""],
    ["C", "9000000003", "c@example.com", "", "", ""],
    ["D", "9000000004", "d@example.com", "Cleared", "Cleared", "Selected"],
  ];
  const companyMapping = companyMappingSchema.parse({
    tabs: [{
      sheet: "MERN", headerRow: 1, columns: { fullName: 0, mobile: 1, email: 2 },
      rounds: [{ column: 3, roundName: "Screening Round", roundType: "RESUME_SCREENING" }, { column: 4, roundName: "TR Round 1", roundType: "TECHNICAL" }],
      finalStatusColumn: 5,
    }],
    roundValueMap: { cleared: "CLEARED", rejected: "REJECTED" },
    finalValueMap: { selected: "SELECTED" },
  });

  test("matches by email then mobile, blocks internally rejected, keeps recorded offers", () => {
    const applicants = [
      applicant("1", "a@example.com", "9000000001"),
      applicant("2", "b@example.com", "9000000002"),
      applicant("3", "c@example.com", "9000000003", { internallyRejected: true }),
      applicant("4", "d@example.com", "9000000004", { nomination: { id: "n-4", pipelineStatus: "OFFER_ACCEPTED", outcomes: new Map() } }),
    ];
    const { rows, summary } = planCompanyImport(companyMapping, reader({ MERN: sheet }), applicants, [], ["Screening Round"]);
    const [a, b, c, d] = rows.map((row) => row);
    assert.equal(a!.data.matchedBy, "email");
    assert.equal(a!.data.toStatus, "REJECTED", "a rejected round means rejected");
    assert.ok(a!.data.createNomination);
    assert.equal(b!.data.matchedBy, "mobile");
    assert.equal(b!.data.toStatus, "IN_PROCESS");
    assert.equal(c!.issues[0]!.code, "INTERNALLY_REJECTED");
    assert.equal(c!.included, false);
    assert.equal(d!.data.toStatus, "OFFER_ACCEPTED", "an offer the PSM recorded is not overwritten");
    assert.deepEqual(summary.rounds, [
      { name: "Screening Round", roundType: "RESUME_SCREENING", exists: true },
      { name: "TR Round 1", roundType: "TECHNICAL", exists: false },
    ]);
  });

  test("a manual match overrides automatic matching", () => {
    const applicants = [applicant("1", "x@example.com", "9111111111")];
    const withOverride = { ...companyMapping, overrides: { "MERN#3": "1" } };
    const { rows } = planCompanyImport(withOverride, reader({ MERN: sheet.slice(0, 3) }), applicants, [], []);
    assert.equal(rows[0]!.issues[0]!.code, "NO_MATCH");
    assert.equal(rows[1]!.data.matchedBy, "manual");
  });

  test("status derivation and allowed manual moves", () => {
    assert.equal(deriveStatus(null, ["CLEARED", "ON_HOLD"]), "ON_HOLD");
    assert.equal(deriveStatus("SELECTED", ["REJECTED"]), "SELECTED");
    assert.ok(canMovePipeline("SELECTED", "OFFER_RELEASED"));
    assert.equal(canMovePipeline("NOT_SUBMITTED", "JOINED"), false);
    assert.equal(canMovePipeline("JOINED", "DROPPED"), false);
  });
});
