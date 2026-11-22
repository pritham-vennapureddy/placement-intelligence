import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bucketRejectionReason } from "./rejection-buckets.js";

describe("bucketRejectionReason", () => {
  test("groups free-text reasons into macro reasons", () => {
    assert.equal(bucketRejectionReason("No show"), "Did not attend / no response");
    assert.equal(bucketRejectionReason("Did not attend the screening call"), "Did not attend / no response");
    assert.equal(bucketRejectionReason("Not interested in the role"), "Not interested / withdrew");
    assert.equal(bucketRejectionReason("CGPA below 7"), "Eligibility (academics, batch, location)");
    assert.equal(bucketRejectionReason("Poor communication"), "Communication");
    assert.equal(bucketRejectionReason("Weak in DSA"), "Technical / coding");
    assert.equal(bucketRejectionReason("Low aptitude score"), "Aptitude / test score");
    assert.equal(bucketRejectionReason("Resume not relevant"), "Resume / profile fit");
    assert.equal(bucketRejectionReason("Something unusual"), "Other");
  });

  test("treats blank reasons as not recorded", () => {
    assert.equal(bucketRejectionReason(""), "Reason not recorded");
    assert.equal(bucketRejectionReason("   "), "Reason not recorded");
    assert.equal(bucketRejectionReason(null), "Reason not recorded");
  });
});
