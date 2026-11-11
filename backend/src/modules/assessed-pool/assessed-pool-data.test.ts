import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  autoAssessedPoolMapping,
  competenciesForRow,
  competencyLevelForRow,
  competencyHeaderInfo,
  groupRowsByMobile,
  isCompetencyPoolSheet,
  processTypeForSheet,
  rawRowData,
  sourceNameForRow,
} from "./assessed-pool-data.js";

describe("assessed-pool sheet data", () => {
  test("classifies process from the source tab while leaving competency pool unclassified", () => {
    assert.equal(processTypeForSheet("Offline Attended - Old Process"), "OLD");
    assert.equal(processTypeForSheet("Offline Pool Main"), "NEW");
    assert.equal(processTypeForSheet("Competency Pool Main"), "UNKNOWN");
  });

  test("extracts names and identifies competency pool membership from the source tab", () => {
    assert.equal(sourceNameForRow(["User ID", "Student Name", "Mobile"], ["uuid", "A Student", "9876543210"]), "A Student");
    assert.equal(sourceNameForRow(["UID", "Mobile"], ["uuid", "9876543210"]), null);
    assert.equal(isCompetencyPoolSheet("Competency Pool Main"), true);
    assert.equal(isCompetencyPoolSheet("Offline Pool Main"), false);
  });

  test("extracts C-levels for competency analytics", () => {
    assert.equal(competencyLevelForRow(["Student Name", "Competency Level"], ["A Student", "c1"], "Competency Pool Main"), "C1");
    assert.equal(competencyLevelForRow(["Student Name", "Competency"], ["A Student", "C2"], "Competency Pool Main"), "C2");
    assert.equal(competencyLevelForRow(["Competency Status"], ["Cleared"], "Competency Pool Main"), null);
    assert.equal(competencyLevelForRow(["Level"], ["C3"], "Competency Pool Main"), "C3");
  });

  test("combines grouped competency headers with their metric headers", () => {
    const header = competencyHeaderInfo([
      {
        rowNumber: 1,
        cells: ["User ID", "C1 Programming with Problem Solving (DSA)", "", "", "C2 Frontend Development"],
        links: [],
      },
      {
        rowNumber: 2,
        cells: ["", "Overall Score (out of 100)", "Verdict Band", "Clearance Status", "Overall Score (out of 100)"],
        links: [],
      },
    ]);

    assert.deepEqual(header, {
      headerRow: 2,
      headers: [
        "User ID",
        "C1 Programming with Problem Solving (DSA) - Overall Score (out of 100)",
        "C1 Programming with Problem Solving (DSA) - Verdict Band",
        "C1 Programming with Problem Solving (DSA) - Clearance Status",
        "C2 Frontend Development - Overall Score (out of 100)",
      ],
    });
  });

  test("extracts score, verdict, clearance, and level for each competency", () => {
    const headers = [
      "C1 Programming with Problem Solving - Overall Score (out of 100)",
      "C1 Programming with Problem Solving - Verdict Band",
      "C1 Programming with Problem Solving - Clearance Status",
      "C1 Programming with Problem Solving - Levels",
      "C2 Frontend Development - Overall Score (out of 100)",
    ];
    assert.deepEqual(competenciesForRow(headers, ["87.5", "Strong", "Cleared", "C2", "101"]), [
      {
        code: "C1",
        title: "Programming with Problem Solving (DSA)",
        score: 87.5,
        verdictBand: "Strong",
        clearanceStatus: "Cleared",
        level: "C2",
      },
    ]);
  });

  test("automatically maps mobile and supported assessment fields from workbook headers", () => {
    assert.deepEqual(
      autoAssessedPoolMapping(["User ID", "Student Name", "Student \nMobile Number", "Bucket", "TR1 Status", "TR2 Status"]),
      { mobile: 2, sourceUserId: 0, bucketTier: 3, tr1Status: 4, tr2Status: 5 },
    );
    assert.deepEqual(autoAssessedPoolMapping(["UUID", "Mobile", "Competency Level"]), {
      mobile: 1,
      sourceUserId: 0,
      competencyLevel: 2,
    });
    assert.deepEqual(autoAssessedPoolMapping(["Student Mobile Number", "Salary Bucket"]), { mobile: 0 });
    assert.equal(autoAssessedPoolMapping(["User ID", "Student Name"]), null);
  });

  test("preserves duplicate headers, blank headers, values, and hyperlinks by column", () => {
    assert.deepEqual(rawRowData("Pool", ["Resume", "Company", "Company"], {
      rowNumber: 4,
      cells: ["Resume", "First", "Second", "Other"],
      links: ["https://example.test/resume", undefined, undefined, undefined],
    }), {
      Pool: {
        rowNumber: 4,
        columns: [
          { column: 1, header: "Resume", value: "Resume", link: "https://example.test/resume" },
          { column: 2, header: "Company", value: "First" },
          { column: 3, header: "Company", value: "Second" },
          { column: 4, header: "", value: "Other" },
        ],
      },
    });
  });

  test("groups duplicate mobile rows without discarding their source rows", () => {
    const first = { rowNumber: 3, cells: ["First"], links: [] };
    const second = { rowNumber: 4, cells: ["Second"], links: [] };
    const result = groupRowsByMobile([
      { mobile: "9876543210", row: first },
      { mobile: "9876543210", row: second },
      { mobile: "9123456780", row: { rowNumber: 5, cells: ["Third"], links: [] } },
    ]);

    assert.equal(result.mergedDuplicateMobile, 1);
    assert.deepEqual(result.rowsByMobile.get("9876543210"), [first, second]);
  });
});
