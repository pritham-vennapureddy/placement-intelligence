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

function mapping(stages: Record<string, unknown> = {}, profileLookups: Record<string, unknown>[] = []) {
  return internalMappingSchema.parse({
    applications: { sheet: "Applied", headerRow: 1, columns: { candidateId: 0, jobId: 1, product: 2, fullName: 3, mobile: 4, email: 5 } },
    profileLookups,
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

describe("screening value suggestions", () => {
  test("NA and not-attended values mean no show", () => {
    for (const value of ["NA", "n/a", "No Show", "not attended"]) assert.equal(suggestStageOutcome(value), "NO_SHOW");
  });
});

describe("internal sheet planning", () => {
  test("imports tool scores, skills, and projects as a separate resume profile", () => {
    const plan = planInternalImport(mapping({}, [{ sheet: "tool", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { candidateId: 0, mobile: 1 } }]), reader({
      Applied: APPLIED,
      SC,
      tool: [["User Id", "Mobile", "Resume Skills Score", "Skills", "Project Title", "Analysis Date"], ["u-1", "9876543210", "0.92", "TypeScript, React", "Placement dashboard", "2026-11-04"]],
    }), context());
    const asha = plan.rows.find((row) => row.role === "APPLICATIONS" && (row.data as { candidate: { mobile: string } }).candidate.mobile === "9876543210")!;
    const data = asha.data as { resumeAssessment?: { scores: Record<string, string>; skills: string[]; projects: string[] }; additionalProfiles?: { classification: string }[] };
    assert.equal(data.resumeAssessment?.scores["Resume Skills Score"], "0.92");
    assert.deepEqual(data.resumeAssessment?.skills, ["TypeScript, React"]);
    assert.deepEqual(data.resumeAssessment?.projects, ["Placement dashboard"]);
    assert.equal(data.additionalProfiles?.[0]?.classification, "RESUME");
    assert.equal(plan.summary.stages.FINAL_SHORTLIST?.rows, 0);
  });

  test("excludes supplemental profiles when normalized mobile matches multiple UUIDs", () => {
    const applied = [
      APPLIED[0]!,
      ["u-1", JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "+91 98765 43210", "asha@example.com"],
      ["u-other", JOB.jobId, "CCBP_INTENSIVE", "Asha R", "09876543210", "asha2@example.com"],
    ];
    const config = mapping({}, [{ sheet: "NXTMOCK", headerRow: 1, keyType: "mobile", keyColumn: 0, columns: { mobile: 0, academicScore: 1 } }]);
    const plan = planInternalImport(config, reader({ Applied: applied, SC, NXTMOCK: [["Mobile", "Score"], ["9876543210", "0.8"]] }), context());
    assert.ok(plan.batchIssues.some((issue) => issue.code === "AMBIGUOUS_PROFILE_MATCH"));
    const asha = plan.rows.find((row) => row.role === "APPLICATIONS" && (row.data as { candidate: { mobile: string } }).candidate.mobile === "9876543210")!;
    assert.deepEqual((asha.data as { additionalProfiles?: unknown[] }).additionalProfiles, []);
  });

  test("excludes profile rows when their mobile is shared, even when UUIDs differ", () => {
    const applied = [
      APPLIED[0]!,
      ["u-1", JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "+91 98765 43210", "asha@example.com"],
      ["u-other", JOB.jobId, "CCBP_INTENSIVE", "Asha R", "09876543210", "asha2@example.com"],
    ];
    const config = mapping({}, [{ sheet: "Form Responses 1", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { candidateId: 0, mobile: 1, academicScore: 2 } }]);
    const plan = planInternalImport(config, reader({
      Applied: applied,
      SC,
      "Form Responses 1": [["UID", "Mobile Number", "Resume Score"], ["u-1", "9876543210", "0.91"]],
    }), context());
    assert.equal(plan.batchIssues.some((issue) => issue.code === "AMBIGUOUS_PROFILE_MATCH"), true);
    const asha = plan.rows.find((row) => row.role === "APPLICATIONS" && (row.data as { candidate: { mobile: string } }).candidate.mobile === "9876543210")!;
    assert.equal((asha.data as { resumeAssessment?: unknown }).resumeAssessment, null);
    assert.deepEqual((asha.data as { additionalProfiles?: unknown[] }).additionalProfiles, []);
  });

  test("collapses repeat form submissions for the same mobile, name, and email to the latest response", () => {
    const config = mapping({}, [{
      sheet: "Form Responses 1",
      headerRow: 1,
      keyType: "mobile",
      keyColumn: 4,
      columns: { candidateId: 1, email: 2, fullName: 3, mobile: 4, academicScore: 5 },
    }]);
    const plan = planInternalImport(config, reader({
      Applied: [APPLIED[0]!, ["u-pdeepak", JOB.jobId, "CCBP_INTENSIVE", "P Deepak", "8978461095", "deepakgoud1095@gmail.com"]],
      SC: [SC[0]!],
      "Form Responses 1": [
        ["Timestamp", "UID", "Email", "Full Name", "Registered Mobile Number", "Score", "Reason"],
        ["Wed Oct 28 2026 17:21:35 GMT+0530", "62472407-9c03-4161-af5c-619e5adc0b91", "deepakgoud1095@gmail.com", "P Deepak ", "8978461095", "0.91", "Location issue"],
        ["Thu Oct 29 2026 10:38:31 GMT+0530", "938e7f30-9974-4e5e-8d17-c32391dd532d", "deepakgoud1095@gmail.com", "P Deepak", "+91 89784 61095", "0.75", "Role mismatch"],
      ],
    }), context());
    const deepak = plan.rows.find((row) => row.role === "APPLICATIONS" && (row.data as { candidate: { mobile: string } }).candidate.mobile === "8978461095")!;
    const profile = (deepak.data as { additionalProfiles?: { data: Record<string, string> }[] }).additionalProfiles;
    assert.equal(profile?.length, 1);
    assert.equal(profile?.[0]?.data.Reason, "Role mismatch");
    assert.ok(plan.batchIssues.some(({ code }) => code === "DUPLICATE_PROFILE_COLLAPSED"));
    assert.equal(plan.batchIssues.some(({ code }) => code === "AMBIGUOUS_PROFILE_MATCH"), false);
  });

  test("treats repeated Applied Users rows with the same mobile, name, and email as one applicant for profile matching", () => {
    const applied = [
      APPLIED[0]!,
      ["uuid-first", JOB.jobId, "CCBP_INTENSIVE", "P Deepak", "8978461095", "deepakgoud1095@gmail.com"],
      ["uuid-repeat", JOB.jobId, "CCBP_INTENSIVE", " P   Deepak ", "+91 89784 61095", "deepakgoud1095@gmail.com"],
    ];
    const config = mapping({}, [{
      sheet: "Form Responses 1",
      headerRow: 1,
      keyType: "mobile",
      keyColumn: 0,
      columns: { mobile: 0, fullName: 1, email: 2, academicScore: 3 },
    }]);
    const plan = planInternalImport(config, reader({
      Applied: applied,
      SC: [SC[0]!],
      "Form Responses 1": [["Mobile", "Full Name", "Email", "Score"], ["8978461095", "P Deepak", "deepakgoud1095@gmail.com", "0.75"]],
    }), context());
    assert.equal(plan.batchIssues.some(({ code }) => code === "AMBIGUOUS_PROFILE_MATCH"), false);
    const deepak = plan.rows.find((row) => row.role === "APPLICATIONS" && (row.data as { candidate: { mobile: string } }).candidate.mobile === "8978461095")!;
    assert.equal((deepak.data as { additionalProfiles?: unknown[] }).additionalProfiles?.length, 1);
  });

  test("screening marked not conducted requires a reason", () => {
    const input = {
      applications: { sheet: "Applied", headerRow: 1, columns: { fullName: 3, mobile: 4 } },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "NOT_CONDUCTED" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    };
    assert.equal(internalMappingSchema.safeParse(input).success, false);
    assert.equal(internalMappingSchema.safeParse({
      ...input,
      stages: { ...input.stages, SCREENING_SHORTLIST: { mode: "NOT_CONDUCTED", reason: "No screening this week" } },
    }).success, true);
  });

  test("SP sheet works without a Selection_Basis column and supports separate Remarks", () => {
    const stages = {
      RESUME_SHORTLIST: { mode: "MANUAL" },
      SCREENING_SHORTLIST: { mode: "MANUAL" },
      ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
      FINAL_SHORTLIST: {
        mode: "SHEET",
        sheet: "SP",
        headerRow: 1,
        matchBy: "mobile",
        matchColumn: 0,
      },
    };
    const input = {
      applications: { sheet: "Applied", headerRow: 1, columns: { fullName: 3, mobile: 4 } },
      stages,
    };
    assert.equal(internalMappingSchema.safeParse(input).success, true);
    assert.equal(internalMappingSchema.safeParse({
      ...input,
      stages: { ...stages, FINAL_SHORTLIST: { ...stages.FINAL_SHORTLIST, selectionBasisColumn: 1, remarksColumn: 2 } },
    }).success, true);
  });

  test("new applicants are staged, products resolved, bad values flagged", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), context());
    const apps = plan.rows.filter((row) => row.role === "APPLICATIONS");
    assert.equal(apps.length, 3);
    const asha = apps[0]!.data as { candidateCode: string; candidate: { email: string; mobile: string }; productId: string };
    assert.match(asha.candidateCode, /^GEN-/);
    assert.deepEqual([asha.candidate.email, asha.candidate.mobile, asha.productId], ["asha@example.com", "9876543210", "p-int"]);
    const meena = apps[2]!;
    assert.ok(meena.included, "warnings do not exclude a row");
    assert.deepEqual(meena.issues.map((issue) => issue.code).sort(), ["INVALID_EMAIL", "UNKNOWN_PRODUCT"]);
    assert.equal(plan.summary.applications.newCandidates, 3);
  });

  test("profile and product lookups enrich an existing form applicant and replace External with its product", () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    const config = internalMappingSchema.parse({
      applications: {
        sheet: "TA",
        headerRow: 1,
        columns: { candidateId: 0, mobile: 1, resumeUrl: 2, product: 3 },
      },
      profileLookups: [{
        sheet: "Student Details",
        headerRow: 1,
        keyType: "mobile",
        keyColumn: 2,
        columns: { candidateId: 0, fullName: 1, mobile: 2 },
      }],
      productsLookup: {
        sheet: "Student Details",
        headerRow: 1,
        keyType: "mobile",
        keyColumn: 2,
        productColumn: 3,
      },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const plan = planInternalImport(
      config,
      reader({
        TA: [["UUID", "Mobile", "Resume", "Product"], [uuid, "9876543210", "https://example.com/resume", "External"]],
        "Student Details": [["UUID", "Name", "Mobile", "Product"], [uuid, "Asha Rao", "9876543210", "CCBP_INTENSIVE"]],
      }),
      context({
        candidates: [{ id: "c-1", candidateCode: uuid, fullName: "Asha Rao", email: null, mobile: "9876543210", category: "EXTERNAL" }],
        applicationCandidateIds: new Set(["c-1"]),
      }),
    );
    const application = plan.rows.find((row) => row.role === "APPLICATIONS")!;
    const data = application.data as { productId: string | null; productCategory: string | null; createApplication: boolean; fill: { category?: string }; candidate: { resumeUrl: string | null } };

    assert.equal(application.included, true);
    assert.equal(data.productId, "p-int");
    assert.equal(data.productCategory, "ACADEMY_INTENSIVE");
    assert.equal(data.createApplication, false);
    assert.equal(data.fill.category, "ACADEMY_INTENSIVE");
    assert.equal(data.candidate.resumeUrl, "https://example.com/resume");
  });

  test("duplicate mobile rows in a product lookup do not choose the last product silently", () => {
    const config = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0, fullName: 1 } },
      productsLookup: { sheet: "Eligible Students", headerRow: 1, keyType: "mobile", keyColumn: 0, productColumn: 1 },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const plan = planInternalImport(config, reader({
      TA: [["Mobile", "Name"], ["9876543210", "Asha Rao"]],
      "Eligible Students": [["Mobile", "Product"], ["9876543210", "Academy"], ["+91 98765 43210", "Intensive"]],
    }), context());
    const application = plan.rows.find((row) => row.role === "APPLICATIONS")!;
    assert.equal((application.data as { productId: string | null }).productId, null);
    assert.ok(application.issues.some(({ code }) => code === "AMBIGUOUS_PRODUCT_MATCH"));
  });

  test("headerless application imports keep and stage their first data row", () => {
    const config = internalMappingSchema.parse({
      applications: { sheet: "Applied", headerRow: 0, columns: { candidateId: 0, jobId: 1, product: 2, fullName: 3, mobile: 4, email: 5 } },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const firstDataRow = APPLIED[1]!;
    const plan = planInternalImport(config, reader({ Applied: [firstDataRow] }), context());
    const [application] = plan.rows.filter((row) => row.role === "APPLICATIONS");

    assert.equal(application?.rowNumber, 1);
    assert.equal((application?.data as { candidate: { fullName: string } }).candidate.fullName, "Asha Rao");
  });

  test("shortlist-only rows use the saved candidate name when the tab has only mobile and resume", () => {
    const config = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0, resumeUrl: 1 } },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const candidate = {
      id: "c-1",
      candidateCode: "u-1",
      fullName: "Asha Rao",
      email: null,
      mobile: "9876543210",
      category: null,
    };
    const plan = planInternalImport(
      config,
      reader({ TA: [["mobile", "resume"], ["9876543210", "https://example.com/resume"]] }),
      context({ candidates: [candidate] }),
    );
    const [application] = plan.rows.filter((row) => row.role === "APPLICATIONS");
    const data = application?.data as { candidate: { fullName: string; resumeUrl: string | null } };

    assert.equal(application?.included, true);
    assert.equal(data.candidate.fullName, "Asha Rao");
    assert.equal(data.candidate.resumeUrl, "https://example.com/resume");
  });

  test("UUID values cannot identify an applicant when mobile is required", () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    const config = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0 } },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const plan = planInternalImport(
      config,
      reader({ TA: [["mobile"], [uuid]] }),
      context({
        candidates: [{ id: "c-1", candidateCode: uuid, fullName: "Asha Rao", email: null, mobile: null, category: null }],
      }),
    );
    const [application] = plan.rows.filter((row) => row.role === "APPLICATIONS");

    assert.equal(application?.included, false);
    assert.ok(application?.issues.some(({ code }) => code === "MISSING_IDENTIFIER"));
  });

  test("shortlist rows are enriched from Applied Users by mobile and ignore its UUID", () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    const config = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0, resumeUrl: 1 } },
      profileLookups: [{
        sheet: "Applied Users",
        headerRow: 1,
        keyType: "mobile",
        keyColumn: 2,
        columns: { candidateId: 0, fullName: 1, mobile: 2, email: 3, state: 4 },
      }],
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
    });
    const plan = planInternalImport(
      config,
      reader({
        TA: [["mobile", "resume"], ["9876543210", "https://example.com/resume"]],
        "Applied Users": [["User Id", "Name", "Phone Number", "Email", "State"], [uuid, "Asha Rao", "9876543210", "asha@example.com", "Telangana"]],
      }),
      context(),
    );
    const [application] = plan.rows.filter((row) => row.role === "APPLICATIONS");
    const data = application?.data as { candidateCode: string; candidate: { fullName: string; email: string; mobile: string; state: string } };

    assert.equal(application?.included, true);
    assert.match(data.candidateCode, /^GEN-/);
    assert.deepEqual(data.candidate, {
      fullName: "Asha Rao",
      email: "asha@example.com",
      mobile: "9876543210",
      gender: null,
      currentCity: null,
      state: "Telangana",
      college: null,
      degree: null,
      department: null,
      graduationYear: null,
      academicScore: null,
      resumeUrl: "https://example.com/resume",
    });
  });

  test("stage rows are matched to applicants by mobile; decisions, scores and priority read", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), context());
    const sc = plan.rows.filter((row) => row.role === "SCREENING_SHORTLIST");
    const [first, second, third] = sc.map((row) => row.data as { candidateCode: string | null; outcome: string; techScore: number | null; priority: string | null });
    const applicationCode = (plan.rows.find((row) => row.role === "APPLICATIONS" && row.rowNumber === 2)!.data as { candidateCode: string }).candidateCode;
    assert.deepEqual([first!.candidateCode, first!.outcome, first!.techScore, first!.priority], [applicationCode, "SELECTED", 3.5, "P1"]);
    assert.equal(second!.outcome, "REJECTED");
    assert.equal(third!.candidateCode, null);
    assert.equal(sc[2]!.issues[0]!.code, "NOT_AN_APPLICANT");
    assert.equal(sc[2]!.included, false);
    assert.deepEqual(plan.summary.stages.SCREENING_SHORTLIST, { mode: "SHEET", rows: 3, selected: 1, rejected: 1, onHold: 0, noShow: 0, pending: 0, other: 0, errors: 1, conflicts: 0 });
  });

  test("stage rows match by mobile number or by a candidate ID found on the applications tab", () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    const unknownUuid = "00000000-0000-4000-8000-0000000000ff";
    const applied = [
      APPLIED[0]!,
      [uuid, JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "9876543210", "asha@example.com"],
      APPLIED[2]!,
    ];
    const stageRows = [
      ["identifier", "decision"],
      [uuid.toUpperCase(), "c"],
      ["9123456780", "reject"],
      [unknownUuid, "c"],
    ];
    const plan = planInternalImport(mapping(), reader({ Applied: applied, SC: stageRows }), context());
    const sc = plan.rows.filter((row) => row.role === "SCREENING_SHORTLIST");
    const asha = plan.rows.find((row) => row.role === "APPLICATIONS" && row.rowRef === "9876543210");

    // The candidate ID resolves to Asha's mobile, so the row lands on her application.
    assert.equal(sc[0]?.included, true);
    assert.equal((sc[0]?.data as { candidateCode: string }).candidateCode, (asha?.data as { candidateCode: string }).candidateCode);
    assert.equal(sc[1]?.included, true);
    assert.match((sc[1]?.data as { candidateCode: string }).candidateCode, /^GEN-/);
    assert.equal(sc[2]?.included, false);
    assert.equal(sc[2]?.issues[0]?.code, "NOT_AN_APPLICANT");
  });

  test("a TA row with “#N/A” for mobile gets the mobile and details its candidate ID has on a student-detail tab", () => {
    const uuid = "00000000-0000-4000-8000-000000000003";
    const applied = [
      APPLIED[0]!,
      [uuid, JOB.jobId, "External", "", "#N/A", ""],
    ];
    const form = [
      ["Candidate ID", "Name", "Mobile"],
      [uuid, "Sravani K", "9573033382"],
    ];
    const plan = planInternalImport(
      mapping({}, [{ sheet: "Form", headerRow: 1, keyType: "mobile", keyColumn: 2, columns: { candidateId: 0, fullName: 1, mobile: 2 } }]),
      reader({ Applied: applied, Form: form, SC: [["id", "decision"], [uuid, "c"]] }),
      context(),
    );
    const ta = plan.rows.find((row) => row.role === "APPLICATIONS");
    const sc = plan.rows.find((row) => row.role === "SCREENING_SHORTLIST");
    assert.equal(ta?.included, true);
    assert.equal((ta?.data as { candidate: { mobile: string; fullName: string } }).candidate.mobile, "9573033382");
    assert.equal((ta?.data as { candidate: { mobile: string; fullName: string } }).candidate.fullName, "Sravani K");
    assert.equal(sc?.included, true);
  });

  test("a candidate ID listed with two different mobiles is not guessed", () => {
    const uuid = "00000000-0000-4000-8000-000000000002";
    const applied = [
      APPLIED[0]!,
      [uuid, JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "9876543210", "asha@example.com"],
      [uuid, JOB.jobId, "CCBP_INTENSIVE", "Ravi Kumar", "9000000001", "ravi@example.com"],
    ];
    const plan = planInternalImport(mapping(), reader({ Applied: applied, SC: [["identifier", "decision"], [uuid, "c"]] }), context());
    const sc = plan.rows.filter((row) => row.role === "SCREENING_SHORTLIST");
    assert.equal(sc[0]?.included, false);
    assert.equal(sc[0]?.issues[0]?.code, "AMBIGUOUS_MATCH");
  });

  test("final shortlist selection reasons are read from the SP tab", () => {
    const plan = planInternalImport(
      mapping({
        FINAL_SHORTLIST: {
          mode: "SHEET",
          sheet: "SP",
          headerRow: 1,
          matchBy: "mobile",
          matchColumn: 0,
          selectionBasisColumn: 1,
          remarksColumn: 2,
          valueMap: {},
        },
      }),
      reader({ Applied: APPLIED, SC, SP: [["mobile", "Selection_Basis", "Remarks"], ["9876543210", "Projects", "Strong project experience"]] }),
      context(),
    );
    const shortlisted = plan.rows.find((row) => row.role === "FINAL_SHORTLIST");
    assert.equal((shortlisted?.data as { selectionBasis: string | null }).selectionBasis, "Projects");
    assert.equal((shortlisted?.data as { remarks: string | null }).remarks, "Strong project experience");
  });

  test("SP without a Selection_Basis column uses Remarks as the selection basis", () => {
    const plan = planInternalImport(
      mapping({
        FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP", headerRow: 1, matchBy: "mobile", matchColumn: 0, remarksColumn: 1, valueMap: {} },
      }),
      reader({ Applied: APPLIED, SC, SP: [["mobile", "Remarks"], ["9876543210", "Strong DSA in screening"]] }),
      context(),
    );
    const shortlisted = plan.rows.find((row) => row.role === "FINAL_SHORTLIST");
    const data = shortlisted?.data as { selectionBasis: string | null; remarks: string | null; outcome: string | null };
    assert.equal(data.selectionBasis, "Strong DSA in screening");
    assert.equal(data.remarks, "Strong DSA in screening");
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
      mapping({ FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP", headerRow: 1, matchBy: "mobile", matchColumn: 0, selectionBasisColumn: 1 } }),
      reader({ Applied: APPLIED, SC, SP: [["mobile", "Selection_Basis", "Remarks"], ["9876543210", "Experience", "selected for experience"]] }),
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

  test("repeated applicants are counted once, not as errors; existing candidates are matched and only blanks filled", () => {
    const duplicate = [...APPLIED, ["u-1", JOB.jobId, "CCBP_INTENSIVE", "Asha Rao", "9876543210", "asha@example.com"]];
    const existing = { id: "c-1", candidateCode: "u-1", fullName: "Asha Rao", email: "asha.old@example.com", mobile: "9876543210", category: null };
    const plan = planInternalImport(mapping(), reader({ Applied: duplicate, SC: [SC[0]!] }), context({ candidates: [existing] }));
    const apps = plan.rows.filter((row) => row.role === "APPLICATIONS");
    const first = apps[0]!.data as { candidateId: string; fill: Record<string, unknown> };
    assert.equal(first.candidateId, "c-1");
    assert.deepEqual(Object.keys(first.fill).sort(), ["category"]);
    assert.ok(apps[0]!.issues.some((issue) => issue.code === "FIELD_DIFFERS"), "a different stored email is kept and reported");
    assert.equal(apps[3]!.issues[0]!.code, "DUPLICATE_IN_FILE");
    assert.equal(apps[3]!.issues[0]!.severity, "WARNING");
    assert.equal(apps[3]!.included, false);
    assert.equal(plan.summary.applications.duplicates, 1);
    assert.equal(plan.summary.applications.errors, 0);
  });

  test("ambiguous existing mobile numbers are blocked instead of selecting an arbitrary candidate", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED.slice(0, 2), SC: [SC[0]!] }), context({
      candidates: [
        { id: "c-1", candidateCode: "old-1", fullName: "Asha One", email: null, mobile: "9876543210", category: null },
        { id: "c-2", candidateCode: "old-2", fullName: "Asha Two", email: null, mobile: "+91 98765 43210", category: null },
      ],
    }));
    const application = plan.rows.find((row) => row.role === "APPLICATIONS")!;
    assert.equal(application.included, false);
    assert.ok(application.issues.some(({ code }) => code === "AMBIGUOUS_MATCH"));
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

  test("TA is the applications tab; names and products come from detail tabs in priority order", () => {
    // TA lists everyone; Applied Users covers only one channel; Form Responses covers the rest.
    const taMapping = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0, resumeUrl: 1 } },
      profileLookups: [
        { sheet: "Applied Users", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { fullName: 0, mobile: 1, product: 2 } },
        { sheet: "Form Responses 1", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { fullName: 0, mobile: 1 } },
      ],
      stages: {
        RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS", headerRow: 1, matchBy: "mobile", matchColumn: 0, priorityColumn: 1, valueMap: {} },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "UNCHANGED" },
      },
    });
    const plan = planInternalImport(taMapping, reader({
      TA: [["mobileno", "resume"], ["9876543210", "https://r/1"], ["9123456780", "https://r/2"]],
      "Applied Users": [["Name", "Phone", "Product"], ["Asha Rao", "9876543210", "CCBP_INTENSIVE"]],
      "Form Responses 1": [["Full Name", "Mobile"], ["Asha From Form", "9876543210"], ["Ravi Kumar", "9123456780"]],
      RS: [["mobile", "priority"], ["9123456780", "p1"]],
    }), context());
    const apps = plan.rows.filter((row) => row.role === "APPLICATIONS").map((row) => row.data as { candidate: { fullName: string }; productId: string | null });
    assert.equal(plan.summary.applications.total, 2);
    assert.equal(plan.summary.applications.errors, 0);
    // Applied Users is the first-priority source; Form Responses fills in only who it lacks.
    assert.deepEqual(apps.map((app) => app.candidate.fullName), ["Asha Rao", "Ravi Kumar"]);
    assert.equal(apps[0]!.productId, "p-int");
    const rs = plan.rows.find((row) => row.role === "RESUME_SHORTLIST")!;
    assert.ok(rs.included);
    assert.equal(plan.batchIssues.some((issue) => issue.code === "STAGE_ROWS_NOT_IN_TA"), false);
  });

  test("a mobile-only TA tab treats the same mobile twice as one applicant listed twice", () => {
    const taOnly = internalMappingSchema.parse({
      applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0 } },
      profileLookups: [{ sheet: "Applied Users", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { fullName: 0, mobile: 1 } }],
      stages: { RESUME_SHORTLIST: { mode: "MANUAL" }, SCREENING_SHORTLIST: { mode: "MANUAL" }, ASSIGNMENT_SHORTLIST: { mode: "MANUAL" }, FINAL_SHORTLIST: { mode: "UNCHANGED" } },
    });
    const plan = planInternalImport(taOnly, reader({
      TA: [["mobileno"], ["8247805403"], ["08247805403"]],
      "Applied Users": [["Name", "Phone"], ["Nemuri Madhuri", "8247805403"]],
    }), context());
    const [first, second] = plan.rows.filter((row) => row.role === "APPLICATIONS");
    assert.ok(first!.included);
    assert.equal((first!.data as { candidate: { fullName: string } }).candidate.fullName, "Nemuri Madhuri");
    assert.deepEqual(second!.issues.map((issue) => issue.code), ["DUPLICATE_IN_FILE"]);
    assert.equal(second!.included, false);
    assert.equal(second!.action, "SKIP");
    assert.match(second!.issues[0]!.message, /row 2 \(Nemuri Madhuri\)/);
    assert.equal(plan.summary.issues.ERROR, 0);
  });

  test("stage rows missing from the applications tab are reported as a TA undercount", () => {
    const plan = planInternalImport(mapping(), reader({ Applied: APPLIED, SC }), context());
    const issue = plan.batchIssues.find((entry) => entry.code === "STAGE_ROWS_NOT_IN_TA");
    assert.ok(issue);
    assert.match(issue.message, /1 in SC/);
  });

  test("a blank screening decision is recorded as a no-show", () => {
    const plan = planInternalImport(mapping(), reader({
      Applied: APPLIED,
      SC: [["mobile", "decision"], ["9876543210", ""], ["9123456780", "reject"]],
    }), context());
    const outcomes = plan.rows.filter((row) => row.role === "SCREENING_SHORTLIST").map((row) => (row.data as { outcome: string }).outcome);
    assert.deepEqual(outcomes, ["NO_SHOW", "REJECTED"]);
  });

  test("students in a detail tab who did not apply produce one summary, not one warning per row", () => {
    const plan = planInternalImport(
      mapping({}, [{ sheet: "Eligible", headerRow: 1, keyType: "mobile", keyColumn: 0, columns: { mobile: 0, fullName: 1 } }]),
      reader({ Applied: APPLIED, SC, Eligible: [["mobile", "name"], ["9000000002", "A B"], ["9000000003", "C D"], ["9000000004", "E F"]] }),
      context(),
    );
    const summaries = plan.batchIssues.filter((issue) => issue.code === "PROFILE_NOT_APPLIED");
    assert.equal(summaries.length, 1);
    assert.match(summaries[0]!.message, /^3 row\(s\) on Eligible/);
    assert.equal(plan.batchIssues.some((issue) => issue.code === "PROFILE_CANDIDATE_NOT_FOUND"), false);
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

  test("matches by mobile only, blocks internally rejected, keeps recorded offers", () => {
    const applicants = [
      applicant("1", "a@example.com", "9000000001"),
      applicant("2", "b@example.com", "9000000002"),
      applicant("3", "c@example.com", "9000000003", { internallyRejected: true }),
      applicant("4", "d@example.com", "9000000004", { nomination: { id: "n-4", pipelineStatus: "OFFER_ACCEPTED", outcomes: new Map() } }),
    ];
    const { rows, summary } = planCompanyImport(companyMapping, reader({ MERN: sheet }), applicants, [], ["Screening Round"]);
    const [a, b, c, d] = rows.map((row) => row);
    assert.equal(a!.data.matchedBy, "mobile");
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

  test("company matching ignores email when the mobile number does not match", () => {
    const onlyEmailMatches = [applicant("1", "a@example.com", "9000000099")];
    const { rows } = planCompanyImport(companyMapping, reader({ MERN: sheet.slice(0, 2) }), onlyEmailMatches, [], []);
    assert.equal(rows[0]?.included, false);
    assert.equal(rows[0]?.issues[0]?.code, "NO_MATCH");
  });

  test("ambiguous mobile numbers are rejected instead of matching an arbitrary company applicant", () => {
    const sharedMobileApplicants = [
      applicant("1", "a@example.com", "9000000001"),
      applicant("2", "b@example.com", "9000000001"),
    ];
    const { rows } = planCompanyImport(companyMapping, reader({ MERN: sheet.slice(0, 2) }), sharedMobileApplicants, [], []);
    assert.equal(rows[0]?.included, false);
    assert.equal(rows[0]?.issues[0]?.code, "AMBIGUOUS_MATCH");
  });

  test("status derivation and allowed manual moves", () => {
    assert.equal(deriveStatus(null, ["CLEARED", "ON_HOLD"]), "ON_HOLD");
    assert.equal(deriveStatus("SELECTED", ["REJECTED"]), "SELECTED");
    assert.ok(canMovePipeline("SELECTED", "OFFER_RELEASED"));
    assert.equal(canMovePipeline("NOT_SUBMITTED", "JOINED"), false);
    assert.equal(canMovePipeline("JOINED", "DROPPED"), false);
  });
});


describe("product comes from the chosen product tab, else External", () => {
  const mapping = (productTab: string | null) => internalMappingSchema.parse({
    applications: { sheet: "TA", headerRow: 1, columns: { mobile: 0, product: 1 } },
    profileLookups: [{ sheet: "Platform Export", headerRow: 1, keyType: "mobile", keyColumn: 1, columns: { fullName: 0, mobile: 1, product: 2 } }],
    ...(productTab ? { productsLookup: { sheet: productTab, headerRow: 1, keyType: "mobile", keyColumn: 1, productColumn: 2 } } : {}),
    productTabConfirmed: true,
    stages: { RESUME_SHORTLIST: { mode: "MANUAL" }, SCREENING_SHORTLIST: { mode: "MANUAL" }, ASSIGNMENT_SHORTLIST: { mode: "MANUAL" }, FINAL_SHORTLIST: { mode: "UNCHANGED" } },
  });
  // The tab name follows no convention: only the PSM's choice decides.
  const sheets = {
    TA: [["mobile", "product"], ["9876543210", "External"], ["9123456780", "CCBP_INTENSIVE"]],
    "Platform Export": [["Name", "Phone", "Product"], ["Asha Rao", "9876543210", "CCBP_INTENSIVE"]],
  };
  const products = (plan: ReturnType<typeof planInternalImport>) =>
    plan.rows.filter((row) => row.role === "APPLICATIONS").map((row) => (row.data as { productId: string | null }).productId);

  test("applicants on the chosen tab get its product; anyone not on it is External", () => {
    const plan = planInternalImport(mapping("Platform Export"), reader(sheets), context());
    assert.deepEqual(products(plan), ["p-int", "p-ext"]);
    assert.match(plan.batchIssues.find((issue) => issue.code === "PRODUCT_TAB")!.message, /“Platform Export”: 1 applicant\(s\) found there; 1 not on it are marked External/);
  });

  test("without a product tab, the applications row's product column is used", () => {
    const plan = planInternalImport(mapping(null), reader(sheets), context());
    assert.deepEqual(products(plan), ["p-ext", "p-int"]);
  });
});
