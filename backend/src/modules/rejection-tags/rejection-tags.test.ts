import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkInterviewSchema, interviewSchema } from "../pipeline/pipeline.validators.js";
import { tagLabelSchema } from "./rejection-tags.routes.js";
import { cleanTagLabel } from "./rejection-tags.service.js";

const tagId = "8a6f2c1e-3b4d-4e5f-9a7b-1c2d3e4f5a6b";

test("a reason label is tidied so the same reason is not added twice", () => {
  assert.equal(cleanTagLabel("  Weak   in\tSQL "), "Weak in SQL");
  assert.equal(tagLabelSchema.safeParse({ label: "x" }).success, false);
  assert.equal(tagLabelSchema.safeParse({ label: "y".repeat(81) }).success, false);
  assert.equal(tagLabelSchema.safeParse({ label: "Weak in SQL" }).success, true);
});

test("a round result takes a reason tag, a note and a full doc link", () => {
  assert.equal(interviewSchema.safeParse({ outcome: "REJECTED", rejectionTagId: tagId, rejectionReason: "Weak DSA", rejectionDocUrl: "https://docs.google.com/d/1" }).success, true);
  assert.equal(interviewSchema.safeParse({ outcome: "REJECTED", rejectionDocUrl: "docs.google.com/d/1" }).success, false);
  assert.equal(interviewSchema.safeParse({ outcome: "REJECTED", rejectionTagId: "not-a-uuid" }).success, false);
  assert.equal(interviewSchema.safeParse({ outcome: "CLEARED", rejectionTagId: null, rejectionDocUrl: null }).success, true);
});

test("one round result can be saved for several students at once", () => {
  const ids = ["1b4e28ba-2fa1-41d2-883f-0016d3cca427", "2c5f39cb-3ab2-42e3-994a-1127e4ddb538"];
  assert.equal(bulkInterviewSchema.safeParse({ nominationIds: ids, outcome: "REJECTED", rejectionTagId: tagId }).success, true);
  assert.equal(bulkInterviewSchema.safeParse({ nominationIds: [], outcome: "REJECTED" }).success, false);
  assert.equal(bulkInterviewSchema.safeParse({ nominationIds: ids, outcome: "PASSED" }).success, false);
});

test("every product shows as Academy, Intensive or External", async () => {
  const { universalProductLabel } = await import("@placement/shared");
  assert.equal(universalProductLabel("CCBP Academy Smart"), "Academy");
  assert.equal(universalProductLabel("CCBP Academy Genius Career Plus"), "Academy");
  assert.equal(universalProductLabel("Intensive College Plus"), "Intensive");
  assert.equal(universalProductLabel("CCBP Intensive NSDC Skill India"), "Intensive");
  assert.equal(universalProductLabel("ACADEMY_INTENSIVE"), "Intensive");
  assert.equal(universalProductLabel("External"), "External");
  assert.equal(universalProductLabel(null), null);
});
