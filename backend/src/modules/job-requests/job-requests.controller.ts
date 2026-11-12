import type { Request, Response } from "express";
import { sendCreated, sendData } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { jobRequestsService } from "./job-requests.service.js";
import type {
  ChangeStatusInput,
  CreateJobRequestInput,
  ListJobRequestsQuery,
  ReassignOwnerInput,
  UpdateJobRequestInput,
} from "./job-requests.validators.js";

const idOf = (request: Request) => request.params.jobRequestId as string;

export const jobRequestsController = {
  async progress(request: Request, response: Response): Promise<void> {
    sendData(response, { jobs: await jobRequestsService.progress(request.user!) });
  },

  async processSummary(request: Request, response: Response): Promise<void> {
    sendData(response, { groups: await jobRequestsService.processSummary(request.user!, request.query as unknown as ListJobRequestsQuery) });
  },

  async list(request: Request, response: Response): Promise<void> {
    const { jobRequests, meta } = await jobRequestsService.list(request.user!, request.query as unknown as ListJobRequestsQuery);
    sendData(response, { jobRequests }, 200, meta);
  },

  async get(request: Request, response: Response): Promise<void> {
    sendData(response, { jobRequest: await jobRequestsService.get(request.user!, idOf(request)) });
  },

  async createRecruitmentBatch(request: Request, response: Response): Promise<void> {
    sendCreated(response, { recruitmentBatch: await jobRequestsService.createRecruitmentBatch(
      request.user!, idOf(request), request.body as import("./job-requests.validators.js").CreateRecruitmentBatchInput, auditContextFrom(request),
    ) });
  },

  async updateRecruitmentBatch(request: Request, response: Response): Promise<void> {
    sendData(response, { recruitmentBatch: await jobRequestsService.updateRecruitmentBatch(
      request.user!, idOf(request), request.params.batchId as string,
      request.body as import("./job-requests.validators.js").UpdateRecruitmentBatchInput, auditContextFrom(request),
    ) });
  },

  async deleteRecruitmentBatch(request: Request, response: Response): Promise<void> {
    sendData(response, { recruitmentBatch: await jobRequestsService.deleteRecruitmentBatch(
      request.user!, idOf(request), request.params.batchId as string, auditContextFrom(request),
    ) });
  },

  async internalSheetTabs(request: Request, response: Response): Promise<void> {
    const { batchId, url } = request.query as { batchId?: string; url?: string };
    sendData(response, await jobRequestsService.internalSheetTabs(request.user!, idOf(request), batchId, url));
  },

  async create(request: Request, response: Response): Promise<void> {
    const job = await jobRequestsService.create(request.user!, request.body as CreateJobRequestInput, auditContextFrom(request));
    sendCreated(response, { jobRequest: { id: job.id, jobId: job.jobId } });
  },

  async update(request: Request, response: Response): Promise<void> {
    const jobRequest = await jobRequestsService.update(
      request.user!,
      idOf(request),
      request.body as UpdateJobRequestInput,
      auditContextFrom(request),
    );
    sendData(response, { jobRequest });
  },

  async delete(request: Request, response: Response): Promise<void> {
    sendData(response, {
      jobRequest: await jobRequestsService.delete(request.user!, idOf(request), auditContextFrom(request)),
    });
  },

  async changeStatus(request: Request, response: Response): Promise<void> {
    const jobRequest = await jobRequestsService.changeStatus(
      request.user!,
      idOf(request),
      request.body as ChangeStatusInput,
      auditContextFrom(request),
    );
    sendData(response, { jobRequest });
  },

  async reassign(request: Request, response: Response): Promise<void> {
    const jobRequest = await jobRequestsService.reassign(
      request.user!,
      idOf(request),
      request.body as ReassignOwnerInput,
      auditContextFrom(request),
    );
    sendData(response, { jobRequest });
  },
};
