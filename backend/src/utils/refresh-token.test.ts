import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshToken, hashRefreshToken } from "./refresh-token.js";

test("refresh tokens are random and stored as one-way, secret-bound hashes", () => {
  const first = createRefreshToken();
  const second = createRefreshToken();

  assert.notEqual(first, second);
  assert.notEqual(hashRefreshToken(first, "secret-a"), first);
  assert.equal(hashRefreshToken(first, "secret-a"), hashRefreshToken(first, "secret-a"));
  assert.notEqual(hashRefreshToken(first, "secret-a"), hashRefreshToken(first, "secret-b"));
});
