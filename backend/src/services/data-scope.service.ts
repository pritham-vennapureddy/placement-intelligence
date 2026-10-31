import { prisma } from "../db.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

/**
 * Which records a user may see:
 * - organization: administrators see everything
 * - team: managers see job requests owned by the PSMs of the team they lead
 * - self: everyone else sees job requests they own
 */
export type DataScope =
  | { kind: "organization"; teamName: null }
  | { kind: "team"; teamName: string | null; ownerIds: string[] }
  | { kind: "self"; teamName: string | null; ownerIds: string[] };

export interface DataScopeRepository {
  findLedTeam(userId: string): Promise<{ name: string; psmIds: string[] } | null>;
  findMemberTeamName(userId: string): Promise<string | null>;
}

export const dataScopeRepository: DataScopeRepository = {
  async findLedTeam(userId) {
    const team = await prisma.team.findFirst({
      where: { teamLeadId: userId },
      select: {
        name: true,
        members: {
          where: { isActive: true, roles: { some: { role: { code: "PSM" } } } },
          select: { id: true },
        },
      },
    });
    return team ? { name: team.name, psmIds: team.members.map(({ id }) => id) } : null;
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
  user: AuthenticatedUser,
  repository: DataScopeRepository = dataScopeRepository,
): Promise<DataScope> {
  if (user.roles.includes("ADMIN")) {
    return { kind: "organization", teamName: null };
  }

  if (user.roles.includes("MANAGER")) {
    const team = await repository.findLedTeam(user.id);
    return { kind: "team", teamName: team?.name ?? null, ownerIds: team?.psmIds ?? [] };
  }

  return { kind: "self", teamName: await repository.findMemberTeamName(user.id), ownerIds: [user.id] };
}

/** Prisma `where` fragment for job requests visible in the given scope. */
export function jobRequestScopeFilter(scope: DataScope): { psmOwnerId?: { in: string[] } } {
  return scope.kind === "organization" ? {} : { psmOwnerId: { in: scope.ownerIds } };
}

/** Whether a job request with this owner is inside the scope. */
export function isJobOwnerInScope(scope: DataScope, psmOwnerId: string | null): boolean {
  return scope.kind === "organization" || (psmOwnerId !== null && scope.ownerIds.includes(psmOwnerId));
}
