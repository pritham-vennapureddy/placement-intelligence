import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkbook, excelSheetName, excelSheetNames, gridChecksum } from "./google-snapshot.js";
import { readWorkbook } from "./workbook.js";
import type { SpreadsheetGrid } from "../sheets/google-sheets.service.js";

const grid: SpreadsheetGrid = {
  title: "Asama.ai :: Internal :: 27-10-2026",
  sheets: [
    {
      title: "Applied Users",
      rows: [
        [{ text: "User Id" }, { text: "Name" }, { text: "Resume Link" }],
        [{ text: "u-1" }, { text: "Asha Rao" }, { text: "resume", link: "https://files.example.com/u-1.pdf" }],
        [],
        [{ text: "u-2" }, { text: "Ravi Kumar" }, { text: "" }],
      ],
    },
    { title: "A very long tab name that Excel would never accept: SC/RS", rows: [[{ text: "mobile" }], [{ text: "9876543210" }]] },
    { title: "A very long tab name that Excel would never accept: SP", rows: [[{ text: "mobile" }]] },
  ],
};

test("a Google Sheet snapshot reads back through the normal workbook reader, links included", async () => {
  const workbook = await readWorkbook(await buildWorkbook(grid), "snapshot.xlsx");
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), [
    "Applied Users",
    "A very long tab name that Excel",
    "A very long tab name that E (2)",
  ]);
  const { headers, rows } = workbook.read("Applied Users", 1);
  assert.deepEqual(headers, ["User Id", "Name", "Resume Link"]);
  assert.equal(rows.length, 2, "empty rows are skipped");
  assert.equal(rows[0]!.links[2], "https://files.example.com/u-1.pdf");
  assert.equal(rows[1]!.rowNumber, 4, "row numbers match the sheet");
});

test("tab names are made Excel-safe the same way every time", () => {
  const first = new Set<string>();
  const second = new Set<string>();
  const names = ["Sheet[1]", "Sheet:1", "SP"];
  assert.deepEqual(names.map((name) => excelSheetName(name, first)), ["Sheet 1", "Sheet 1 (2)", "SP"]);
  assert.deepEqual(names.map((name) => excelSheetName(name, second)), ["Sheet 1", "Sheet 1 (2)", "SP"]);
});

test("the content fingerprint changes only when the content does", () => {
  const same = structuredClone(grid);
  assert.equal(gridChecksum(grid), gridChecksum(same));
  same.sheets[0]!.rows[1]![1] = { text: "Asha R." };
  assert.notEqual(gridChecksum(grid), gridChecksum(same));
});

test("excelSheetNames matches the worksheet names buildWorkbook writes, in order", async () => {
  const names = excelSheetNames(grid.sheets);
  const workbook = await readWorkbook(await buildWorkbook(grid), "snapshot.xlsx");
  assert.deepEqual(workbook.sheets.map(({ name }) => name), names);
});
