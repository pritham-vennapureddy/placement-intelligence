import assert from "node:assert/strict";
import { test } from "node:test";
import { secretMatches } from "./sheet-sync.routes.js";

test("the scheduled sync only starts with the exact shared secret", () => {
  const secret = "a".repeat(32);
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches(`${secret}x`, secret), false);
  assert.equal(secretMatches("b".repeat(32), secret), false);
  assert.equal(secretMatches(undefined, secret), false);
  assert.equal(secretMatches(secret, undefined), false);
});
