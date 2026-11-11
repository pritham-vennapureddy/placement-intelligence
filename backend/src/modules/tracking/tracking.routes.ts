import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { trackingController } from "./tracking.controller.js";
import {
  bulkStudentSupportSchema,
  createStatusOptionSchema,
  guidanceJobSearchSchema,
  guidanceViewQuerySchema,
  guidanceSessionSchema,
  jobParamsSchema,
  myWorkQuerySchema,
  processStatusSchema,
  reorderStatusOptionsSchema,
  sessionParamsSchema,
  statusOptionParamsSchema,
  studentSupportSchema,
  supportParamsSchema,
  updateStatusOptionSchema,
} from "./tracking.validators.js";

/** Mounted under /api/job-requests/:jobRequestId/tracking: company process status and the not-shared list. */
export const jobTrackingRouter = Router({ mergeParams: true });
jobTrackingRouter.use(authenticate, idempotency, requirePermission("job:read"));
jobTrackingRouter.get("/", validateParams(jobParamsSchema), trackingController.jobTracking);
jobTrackingRouter.put("/process-status", requirePermission("pipeline:write"), validateParams(jobParamsSchema), validateBody(processStatusSchema), trackingController.setProcessStatus);

/** Mounted under /api/guidance. Open to every PSM, across job ownership. */
export const guidanceRouter = Router();
guidanceRouter.use(authenticate, idempotency, requirePermission("pipeline:write"));
guidanceRouter.get("/jobs", validateQuery(guidanceJobSearchSchema), trackingController.searchGuidanceJobs);
guidanceRouter.get("/jobs/:jobRequestId", validateParams(jobParamsSchema), validateQuery(guidanceViewQuerySchema), trackingController.guidanceForJob);
guidanceRouter.post("/jobs/:jobRequestId/sessions", validateParams(jobParamsSchema), validateBody(guidanceSessionSchema), trackingController.addSession);
guidanceRouter.delete("/sessions/:sessionId", validateParams(sessionParamsSchema), trackingController.deleteSession);
// Per-student Guidance / RSA status. Anyone with pipeline:write may set or correct it.
guidanceRouter.put("/jobs/:jobRequestId/support", validateParams(jobParamsSchema), validateBody(bulkStudentSupportSchema), trackingController.bulkStudentSupport);
guidanceRouter.put("/applications/:applicationId/support/:kind", validateParams(supportParamsSchema), validateBody(studentSupportSchema), trackingController.setStudentSupport);
guidanceRouter.delete("/applications/:applicationId/support/:kind", validateParams(supportParamsSchema), trackingController.clearStudentSupport);
// The Guidance / RSA status lists, managed by the team.
guidanceRouter.get("/status-options", trackingController.listStatusOptions);
guidanceRouter.post("/status-options", validateBody(createStatusOptionSchema), trackingController.createStatusOption);
guidanceRouter.put("/status-options/order", validateBody(reorderStatusOptionsSchema), trackingController.reorderStatusOptions);
guidanceRouter.patch("/status-options/:optionId", validateParams(statusOptionParamsSchema), validateBody(updateStatusOptionSchema), trackingController.updateStatusOption);
guidanceRouter.delete("/status-options/:optionId", validateParams(statusOptionParamsSchema), trackingController.deleteStatusOption);

/** Mounted under /api/my-work. */
export const myWorkRouter = Router();
myWorkRouter.get("/", authenticate, requirePermission("dashboard:read"), validateQuery(myWorkQuerySchema), trackingController.myWork);
