import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePassword } from "./teams.service.js";
import { resetPasswordSchema, updateUserSchema } from "./teams.validators.js";

test("generated passwords are long enough and avoid look-alike characters", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 50; index++) {
    const password = generatePassword();
    assert.equal(password.length, 14);
    assert.doesNotMatch(password, /[0O1lI]/);
    seen.add(password);
  }
  assert.equal(seen.size, 50);
});

test("a user edit must change something, and a typed reset password needs 12+ characters", () => {
  assert.equal(updateUserSchema.safeParse({}).success, false);
  assert.equal(updateUserSchema.safeParse({ role: "STAKEHOLDER" }).success, true);
  assert.equal(resetPasswordSchema.safeParse({}).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: "short" }).success, false);
});
