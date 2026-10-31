import type { Request, Response } from "express";
import { sendCreated, sendData, sendNoContent } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { pipelineService } from "./pipeline.service.js";
import type { CreateRoundInput, InterviewInput, NominateInput, PipelineStatusInput, UpdateRoundInput } from "./pipeline.validators.js";

const jobOf = (request: Request) => request.params.jobRequestId as string;
const param = (request: Request, name: string) => request.params[name] as string;

export const pipelineController = {
  async get(request: Request, response: Response) {
    sendData(response, { pipeline: await pipelineService.get(request.user!, jobOf(request)) });
  },
  async eligible(request: Request, response: Response) {
    sendData(response, { applications: await pipelineService.eligible(request.user!, jobOf(request)) });
  },
  async createRound(request: Request, response: Response) {
    sendCreated(response, { round: await pipelineService.createRound(request.user!, jobOf(request), request.body as CreateRoundInput, auditContextFrom(request)) });
  },
  async updateRound(request: Request, response: Response) {
    sendData(response, { round: await pipelineService.updateRound(request.user!, jobOf(request), param(request, "roundId"), request.body as UpdateRoundInput, auditContextFrom(request)) });
  },
  async deleteRound(request: Request, response: Response) {
    await pipelineService.deleteRound(request.user!, jobOf(request), param(request, "roundId"), auditContextFrom(request));
    sendNoContent(response);
  },
  async reorderRounds(request: Request, response: Response) {
    await pipelineService.reorderRounds(request.user!, jobOf(request), (request.body as { roundIds: string[] }).roundIds, auditContextFrom(request));
    sendNoContent(response);
  },
  async nominate(request: Request, response: Response) {
    sendData(response, await pipelineService.nominate(request.user!, jobOf(request), request.body as NominateInput, auditContextFrom(request)));
  },
  async changeStatus(request: Request, response: Response) {
    sendData(response, await pipelineService.changeStatus(request.user!, jobOf(request), param(request, "nominationId"), request.body as PipelineStatusInput, auditContextFrom(request)));
  },
  async withdraw(request: Request, response: Response) {
    sendData(response, await pipelineService.withdraw(request.user!, jobOf(request), param(request, "nominationId"), (request.body as { notes: string }).notes, auditContextFrom(request)));
  },
  async recordInterview(request: Request, response: Response) {
    sendData(response, await pipelineService.recordInterview(
      request.user!,
      jobOf(request),
      param(request, "nominationId"),
      param(request, "roundId"),
      request.body as InterviewInput,
      auditContextFrom(request),
    ));
  },
};
