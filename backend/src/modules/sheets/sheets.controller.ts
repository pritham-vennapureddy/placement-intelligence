import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { sheetsService } from "./sheets.service.js";
import type { CreateConnectionInput, CreateMappingInput, HeaderParams, HeaderQuery } from "./sheets.validators.js";

export const sheetsController = {
  async setup(request: Request, response: Response): Promise<void> {
    sendData(response, await sheetsService.getSetup(request.user!));
  },

  async connect(request: Request, response: Response): Promise<void> {
    const result = await sheetsService.createConnection(
      request.body as CreateConnectionInput,
      request.user!,
      auditContextFrom(request),
    );
    sendCreated(response, result);
  },

  async tabs(request: Request, response: Response): Promise<void> {
    const tabs = await sheetsService.listTabs(request.params.connectionId as string, request.user!);
    sendData(response, { tabs });
  },

  async headers(request: Request, response: Response): Promise<void> {
    const { connectionId, sheetId } = request.params as unknown as HeaderParams;
    const { row } = request.query as unknown as HeaderQuery;
    const headers = await sheetsService.getHeaders(connectionId, sheetId, row, request.user!);
    sendData(response, { headers });
  },

  async saveMapping(request: Request, response: Response): Promise<void> {
    const mapping = await sheetsService.saveMapping(
      request.params.connectionId as string,
      request.body as CreateMappingInput,
      request.user!,
      auditContextFrom(request),
    );
    sendCreated(response, { mapping });
  },
};
