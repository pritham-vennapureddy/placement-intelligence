import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jobRequestScopeFilter, resolveDataScope, type DataScopeRepository } from "./data-scope.service.js";

const repository = (ledTeam: { name: string; psmIds: string[] } | null, memberTeam: string | null): DataScopeRepository => ({
  findLedTeam: async () => ledTeam,
  findMemberTeamName: async () => memberTeam,
});

describe("resolveDataScope", () => {
  test("administrators see the whole organisation", async () => {
    const scope = await resolveDataScope({ id: "a", roles: ["ADMIN", "MANAGER"] }, repository(null, null));
    assert.equal(scope.kind, "organization");
    assert.deepEqual(jobRequestScopeFilter(scope), {});
  });

  test("managers see job requests owned by the PSMs of the team they lead", async () => {
    const scope = await resolveDataScope(
      { id: "m", roles: ["MANAGER"] },
      repository({ name: "South", psmIds: ["p1", "p2"] }, null),
    );
    assert.deepEqual(scope, { kind: "team", teamName: "South", ownerIds: ["p1", "p2"] });
    assert.deepEqual(jobRequestScopeFilter(scope), { psmOwnerId: { in: ["p1", "p2"] } });
  });

  test("a manager without a team sees nothing rather than everything", async () => {
    const scope = await resolveDataScope({ id: "m", roles: ["MANAGER"] }, repository(null, null));
    assert.deepEqual(jobRequestScopeFilter(scope), { psmOwnerId: { in: [] } });
  });

  test("PSMs and viewers see only job requests they own", async () => {
    for (const role of ["PSM", "VIEWER"]) {
      const scope = await resolveDataScope({ id: "p1", roles: [role] }, repository(null, "South"));
      assert.deepEqual(scope, { kind: "self", teamName: "South", ownerIds: ["p1"] });
    }
  });
});
