import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { internalMappingSchema } from "./imports.validators.js";
import { inferGoogleMapping } from "./google-sheet-analysis.js";
import type { SheetRow, Workbook } from "./workbook.js";

function workbook(tabs: Record<string, string[][]>): Workbook {
  const rows = new Map<string, SheetRow[]>(
    Object.entries(tabs).map(([name, values]) => [
      name,
      values.map((cells, index) => ({ rowNumber: index + 1, cells, links: [] })),
    ]),
  );
  return {
    sheets: [...rows].map(([name, content]) => ({ name, rowCount: content.length, columnCount: Math.max(...content.map(({ cells }) => cells.length)) })),
    top: (name, limit) => rows.get(name)?.slice(0, limit) ?? [],
    read: (name, headerRow) => {
      const content = rows.get(name) ?? [];
      return {
        headers: content.find(({ rowNumber }) => rowNumber === headerRow)?.cells ?? [],
        rows: content.filter(({ rowNumber }) => rowNumber > headerRow),
      };
    },
  };
}

describe("Google Sheets tab analysis", () => {
  test("preselects internal application and stage tabs and omits unrelated tabs", () => {
    const suggested = inferGoogleMapping(workbook({
      "Applied Users": [
        ["User Id", "Job Id", "Product", "Full Name", "Mobile Number", "Email Id"],
        ["u-1", "job-1", "CCBP Intensive", "Asha Rao", "9876543210", "asha@example.com"],
      ],
      SC: [["Mobile", "Screening Status"], ["9876543210", "Clear"]],
      SP: [["Mobile", "Selection_Basis", "Remarks"], ["9876543210", "Projects", "Strong projects"]],
      "Monthly Dashboard": [["Metric", "Value"], ["Jobs", "12"]],
    }), "INTERNAL_SCREENING") as {
      applications: { sheet: string; columns: Record<string, number> };
      stages: Record<string, { mode: string; sheet?: string; decisionColumn?: number }>;
    };

    assert.equal(suggested.applications.sheet, "Applied Users");
    assert.deepEqual(suggested.applications.columns, { candidateId: 0, fullName: 3, email: 5, mobile: 4, product: 2 });
    assert.equal(suggested.stages.SCREENING_SHORTLIST?.sheet, "SC");
    assert.equal(suggested.stages.FINAL_SHORTLIST?.sheet, "SP");
    assert.equal(suggested.stages.FINAL_SHORTLIST?.decisionColumn, undefined);
    assert.equal(suggested.stages.RESUME_SHORTLIST?.mode, "MANUAL");
  });

  test("selects only candidate/round tabs in a company workbook", () => {
    const suggested = inferGoogleMapping(workbook({
      "MERN Developer": [
        ["Full Name", "Mobile Number", "Email Id", "TR Round 1", "Final Status"],
        ["Asha Rao", "9876543210", "asha@example.com", "Cleared", ""],
      ],
      "Sheet Notes": [["Name", "Value"], ["Owner", "PSM"]],
      "AIML Engineer": [
        ["Candidate Name", "Email", "Mobile", "Screening Round"],
        ["Ravi Kumar", "ravi@example.com", "9123456780", "Pending"],
      ],
    }), "COMPANY_PIPELINE") as { tabs: { sheet: string; rounds: { roundName: string }[] }[] };

    assert.deepEqual(suggested.tabs.map(({ sheet }) => sheet), ["MERN Developer", "AIML Engineer"]);
    assert.equal(suggested.tabs[0]?.rounds[0]?.roundName, "TR Round 1");
    assert.equal(suggested.tabs[0]?.rounds.length, 1);
  });

  test("an SP tab with only Remarks is still mapped, with Remarks as the selection basis", () => {
    const suggested = inferGoogleMapping(workbook({
      "Applied Users": [["Asha Rao", "9876543210", "asha@example.com", "CCBP Intensive"]],
      SP: [["Mobile", "Remarks"], ["9876543210", "Good communication"]],
    }), "INTERNAL_SCREENING", {
      applications: { sheet: "Applied Users" },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP" },
      },
      acceptOtherJobIds: false,
      overwriteManualDecisions: false,
    }) as { stages: Record<string, { mode: string; remarksColumn?: number; selectionBasisColumn?: number }> };

    assert.equal(suggested.stages.FINAL_SHORTLIST?.mode, "SHEET");
    assert.equal(suggested.stages.FINAL_SHORTLIST?.remarksColumn, 1);
    assert.equal(suggested.stages.FINAL_SHORTLIST?.selectionBasisColumn, 1);
  });

  test("uses only the explicitly selected tabs and maps the SP basis and remarks independently", () => {
    const suggested = inferGoogleMapping(workbook({
      "Applied Users": [
        ["Asha Rao", "9876543210", "asha@example.com", "CCBP Intensive"],
        ["Ravi Kumar", "9123456780", "ravi@example.com", "Academy"],
      ],
      SP: [["Mobile", "Selection_Basis", "Remarks"], ["9876543210", "Projects", "Strong project work"], ["9123456780", "Skills", "Missing required skills"]],
      "Monthly Dashboard": [["Metric", "Value"], ["Jobs", "12"]],
    }), "INTERNAL_SCREENING", {
      applications: { sheet: "Applied Users" },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP" },
      },
      acceptOtherJobIds: false,
      overwriteManualDecisions: false,
    }) as {
      applications: { sheet: string; headerRow: number; columns: Record<string, number> };
      stages: Record<string, { mode: string; sheet?: string; decisionColumn?: number; remarksColumn?: number; selectionBasisColumn?: number }>;
    };

    assert.equal(suggested.applications.sheet, "Applied Users");
    assert.equal(suggested.applications.headerRow, 0);
    assert.deepEqual(suggested.applications.columns, { fullName: 0, email: 2, mobile: 1 });
    assert.equal(suggested.stages.FINAL_SHORTLIST?.mode, "SHEET");
    assert.equal(suggested.stages.FINAL_SHORTLIST?.sheet, "SP");
    assert.equal(suggested.stages.FINAL_SHORTLIST?.selectionBasisColumn, 1);
    assert.equal(suggested.stages.FINAL_SHORTLIST?.remarksColumn, 2);
    assert.equal(suggested.stages.RESUME_SHORTLIST?.mode, "MANUAL");
  });

  test("analyzes only the selected company tabs and suggests their values", () => {
    const suggested = inferGoogleMapping(workbook({
      "MERN Developer": [
        ["Full Name", "Mobile Number", "TR Round 1", "Final Status"],
        ["Asha Rao", "9876543210", "Cleared", "Offer released"],
      ],
      "AIML Engineer": [
        ["Full Name", "Mobile", "Screening Round"],
        ["Ravi Kumar", "9123456780", "Pending"],
      ],
      "Sheet Notes": [["Name", "Value"], ["Owner", "PSM"]],
    }), "COMPANY_PIPELINE", {
      tabs: [{ sheet: "AIML Engineer" }],
      addJobSkills: false,
    }) as {
      tabs: { sheet: string; rounds: { roundName: string }[] }[];
      roundValueMap: Record<string, string>;
      finalValueMap: Record<string, string>;
      addJobSkills: boolean;
    };

    assert.deepEqual(suggested.tabs.map(({ sheet }) => sheet), ["AIML Engineer"]);
    assert.equal(suggested.tabs[0]?.rounds[0]?.roundName, "Screening Round");
    assert.equal(suggested.roundValueMap.pending, "SCHEDULED");
    assert.equal(suggested.finalValueMap["offer released"], undefined);
    assert.equal(suggested.addJobSkills, false);
  });

  test("infers multiple headerless company rounds and a final status", () => {
    const suggested = inferGoogleMapping(workbook({
      "MERN Developer": [
        ["Asha Rao", "9876543210", "Cleared", "Pending", "Offer released"],
        ["Ravi Kumar", "9123456780", "Rejected", "Scheduled", "Joined"],
      ],
    }), "COMPANY_PIPELINE", {
      tabs: [{ sheet: "MERN Developer" }],
      addJobSkills: true,
    }) as {
      tabs: { columns: { fullName?: number; mobile?: number }; rounds: { column: number; roundName: string }[]; finalStatusColumn?: number }[];
      roundValueMap: Record<string, string>;
      finalValueMap: Record<string, string>;
    };

    assert.deepEqual(suggested.tabs[0]?.columns, { fullName: 0, mobile: 1 });
    assert.deepEqual(suggested.tabs[0]?.rounds.map(({ column, roundName }) => [column, roundName]), [[2, "Round 1"], [3, "Round 2"]]);
    assert.equal(suggested.tabs[0]?.finalStatusColumn, 4);
    assert.equal(suggested.roundValueMap.cleared, "CLEARED");
    assert.equal(suggested.roundValueMap.pending, "SCHEDULED");
    assert.equal(suggested.finalValueMap["offer released"], "OFFER_RELEASED");
    assert.equal(suggested.finalValueMap.joined, "JOINED");
  });

  test("recognizes common student-name and phone headers with scientific-notation mobile values", () => {
    const suggested = inferGoogleMapping(workbook({
      TA: [
        ["Name of the Candidate", "Phone No.", "Product"],
        ["Asha Rao", "9.87654321E+09", "CCBP Intensive"],
        ["Ravi Kumar", "9.12345678E+09", "Academy"],
      ],
    }), "INTERNAL_SCREENING") as {
      applications: { sheet: string; columns: Record<string, number> };
    };

    assert.equal(suggested.applications.sheet, "TA");
    assert.deepEqual(suggested.applications.columns, { fullName: 0, mobile: 1, product: 2 });
  });

  test("allows a selected TA tab with mobile and resume columns but no name column", () => {
    const suggested = inferGoogleMapping(workbook({
      TA: [
        ["mobile", "resume"],
        ["9876543210", "https://example.com/resume"],
      ],
    }), "INTERNAL_SCREENING");

    assert.equal(suggested.applications.sheet, "TA");
    assert.deepEqual(suggested.applications.columns, { mobile: 0, resumeUrl: 1 });
    assert.equal(internalMappingSchema.safeParse(suggested).success, true);
  });

  test("uses the explicitly selected product tab and matches it by candidate identifier", () => {
    const suggested = inferGoogleMapping(workbook({
      TA: [["mobile", "resume"], ["9876543210", "https://example.com/resume"]],
      "Student Details": [
        ["UUID", "Name", "Mobile", "Product"],
        ["00000000-0000-4000-8000-000000000001", "Asha Rao", "9876543210", "CCBP_INTENSIVE"],
      ],
    }), "INTERNAL_SCREENING", {
      applications: { sheet: "TA" },
      productLookupSheet: "Student Details",
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
      acceptOtherJobIds: false,
      overwriteManualDecisions: false,
    });

    assert.deepEqual(suggested.productsLookup, {
      sheet: "Student Details",
      headerRow: 1,
      keyType: "mobile",
      keyColumn: 2,
      productColumn: 3,
    });
  });

  test("uses shortlist tabs as supplemental sources for resume and profile details", () => {
    const suggested = inferGoogleMapping(workbook({
      TA: [["mobile"], ["9876543210"]],
      RS: [
        ["UUID", "Mobile", "Resume"],
        ["00000000-0000-4000-8000-000000000001", "9876543210", "https://example.com/resume"],
      ],
    }), "INTERNAL_SCREENING", {
      applications: { sheet: "TA" },
      stages: {
        RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
      acceptOtherJobIds: false,
      overwriteManualDecisions: false,
    });

    assert.deepEqual(suggested.profileLookups.map(({ sheet, keyType, keyColumn, columns }) => ({ sheet, keyType, keyColumn, mobile: columns.mobile, resumeUrl: columns.resumeUrl })), [
      { sheet: "RS", keyType: "mobile", keyColumn: 1, mobile: 1, resumeUrl: 2 },
    ]);
  });

  test("detects Applied Users and Form Responses as profile sources for selected TA", () => {
    const suggested = inferGoogleMapping(workbook({
      TA: [
        ["mobileno", "resume"],
        ["9876543210", "https://example.com/resume"],
      ],
      "Applied Users": [
        ["User Id", "Name", "Phone Number", "Email"],
        ["00000000-0000-4000-8000-000000000001", "Asha Rao", "9876543210", "asha@example.com"],
      ],
      "Form Responses 1": [
        ["Timestamp", "Email Address", "UID", "Full Name", "Registered Mobile Number", "Gender", "State"],
        ["2026-10-25", "asha@example.com", "00000000-0000-4000-8000-000000000001", "Asha Rao", "9876543210", "Female", "Telangana"],
      ],
      SC: [["mobile", "decision"], ["9876543210", "consider"]],
    }), "INTERNAL_SCREENING", {
      applications: { sheet: "TA" },
      stages: {
        RESUME_SHORTLIST: { mode: "MANUAL" },
        SCREENING_SHORTLIST: { mode: "MANUAL" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "MANUAL" },
      },
      acceptOtherJobIds: false,
      overwriteManualDecisions: false,
    });

    assert.deepEqual(suggested.profileLookups.map(({ sheet }) => sheet), ["Applied Users", "Form Responses 1"]);
    assert.deepEqual(suggested.applications.columns, { mobile: 0, resumeUrl: 1 });
    const parsed = internalMappingSchema.safeParse(suggested);
    assert.equal(parsed.success, true, parsed.success ? undefined : JSON.stringify(parsed.error.issues));
  });

  test("uses screening status instead of resume decision when both columns are on SC", () => {
    const suggested = inferGoogleMapping(workbook({
      "Applied Users": [
        ["User Id", "Name", "Mobile Number"],
        ["u-1", "Asha Rao", "9876543210"],
      ],
      SC: [
        ["mobile", "resume", "priority", "resume decision", "email or reason", "tech", "comm", "screening status", "remark"],
        ["9876543210", "", "P1", "c", "asha@example.com", "4", "5", "consider", ""],
        ["9123456780", "", "P2", "reject", "no projects", "2", "3", "hold", "review later"],
      ],
    }), "INTERNAL_SCREENING") as {
      stages: Record<string, { decisionColumn?: number; valueMap: Record<string, string> }>;
    };

    assert.equal(suggested.stages.SCREENING_SHORTLIST?.decisionColumn, 7);
    assert.deepEqual(suggested.stages.SCREENING_SHORTLIST?.valueMap, {
      consider: "SELECTED",
      hold: "ON_HOLD",
    });
  });

  test("does not mistake emails and reasons in a generic SC status column for decisions", () => {
    const suggested = inferGoogleMapping(workbook({
      "Applied Users": [
        ["User Id", "Name", "Mobile Number"],
        ["u-1", "Asha Rao", "9876543210"],
      ],
      SC: [
        ["mobile", "resume", "tech", "comm", "status", "name"],
        ["9876543210", "", "4", "5", "asha@example.com", ""],
        ["9123456780", "", "3", "4", "no projects", ""],
      ],
    }), "INTERNAL_SCREENING") as {
      stages: Record<string, { mode: string }>;
    };

    assert.equal(suggested.stages.SCREENING_SHORTLIST?.mode, "MANUAL");
  });

  test("a tab named TA is the applications tab even when Applied Users comes first", () => {
    const suggested = inferGoogleMapping(workbook({
      "Form Responses 1": [["Timestamp", "Full Name", "Registered Mobile Number"], ["t", "Ravi Kumar", "9123456780"]],
      "Applied Users": [["User Id", "Product", "Name", "Phone Number"], ["u-1", "CCBP_INTENSIVE", "Asha Rao", "9876543210"]],
      TA: [["mobileno", "resume"], ["9876543210", "https://r/1"], ["9123456780", "https://r/2"]],
      RS: [["mobile", "resume", "priority"], ["9123456780", "https://r/2", "p1"]],
    }), "INTERNAL_SCREENING") as {
      applications: { sheet: string };
      profileLookups: { sheet: string; columns: Record<string, number> }[];
    };

    assert.equal(suggested.applications.sheet, "TA");
    // Applied Users is the first-priority detail source, then form responses, then stage tabs.
    assert.deepEqual(suggested.profileLookups.map(({ sheet }) => sheet), ["Applied Users", "Form Responses 1", "RS"]);
    assert.equal(suggested.profileLookups[0]!.columns.product, 1);
  });
});
