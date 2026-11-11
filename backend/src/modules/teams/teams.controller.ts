import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { teamsService } from "./teams.service.js";
import type { CreateUserInput, ResetPasswordInput, UpdateUserInput } from "./teams.validators.js";

export const teamsController = {
  async listUsers(_request: Request, response: Response): Promise<void> {
    sendData(response, { users: await teamsService.listUsers() });
  },

  async createUser(request: Request, response: Response): Promise<void> {
    const user = await teamsService.createUser(request.body as CreateUserInput, auditContextFrom(request));
    sendCreated(response, { user });
  },

  async updateUser(request: Request, response: Response): Promise<void> {
    const user = await teamsService.updateUser(request.params.userId as string, request.body as UpdateUserInput, auditContextFrom(request));
    sendData(response, { user });
  },

  async resetPassword(request: Request, response: Response): Promise<void> {
    const result = await teamsService.resetPassword(request.params.userId as string, request.body as ResetPasswordInput, auditContextFrom(request));
    response.setHeader("Cache-Control", "no-store");
    sendData(response, result);
  },

  async deleteUser(request: Request, response: Response): Promise<void> {
    sendData(response, await teamsService.deleteUser(request.params.userId as string, auditContextFrom(request)));
  },
};
