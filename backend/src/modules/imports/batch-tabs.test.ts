import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { duplicateTabs, mappingMatchesTabs, parseBatchTabs, selectionFromTabs, tabsFromMapping } from "./batch-tabs.js";

describe("recruitment batch tabs", () => {
  test("stored tabs keep only non-empty names; nothing chosen is null", () => {
    assert.deepEqual(parseBatchTabs({ TA: " TA-1 ", RS: "", SC: null, SP: "SP-1", junk: "x" }), { TA: "TA-1", SP: "SP-1" });
    assert.equal(parseBatchTabs({ TA: "", RS: null }), null);
    assert.equal(parseBatchTabs(null), null);
  });

  test("a saved mapping's tabs become the batch's TA / stage codes", () => {
    const mapping = {
      applications: { sheet: "TA-1" },
      stages: {
        RESUME_SHORTLIST: { mode: "SHEET", sheet: "RS-1" },
        SCREENING_SHORTLIST: { mode: "NOT_CONDUCTED" },
        ASSIGNMENT_SHORTLIST: { mode: "MANUAL" },
        FINAL_SHORTLIST: { mode: "SHEET", sheet: "SP-1" },
      },
    };
    assert.deepEqual(tabsFromMapping(mapping), { TA: "TA-1", RS: "RS-1", SP: "SP-1" });
    assert.equal(mappingMatchesTabs(mapping, { TA: "TA-1", RS: "RS-1", SP: "SP-1" }), true);
    assert.equal(mappingMatchesTabs(mapping, { TA: "TA", RS: "RS-1" }), false, "a different TA tab means the PSM changed the batch");
  });

  test("the batch's tabs become an import selection; missing stage tabs are left to map by hand", () => {
    const result = selectionFromTabs({ TA: "TA-1", RS: "RS-1", SP: "SP old" }, ["TA", "TA-1", "RS-1", "SP-1"]);
    assert.ok(result);
    assert.deepEqual(result.selection.applications, { sheet: "TA-1" });
    assert.deepEqual(result.selection.stages.RESUME_SHORTLIST, { mode: "SHEET", sheet: "RS-1" });
    assert.deepEqual(result.selection.stages.FINAL_SHORTLIST, { mode: "MANUAL" });
    assert.deepEqual(result.missing, ["SP old"]);
  });

  test("without a usable TA tab the import falls back to detecting tabs", () => {
    assert.equal(selectionFromTabs({ RS: "RS-1" }, ["TA", "RS-1"]), null);
    assert.equal(selectionFromTabs({ TA: "Renamed" }, ["TA", "RS"]), null);
    assert.equal(selectionFromTabs(null, ["TA"]), null);
  });

  test("one tab cannot be two stages (case-insensitive)", () => {
    assert.deepEqual(duplicateTabs({ TA: "TA", RS: "rs", SC: "RS" }), ["RS"]);
    assert.deepEqual(duplicateTabs({ TA: "TA", RS: "RS" }), []);
  });
});
