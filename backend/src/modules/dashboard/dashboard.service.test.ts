import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryQuerySchema } from "./dashboard.validators.js";
import { jobRequestFilterFrom } from "./dashboard.service.js";

test("dashboard filters translate into job-request conditions", () => {
  assert.deepEqual(jobRequestFilterFrom({}), {});
  assert.deepEqual(
    jobRequestFilterFrom(summaryQuerySchema.parse({ from: "2026-10-01", skill: " React ", productId: "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d" })),
    {
      requestDate: { gte: new Date("2026-10-01") },
      productId: "6f1c1b7e-8c4e-4a8e-9d2a-1f0f6a1b2c3d",
      skills: { some: { skill: { normalizedName: "react" } } },
    },
  );
});

test("an inverted date range is rejected", () => {
  assert.throws(() => summaryQuerySchema.parse({ from: "2026-10-31", to: "2026-10-01" }));
});
