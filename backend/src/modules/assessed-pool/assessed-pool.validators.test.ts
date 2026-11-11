import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assessedPoolLookupQuerySchema, importQuerySchema, previewQuerySchema, sourceConnectBodySchema } from "./assessed-pool.validators.js";

describe("assessed-pool upload validation", () => {
  test("accepts a mobile mapping and optional analytics columns", () => {
    const parsed = importQuerySchema.parse({
      fileName: "pool.xlsx",
      sheet: "Form Responses 1",
      mapping: JSON.stringify({ mobile: 4, sourceUserId: 1, tr1Status: 5, tr2Status: 6, competencyLevel: 7 }),
    });

    assert.deepEqual(parsed.mapping, { mobile: 4, sourceUserId: 1, tr1Status: 5, tr2Status: 6, competencyLevel: 7 });
    assert.equal(parsed.sheet, "Form Responses 1");
  });

  test("requires a mobile column and valid column indices", () => {
    assert.throws(() => importQuerySchema.parse({
      fileName: "pool.xlsx",
      mapping: JSON.stringify({ bucketTier: 3 }),
    }));
    assert.throws(() => importQuerySchema.parse({
      fileName: "pool.xlsx",
      mapping: JSON.stringify({ mobile: 200 }),
    }));
  });

  test("rejects malformed mapping JSON and invalid preview rows", () => {
    assert.throws(() => importQuerySchema.parse({ fileName: "pool.xlsx", mapping: "{" }));
    assert.deepEqual(previewQuerySchema.parse({ fileName: "pool.xlsx" }), { fileName: "pool.xlsx" });
  });

  test("connects a Google source by URL and selects the configured assessed-pool tabs server-side", () => {
    assert.deepEqual(sourceConnectBodySchema.parse({ url: "https://docs.google.com/spreadsheets/d/example" }), {
      url: "https://docs.google.com/spreadsheets/d/example",
    });
    assert.throws(() => sourceConnectBodySchema.parse({ url: "" }));
  });

  test("validates and trims assessed-pool lookup searches", () => {
    assert.deepEqual(assessedPoolLookupQuerySchema.parse({ search: "  sample name  " }), { search: "sample name" });
    assert.throws(() => assessedPoolLookupQuerySchema.parse({ search: "x" }));
    assert.throws(() => assessedPoolLookupQuerySchema.parse({ search: "x".repeat(121) }));
  });
});
