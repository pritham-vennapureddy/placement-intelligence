import type { Request, Response } from "express";
import { sendCreated, sendData, sendNoContent } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { trackingService } from "./tracking.service.js";
import type { StudentSupportKind } from "@placement/shared";
import { supportStatusService } from "./support-status.service.js";
import type { BulkStudentSupportInput, CreateStatusOptionInput, GuidanceSessionInput, ReorderStatusOptionsInput, UpdateStatusOptionInput, GuidanceViewQuery, MyWorkQuery, ProcessStatusInput, StudentSupportInput } from "./tracking.validators.js";

const param = (request: Request, name: string) => request.params[name] as string;

export const trackingController = {
  async jobTracking(request: Request, response: Response) {
    sendData(response, await trackingService.jobTracking(request.user!, param(request, "jobRequestId")));
  },
  async setProcessStatus(request: Request, response: Response) {
    sendData(response, await trackingService.setProcessStatus(request.user!, param(request, "jobRequestId"), request.body as ProcessStatusInput, auditContextFrom(request)));
  },
  async searchGuidanceJobs(request: Request, response: Response) {
    sendData(response, { jobs: await trackingService.searchGuidanceJobs(request.user!, (request.query as { q?: string }).q) });
  },
  async guidanceForJob(request: Request, response: Response) {
    sendData(response, await trackingService.guidanceForJob(request.user!, param(request, "jobRequestId"), request.query as unknown as GuidanceViewQuery));
  },
  async addSession(request: Request, response: Response) {
    sendCreated(response, { session: await trackingService.addSession(request.user!, param(request, "jobRequestId"), request.body as GuidanceSessionInput, auditContextFrom(request)) });
  },
  async deleteSession(request: Request, response: Response) {
    await trackingService.deleteSession(request.user!, param(request, "sessionId"), auditContextFrom(request));
    sendNoContent(response);
  },
  async setStudentSupport(request: Request, response: Response) {
    const kind = param(request, "kind") as StudentSupportKind;
    sendData(response, await trackingService.setStudentSupport(request.user!, param(request, "applicationId"), kind, request.body as StudentSupportInput, auditContextFrom(request)));
  },
  async bulkStudentSupport(request: Request, response: Response) {
    sendData(response, await trackingService.bulkStudentSupport(request.user!, param(request, "jobRequestId"), request.body as BulkStudentSupportInput, auditContextFrom(request)));
  },
  async clearStudentSupport(request: Request, response: Response) {
    await trackingService.clearStudentSupport(request.user!, param(request, "applicationId"), param(request, "kind") as StudentSupportKind, auditContextFrom(request));
    sendNoContent(response);
  },
  async listStatusOptions(_request: Request, response: Response) {
    sendData(response, { statusOptions: await supportStatusService.list() });
  },
  async createStatusOption(request: Request, response: Response) {
    sendCreated(response, { statusOption: await supportStatusService.create(request.user!, request.body as CreateStatusOptionInput, auditContextFrom(request)) });
  },
  async updateStatusOption(request: Request, response: Response) {
    sendData(response, { statusOption: await supportStatusService.update(request.user!, param(request, "optionId"), request.body as UpdateStatusOptionInput, auditContextFrom(request)) });
  },
  async deleteStatusOption(request: Request, response: Response) {
    sendData(response, await supportStatusService.delete(request.user!, param(request, "optionId"), auditContextFrom(request)));
  },
  async reorderStatusOptions(request: Request, response: Response) {
    sendData(response, await supportStatusService.reorder(request.user!, request.body as ReorderStatusOptionsInput, auditContextFrom(request)));
  },
  async myWork(request: Request, response: Response) {
    sendData(response, await trackingService.myWork(request.user!, request.query as MyWorkQuery));
  },
};
