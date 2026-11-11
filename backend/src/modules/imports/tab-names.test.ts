import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { inferGoogleMapping } from "./google-sheet-analysis.js";
import { reusableMapping } from "./imports.service.js";
import { isRecruitmentTab, sheetsInMapping, suggestRecruitmentTab, tabNumber } from "./tab-names.js";
import { restoreWorkbook } from "./workbook.js";

function workbook(sheets: Record<string, string[][]>) {
  return restoreWorkbook({
    version: 1,
    sheets: Object.entries(sheets).map(([name, rows]) => ({ name, rowCount: rows.length, columnCount: rows[0]?.length ?? 0 })),
    rowsBySheet: Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, rows.map((cells, index) => ({ rowNumber: index + 1, cells, links: cells.map(() => null) }))])),
  });
}

const stageTab = [["Name", "mobile", "priority"], ["Asha Rao", "9876543210", "P1"]];
const spTab = [["mobile", "priority", "selection basis"], ["9876543210", "P1", "screening"]];
const taTab =[["mobileno", "resume"], ["9876543210", "https://example.com/a.pdf"]];
const sheets = {
  "Applied Users": [["Name", "Phone Number", "Product"], ["Asha Rao", "9876543210", "CCBP_INTENSIVE"]],
  TA: taTab, RS: stageTab, SP: spTab,
  "TA-1": taTab, "RS-1": stageTab, "SP-1": spTab,
};

describe("recruitment tab names", () => {
  test("recognise numbered batch tabs", () => {
    for (const name of ["TA", "ta", "TA-1", "TA 2", "TA_3", "TA (2)", "TA#4"]) assert.ok(isRecruitmentTab(name, "TA"), name);
    for (const name of ["TAB", "Total", "Applied Users", "RS-1"]) assert.equal(isRecruitmentTab(name, "TA"), false, name);
    assert.deepEqual(["TA", "TA-1", "TA (2)"].map(tabNumber), [0, 1, 2]);
  });

  test("suggest the lowest-numbered tab no other batch uses", () => {
    const tabs = Object.keys(sheets).map((name) => ({ name }));
    assert.equal(suggestRecruitmentTab(tabs, "TA", new Set())?.name, "TA");
    assert.equal(suggestRecruitmentTab(tabs, "TA", new Set(["TA"]))?.name, "TA-1");
    assert.equal(suggestRecruitmentTab(tabs, "TA", new Set(["TA", "TA-1"])), undefined);
  });

  test("a new batch is offered the tabs batch 1 does not use", () => {
    const used = new Set(sheetsInMapping({ applications: { sheet: "TA" }, stages: { RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS" }, FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP" }, SCREENING_SHORTLIST: { mode: "MANUAL" } } }));
    const mapping = inferGoogleMapping(workbook(sheets), "INTERNAL_SCREENING", undefined, used);
    assert.equal(mapping.applications.sheet, "TA-1");
    assert.equal((mapping.stages.RESUME_SHORTLIST as { sheet?: string }).sheet, "RS-1");
    assert.equal((mapping.stages.FINAL_SHORTLIST as { sheet?: string }).sheet, "SP-1");
    assert.equal(mapping.productsLookup?.sheet, "Applied Users");
  });

  test("a batch saved on TA-1 keeps it when re-imported", () => {
    const saved = { applications: { sheet: "TA-1", headerRow: 1, columns: { mobile: 0 } }, profileLookups: [], stages: {}, productTabConfirmed: true };
    const result = reusableMapping(saved, workbook(sheets), "INTERNAL_SCREENING", new Set(["TA", "RS", "SP"])) as typeof saved;
    assert.equal(result.applications.sheet, "TA-1");
  });
});
