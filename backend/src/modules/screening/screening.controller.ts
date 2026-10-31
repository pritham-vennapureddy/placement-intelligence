import type { Request, Response } from "express";
import type { InternalStage } from "@placement/shared";
import { sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { screeningService } from "./screening.service.js";
import type { AddToStageInput, DecisionInput, StageCandidatesQuery, UpdateStageInput } from "./screening.validators.js";

const jobOf = (request: Request) => request.params.jobRequestId as string;
const stageOf = (request: Request) => request.params.stage as InternalStage;

export const screeningController = {
  async get(request: Request, response: Response): Promise<void> {
    sendData(response, { process: await screeningService.get(request.user!, jobOf(request)) });
  },

  async updateNotes(request: Request, response: Response): Promise<void> {
    const { shortlistingNotes } = request.body as { shortlistingNotes: string | null };
    sendData(response, { process: await screeningService.updateNotes(request.user!, jobOf(request), shortlistingNotes, auditContextFrom(request)) });
  },

  async updateStage(request: Request, response: Response): Promise<void> {
    const process = await screeningService.updateStage(request.user!, jobOf(request), stageOf(request), request.body as UpdateStageInput, auditContextFrom(request));
    sendData(response, { process });
  },

  async listCandidates(request: Request, response: Response): Promise<void> {
    const { rows, meta } = await screeningService.listCandidates(request.user!, jobOf(request), stageOf(request), request.query as unknown as StageCandidatesQuery);
    sendData(response, { rows }, 200, meta);
  },

  async decide(request: Request, response: Response): Promise<void> {
    sendData(response, await screeningService.decide(
      request.user!,
      jobOf(request),
      stageOf(request),
      request.params.applicationId as string,
      request.body as DecisionInput,
      auditContextFrom(request),
    ));
  },

  async addToStage(request: Request, response: Response): Promise<void> {
    sendData(response, await screeningService.addToStage(request.user!, jobOf(request), stageOf(request), request.body as AddToStageInput, auditContextFrom(request)));
  },
};
