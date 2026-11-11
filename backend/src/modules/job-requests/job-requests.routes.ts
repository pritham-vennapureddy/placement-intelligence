import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { jobRequestsController } from "./job-requests.controller.js";
import {
  changeStatusSchema,
  createRecruitmentBatchSchema,
  createJobRequestSchema,
  internalSheetTabsQuerySchema,
  jobRequestIdParamsSchema,
  listJobRequestsQuerySchema,
  reassignOwnerSchema,
  recruitmentBatchParamsSchema,
  updateJobRequestSchema,
  updateRecruitmentBatchSchema,
} from "./job-requests.validators.js";

export const jobRequestsRouter = Router();

jobRequestsRouter.use(authenticate, idempotency, requirePermission("job:read"));

const withId = validateParams(jobRequestIdParamsSchema);

jobRequestsRouter.get("/", validateQuery(listJobRequestsQuerySchema), jobRequestsController.list);
jobRequestsRouter.get("/progress", jobRequestsController.progress);
jobRequestsRouter.post("/", requirePermission("job:write"), validateBody(createJobRequestSchema), jobRequestsController.create);
jobRequestsRouter.get("/:jobRequestId", withId, jobRequestsController.get);
jobRequestsRouter.post("/:jobRequestId/recruitment-batches", requirePermission("job:write"), withId, validateBody(createRecruitmentBatchSchema), jobRequestsController.createRecruitmentBatch);
jobRequestsRouter.patch(
  "/:jobRequestId/recruitment-batches/:batchId",
  requirePermission("job:write"),
  validateParams(recruitmentBatchParamsSchema),
  validateBody(updateRecruitmentBatchSchema),
  jobRequestsController.updateRecruitmentBatch,
);
jobRequestsRouter.get(
  "/:jobRequestId/internal-sheet/tabs",
  withId,
  validateQuery(internalSheetTabsQuerySchema),
  jobRequestsController.internalSheetTabs,
);
jobRequestsRouter.patch(
  "/:jobRequestId",
  requirePermission("job:write"),
  withId,
  validateBody(updateJobRequestSchema),
  jobRequestsController.update,
);
jobRequestsRouter.delete("/:jobRequestId", requirePermission("job:assign"), withId, jobRequestsController.delete);
jobRequestsRouter.post(
  "/:jobRequestId/status",
  requirePermission("job:write"),
  withId,
  validateBody(changeStatusSchema),
  jobRequestsController.changeStatus,
);
jobRequestsRouter.post(
  "/:jobRequestId/owner",
  requirePermission("job:assign"),
  withId,
  validateBody(reassignOwnerSchema),
  jobRequestsController.reassign,
);
