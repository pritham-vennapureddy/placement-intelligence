import assert from "node:assert/strict";
import { test } from "node:test";
import { packSnapshot, unpackSnapshot } from "./imports.repository.js";

test("a workbook snapshot survives gzip packing unchanged and shrinks", () => {
  const row = { rowNumber: 2, cells: ["Ravi Kumar", "9876543210", "ravi@example.com", "CCBP Academy"], links: [null, null, null, "https://drive.google.com/x"] };
  const snapshot = {
    sheets: [{ name: "TA", rowCount: 500, columnCount: 4 }],
    rowsBySheet: { TA: Array.from({ length: 500 }, (_, index) => ({ ...row, rowNumber: index + 2 })) },
    unicode: "తెలుగు ✓ “quotes”",
  };
  const packed = packSnapshot(snapshot);
  assert.ok(packed.byteLength < JSON.stringify(snapshot).length / 5, "repeated rows compress well");
  assert.deepEqual(unpackSnapshot(packed), snapshot);
});
