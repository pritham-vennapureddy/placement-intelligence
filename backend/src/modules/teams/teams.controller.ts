import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { teamsService } from "./teams.service.js";
import type { CreateTeamInput, CreateUserInput, TeamMembersInput } from "./teams.validators.js";

export const teamsController = {
  async list(request: Request, response: Response): Promise<void> {
    sendData(response, { teams: await teamsService.listVisibleTeams(request.user!) });
  },

  async listUsers(_request: Request, response: Response): Promise<void> {
    sendData(response, { users: await teamsService.listAssignableUsers() });
  },

  async create(request: Request, response: Response): Promise<void> {
    const team = await teamsService.createTeam(request.body as CreateTeamInput, auditContextFrom(request));
    sendCreated(response, { team });
  },

  async createUser(request: Request, response: Response): Promise<void> {
    const user = await teamsService.createUser(request.body as CreateUserInput, auditContextFrom(request));
    sendCreated(response, { user });
  },

  async updateMembers(request: Request, response: Response): Promise<void> {
    const team = await teamsService.updateMembers(
      request.params.teamId as string,
      request.body as TeamMembersInput,
      auditContextFrom(request),
    );
    sendData(response, { team });
  },
};
