import type { Request, Response } from "express";
import { sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { candidatesService } from "./candidates.service.js";
import type { ListCandidatesQuery, UpdateCandidateInput } from "./candidates.validators.js";

export const candidatesController = {
  async list(request: Request, response: Response) {
    const { candidates, meta } = await candidatesService.list(request.user!, request.query as unknown as ListCandidatesQuery);
    sendData(response, { candidates }, 200, meta);
  },
  async get(request: Request, response: Response) {
    sendData(response, { candidate: await candidatesService.get(request.user!, request.params.candidateId as string) });
  },
  async update(request: Request, response: Response) {
    const candidate = await candidatesService.update(request.user!, request.params.candidateId as string, request.body as UpdateCandidateInput, auditContextFrom(request));
    sendData(response, { candidate });
  },
};
