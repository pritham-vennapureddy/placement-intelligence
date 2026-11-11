import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectHeaderRow, readWorkbook, restoreWorkbook, serializeWorkbook } from "./workbook.js";

describe("workbook header detection", () => {
  test("finds header labels after a title row", async () => {
    const workbook = await readWorkbook(
      Buffer.from("Placement applicants\nuser_id,mobile_number,email_id\nAsha Rao,9876543210,asha@example.com\n"),
      "applicants.csv",
    );

    assert.equal(detectHeaderRow(workbook.top("CSV", 10)), 2);
    assert.deepEqual(workbook.read("CSV", 2).rows.map(({ rowNumber }) => rowNumber), [3]);
  });

  test("keeps the first row as data when no header is detected", async () => {
    const workbook = await readWorkbook(
      Buffer.from("Asha Rao,9876543210,Academy Intensive\nRavi Kumar,9123456780,External\n"),
      "headerless.csv",
    );
    const headerRow = detectHeaderRow(workbook.top("CSV", 10));
    const read = workbook.read("CSV", headerRow);

    assert.equal(headerRow, 0);
    assert.deepEqual(read.headers, []);
    assert.deepEqual(read.rows.map(({ rowNumber }) => rowNumber), [1, 2]);
  });
});

describe("database-backed workbook snapshots", () => {
  test("round-trips sheet metadata, row numbers, cell values, and links", async () => {
    const workbook = await readWorkbook(
      Buffer.from("Student,Mobile,Resume\nAsha Rao,9876543210,https://files.example.com/asha.pdf\n"),
      "students.csv",
    );
    const restored = restoreWorkbook(serializeWorkbook(workbook));

    assert.deepEqual(restored.sheets, workbook.sheets);
    assert.deepEqual(restored.top("CSV", 10), workbook.top("CSV", 10));
    assert.deepEqual(restored.read("CSV", 1), workbook.read("CSV", 1));
  });

  test("rejects invalid or incomplete snapshots with an actionable error", () => {
    assert.throws(() => restoreWorkbook({ version: 1, sheets: [{ name: "TA" }], rowsBySheet: {} }), /source snapshot.*invalid/i);
    assert.throws(() => restoreWorkbook(null), /source snapshot.*unavailable/i);
  });

  test("stores blank links as JSON nulls instead of undefined array entries", () => {
    const workbook = {
      sheets: [{ name: "TA", rowCount: 1, columnCount: 2 }],
      read: () => ({ headers: [], rows: [{ rowNumber: 1, cells: ["Asha", ""], links: [undefined, "https://resume.example/asha.pdf"] }] }),
      top: () => [],
    };
    const snapshot = serializeWorkbook(workbook);

    assert.deepEqual(snapshot.rowsBySheet.TA![0]!.links, [null, "https://resume.example/asha.pdf"]);
    assert.deepEqual(restoreWorkbook(snapshot).read("TA", 0).rows[0]!.links, [undefined, "https://resume.example/asha.pdf"]);
  });
});
