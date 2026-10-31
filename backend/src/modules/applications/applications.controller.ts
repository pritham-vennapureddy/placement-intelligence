import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { applicationsService } from "./applications.service.js";
import type { AddApplicationInput, CarryOverCandidatesQuery, CarryOverInput } from "./applications.validators.js";

const jobOf = (request: Request) => request.params.jobRequestId as string;

export const applicationsController = {
  async add(request: Request, response: Response) {
    sendCreated(response, { application: await applicationsService.add(request.user!, jobOf(request), request.body as AddApplicationInput, auditContextFrom(request)) });
  },
  async sources(request: Request, response: Response) {
    sendData(response, { jobs: await applicationsService.carryOverSources(request.user!, jobOf(request)) });
  },
  async candidates(request: Request, response: Response) {
    sendData(response, { candidates: await applicationsService.carryOverCandidates(request.user!, jobOf(request), request.query as unknown as CarryOverCandidatesQuery) });
  },
  async carryOver(request: Request, response: Response) {
    sendData(response, await applicationsService.carryOver(request.user!, jobOf(request), request.body as CarryOverInput, auditContextFrom(request)));
  },
};
