import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canTransitionJob,
  jobTransitionNeedsReason,
  JOB_REQUEST_STATUSES,
  parseHubspotRecordId,
} from "@placement/shared";
import { diffFields } from "../audit/audit.service.js";
import { definedOnly } from "../../utils/object.js";
import { splitSkills } from "../../utils/skills.js";
import { createCompanySchema } from "../companies/companies.validators.js";
import { createJobRequestSchema, updateJobRequestSchema } from "./job-requests.validators.js";
import { resolveJobRequestOwner } from "./owner-policy.js";

const COMPANY_ID = "0b6f7a3e-2c1d-4e5f-9a8b-7c6d5e4f3a2b";
const validJob = {
  jobId: "78E5A531-6FF2-4F04-970A-8162B9FA2A1A",
  companyId: COMPANY_ID,
  roleTitle: "MERN Developer",
  techStack: ["React", "Node.js"],
  openings: 3,
  requiredCandidateCount: 15,
  requestDate: "2026-10-27",
};

describe("HubSpot references", () => {
  test("accepts a bare ID or a link to the right record type", () => {
    assert.equal(parseHubspotRecordId("67071294016", "deal"), "67071294016");
    assert.equal(parseHubspotRecordId("https://app.hubspot.com/contacts/44403767/record/0-3/67071294016", "deal"), "67071294016");
    assert.equal(parseHubspotRecordId("https://app.hubspot.com/contacts/44403767/record/0-3/67071294016/?tab=x", "deal"), "67071294016");
    assert.equal(parseHubspotRecordId("https://app.hubspot.com/contacts/44403767/record/0-2/1234", "company"), "1234");
  });

  test("rejects a link to a different record type or anything else", () => {
    assert.equal(parseHubspotRecordId("https://app.hubspot.com/contacts/44403767/record/0-2/1234", "deal"), null);
    assert.equal(parseHubspotRecordId("https://example.com/deal", "deal"), null);
    assert.equal(parseHubspotRecordId("CMP-104", "company"), null);
  });

  test("validators normalise links to IDs and explain bad input", () => {
    const parsed = createJobRequestSchema.parse({
      ...validJob,
      hubspotDeal: "https://app.hubspot.com/contacts/44403767/record/0-3/67071294016",
    });
    assert.equal(parsed.hubspotDeal, "67071294016");
    assert.throws(() => createCompanySchema.parse({ name: "Asama.ai", hubspotCompany: "https://app.hubspot.com/contacts/1/record/0-3/9" }));
  });
});

describe("job request validation", () => {
  test("the HubSpot Job ID must be a UUID and is stored lower-case", () => {
    assert.equal(createJobRequestSchema.parse(validJob).jobId, "78e5a531-6ff2-4f04-970a-8162b9fa2a1a");
    assert.throws(() => createJobRequestSchema.parse({ ...validJob, jobId: "CMP-104" }));
  });

  test("new job requests default to open, with no products", () => {
    const parsed = createJobRequestSchema.parse(validJob);
    assert.equal(parsed.status, "OPEN");
    assert.deepEqual(parsed.eligibleProductIds, []);
  });

  test("a deadline before the request date is rejected", () => {
    assert.throws(() => createJobRequestSchema.parse({ ...validJob, deadline: "2026-10-01" }));
    assert.throws(() => updateJobRequestSchema.parse({ requestDate: "2026-10-27", deadline: "2026-10-01" }));
  });

  test("at least one skill is required", () => {
    assert.throws(() => createJobRequestSchema.parse({ ...validJob, techStack: [] }));
  });

  test("a partial update does not fill in defaults that would wipe existing data", () => {
    const parsed = definedOnly(updateJobRequestSchema.parse({ roleTitle: "AIML Engineer" }));
    assert.deepEqual(parsed, { roleTitle: "AIML Engineer" });
  });
});

describe("job request owner selection", () => {
  test("an admin can leave the employee owner blank and own the new job", () => {
    assert.deepEqual(resolveJobRequestOwner({ id: "admin-1", roles: ["ADMIN"] }), {
      ownerId: "admin-1",
      adminSelfAssignment: true,
    });
  });

  test("an admin-selected employee still goes through employee validation", () => {
    assert.deepEqual(resolveJobRequestOwner({ id: "admin-1", roles: ["ADMIN"] }, "employee-1"), {
      ownerId: "employee-1",
      adminSelfAssignment: false,
    });
  });

  test("a manager still must choose an employee and an employee defaults to themself", () => {
    assert.throws(() => resolveJobRequestOwner({ id: "manager-1", roles: ["MANAGER"] }), /Choose the employee/);
    assert.deepEqual(resolveJobRequestOwner({ id: "employee-1", roles: ["EMPLOYEE"] }), {
      ownerId: "employee-1",
      adminSelfAssignment: false,
    });
  });
});

describe("job status rules", () => {
  test("cancelled is final; filled and closed jobs can be reopened", () => {
    for (const status of JOB_REQUEST_STATUSES) {
      assert.equal(canTransitionJob("CANCELLED", status), false);
    }
    assert.ok(canTransitionJob("FILLED", "OPEN"));
    assert.ok(canTransitionJob("CLOSED", "OPEN"));
    assert.equal(canTransitionJob("DRAFT", "FILLED"), false);
  });

  test("hold, cancel and reopen need a reason; ordinary moves do not", () => {
    assert.ok(jobTransitionNeedsReason("OPEN", "ON_HOLD"));
    assert.ok(jobTransitionNeedsReason("OPEN", "CANCELLED"));
    assert.ok(jobTransitionNeedsReason("FILLED", "OPEN"));
    assert.equal(jobTransitionNeedsReason("ON_HOLD", "OPEN"), false);
    assert.equal(jobTransitionNeedsReason("OPEN", "FILLED"), false);
  });
});

describe("helpers", () => {
  test("tech stacks are split and de-duplicated case-insensitively", () => {
    assert.deepEqual(splitSkills(["SQL / Python", "python, BI", "  Power   BI "]), ["SQL", "Python", "BI", "Power BI"]);
  });

  test("diffFields reports only changed values, comparing dates by time", () => {
    const before = { name: "A", deadline: new Date("2026-11-01"), notes: null };
    assert.deepEqual(diffFields(before, { name: "A", deadline: new Date("2026-11-01"), notes: "x" }), {
      notes: { from: null, to: "x" },
    });
  });
});
