import { prisma } from "../db.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

/**
 * Which records a user may see. Placement work is shared: every signed-in role
 * sees every company, job request and candidate ("organization"). What a role
 * may *change* is still decided by its permissions (shared/src/permissions.ts).
 * The narrower "team" and "self" scopes are kept so they can be reintroduced.
 */
export type DataScope =
  | { kind: "organization"; teamName: null }
  | { kind: "team"; teamName: string | null; ownerIds: string[] }
  | { kind: "self"; teamName: string | null; ownerIds: string[] };

export interface DataScopeRepository {
  findManagerWorkspace(userId: string): Promise<{ name: string; employeeIds: string[] } | null>;
  findMemberTeamName(userId: string): Promise<string | null>;
}

export const dataScopeRepository: DataScopeRepository = {
  async findManagerWorkspace(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        team: {
          select: {
            name: true,
            members: {
              where: { isActive: true, roles: { some: { role: { code: "EMPLOYEE" } } } },
              select: { id: true },
            },
          },
        },
      },
    });
    const team = user?.team;
    return team ? { name: team.name, employeeIds: team.members.map(({ id }) => id) } : null;
  },

  async findMemberTeamName(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { team: { select: { name: true } } },
    });
    return user?.team?.name ?? null;
  },
};

export async function resolveDataScope(
  _user: AuthenticatedUser,
  _repository: DataScopeRepository = dataScopeRepository,
): Promise<DataScope> {
  return { kind: "organization", teamName: null };
}

/** Prisma `where` fragment for job requests visible in the given scope. */
export function jobRequestScopeFilter(scope: DataScope): { psmOwnerId?: { in: string[] } } {
  return scope.kind === "organization" ? {} : { psmOwnerId: { in: scope.ownerIds } };
}

/** Whether a job request with this owner is inside the scope. */
export function isJobOwnerInScope(scope: DataScope, psmOwnerId: string | null): boolean {
  return scope.kind === "organization" || (psmOwnerId !== null && scope.ownerIds.includes(psmOwnerId));
}
