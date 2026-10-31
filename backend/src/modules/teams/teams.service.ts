import { hash } from "bcryptjs";
import { hasPermission } from "@placement/shared";
import { inTransaction } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { teamsRepository } from "./teams.repository.js";
import type { CreateTeamInput, CreateUserInput, TeamMembersInput } from "./teams.validators.js";

const hasRole = (roles: { role: { code: string } }[], code: string) => roles.some(({ role }) => role.code === code);

export const teamsService = {
  /** Administrators see every team; managers see the team they lead. */
  async listVisibleTeams(user: AuthenticatedUser) {
    if (hasPermission(user.roles, "team:manage")) {
      return teamsRepository.listTeams();
    }
    if (hasPermission(user.roles, "team:read")) {
      const team = await teamsRepository.findTeamLedBy(user.id);
      return team ? [team] : [];
    }
    throw new ApiError(403, "FORBIDDEN", "Only administrators and team leads can view team management.");
  },

  listAssignableUsers() {
    return teamsRepository.listAssignableUsers();
  },

  createTeam(input: CreateTeamInput, audit: AuditContext) {
    return inTransaction(async (transaction) => {
      const { id } = await teamsRepository.createTeam(transaction, input.name, audit.actorId!);
      await recordAudit(transaction, audit, {
        action: "TEAM_CREATED",
        entityType: "Team",
        entityId: id,
        metadata: { name: input.name },
      });
      return teamsRepository.findTeamWithMembers(id, transaction);
    });
  },

  async createUser(input: CreateUserInput, audit: AuditContext) {
    if (input.role === "PSM" && !input.teamId) {
      throw new ApiError(400, "PSM_TEAM_REQUIRED", "Assign each PSM to a team when creating the account.");
    }
    if (input.teamId) {
      const team = await teamsRepository.findTeam(input.teamId);
      if (!team) {
        throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
      }
      if (input.role === "MANAGER" && team.teamLeadId) {
        throw new ApiError(409, "TEAM_LEAD_EXISTS", "This team already has a team lead.");
      }
    }

    const email = input.email.toLowerCase();
    if (await teamsRepository.emailExists(email)) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }

    const passwordHash = await hash(input.password, 12);
    return inTransaction(async (transaction) => {
      const created = await teamsRepository.createUserWithRole(transaction, {
        email,
        fullName: input.fullName,
        passwordHash,
        role: input.role,
        ...(input.teamId ? { teamId: input.teamId } : {}),
      });
      if (input.role === "MANAGER" && input.teamId) {
        await teamsRepository.setTeamLead(transaction, input.teamId, created.id);
      }
      await recordAudit(transaction, audit, {
        action: "USER_CREATED",
        entityType: "User",
        entityId: created.id,
        metadata: { role: input.role, teamId: input.teamId ?? null },
      });
      return created;
    });
  },

  async updateMembers(teamId: string, input: TeamMembersInput, audit: AuditContext) {
    const psmIds = [...new Set(input.psmIds)];
    const { teamLeadId } = input;
    const team = await teamsRepository.findTeam(teamId);
    if (!team) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
    }

    const selectedIds = [...new Set([...psmIds, ...(teamLeadId ? [teamLeadId] : [])])];
    const selectedUsers = await teamsRepository.findActiveUsersWithRoles(selectedIds);
    if (selectedUsers.length !== selectedIds.length) {
      throw new ApiError(400, "INVALID_TEAM_MEMBER", "One or more selected users are unavailable.");
    }

    const lead = teamLeadId ? selectedUsers.find(({ id }) => id === teamLeadId) : undefined;
    if (teamLeadId && !(lead && hasRole(lead.roles, "MANAGER"))) {
      throw new ApiError(400, "INVALID_TEAM_LEAD", "The team lead must have a Manager account.");
    }
    if (psmIds.some((id) => !selectedUsers.some((user) => user.id === id && hasRole(user.roles, "PSM")))) {
      throw new ApiError(400, "INVALID_PSM", "Team members must have PSM accounts.");
    }

    return inTransaction(async (transaction) => {
      await teamsRepository.replaceMembers(transaction, team, teamLeadId, psmIds);
      await recordAudit(transaction, audit, {
        action: "TEAM_MEMBERS_UPDATED",
        entityType: "Team",
        entityId: team.id,
        metadata: { teamLeadId, psmIds, previousTeamLeadId: team.teamLeadId },
      });
      return teamsRepository.findTeamWithMembers(team.id, transaction);
    });
  },
};
