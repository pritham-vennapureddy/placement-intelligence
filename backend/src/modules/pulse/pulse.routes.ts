import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { sendCreated, sendData, sendNoContent } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { driveNotesService } from "./drive-notes.service.js";
import { monthlyPipelineService } from "./monthly-pipeline.service.js";
import {
  applicationParamsSchema,
  carryForwardSchema,
  createEntrySchema,
  crmRemarkSchema,
  entryParamsSchema,
  jobParamsSchema,
  monthQuerySchema,
  remarkParamsSchema,
  rsaReasonSchema,
  rsaReportSchema,
  rsaReviewSchema,
  rsaStudentsQuerySchema,
  updateEntrySchema,
  type CarryForwardInput,
  type CreateEntryInput,
  type CrmRemarkInput,
  type RsaReasonInput,
  type RsaReportInput,
  type RsaReviewInput,
  type RsaStudentsQuery,
  type UpdateEntryInput,
} from "./pulse.validators.js";
import { rsaReportsService } from "./rsa-reports.service.js";

const param = (request: Request, name: string) => request.params[name] as string;

/** Mounted under /api/monthly-pipeline: CRM's potential-company list plus the month's drives and students. */
export const monthlyPipelineRouter = Router();
monthlyPipelineRouter.use(authenticate, idempotency, requirePermission("report:read"));
monthlyPipelineRouter.get("/", validateQuery(monthQuerySchema), async (request: Request, response: Response) => {
  sendData(response, await monthlyPipelineService.month(request.user!, (request.query as unknown as { month: string }).month));
});
monthlyPipelineRouter.post("/entries", validateBody(createEntrySchema), async (request: Request, response: Response) => {
  sendCreated(response, { entry: await monthlyPipelineService.create(request.user!, request.body as CreateEntryInput, auditContextFrom(request)) });
});
monthlyPipelineRouter.patch("/entries/:entryId", validateParams(entryParamsSchema), validateBody(updateEntrySchema), async (request: Request, response: Response) => {
  sendData(response, { entry: await monthlyPipelineService.update(request.user!, param(request, "entryId"), request.body as UpdateEntryInput, auditContextFrom(request)) });
});
monthlyPipelineRouter.delete("/entries/:entryId", validateParams(entryParamsSchema), async (request: Request, response: Response) => {
  await monthlyPipelineService.remove(request.user!, param(request, "entryId"), auditContextFrom(request));
  sendNoContent(response);
});
monthlyPipelineRouter.post("/carry-forward", validateBody(carryForwardSchema), async (request: Request, response: Response) => {
  sendData(response, await monthlyPipelineService.carryForward(request.user!, request.body as CarryForwardInput, auditContextFrom(request)));
});

/** Mounted under /api/job-requests/:jobRequestId/drive-notes: CRM remarks and the RSA review of a drive. */
export const driveNotesRouter = Router({ mergeParams: true });
driveNotesRouter.use(authenticate, idempotency, requirePermission("job:read"));
driveNotesRouter.get("/", validateParams(jobParamsSchema), async (request: Request, response: Response) => {
  sendData(response, await driveNotesService.get(request.user!, param(request, "jobRequestId")));
});
driveNotesRouter.post("/crm-remarks", validateParams(jobParamsSchema), validateBody(crmRemarkSchema), async (request: Request, response: Response) => {
  sendCreated(response, { remark: await driveNotesService.addRemark(request.user!, param(request, "jobRequestId"), request.body as CrmRemarkInput, auditContextFrom(request)) });
});
driveNotesRouter.put("/crm-remarks/:remarkId", validateParams(remarkParamsSchema), validateBody(crmRemarkSchema), async (request: Request, response: Response) => {
  sendData(response, { remark: await driveNotesService.updateRemark(request.user!, param(request, "jobRequestId"), param(request, "remarkId"), request.body as CrmRemarkInput, auditContextFrom(request)) });
});
driveNotesRouter.delete("/crm-remarks/:remarkId", validateParams(remarkParamsSchema), async (request: Request, response: Response) => {
  await driveNotesService.deleteRemark(request.user!, param(request, "jobRequestId"), param(request, "remarkId"), auditContextFrom(request));
  sendNoContent(response);
});
driveNotesRouter.put("/rsa-review", validateParams(jobParamsSchema), validateBody(rsaReviewSchema), async (request: Request, response: Response) => {
  sendData(response, { rsaReview: await driveNotesService.setRsaReview(request.user!, param(request, "jobRequestId"), request.body as RsaReviewInput, auditContextFrom(request)) });
});

/** Mounted under /api/rsa: the RSA team's student worklist and per-student reports. */
export const rsaRouter = Router();
rsaRouter.use(authenticate, idempotency, requirePermission("candidate:read"));
rsaRouter.get("/students", validateQuery(rsaStudentsQuerySchema), async (request: Request, response: Response) => {
  sendData(response, await rsaReportsService.students(request.user!, request.query as unknown as RsaStudentsQuery));
});
rsaRouter.put("/applications/:applicationId/reason", validateParams(applicationParamsSchema), validateBody(rsaReasonSchema), async (request: Request, response: Response) => {
  sendData(response, await rsaReportsService.setReason(request.user!, param(request, "applicationId"), (request.body as RsaReasonInput).rejectionTagId, auditContextFrom(request)));
});
rsaRouter.put("/applications/:applicationId/report", validateParams(applicationParamsSchema), validateBody(rsaReportSchema), async (request: Request, response: Response) => {
  sendData(response, await rsaReportsService.setReport(request.user!, param(request, "applicationId"), request.body as RsaReportInput, auditContextFrom(request)));
});
