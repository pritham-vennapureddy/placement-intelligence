import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/authorize.js";
import { idempotency } from "../../middleware/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate.js";
import { jobRequestsController } from "./job-requests.controller.js";
import {
  changeStatusSchema,
  createJobRequestSchema,
  jobRequestIdParamsSchema,
  listJobRequestsQuerySchema,
  reassignOwnerSchema,
  updateJobRequestSchema,
} from "./job-requests.validators.js";

export const jobRequestsRouter = Router();

jobRequestsRouter.use(authenticate, idempotency, requirePermission("job:read"));

const withId = validateParams(jobRequestIdParamsSchema);

jobRequestsRouter.get("/", validateQuery(listJobRequestsQuerySchema), jobRequestsController.list);
jobRequestsRouter.post("/", requirePermission("job:write"), validateBody(createJobRequestSchema), jobRequestsController.create);
jobRequestsRouter.get("/:jobRequestId", withId, jobRequestsController.get);
jobRequestsRouter.patch(
  "/:jobRequestId",
  requirePermission("job:write"),
  withId,
  validateBody(updateJobRequestSchema),
  jobRequestsController.update,
);
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
