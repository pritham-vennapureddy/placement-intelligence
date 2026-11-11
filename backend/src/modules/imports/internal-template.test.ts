import assert from "node:assert/strict";
import test from "node:test";
import { inferGoogleMapping } from "./google-sheet-analysis.js";
import { buildInternalTemplate } from "./internal-template.js";
import { readWorkbook } from "./workbook.js";

test("internal template uses tabs and headers recognized by the Google Sheets importer", async () => {
  const workbook = await readWorkbook(await buildInternalTemplate(), "internal-screening-standard.xlsx");
  const mapping = inferGoogleMapping(workbook, "INTERNAL_SCREENING");

  assert.deepEqual(workbook.sheets.map(({ name }) => name), ["Read Me", "TA", "Student Details", "RS", "SC", "AS", "SP"]);
  assert.equal(mapping.applications.sheet, "TA");
  assert.equal(mapping.applications.headerRow, 1);
  assert.equal(mapping.applications.columns.fullName, 1);
  assert.equal(mapping.applications.columns.email, 2);
  assert.equal(mapping.applications.columns.mobile, 3);
  assert.equal(mapping.applications.columns.product, 4);
  assert.equal(mapping.profileLookups[0]?.sheet, "Student Details");
  assert.equal(mapping.profileLookups[0]?.columns.resumeUrl, 4);
  assert.equal(mapping.profileLookups[0]?.columns.city, 6);
  assert.equal(mapping.profileLookups[0]?.columns.academicScore, 12);
  assert.deepEqual(
    Object.values(mapping.stages).map((stage) => (stage as { sheet?: string }).sheet),
    ["RS", "SC", "AS", "SP"],
  );
  assert.equal((mapping.stages.RESUME_SHORTLIST as { remarksColumn?: number }).remarksColumn, 9);
  assert.equal((mapping.stages.RESUME_SHORTLIST as { reasonColumn?: number }).reasonColumn, 8);
  assert.equal((mapping.stages.FINAL_SHORTLIST as { selectionBasisColumn?: number }).selectionBasisColumn, 1);
  assert.equal((mapping.stages.FINAL_SHORTLIST as { remarksColumn?: number }).remarksColumn, 2);
  assert.equal((mapping.stages.FINAL_SHORTLIST as { decisionColumn?: number }).decisionColumn, undefined);
});
