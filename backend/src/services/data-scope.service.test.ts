import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jobRequestScopeFilter, resolveDataScope, type DataScopeRepository } from "./data-scope.service.js";

const repository = (workspace: { name: string; employeeIds: string[] } | null, memberTeam: string | null): DataScopeRepository => ({
  findManagerWorkspace: async () => workspace,
  findMemberTeamName: async () => memberTeam,
});

describe("resolveDataScope", () => {
  test("every role sees the whole shared workspace", async () => {
    for (const roles of [["ADMIN"], ["MANAGER"], ["EMPLOYEE"], ["STAKEHOLDER"]]) {
      const scope = await resolveDataScope({ id: "u", roles }, repository(null, null));
      assert.equal(scope.kind, "organization", roles.join());
      assert.deepEqual(jobRequestScopeFilter(scope), {});
    }
  });

  test("a narrower scope still filters by owner", () => {
    assert.deepEqual(jobRequestScopeFilter({ kind: "self", teamName: null, ownerIds: ["p1"] }), { psmOwnerId: { in: ["p1"] } });
  });
});
