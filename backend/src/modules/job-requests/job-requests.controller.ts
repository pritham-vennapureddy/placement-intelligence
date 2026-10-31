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

  async list(request: Request, response: Response): Promise<void> {
    const { jobRequests, meta } = await jobRequestsService.list(request.user!, request.query as unknown as ListJobRequestsQuery);
    sendData(response, { jobRequests }, 200, meta);
  },

  async get(request: Request, response: Response): Promise<void> {
    sendData(response, { jobRequest: await jobRequestsService.get(request.user!, idOf(request)) });
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
