import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createConnectionSchema, createMappingSchema } from "./sheets.validators.js";

describe("Google Sheets connection types", () => {
  test("accepts only internal-process and company-process workbooks", () => {
    assert.equal(createConnectionSchema.safeParse({
      url: "https://docs.google.com/spreadsheets/d/example/edit",
      sourceType: "INTERNAL_PROCESS",
    }).success, true);
    assert.equal(createConnectionSchema.safeParse({
      url: "https://docs.google.com/spreadsheets/d/example/edit",
      sourceType: "COMPANY_PROCESS",
    }).success, true);
    assert.equal(createConnectionSchema.safeParse({
      url: "https://docs.google.com/spreadsheets/d/example/edit",
      sourceType: "STUDENT_APPLICATIONS",
    }).success, false);
  });

  test("accepts a headerless tab mapping using a stable column index", () => {
    assert.equal(createMappingSchema.safeParse({
      workflowStage: "BUCKET_POOL",
      sheetId: 12,
      sheetTitle: "Bucket A",
      headerRow: 0,
      columnMapping: { candidate_id: "__column_3__" },
    }).success, true);
  });
});
