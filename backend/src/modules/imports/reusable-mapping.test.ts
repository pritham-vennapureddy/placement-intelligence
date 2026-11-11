import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reusableMapping } from "./imports.service.js";
import { restoreWorkbook } from "./workbook.js";

function workbook(sheets: Record<string, string[][]>) {
  return restoreWorkbook({
    version: 1,
    sheets: Object.entries(sheets).map(([name, rows]) => ({ name, rowCount: rows.length, columnCount: rows[0]?.length ?? 0 })),
    rowsBySheet: Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, rows.map((cells, index) => ({ rowNumber: index + 1, cells, links: cells.map(() => null) }))])),
  });
}

const sheets = {
  "Applied Users": [["Name", "Phone Number", "Product"], ["Asha Rao", "9876543210", "CCBP_INTENSIVE"]],
  TA: [["mobileno", "resume"], ["9876543210", "https://example.com/a.pdf"], ["9123456780", "https://example.com/b.pdf"]],
  RS: [["mobile", "priority"], ["9876543210", "P1"]],
};
const saved = {
  applications: { sheet: "Applied Users", headerRow: 1, columns: { fullName: 0, mobile: 1, product: 2 } },
  profileLookups: [{ sheet: "TA", headerRow: 1, keyType: "mobile", keyColumn: 0, columns: { mobile: 0 } }],
  stages: { RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS" } },
  productsLookup: { sheet: "Applied Users", headerRow: 1, keyType: "mobile", keyColumn: 1, productColumn: 2 },
  productTabConfirmed: true,
  acceptOtherJobIds: true,
};

describe("reusableMapping", () => {
  test("switches an earlier Applied Users mapping to the TA tab and keeps other choices", () => {
    const result = reusableMapping(saved, workbook(sheets), "INTERNAL_SCREENING") as typeof saved;
    assert.equal(result.applications.sheet, "TA");
    assert.equal(result.applications.columns.mobile, 0);
    assert.ok(result.profileLookups.some(({ sheet }) => sheet === "Applied Users"));
    assert.ok(!result.profileLookups.some(({ sheet }) => sheet === "TA"));
    assert.deepEqual(result.stages, saved.stages);
    assert.equal(result.acceptOtherJobIds, true);
  });

  test("keeps the saved mapping when it already reads TA or the workbook has no TA tab", () => {
    const onTa = { ...saved, applications: { ...saved.applications, sheet: "TA" } };
    assert.equal(reusableMapping(onTa, workbook(sheets), "INTERNAL_SCREENING"), onTa);
    const { TA: _ta, ...withoutTa } = sheets;
    assert.equal(reusableMapping(saved, workbook(withoutTa), "INTERNAL_SCREENING"), saved);
    assert.equal(reusableMapping(saved, workbook(sheets), "COMPANY_PIPELINE"), saved);
  });

  test("an unconfirmed, auto-detected product tab is detected again, preferring Applied Users", () => {
    const eligible = { ...sheets, "Eligible Students": [["mobile", "product"], ["9123456780", "External"]] };
    const unconfirmed = { ...saved, applications: { ...saved.applications, sheet: "TA" }, productTabConfirmed: false, productsLookup: { ...saved.productsLookup, sheet: "Eligible Students" } };
    const result = reusableMapping(unconfirmed, workbook(eligible), "INTERNAL_SCREENING") as typeof saved;
    assert.equal(result.productsLookup.sheet, "Applied Users");
    assert.equal(result.productsLookup.productColumn, 2);
    const confirmed = { ...unconfirmed, productTabConfirmed: true };
    assert.equal(reusableMapping(confirmed, workbook(eligible), "INTERNAL_SCREENING"), confirmed);
  });
});
